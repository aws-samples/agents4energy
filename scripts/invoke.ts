#!/usr/bin/env tsx
// Invoke the deployed AgentCore harness from the command line.
//
// Usage:
//   npx tsx scripts/invoke.ts "Your prompt here"
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

// Load Cognito config
const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const { user_pool_client_id: clientId, aws_region: authRegion } = amplifyOutputs.auth;

// Load harness ARN
const deploymentInfo = JSON.parse(readFileSync(resolve(root, 'web/deployment-info.json'), 'utf8'));
const harnessArn: string = deploymentInfo.harnesses?.MyHarness?.harnessArn;
if (!harnessArn) {
  console.error('No harness ARN in web/deployment-info.json — run node scripts/extract-deployment-info.js after deploying');
  process.exit(1);
}
const region = harnessArn.split(':')[3];
const encodedArn = encodeURIComponent(harnessArn);
const url = `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke?harnessArn=${encodedArn}`;

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
if (!accessToken) {
  console.error('Authentication failed — no access token returned');
  process.exit(1);
}

// Build message from CLI args
const text = process.argv.slice(2).join(' ') || 'Hello!';
console.log(`Prompt: ${text}\n`);

// Invoke harness
const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    runtimeSessionId: randomUUID(),
    messages: [{ role: 'user', content: [{ text }] }],
  }),
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
