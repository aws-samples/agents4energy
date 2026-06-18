# Agent Config Runtime — Progress

## Goal

Enable runtime agent configuration so a single deployed AgentCore harness can serve multiple named agents, each with its own system prompt, model override, and MCP server assignments. Users pick an agent from a dropdown in the chat UI.

---

## What Was Done

### 1. Schema — `web/amplify/data/schemas/agentConfig.schema.ts`
- Added `systemPromptText` field to the `Agent` model so agents can store their system prompt inline (no S3 required for simple cases).
- Existing schema already had `systemPromptS3Key`, `modelId`, `slug`, `enabled`, `McpServer`, `AgentMcpServer`, `AgentSubAgent`.

### 2. Data Layer — `web/amplify/data/resource.ts`
- Added `agentConfigSchema` to the `a.combine([...])` call so the four new models (`Agent`, `McpServer`, `AgentMcpServer`, `AgentSubAgent`) are deployed to AppSync/DynamoDB.

### 3. Transport — `web/lib/agentcore-transport.ts`
- Added `AgentConfig` interface (`agentId`, `systemPromptText`, `modelId`).
- `HarnessChatTransport` now accepts a `getAgentConfig` callback.
- Uses the `InvokeHarness` API's first-class `systemPrompt` field (`[{ text }]`) and `model` field (`{ bedrock: { modelId } }`) so the harness handles them properly without message injection.

### 4. Chat Session Hook — `web/app/(with-auth)/chat/use-chat-session.ts`
- Tracks `agentId` state sourced from the URL param `?agentId=<id>`.
- On new sessions, writes `agentId` to the `ChatSession` record.
- On existing sessions (page reload), fetches the session's `agentId` from AppSync if not already in URL.
- Exposes `setAgentId()` which updates both state and URL.

### 5. Agent Fetching Hook — `web/app/(with-auth)/chat/use-agents.ts` (new file)
- Queries `Agent.list()` for all `enabled: true` agents.
- Returns typed `AgentOption[]` with `id`, `name`, `slug`, `description`, `systemPromptText`, `modelId`.

### 6. Chat Page — `web/app/(with-auth)/chat/page.tsx`
- Imports `useAgents` and `useChatSession` agentId/setAgentId.
- Passes `getAgentConfig` to `HarnessChatTransport` via a ref (so transport is stable but config is always fresh).
- Renders an agent picker `<PromptInputSelect>` in the footer toolbar. Uses existing `PromptInput*` select sub-components from the design system.
- Picker is hidden when no agents exist in the database (graceful degradation).

### 7. Deployment
- Ran `npx ampx sandbox --once` in `web/` — all four new models deployed successfully.
- Confirmed in `amplify_outputs.json`: `['ChatSession', 'ChatMessage', 'Settings', 'Agent', 'McpServer', 'AgentMcpServer', 'AgentSubAgent']`.

### 8. Sample Agent & Test
- Created `scripts/create-sample-agent.ts` — authenticates via Cognito and calls the GraphQL `createAgent` mutation.
- Created `scripts/invoke-agent.ts` — looks up an agent by slug, injects its system prompt, invokes the harness.
- **Test result**: `invoke-agent.ts demo-agent "What agent are you?"` → `"I am the Demo Agent."` ✅

**Demo Agent record (DynamoDB ID):** `1a92fb1c-440f-455d-954a-80e70b7d7e1c`

---

## Known Constraints / Design Decisions

| Topic | Decision |
|---|---|
| System prompt | Passed via `systemPrompt: [{ text }]` in the `InvokeHarness` request body — the proper first-class API field. The harness uses it as the system context without injecting it into the conversation. |
| MCP servers | Schema is deployed (`AgentMcpServer` table exists), but the harness does not yet read MCP server assignments from DynamoDB at invoke time. Harness tools are still controlled by `harness.json`. |
| Sub-agents | `AgentSubAgent` table is deployed; the harness does not yet route to sub-agents based on it. |
| Model override | `modelId` is stored on `Agent` but not sent to the harness (harness uses its `harness.json` model). Implementing model override requires either a custom runtime harness or a `configBundle` AB test. |

---

## TODO

- [ ] **MCP server wiring**: On invoke, resolve the agent's `AgentMcpServer` records and either (a) pass them to a custom harness runtime that configures MCP dynamically, or (b) maintain per-agent harnesses via agentcore CDK.
- [ ] **Model override**: Implement per-agent model selection — likely requires a custom `bedrock-agentcore` runtime harness (not the managed harness) that reads config from headers/context.
- [ ] **Sub-agent routing**: Wire `AgentSubAgent` records so agents can call each other as sub-agents.
- [ ] **Agent management UI**: Build an admin page (`/agents`) to create/edit/delete `Agent` and `McpServer` records without using GraphQL directly.
- [ ] **Persist session agentId**: When a user changes the agent mid-session, update the `ChatSession.agentId` in AppSync so page reloads restore the same agent.
- [ ] **System prompt via S3**: Implement reading `systemPromptS3Key` as a fallback when `systemPromptText` is absent (requires a Lambda or server action to fetch S3 content).
- [ ] **Multiple agents in one conversation**: Currently the first user message injection strategy means switching agents mid-session isn't clean. Consider a per-message agent field.
