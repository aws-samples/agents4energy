#!/usr/bin/env tsx
// Test the listMcpTools AppSync query against the deployed gateway.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = Object.fromEntries(
  readFileSync(resolve(root, 'scripts/.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const outputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const { user_pool_client_id: clientId, aws_region: authRegion } = outputs.auth;
const graphqlUrl: string = outputs.data.url;
const gatewayUrl: string = outputs.custom?.agentcore_gateway_endpoint;

const cognito = new CognitoIdentityProviderClient({ region: authRegion });
const authResult = await cognito.send(
  new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: env.TEST_USER_EMAIL, PASSWORD: env.TEST_USER_PASSWORD },
  }),
);
const token = authResult.AuthenticationResult?.AccessToken;
if (!token) {
  console.error('Auth failed');
  process.exit(1);
}

console.log(`Testing listMcpTools against gateway:\n  ${gatewayUrl}\n`);

// The gateway requires Cognito JWT auth — pass the token as a header so the
// listMcpTools Lambda forwards it to the gateway exactly like the harness does.
const resp = await fetch(graphqlUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: `
      query ListMcpTools($url: String!, $headers: [McpServerHeaderEntryInput]) {
        listMcpTools(url: $url, headers: $headers) {
          tools {
            name
            description
            inputSchema
          }
          error
        }
      }
    `,
    variables: {
      url: gatewayUrl,
      headers: [{ key: 'Authorization', value: `Bearer ${token}` }],
    },
  }),
});

const json = await resp.json();
console.log(JSON.stringify(json, null, 2));
