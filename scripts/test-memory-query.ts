#!/usr/bin/env tsx
/**
 * End-to-end test for the listSessionMessages AppSync resolver.
 *
 * Steps:
 *  1. Authenticate (Cognito USER_PASSWORD_AUTH) → access token + user sub
 *  2. Create a ChatSession via AppSync mutation
 *  3. Invoke the AgentCore harness with that session ID (adds events to memory)
 *  4. Query listSessionMessages via AppSync and print the results
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Config ───────────────────────────────────────────────────────────────────

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

const amplifyOutputs = JSON.parse(
  readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'),
);
const { user_pool_client_id: clientId, aws_region: authRegion } = amplifyOutputs.auth;
const graphqlUrl: string = amplifyOutputs.data.url;

const deploymentInfo = JSON.parse(
  readFileSync(resolve(root, 'web/deployment-info.json'), 'utf8'),
);
const harnessArn: string = deploymentInfo.harnesses?.MyHarness?.harnessArn;
if (!harnessArn) {
  console.error('No harness ARN in web/deployment-info.json');
  process.exit(1);
}
const harnessRegion = harnessArn.split(':')[3];

// ─── Step 1: Authenticate ─────────────────────────────────────────────────────

console.log('Step 1: Authenticating…');
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

// The harness SDK uses "default" as the actorId (the agent name) rather than
// the Cognito user sub. Confirmed from CloudWatch logs:
//   /users/default/preferences, /summaries/default/{sessionId}, etc.
const actorId = 'default';
console.log(`  actorId: ${actorId}\n`);

// ─── GraphQL helper ───────────────────────────────────────────────────────────

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: idToken!,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data?: any; errors?: any[] };
  if (json.errors?.length) {
    console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  return json.data;
}

// ─── Step 2: Create a ChatSession ─────────────────────────────────────────────

console.log('Step 2: Creating ChatSession via AppSync…');
const sessionId = randomUUID();

// Use a fixed UUID as the ID so it matches what we'll pass to AgentCore
const createData = await gql(
  `mutation CreateChatSession($input: CreateChatSessionInput!) {
    createChatSession(input: $input) { id name }
  }`,
  { input: { id: sessionId, name: 'Test session for memory query' } },
);
const createdSession = createData?.createChatSession;
console.log(`  Created session: ${createdSession?.id} ("${createdSession?.name}")\n`);

// ─── Step 3: Invoke AgentCore harness ─────────────────────────────────────────

const prompt = process.argv[2] ?? 'What is the capital of France?';
console.log(`Step 3: Invoking AgentCore harness with session ${sessionId}…`);
console.log(`  Prompt: "${prompt}"`);

const encodedArn = encodeURIComponent(harnessArn);
const harnessUrl = `https://bedrock-agentcore.${harnessRegion}.amazonaws.com/harnesses/invoke?harnessArn=${encodedArn}`;

const harnessRes = await fetch(harnessUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    runtimeSessionId: sessionId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
  }),
});

if (!harnessRes.ok) {
  console.error(`AgentCore error ${harnessRes.status}: ${await harnessRes.text()}`);
  process.exit(1);
}

// Stream and collect the response
function u32(buf: Buffer, offset: number) { return buf.readUInt32BE(offset); }
function u16(buf: Buffer, offset: number) { return buf.readUInt16BE(offset); }

let raw = Buffer.alloc(0);
let agentResponse = '';
process.stdout.write('  Response: ');
for await (const chunk of harnessRes.body as AsyncIterable<Buffer>) {
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
      pos++;
      const valLen = u16(raw, pos); pos += 2;
      headers[name] = raw.subarray(pos, pos + valLen).toString('utf8');
      pos += valLen;
    }
    const payloadBytes = raw.subarray(12 + headersLen, totalLen - 4);
    let payload: any = null;
    try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { /**/ }
    if (headers[':event-type'] === 'contentBlockDelta') {
      const delta = payload?.delta?.text as string | undefined;
      if (delta) { process.stdout.write(delta); agentResponse += delta; }
    }
    raw = raw.subarray(totalLen);
  }
}
process.stdout.write('\n\n');

// Give AgentCore a moment to flush the event into memory
console.log('  Waiting 3s for memory to be written…');
await new Promise((r) => setTimeout(r, 3000));

// ─── Step 4: Query listSessionMessages via AppSync ───────────────────────────

console.log(`Step 4: Querying listSessionMessages for session ${sessionId}…`);
const queryData = await gql(
  `query ListSessionMessages($sessionId: String!, $actorId: String!) {
    listSessionMessages(sessionId: $sessionId, actorId: $actorId) {
      events { eventId role text timestamp }
      nextToken
    }
  }`,
  { sessionId, actorId },
);

const result = queryData?.listSessionMessages;
if (!result) {
  console.error('No result returned from listSessionMessages');
  process.exit(1);
}

console.log(`\n  Found ${result.events.length} event(s):\n`);
for (const e of result.events) {
  console.log(`  [${e.role.toUpperCase()}] ${e.timestamp}`);
  console.log(`    "${e.text.slice(0, 120)}${e.text.length > 120 ? '…' : ''}"\n`);
}

if (result.events.length === 0) {
  console.warn('  WARNING: No events found. Memory may not have been written yet,');
  console.warn('  or the actorId/sessionId do not match what the harness stored.');
} else {
  console.log('  ✓ listSessionMessages resolver is working correctly.');
}
