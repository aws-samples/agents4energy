# Integrating an MCP Server

This document describes what an MCP server must support to work with this system, and the requirements for OAuth2-protected servers.

---

## Protocol requirements

All MCP servers must speak **MCP Streamable HTTP** (spec versions `2025-03-26` or `2025-06-18`). The server must accept POST requests and respond to the two-step handshake:

1. `initialize` — the client announces its capabilities; the server may accept or reject
2. `tools/list` — the client fetches the tool catalog

Both steps are validated by the **List tools** button in the MCP Servers panel before a server is used. If List tools succeeds, harness invocations will too.

The server may respond with either:
- **Plain JSON** (`Content-Type: application/json`)
- **Server-Sent Events** (`Content-Type: text/event-stream`) — the client reads until it finds a `data:` line containing a parseable JSON payload

---

## Static-header auth (API keys, pre-issued tokens)

For servers that accept a fixed credential (e.g. `Authorization: Bearer <static-token>` or a custom `X-Api-Key` header):

1. Open the **MCP Servers** tab on the Agents page.
2. Create or edit the server record.
3. Under **Auth headers**, click **Add header** and enter the key/value pair.
4. Click **List tools** to verify the server responds correctly.

The headers are stored in `McpServer.headers` (DynamoDB) and forwarded verbatim on every harness invocation and tool listing. They are shared across all users.

---

## OAuth2 / OIDC auth (per-user tokens)

Some servers — including the AgentCore Dispatcher Gateway — require a Bearer token issued by a specific OAuth2 / OIDC authorization server. Because these tokens are user-scoped, they cannot be shared in `McpServer.headers`. Instead, each user authenticates separately and their token is stored in `McpServerCredential` (owner-only, per-user DynamoDB record).

### Requirements for the MCP server

The MCP server **must** meet all of the following for the OAuth flow to work:

1. **Serve an OAuth Protected Resource Metadata document** (RFC 9728) at:
   ```
   GET <server-origin>/.well-known/oauth-protected-resource
   ```
   Response:
   ```json
   {
     "resource": "https://<server-origin>/mcp",
     "authorization_servers": ["https://<oidc-provider>"]
   }
   ```

2. **The authorization server** listed there must expose a standard OIDC discovery document at:
   ```
   GET <authorization-server>/.well-known/openid-configuration
   ```
   Containing at minimum:
   - `authorization_endpoint`
   - `token_endpoint`

3. **The OAuth app client** (Cognito app client, Auth0 application, etc.) must have the redirect URI registered:
   ```
   https://localhost:3000/oauth/callback   (local dev)
   https://<your-amplify-domain>/oauth/callback   (production)
   ```

4. The app client must support **Authorization Code + PKCE** (`response_type=code`, `code_challenge_method=S256`, no client secret required).

5. The authorization server must issue tokens with the `openid` scope.

### Dispatcher Gateway — current configuration

| Property | Value |
|----------|-------|
| Server URL | `https://agentcore-amplify-genaichatbot-waltma-dispatcher-tr4kfk4gbh.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp/` |
| Authorization server | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_tYwnczxVc` |
| Cognito app client ID | `3plv39vprqba2im1ehpseslc1h` |
| Registered redirect URIs | `http://localhost:3000/oauth/callback`, `https://localhost:3000/oauth/callback`, `http://localhost:8080/callback`, `http://localhost:16998/oauth/callback` |

---

## User authentication flow

Once a server record has an **OAuth2 client ID** set, the **Your credentials** section appears at the bottom of the edit panel.

### Step-by-step

1. Open the **MCP Servers** tab → select a server that has an OAuth2 client ID set.
2. The **Your credentials** section shows the current auth status (Not authenticated / Authenticated / Expiring soon).
3. Click **Authenticate**.
4. The app:
   - Fetches `/.well-known/oauth-protected-resource` from the MCP server to discover the authorization server URL
   - Fetches `/.well-known/openid-configuration` from that authorization server to find `authorization_endpoint` and `token_endpoint`
   - Generates a PKCE verifier + S256 challenge using the browser's Web Crypto API
   - Opens a **popup window** pointing at the authorization URL
5. Sign in to your account in the popup. The popup will redirect to `/oauth/callback` on this app.
6. The callback page posts the authorization code back to the opener via `postMessage` and closes.
7. The app exchanges the code for tokens by calling the `token_endpoint` directly from the browser.
8. The access token (and refresh token if provided) is saved to `McpServerCredential` in DynamoDB — visible only to you.
9. The credential section updates to **Authenticated**, showing the expiry time if available.

### Revoking / re-authenticating

Click **Revoke** to delete your stored token. Then click **Authenticate** to run the flow again (e.g. after a token expires or you need to switch accounts).

---

## How tokens are used at runtime

Token injection happens in two places:

### 1. Tool listing (List tools button)

When you click **List tools** in the edit panel, the app merges your stored credential into the request headers before calling the `listMcpTools` Lambda. The effective header set is:

```
[all static headers from McpServer.headers]
+ Authorization: Bearer <your accessToken>   ← injected if credential exists and is not expired
```

Any existing static `Authorization` header is replaced by the credential token.

### 2. Agent chat invocations

When the chat page loads, `use-agents.ts` fetches:
- All enabled `McpServer` records assigned to the selected agent
- All `McpServerCredential` records owned by the current user

For each server that has a valid (non-expired) credential, it injects `Authorization: Bearer <accessToken>` into the server's headers before building the harness invoke request. The credential token overrides any static `Authorization` header.

If no valid credential exists for an OAuth-protected server, no Authorization header is added. The harness call will 401 if the server requires a token — the user should re-authenticate via the MCP Servers panel.

---

## Adding a new OAuth-protected MCP server

1. Verify the server meets the requirements above (especially `/.well-known/oauth-protected-resource` and registered redirect URIs).
2. In the **MCP Servers** tab, create a new server record:
   - **URL** — the MCP endpoint
   - **OAuth2 client ID** — the app client ID used for PKCE
3. Click **Save**.
4. Follow the **User authentication flow** above.
5. Click **List tools** to confirm the server is reachable with your stored token.
6. Assign the server to one or more agents on the **Agents** tab.
