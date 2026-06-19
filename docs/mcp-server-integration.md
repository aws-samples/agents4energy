# Integrating an MCP Server

This document describes what an MCP server must support to work with this system, and the requirements that apply to servers needing OAuth2 authentication.

---

## Protocol requirements

All MCP servers must speak **MCP Streamable HTTP** (spec versions `2025-03-26` or `2025-06-18`). The server must accept POST requests and respond to the two-step handshake:

1. `initialize` — the client announces its capabilities; the server may accept or reject
2. `tools/list` — the client fetches the tool catalog

Both steps are validated by the `listMcpTools` query before a server is saved. If `listMcpTools` succeeds, the harness invocation will too.

The server may respond with either:
- **Plain JSON** (`Content-Type: application/json`)
- **Server-Sent Events** (`Content-Type: text/event-stream`) — the client reads until it finds a `data:` line with a parseable JSON payload

---

## Static-header auth (API keys, pre-issued tokens)

For servers that accept a fixed credential (e.g. `Authorization: Bearer <static-token>` or a custom `X-Api-Key` header):

1. Open the **MCP Servers** tab on the Agents page.
2. Create or edit the server record.
3. Under **Auth headers**, click **Add header** and enter the key/value pair.
4. Use **List tools** to verify the server responds correctly.

The headers are stored in `McpServer.headers` (DynamoDB) and forwarded verbatim on every harness invocation. They are shared across all users.

---

## OAuth2 / OIDC auth (per-user tokens)

Some servers — including the AgentCore Dispatcher Gateway — require a Bearer token issued by a specific OAuth2 / OIDC authorization server. Because these tokens are user-scoped, they cannot be shared in `McpServer.headers`. Instead, each user authenticates separately and the token is stored in `McpServerCredential` (owner-only, per-user).

### Server requirements

The MCP server must:

1. **Return a `401` with a `WWW-Authenticate` header** on unauthenticated requests. The header must include a `resource_metadata` pointer:
   ```
   WWW-Authenticate: Bearer error="invalid_token",
     resource_metadata="https://<server-origin>/.well-known/oauth-protected-resource"
   ```
   If the header is absent, discovery falls back to `<server-origin>/.well-known/oauth-protected-resource`.

2. **Serve an OAuth Protected Resource Metadata document** at that URL (RFC 9728):
   ```json
   {
     "resource": "https://<server-origin>/mcp",
     "authorization_servers": ["https://<cognito-or-oidc-provider>"]
   }
   ```

3. **The authorization server** listed there must serve a standard OIDC discovery document at `/.well-known/openid-configuration` (or `/.well-known/oauth-authorization-server`), exposing at minimum:
   - `authorization_endpoint`
   - `token_endpoint`

4. **The Cognito app client** (or equivalent) used for this server must have `http://localhost:8080/callback` registered as an **allowed redirect URI**. This is required for the local PKCE helper to work. Other ports can be used by passing a `port` argument to `scripts/mcp-auth.ts`; any port used must be registered.

5. The app client must support the **Authorization Code + PKCE** flow (`AllowedOAuthFlows: ["code"]`, no client secret required by the helper).

### Dispatcher Gateway — current configuration

| Property | Value |
|----------|-------|
| Server URL | `https://agentcore-amplify-genaichatbot-waltma-dispatcher-tr4kfk4gbh.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp/` |
| Authorization server | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_tYwnczxVc` |
| Cognito app client ID | `3plv39vprqba2im1ehpseslc1h` |
| Registered redirect URIs | `http://localhost:8080/callback`, `http://localhost:3000/oauth/callback`, `http://localhost:16998/oauth/callback` |

### User authentication flow

Once a server record has an **OAuth2 client ID** set, the MCP Servers tab shows a **Your credentials** section for each user:

1. Open the **MCP Servers** tab → select the server → note the auth status.
2. Click **Authenticate** — a dialog appears with a copy-pasteable terminal command:
   ```
   npx tsx scripts/mcp-auth.ts "<url>" "<clientId>" 8080 _ _ "<mcpServerId>"
   ```
3. Run the command in a terminal from the repo root. It will:
   - Discover the OAuth endpoints from the server's metadata
   - Open the authorization URL in your browser (PKCE S256, `scope=openid`)
   - Listen on `http://localhost:8080/callback` for the authorization code
   - Exchange the code for tokens
   - Write the access token to `McpServerCredential` in DynamoDB using your app credentials from `scripts/.env.local`
4. Return to the browser and click **"I've run the command"** — the UI polls the credential table and updates the status to **Authenticated** when the token appears.

The credential is owner-scoped: each user's token is invisible to other users. Tokens are checked for expiry at chat load time; expired tokens are excluded from injection so the harness does not receive a stale `Authorization` header.

### Revoking / re-authenticating

Click **Revoke** on the credentials status row to delete your token. Then click **Authenticate** to run the flow again (e.g. after a token expires or if you need to switch accounts).

### Prerequisites

- `scripts/.env.local` must contain `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` — the same credentials used by `scripts/invoke.ts`.
- The redirect URI used must be registered on the target server's OAuth app client before the flow is attempted.
- `npx tsx` requires Node.js ≥ 18 and `tsx` resolvable via `npx` (it is a dev dependency of this repo).

---

## Token injection at invocation time

When the chat UI loads agents (`use-agents.ts`), it fetches `McpServerCredential` records for the current user alongside the `McpServer` list. For any server with a valid, non-expired credential, it injects:

```
Authorization: Bearer <accessToken>
```

into the server's headers before passing them to the harness invoke body. This overrides any static `Authorization` header already on the server record, ensuring the per-user token takes precedence.

No token → the header is not added and the harness call will 401 if the server requires auth.

---

## Adding a new OAuth-protected MCP server

1. **Verify** the server meets the protocol and OAuth requirements above (especially the `/.well-known/oauth-protected-resource` endpoint and registered redirect URIs).
2. In the **MCP Servers** tab, create a new server record with:
   - **URL** — the MCP endpoint
   - **OAuth2 client ID** — the app client ID for the PKCE flow
3. Click **Save**.
4. Follow the **User authentication flow** above to obtain and store your token.
5. Assign the server to one or more agents on the **Agents** tab.
6. Use **List tools** to confirm the server is reachable with your stored token.
