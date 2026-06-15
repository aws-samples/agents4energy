#!/usr/bin/env tsx
// Invoke the deployed AgentCore agent from the command line.
//
// Usage:
//   node scripts/invoke.ts "Hello, how are you?"
//
// Auth credentials are read from scripts/.env.local (TEST_USER_EMAIL / TEST_USER_PASSWORD).
// Runtime ARN is read from web/deployment-info.json.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { AgentPayload } from '@agentcore/shared-types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local
const envPath = resolve(root, 'scripts/.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => l.split('=').map((s) => s.trim())),
);

const email = env.TEST_USER_EMAIL;
const password = env.TEST_USER_PASSWORD;
if (!email || !password) {
  console.error('Missing TEST_USER_EMAIL or TEST_USER_PASSWORD in scripts/.env.local');
  process.exit(1);
}

// Load Cognito config
const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const { user_pool_client_id: clientId, aws_region: region } = amplifyOutputs.auth;

// Load runtime ARN
const deploymentInfo = JSON.parse(readFileSync(resolve(root, 'web/deployment-info.json'), 'utf8'));
const runtimeArn: string = deploymentInfo.runtimes.Default.runtimeArn;
const runtimeRegion = runtimeArn.split(':')[3];
const encodedArn = encodeURIComponent(runtimeArn);
const url = `https://bedrock-agentcore.${runtimeRegion}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;

// Authenticate
const cognito = new CognitoIdentityProviderClient({ region });
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

// Build payload from CLI args
const text = process.argv.slice(2).join(' ') || 'Hello!';
console.log(`Prompt: ${text}\n`);

const body: AgentPayload = {
  messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text }] }],
};

// Invoke
const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  },
  body: JSON.stringify(body),
});

if (!response.ok) {
  console.error(`AgentCore error ${response.status}: ${await response.text()}`);
  process.exit(1);
}

// Stream and print
const decoder = new TextDecoder();
let buffer = '';
for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const event = JSON.parse(raw);
      if (event.type === 'text-delta') process.stdout.write(event.delta);
    } catch {
      process.stdout.write(raw);
    }
  }
}
process.stdout.write('\n');
