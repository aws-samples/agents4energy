#!/usr/bin/env tsx
// Smoke-test: verify listMcpTools works with OAuth credential injection.
// Reads scripts/.env.local for TEST_USER_EMAIL / TEST_USER_PASSWORD.
// Uses the same GraphQL path as the UI (listMcpToolsForServer).
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(path: string) {
  return Object.fromEntries(
    readFileSync(path, 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
  );
}

const env = parseEnv(resolve(root, 'scripts/.env.local'));
const { TEST_USER_EMAIL: email, TEST_USER_PASSWORD: password } = env;
if (!email || !password) {
  console.error('Missing TEST_USER_EMAIL or TEST_USER_PASSWORD in scripts/.env.local');
  process.exit(1);
}

const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const { user_pool_client_id: clientId, aws_region: region, identity_pool_id } = amplifyOutputs.auth;
const graphqlEndpoint: string = amplifyOutputs.data?.url;
if (!graphqlEndpoint) {
  console.error('No AppSync endpoint in web/amplify_outputs.json');
  process.exit(1);
}

console.log('Authenticating…');
const cognito = new CognitoIdentityProviderClient({ region });
const authResult = await cognito.send(
  new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  })
);
const accessToken = authResult.AuthenticationResult?.AccessToken;
if (!accessToken) { console.error('Auth failed'); process.exit(1); }
console.log('Authenticated ✓\n');

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e: any) => e.message).join('; '));
  return json.data;
}

// 1. Find MCP servers with a gateway URL
console.log('Fetching MCP servers…');
const serversData = await gql(`
  query { listMcpServers { items { id name url oauthClientId headers { key value } } } }
`);
const servers: any[] = serversData.listMcpServers?.items ?? [];
const gatewayServers = servers.filter((s: any) => s.url?.includes('gateway.bedrock-agentcore'));
console.log(`Found ${servers.length} servers total, ${gatewayServers.length} gateway server(s)`);

if (gatewayServers.length === 0) {
  console.log('\nNo gateway server configured for this user — nothing to test.');
  process.exit(0);
}

// 2. Fetch stored credentials
console.log('\nFetching stored credentials…');
const credsData = await gql(`
  query { listMcpServerCredentials { items { id mcpServerId accessToken tokenType expiresAt } } }
`);
const creds: any[] = credsData.listMcpServerCredentials?.items ?? [];

// 3. For each gateway server, inject credential and call listMcpTools
for (const server of gatewayServers) {
  console.log(`\n── ${server.name} (${server.url})`);

  let headers: Array<{ key: string; value: string }> = (server.headers ?? []).filter((h: any) => h.key?.trim());

  if (server.oauthClientId) {
    const cred = creds.find((c: any) => c.mcpServerId === server.id);
    if (cred?.accessToken) {
      const expired = cred.expiresAt && new Date(cred.expiresAt).getTime() < Date.now();
      if (expired) {
        console.log('  ⚠ Credential expired — skipping token injection');
      } else {
        headers = [
          ...headers.filter((h: any) => h.key.toLowerCase() !== 'authorization'),
          { key: 'Authorization', value: `Bearer ${cred.accessToken}` },
        ];
        console.log('  Injected Bearer token from stored credential ✓');
      }
    } else {
      console.log('  ⚠ No stored credential found — calling without Bearer token');
    }
  }

  console.log(`  Calling listMcpTools…`);
  try {
    const toolsData = await gql(`
      query ListMcpTools($url: String!, $headers: [McpServerHeaderEntryInput]) {
        listMcpTools(url: $url, headers: $headers) {
          tools { name description }
          error
        }
      }
    `, { url: server.url, headers: headers.length > 0 ? headers : undefined });

    const result = toolsData.listMcpTools;
    if (result?.error) {
      console.log(`  ✗ Error: ${result.error}`);
    } else {
      const tools: any[] = result?.tools ?? [];
      console.log(`  ✓ ${tools.length} tool(s) returned:`);
      for (const t of tools) console.log(`    • ${t.name}${t.description ? ' — ' + t.description : ''}`);
    }
  } catch (err: any) {
    console.log(`  ✗ Exception: ${err.message}`);
  }
}
