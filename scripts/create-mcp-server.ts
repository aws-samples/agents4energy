#!/usr/bin/env tsx
// Create a McpServer record and link it to an Agent via AgentMcpServer.
//
// Usage:
//   npx tsx scripts/create-mcp-server.ts <agentId> <mcpServerUrl> [bearerToken]
//
// Example (public test MCP server, no auth):
//   npx tsx scripts/create-mcp-server.ts 1a92fb1c-... https://example.com/mcp
//
// Example (auth-protected MCP server):
//   npx tsx scripts/create-mcp-server.ts 1a92fb1c-... https://example.com/mcp my-secret-token
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const [agentId, mcpServerUrl, bearerToken] = process.argv.slice(2);
if (!agentId || !mcpServerUrl) {
  console.error('Usage: npx tsx scripts/create-mcp-server.ts <agentId> <mcpServerUrl> [bearerToken]');
  process.exit(1);
}

const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const { user_pool_client_id: clientId, aws_region: authRegion } = amplifyOutputs.auth;
const graphqlUrl: string = amplifyOutputs.data.url;

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
  console.error('Authentication failed');
  process.exit(1);
}

async function gql(query: string, variables: Record<string, unknown>) {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: idToken! },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as any;
  if (json.errors) {
    console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  return json.data;
}

// Create the McpServer record
const headers = bearerToken
  ? [{ key: 'Authorization', value: `Bearer ${bearerToken}` }]
  : [];

const serverData = await gql(`
  mutation CreateMcpServer($input: CreateMcpServerInput!) {
    createMcpServer(input: $input) {
      id name url headers { key value } enabled createdAt
    }
  }
`, {
  input: {
    name: 'Test MCP Server',
    url: mcpServerUrl,
    description: 'Test MCP server created by create-mcp-server.ts',
    serverType: 'mcp',
    headers,
    enabled: true,
  },
});

const mcpServer = serverData.createMcpServer;
console.log('Created McpServer:');
console.log(JSON.stringify(mcpServer, null, 2));

// Link the McpServer to the Agent
const joinData = await gql(`
  mutation CreateAgentMcpServer($input: CreateAgentMcpServerInput!) {
    createAgentMcpServer(input: $input) {
      id agentId mcpServerId createdAt
    }
  }
`, {
  input: {
    agentId,
    mcpServerId: mcpServer.id,
  },
});

const join = joinData.createAgentMcpServer;
console.log('\nLinked to agent:');
console.log(JSON.stringify(join, null, 2));
console.log('\nDone. McpServer ID:', mcpServer.id);
console.log('Agent ID:', agentId, '→ MCP server will be injected as a remote_mcp tool on next invoke.');
