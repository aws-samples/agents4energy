#!/usr/bin/env tsx
// Invoke the AgentCore harness with a specific agent config loaded from GraphQL.
//
// Usage:
//   npx tsx scripts/invoke-agent.ts <agentSlug> "Your prompt here"
//   npx tsx scripts/invoke-agent.ts demo-agent "What agent are you?"
//
// Auth credentials are read from scripts/.env.local (TEST_USER_EMAIL / TEST_USER_PASSWORD).
// Harness ARN is read from web/deployment-info.json.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local
const envPath = resolve(root, 'scripts/.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const email = env.TEST_USER_EMAIL;
const password = env.TEST_USER_PASSWORD;
if (!email || !password) {
  console.error('Missing TEST_USER_EMAIL or TEST_USER_PASSWORD in scripts/.env.local');
  process.exit(1);
}

// Load Amplify config
const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const { user_pool_client_id: clientId, aws_region: authRegion } = amplifyOutputs.auth;
const graphqlUrl: string = amplifyOutputs.data.url;

// Load harness ARN
const deploymentInfo = JSON.parse(readFileSync(resolve(root, 'web/deployment-info.json'), 'utf8'));
const harnessArn: string = deploymentInfo.harnesses?.MyHarness?.harnessArn;
if (!harnessArn) {
  console.error('No harness ARN in web/deployment-info.json');
  process.exit(1);
}
const region = harnessArn.split(':')[3];

// Parse args
const agentSlug = process.argv[2];
const promptText = process.argv.slice(3).join(' ') || 'Hello! What agent are you?';

if (!agentSlug) {
  console.error('Usage: npx tsx scripts/invoke-agent.ts <agentSlug> "Your prompt"');
  process.exit(1);
}

// Authenticate
const cognito = new CognitoIdentityProviderClient({ region: authRegion });
const authResult = await cognito.send(
  new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }),
);
const accessToken = authResult.AuthenticationResult?.AccessToken;
const idToken = authResult.AuthenticationResult?.IdToken;
if (!accessToken || !idToken) {
  console.error('Authentication failed');
  process.exit(1);
}

// Look up agent by slug
const query = `
  query ListAgents {
    listAgents {
      items {
        id name slug description systemPromptText modelId enabled
      }
    }
  }
`;

const gqlResult = await fetch(graphqlUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: idToken },
  body: JSON.stringify({ query }),
});
const gqlData = await gqlResult.json() as any;
const agents = gqlData.data?.listAgents?.items ?? [];
const agent = agents.find((a: any) => a.slug === agentSlug);

if (!agent) {
  console.error(`Agent with slug "${agentSlug}" not found.`);
  console.error('Available agents:', agents.map((a: any) => `${a.slug} (${a.name})`).join(', ') || 'none');
  process.exit(1);
}

console.log(`Using agent: ${agent.name} (${agent.slug})`);
if (agent.systemPromptText) {
  console.log(`System prompt: ${agent.systemPromptText.substring(0, 100)}...`);
}
console.log(`Prompt: ${promptText}\n`);

// Build messages (user/assistant only — system prompt goes in the dedicated field)
const messages: { role: string; content: { text: string }[] }[] = [
  { role: 'user', content: [{ text: promptText }] },
];

// Invoke harness using first-class systemPrompt and model override fields
const encodedArn = encodeURIComponent(harnessArn);
const url = `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke?harnessArn=${encodedArn}`;

const invokeBody: Record<string, unknown> = {
  runtimeSessionId: randomUUID(),
  messages,
};
if (agent.systemPromptText) {
  invokeBody.systemPrompt = [{ text: agent.systemPromptText }];
}
if (agent.modelId) {
  invokeBody.model = { bedrock: { modelId: agent.modelId } };
}

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(invokeBody),
});

if (!response.ok) {
  console.error(`AgentCore error ${response.status}: ${await response.text()}`);
  process.exit(1);
}

// Decode AWS binary event stream
function u32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}
function u16(buf: Buffer, offset: number): number {
  return buf.readUInt16BE(offset);
}

let raw = Buffer.alloc(0);
for await (const chunk of response.body as AsyncIterable<Buffer>) {
  raw = Buffer.concat([raw, chunk]);

  while (raw.length >= 12) {
    const totalLen = u32(raw, 0);
    if (raw.length < totalLen) break;

    const headersLen = u32(raw, 4);
    let pos = 12;
    const headersEnd = pos + headersLen;
    const headers: Record<string, string> = {};

    while (pos < headersEnd) {
      const nameLen = raw[pos++];
      const name = raw.subarray(pos, pos + nameLen).toString('utf8');
      pos += nameLen;
      pos++; // value type byte
      const valLen = u16(raw, pos);
      pos += 2;
      headers[name] = raw.subarray(pos, pos + valLen).toString('utf8');
      pos += valLen;
    }

    const payloadBytes = raw.subarray(12 + headersLen, totalLen - 4);
    let payload: any = null;
    try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { /* empty */ }

    if (headers[':event-type'] === 'contentBlockDelta') {
      const delta = payload?.delta?.text as string | undefined;
      if (delta) process.stdout.write(delta);
    }

    raw = raw.subarray(totalLen);
  }
}
process.stdout.write('\n');
