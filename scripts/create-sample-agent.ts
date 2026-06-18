#!/usr/bin/env tsx
// Create a sample Agent record in the deployed AppSync GraphQL API.
// Uses the same auth pattern as invoke.ts (USER_PASSWORD_AUTH via Cognito).
//
// Usage:
//   npx tsx scripts/create-sample-agent.ts
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
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

// Authenticate
const cognito = new CognitoIdentityProviderClient({ region: authRegion });
const authResult = await cognito.send(
  new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }),
);
const idToken = authResult.AuthenticationResult?.IdToken;
if (!idToken) {
  console.error('Authentication failed — no ID token returned');
  process.exit(1);
}

// Create Agent via GraphQL mutation
const mutation = `
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      id
      name
      slug
      description
      systemPromptText
      modelId
      enabled
      createdAt
    }
  }
`;

const variables = {
  input: {
    name: 'Demo Agent',
    slug: 'demo-agent',
    description: 'A sample agent with a custom system prompt for testing',
    systemPromptText: 'You are a helpful demo assistant. Always respond in a friendly and concise manner. When asked what agent you are, say you are the Demo Agent.',
    modelId: null,
    enabled: true,
  },
};

const response = await fetch(graphqlUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: idToken,
  },
  body: JSON.stringify({ query: mutation, variables }),
});

const result = await response.json() as any;

if (result.errors) {
  console.error('GraphQL errors:', JSON.stringify(result.errors, null, 2));
  process.exit(1);
}

const agent = result.data?.createAgent;
console.log('Created agent:');
console.log(JSON.stringify(agent, null, 2));
console.log('\nAgent ID:', agent.id);
console.log('System prompt:', agent.systemPromptText);
