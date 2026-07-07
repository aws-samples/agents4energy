// Browser-side MCP OAuth2 PKCE helpers.
//
// Flow:
//   1. Discover authorization + token endpoints from the MCP server's
//      /.well-known/oauth-protected-resource metadata (RFC 9728).
//   2. Generate a PKCE verifier + S256 challenge with Web Crypto API.
//   3. Open a small popup window pointing at the authorization URL.
//   4. Wait for the popup to redirect to /oauth/callback, which posts
//      the authorization code back via postMessage.
//   5. Exchange the code for tokens using fetch() directly from the browser.
//   6. Save the resulting token to McpServerCredential (DynamoDB via Amplify).

import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const client = generateClient<Schema>({ authMode: 'userPool' });

export interface McpCredential {
  id: string;
  mcpServerId: string;
  accessToken: string;
  tokenType: string;
  expiresAt?: string | null;
  refreshToken?: string | null;
}

// ---------------------------------------------------------------------------
// Credential CRUD
// ---------------------------------------------------------------------------

export function isExpiredOrExpiringSoon(cred: McpCredential): boolean {
  if (!cred.expiresAt) return false;
  return new Date(cred.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
}

export async function fetchCredential(mcpServerId: string): Promise<McpCredential | null> {
  const res = await client.models.McpServerCredential.list({
    filter: { mcpServerId: { eq: mcpServerId } },
  });
  const item = res.data?.[0];
  if (!item) return null;
  return {
    id: item.id,
    mcpServerId: item.mcpServerId,
    accessToken: item.accessToken,
    tokenType: item.tokenType ?? 'Bearer',
    expiresAt: item.expiresAt ?? null,
    refreshToken: item.refreshToken ?? null,
  };
}

export async function revokeCredential(credentialId: string): Promise<void> {
  await client.models.McpServerCredential.delete({ id: credentialId });
}

// ---------------------------------------------------------------------------
// PKCE helpers (Web Crypto API — works in browsers and modern Deno/Node)
// ---------------------------------------------------------------------------

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes.buffer);
}

async function deriveChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64UrlEncode(digest);
}

// ---------------------------------------------------------------------------
// OIDC / OAuth discovery
// ---------------------------------------------------------------------------

interface OAuthEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

async function discover(mcpServerUrl: string): Promise<OAuthEndpoints> {
  const origin = new URL(mcpServerUrl).origin;

  // RFC 9728: fetch oauth-protected-resource metadata first.
  const prMeta = await fetch(`${origin}/.well-known/oauth-protected-resource`);
  if (!prMeta.ok) {
    throw new Error(`Could not fetch OAuth protected resource metadata from ${origin} (HTTP ${prMeta.status})`);
  }
  const prData = await prMeta.json() as { authorization_servers?: string[] };
  const asUrl = prData.authorization_servers?.[0];
  if (!asUrl) throw new Error('No authorization_servers listed in oauth-protected-resource metadata');

  // OIDC discovery document at the authorization server.
  const asOrigin = asUrl.endsWith('/') ? asUrl.slice(0, -1) : asUrl;
  const oidcMeta = await fetch(`${asOrigin}/.well-known/openid-configuration`);
  if (!oidcMeta.ok) {
    throw new Error(`Could not fetch OIDC configuration from ${asOrigin} (HTTP ${oidcMeta.status})`);
  }
  const oidcData = await oidcMeta.json() as {
    authorization_endpoint: string;
    token_endpoint: string;
  };
  return {
    authorizationEndpoint: oidcData.authorization_endpoint,
    tokenEndpoint: oidcData.token_endpoint,
  };
}

// ---------------------------------------------------------------------------
// Popup management + postMessage listener
// ---------------------------------------------------------------------------

interface OAuthCallbackMessage {
  type: 'mcp-oauth-callback';
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

function openAuthPopup(url: string): Window {
  const width = 520;
  const height = 660;
  const left = Math.max(0, (screen.width - width) / 2);
  const top = Math.max(0, (screen.height - height) / 2);
  const popup = window.open(
    url,
    'mcp-oauth-popup',
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`,
  );
  if (!popup) throw new Error('Popup blocked — allow popups for this site and try again.');
  return popup;
}

function waitForCode(
  expectedState: string,
  popup: Window,
  timeoutMs = 5 * 60 * 1000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for OAuth callback'));
    }, timeoutMs);

    // Poll for popup closed (user closed it manually).
    const pollPopupClosed = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('Authentication cancelled — popup was closed.'));
      }
    }, 500);

    function onMessage(evt: MessageEvent) {
      if (evt.origin !== window.location.origin) return;
      const msg = evt.data as OAuthCallbackMessage;
      if (msg?.type !== 'mcp-oauth-callback') return;
      if (msg.state !== expectedState) return;

      cleanup();
      if (msg.error) {
        reject(new Error(msg.errorDescription ?? msg.error));
      } else if (msg.code) {
        resolve(msg.code);
      } else {
        reject(new Error('No authorization code returned'));
      }
    }

    function cleanup() {
      clearTimeout(timer);
      clearInterval(pollPopupClosed);
      window.removeEventListener('message', onMessage);
    }

    window.addEventListener('message', onMessage);
  });
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  verifier: string,
  clientId: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// Main entry point: full PKCE popup flow
// ---------------------------------------------------------------------------

export async function authenticateViaPkce(opts: {
  mcpServerId: string;
  mcpServerUrl: string;
  oauthClientId: string;
  /** Existing credential ID to overwrite (delete then create). */
  existingCredentialId?: string;
}): Promise<McpCredential> {
  const redirectUri = `${window.location.origin}/oauth/callback`;

  // 1. Discover endpoints.
  const endpoints = await discover(opts.mcpServerUrl);

  // 2. Generate PKCE params.
  const verifier = generateVerifier();
  const challenge = await deriveChallenge(verifier);
  const state = generateVerifier(); // random opaque value for CSRF protection

  // 3. Build authorization URL.
  const authUrl = new URL(endpoints.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', opts.oauthClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  // 4. Open popup and wait for the code.
  const popup = openAuthPopup(authUrl.toString());
  const code = await waitForCode(state, popup);

  // 5. Exchange code for tokens.
  const tokens = await exchangeCode(
    endpoints.tokenEndpoint,
    code,
    verifier,
    opts.oauthClientId,
    redirectUri,
  );

  // 6. Persist to DynamoDB. Delete stale record first if it exists.
  if (opts.existingCredentialId) {
    await client.models.McpServerCredential.delete({ id: opts.existingCredentialId }).catch(() => null);
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : undefined;

  const created = await client.models.McpServerCredential.create({
    mcpServerId: opts.mcpServerId,
    accessToken: tokens.access_token,
    tokenType: tokens.token_type ?? 'Bearer',
    expiresAt: expiresAt ?? null,
    refreshToken: tokens.refresh_token ?? null,
  });

  if (!created.data) {
    throw new Error('Failed to save credential to database');
  }

  return {
    id: created.data.id,
    mcpServerId: opts.mcpServerId,
    accessToken: tokens.access_token,
    tokenType: tokens.token_type ?? 'Bearer',
    expiresAt: expiresAt ?? null,
    refreshToken: tokens.refresh_token ?? null,
  };
}
