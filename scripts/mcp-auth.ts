#!/usr/bin/env tsx
// Local PKCE OAuth2 helper for MCP servers that require Bearer auth.
//
// Usage:
//   npx tsx scripts/mcp-auth.ts <mcp-server-url> <oauth-client-id> [port]
//
// What it does:
//   1. Authenticates as the user via USER_PASSWORD_AUTH (reads TEST_USER_EMAIL /
//      TEST_USER_PASSWORD from scripts/.env.local — same as invoke.ts).
//   2. Discovers the OAuth2 authorization + token endpoints from the MCP server.
//   3. Generates PKCE code_verifier + code_challenge.
//   4. Opens the authorization URL in the system browser with
//      redirect_uri=http://localhost:<port>/callback.
//   5. Listens on localhost:<port> for the authorization code callback.
//   6. Exchanges the code for tokens.
//   7. Saves the resulting access token as a McpServerCredential record in
//      Amplify DynamoDB so the web app can immediately pick it up.
//
// Port defaults to 8080 (matching Claude Code's default callbackPort).
// The MCP server's Cognito app client must have http://localhost:8080/callback
// (or whichever port you use) registered as an allowed redirect URI.

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── args ─────────────────────────────────────────────────────────────────────

const [mcpServerUrl, gatewayClientId, portArg] = process.argv.slice(2);
if (!mcpServerUrl || !gatewayClientId) {
  console.error('Usage: npx tsx scripts/mcp-auth.ts <mcp-server-url> <oauth-client-id> [port]');
  process.exit(1);
}
const PORT = parseInt(portArg ?? '8080', 10);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// ── Load config ───────────────────────────────────────────────────────────────

const envPath = resolve(root, 'scripts/.env.local');
const envVars = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const email = envVars.TEST_USER_EMAIL;
const password = envVars.TEST_USER_PASSWORD;
if (!email || !password) {
  console.error('Missing TEST_USER_EMAIL or TEST_USER_PASSWORD in scripts/.env.local');
  process.exit(1);
}

const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const appClientId: string = amplifyOutputs.auth.user_pool_client_id;
const authRegion: string = amplifyOutputs.auth.aws_region ?? 'us-east-1';
const appsyncUrl: string = amplifyOutputs.data.url;

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
const generateVerifier = () => base64url(randomBytes(32));
const deriveChallenge = (v: string) => base64url(createHash('sha256').update(v).digest());

// ── OAuth discovery ───────────────────────────────────────────────────────────

interface OAuthMeta { authorizationEndpoint: string; tokenEndpoint: string; }

async function discoverOAuth(serverUrl: string): Promise<OAuthMeta> {
  const probe = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
  }).catch(() => null);

  const wwwAuth = probe?.headers.get('www-authenticate') ?? '';
  const metaMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
  const origin = new URL(serverUrl).origin;
  const metaUrl = metaMatch?.[1] ?? `${origin}/.well-known/oauth-protected-resource`;

  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) throw new Error(`Could not fetch OAuth resource metadata from ${metaUrl}`);
  const meta = await metaRes.json() as { authorization_servers?: string[] };

  const authServerBase = meta.authorization_servers?.[0];
  if (!authServerBase) throw new Error('No authorization_servers in resource metadata');

  let discovery: { authorization_endpoint: string; token_endpoint: string } | null = null;
  for (const url of [`${authServerBase}/.well-known/openid-configuration`, `${authServerBase}/.well-known/oauth-authorization-server`]) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) { discovery = await r.json(); break; }
  }
  if (!discovery) throw new Error(`Could not fetch discovery document from ${authServerBase}`);

  return { authorizationEndpoint: discovery.authorization_endpoint, tokenEndpoint: discovery.token_endpoint };
}

// ── Token exchange ────────────────────────────────────────────────────────────

interface TokenResponse { access_token: string; token_type?: string; expires_in?: number; refresh_token?: string; }

async function exchangeCode(tokenEndpoint: string, code: string, verifier: string): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: gatewayClientId, redirect_uri: REDIRECT_URI, code, code_verifier: verifier }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ── Cognito auth (to write back to Amplify DynamoDB) ─────────────────────────

async function getCognitoAccessToken(): Promise<string> {
  const cognito = new CognitoIdentityProviderClient({ region: authRegion });
  const result = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: appClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }));
  const token = result.AuthenticationResult?.AccessToken;
  if (!token) throw new Error('Cognito auth failed — no access token');
  return token;
}

// ── Save credential to Amplify DynamoDB via AppSync GraphQL ──────────────────

async function saveCredential(opts: {
  mcpServerId: string;
  accessToken: string;
  tokenType: string;
  expiresAt: string | undefined;
  refreshToken: string | undefined;
  cognitoToken: string;
}): Promise<void> {
  // Try update first (if a credential already exists for this server+owner),
  // then fall back to create. The simplest approach: always create; the UI
  // will clean up stale records on revoke. But to avoid duplicates we list first.
  const listQuery = /* GraphQL */ `
    query ListCreds($filter: ModelMcpServerCredentialFilterInput) {
      listMcpServerCredentials(filter: $filter) {
        items { id }
      }
    }
  `;
  const listRes = await fetch(appsyncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: opts.cognitoToken },
    body: JSON.stringify({ query: listQuery, variables: { filter: { mcpServerId: { eq: opts.mcpServerId } } } }),
  });
  const listData = await listRes.json() as any;
  const existing = listData?.data?.listMcpServerCredentials?.items?.[0];

  if (existing?.id) {
    const updateMutation = /* GraphQL */ `
      mutation UpdateCred($input: UpdateMcpServerCredentialInput!) {
        updateMcpServerCredential(input: $input) { id }
      }
    `;
    await fetch(appsyncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: opts.cognitoToken },
      body: JSON.stringify({ query: updateMutation, variables: { input: { id: existing.id, accessToken: opts.accessToken, tokenType: opts.tokenType, expiresAt: opts.expiresAt, refreshToken: opts.refreshToken } } }),
    });
  } else {
    const createMutation = /* GraphQL */ `
      mutation CreateCred($input: CreateMcpServerCredentialInput!) {
        createMcpServerCredential(input: $input) { id }
      }
    `;
    await fetch(appsyncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: opts.cognitoToken },
      body: JSON.stringify({ query: createMutation, variables: { input: { mcpServerId: opts.mcpServerId, accessToken: opts.accessToken, tokenType: opts.tokenType, expiresAt: opts.expiresAt, refreshToken: opts.refreshToken } } }),
    });
  }
}

// ── Open browser ──────────────────────────────────────────────────────────────

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.error('[mcp-auth] Could not open browser automatically.\nOpen this URL manually:\n' + url); });
}

// ── Main ──────────────────────────────────────────────────────────────────────

// The web app passes the McpServer record ID as the third positional so we can
// write the credential back under the correct mcpServerId.
const mcpServerId = process.argv[5]; // optional; if absent, skips DynamoDB write

async function main() {
  console.error('[mcp-auth] Discovering OAuth endpoints for', mcpServerUrl);
  const { authorizationEndpoint, tokenEndpoint } = await discoverOAuth(mcpServerUrl);

  const verifier = generateVerifier();
  const challenge = deriveChallenge(verifier);
  const state = base64url(randomBytes(16));

  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', gatewayClientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      if (reqUrl.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

      const code = reqUrl.searchParams.get('code');
      const returnedState = reqUrl.searchParams.get('state');
      const error = reqUrl.searchParams.get('error');

      const html = (title: string, body: string, ok = true) =>
        `<html><body style="font-family:sans-serif;padding:2rem"><h2>${title}</h2><p>${body}</p></body></html>`;

      if (error || !code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(html('Auth failed', error ?? 'Invalid state or missing code', false));
        server.close(() => reject(new Error(error ?? 'Invalid callback')));
        return;
      }

      try {
        console.error('[mcp-auth] Exchanging authorization code...');
        const tokens = await exchangeCode(tokenEndpoint, code, verifier);
        const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : undefined;

        if (mcpServerId) {
          console.error('[mcp-auth] Saving credential to DynamoDB for mcpServerId:', mcpServerId);
          const cognitoToken = await getCognitoAccessToken();
          await saveCredential({ mcpServerId, accessToken: tokens.access_token, tokenType: tokens.token_type ?? 'Bearer', expiresAt, refreshToken: tokens.refresh_token, cognitoToken });
          console.error('[mcp-auth] Credential saved.');
        }

        // Print result for CLI use.
        process.stdout.write(JSON.stringify({ accessToken: tokens.access_token, tokenType: tokens.token_type ?? 'Bearer', expiresAt, refreshToken: tokens.refresh_token }) + '\n');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html('✓ Authenticated', 'Token captured. You can close this tab and return to the app.'));
        server.close(() => resolve());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(html('Error', msg, false));
        server.close(() => reject(err));
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.error(`[mcp-auth] Listening on http://localhost:${PORT}/callback`);
      openBrowser(authUrl.toString());
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') reject(new Error(`Port ${PORT} already in use. Pass a different port as the third argument.`));
      else reject(err);
    });

    setTimeout(() => server.close(() => reject(new Error('Auth flow timed out after 5 minutes'))), 5 * 60 * 1000);
  });
}

main().catch((err) => { console.error('[mcp-auth] Fatal:', err.message); process.exit(1); });
