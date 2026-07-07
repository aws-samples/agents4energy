# Agentic Architecture

This document covers how the AI agent actually runs: the harness, memory, MCP tools, and the path from a user message to a streamed response.

For cross-project deployment wiring (Amplify → AgentCore CDK) see [architecture.md](architecture.md).

---

## `agent/` Folder Structure

The `agent/` directory contains two things that are easy to confuse:

| Path | What it is |
|------|-----------|
| `agent/default/` | The AgentCore CLI project root. `agentcore.json`/`harness.json` here are read at Amplify synth time — the CLI itself (`agentcore dev`, `agentcore validate`) remains usable for local iteration, but `agentcore deploy` is no longer part of the production pipeline. |
| `agent/default/agentcore/agentcore.json` | Declarative source of truth — declares all AgentCore resources (memories, harnesses, gateways). |
| `agent/default/app/MyHarness/` | Harness config. Referenced by the `harnesses[]` entry in `agentcore.json`. |
| `agent/handler/` | Python source for the Strands agent container (FastAPI + uvicorn). **Not its own deploy unit** — it's referenced directly by `web/amplify/backend.ts` via `AgentCoreRuntimeWithBuild`. |

`web/amplify/backend.ts` builds both resources declared in `agentcore.json`, directly inside the `agentStack` CDK stack:

1. **`AgUiHandler` runtime** — `AgentCoreRuntimeWithBuild` builds `agent/handler/` into a Docker image, pushes to ECR, and creates the AgentCore runtime as a same-stack CDK resource. Used by the `/chat-handler` page via AppSync mutation → HTTP resolver.
2. **`MyHarness` harness** (plus `MyHarnessMemory` and the MCP gateway) — built by the `AgentCoreApplication` construct (`web/amplify/constructs/agentCoreApplication.ts`) directly from `agentcore.json`/`harness.json`. Used by the original `/chat` page via the SigV4 streaming transport.

Both share `MyHarnessMemory`, so both chat surfaces see the same conversation history. Because everything is same-stack, all ARNs are CDK tokens resolved at synth time — no post-deploy control-plane lookups are needed.

---

## Overview

The agent in this project is a **Bedrock AgentCore Harness** — a managed runtime that handles model invocation, memory, and tool execution. The frontend never talks to a model API directly; all inference flows through the harness.

```
Browser
  │  Bearer JWT request (Cognito access token)
  ▼
bedrock-agentcore.{region}.amazonaws.com/harnesses/invoke
  │
  ▼
MyHarness (AgentCore Harness)
  ├── Model: OpenAI GPT-OSS-120B via Bedrock (chat completions format)
  ├── Memory: MyHarnessMemory (semantic + episodic)
  ├── Built-in tools: Browser, Code Interpreter
  └── Remote MCP tools: injected per-request from agent config
```

---

## Harness

The harness is configured in [`agent/default/app/MyHarness/harness.json`](../agent/default/app/MyHarness/harness.json).

| Setting | Value |
|---------|-------|
| Model | `openai.gpt-oss-120b` via Bedrock, chat completions API format |
| Memory | `MyHarnessMemory` (persistent, per-user + per-session) |
| Built-in tools | `agentcore_browser`, `agentcore_code_interpreter` |
| Auth | CUSTOM_JWT — requests carry a Cognito access token as a Bearer header; `discoveryUrl`/`allowedClients` are derived from this deployment's Cognito user pool at synth time (`web/amplify/backend.ts`), not hardcoded in `harness.json` |
| Context truncation | Summarization (preserves 10 most-recent messages, summarizes the rest) |

The harness runs as a hosted container on AgentCore infrastructure. Its ARN is exported via `backend.addOutput({ custom: { agentcore_harness_arn, ... } })` and read from `web/amplify_outputs.json` at build time by the frontend transport layer.

---

## Invocation Flow

### 1. Authentication

The frontend calls `fetchAuthSession()` from `aws-amplify/auth` and sends the Cognito access token as an `Authorization: Bearer <token>` header on every harness invoke request (see `bearerFetch()` in `web/lib/agentcore-transport.ts`). The access token is required rather than the ID token because the CUSTOM_JWT authorizer's `allowedClients` check matches against the token's `client_id` claim, which only access tokens carry — ID tokens carry `aud` instead.

The harness uses CUSTOM_JWT auth — it validates the token against the Cognito user pool's discovery URL and checks the client ID against `allowedClients`. `web/amplify/backend.ts` derives both values from `backend.auth.resources.userPool`/`userPoolClient` at synth time (the same pattern `AgentCoreRuntimeWithBuild` uses for the AG-UI runtime), so the harness always authorizes against the Cognito user pool it's actually deployed alongside rather than a value frozen in `harness.json` from a prior deployment.

### 2. Request construction

`web/lib/agentcore-transport.ts` implements the AI SDK `ChatTransport` interface. On each message send it builds the invoke body:

```typescript
{
  runtimeSessionId: string,   // stable per-tab session; stored in sessionStorage
  messages: HarnessMessage[], // conversation history in Bedrock message format
  systemPrompt?: [...],       // from selected Agent's systemPromptText field
  model?: { bedrock: { modelId } }, // from selected Agent's modelId field
  tools?: [                   // from selected Agent's mcpServers
    { type: "remote_mcp", name, config: { remoteMcp: { url, headers? } } },
    ...
  ],
}
```

`systemPrompt` and `model` use the harness's first-class override fields so the harness can apply them correctly rather than injecting them as message content.

### 3. Streaming response

The harness returns a binary AWS event stream (Smithy protocol). `web/lib/aws-event-stream.ts` decodes it frame-by-frame, yielding events:

- `messageStart` — signals the assistant turn has begun
- `contentBlockDelta` — text delta (streamed token by token)
- `contentBlockStop` — signals text block is complete
- `messageStop` — end of turn, includes `stopReason`
- `metadata` — token usage and latency metrics

The transport translates `contentBlockDelta` events into AI SDK `UIMessageChunk` objects, which React renders incrementally via `useChat`.

---

## Memory

`MyHarnessMemory` uses four complementary strategies, all namespaced per user:

| Strategy | Namespace | What it stores |
|----------|-----------|----------------|
| `SEMANTIC` | `/users/{actorId}/facts` | Durable facts extracted from conversation (preferences, stated facts) |
| `USER_PREFERENCE` | `/users/{actorId}/preferences` | Behavioral preferences inferred from interactions |
| `SUMMARIZATION` | `/summaries/{actorId}/{sessionId}` | Compressed summaries of old sessions |
| `EPISODIC` | `/episodes/{actorId}/{sessionId}` | Timestamped episode records; reflects to `/episodes/{actorId}` across sessions |

The harness reads relevant memory automatically before each inference call and writes new events after each turn. Memory events expire after 30 days.

### Viewing past sessions

The Amplify Lambda `list-session-messages` queries `ListEvents` on the memory ARN for a given session ID, parses the JSON payloads, and returns them as structured messages. The chat UI calls this on load to restore prior context.

---

## MCP Tools

MCP (Model Context Protocol) tools let the agent call external APIs as tools. There are two ways they enter the system.

### Per-request injection (remote_mcp)

When the user selects an agent in the chat UI, the frontend reads the agent's `McpServer` records from AppSync and includes them in the invoke body as `remote_mcp` tool specs:

```typescript
{
  type: "remote_mcp",
  name: "my-tool-server",
  config: {
    remoteMcp: {
      url: "https://...",
      headers: { "Authorization": "Bearer ..." },
    },
  },
}
```

The harness calls the MCP server on demand using these exact credentials. This is the primary path for per-agent tool configuration.

### Gateway registration (optional)

MCP servers can also be registered as targets on the AgentCore Gateway. Registered targets benefit from gateway-level auth handling (workload identity, token exchange) rather than relying on raw header forwarding.

Registration happens via the `registerMcpTarget` GraphQL mutation → Amplify Lambda → `CreateGatewayTarget` API. The returned `gatewayTargetId` is saved on the `McpServer` record.

### Validating connectivity

Before saving an MCP server, the frontend can call the `listMcpTools` GraphQL query. This Lambda probes the server using the same `url` + `headers` that the harness would use (MCP `initialize` → `tools/list` sequence). If the query succeeds, the harness invocation will too.

---

## Agent Configuration

Agents are stored in DynamoDB via the Amplify `Agent` and `McpServer` models. The chat UI loads them and passes the selected agent's config into every harness invoke:

```
Agent record
  ├── name, slug
  ├── systemPromptText  → injected as systemPrompt override
  ├── modelId           → injected as model override (null = harness default)
  └── mcpServers (via AgentMcpServer join)
        └── McpServer: url, headers[]  → injected as remote_mcp tools
```

Agent configs are applied dynamically at invoke time — no redeployment required when an agent's prompt or tool list changes.

---

## Key ARNs

Exported via `backend.addOutput({ custom: {...} })` in `web/amplify/backend.ts` and read from `web/amplify_outputs.json`:

| Resource | Output key |
|----------|-----|
| Harness | `agentcore_harness_arn` |
| Memory | `agentcore_memory_arn` / `agentcore_memory_id` |
| MCP Gateway | `agentcore_gateway_arn` / `agentcore_gateway_id` / `agentcore_gateway_endpoint` |

> **Note**: The harness ARN uses the `harness/` resource type, not `runtime/`. These are different resources — the harness ARN is required by the `/harnesses/invoke` endpoint.

See [docs/architecture.md](architecture.md) for the full list of `custom` outputs.

---

## Data Flow Diagram

```
User types message
       │
       ▼
ChatView (React)
  useChat(transport)
       │
       ▼
HarnessChatTransport
  fetchAuthSession() → Cognito access token
  build invoke body (messages + systemPrompt + model + tools)
       │
       ▼
POST /harnesses/invoke?harnessArn=...
  Authorization: Bearer <Cognito access token>
       │
       ▼
AgentCore Harness (MyHarness)
  1. Validate JWT against Cognito discovery URL (CUSTOM_JWT auth)
  2. Load memory context for actorId + sessionId
  3. Build model request (history + system prompt + tools)
       │
       ▼
Bedrock: openai.gpt-oss-120b
  Streaming inference
       │  tool_use blocks
       ▼
AgentCore tool execution
  ├── agentcore_browser  (if invoked)
  ├── agentcore_code_interpreter  (if invoked)
  └── remote_mcp call to external server  (if invoked)
       │
       ▼
Streaming binary event stream response
       │
       ▼
aws-event-stream.ts decoder
  contentBlockDelta → UIMessageChunk
       │
       ▼
React renders streamed text
```
