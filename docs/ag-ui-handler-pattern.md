# AG-UI Handler Pattern

This document describes the AG-UI over AppSync subscription architecture introduced alongside the existing harness transport.  The `/chat-handler` page uses this pattern; the original `/chat` page and harness transport are unchanged.

---

## Overview

Traditional harness flow (existing `/chat`):
```
Browser → SigV4 fetch → AgentCore Harness → binary event stream → Browser
```

AG-UI handler flow (new `/chat-handler`):
```
Browser ──subscribe──▶ AppSync (onAgentEvent)
Browser ──mutation───▶ AppSync (invokeHandler)
                         └─ HTTP resolver (SigV4) ──▶ AgentCore Runtime (/invocations)
                                                         ├── asyncio task: Strands Agent
                                                         └── AppSync (publishAgentEvent) ──▶ Browser subscription
```

The key difference: the browser calls an AppSync mutation which forwards directly to the AgentCore runtime via an HTTP data source — no Lambda involved.  The runtime runs the agent in a background task, publishing AG-UI events back to AppSync as they arrive.

---

## Components

### `agent/handler/` — AgentCore Runtime Container

| File | Purpose |
|---|---|
| `agent.py` | FastAPI app with `/ping` (health) and `/invocations` (start agent run) endpoints |
| `Dockerfile` | ARM64 Python 3.12 image (required by AgentCore Runtime) |
| `requirements.txt` | `strands-agents`, `fastapi`, `uvicorn`, `httpx`, `boto3` |

The container:
1. Receives `{ sessionId, prompt, systemPrompt?, modelId? }`.
2. Returns `{ sessionId }` immediately (so the AppSync HTTP resolver completes fast).
3. Runs a [Strands agent](https://github.com/strands-agents/sdk-python) in `asyncio.create_task()`.
4. For each delta, calls the AppSync `publishAgentEvent` mutation using SigV4-signed HTTPS (IAM via the runtime execution role).

AG-UI event sequence:
```
run_started → text_message_start → text_message_content* → text_message_end → run_finished
```
On error: `run_error` (with `done: true`).

### AgentCore Runtime Config (`agentcore.json`)

```json
{
  "name": "AgUiHandler",
  "build": "Container",
  "codeLocation": "../handler",
  "entrypoint": "agent.py",
  "networkMode": "PUBLIC",
  "envVars": [
    { "name": "APPSYNC_HTTP_ENDPOINT", "value": "<AppSync URL>" }
  ]
}
```

`networkMode: PUBLIC` is required for the container to reach AppSync over HTTPS.  The `APPSYNC_HTTP_ENDPOINT` value is kept in sync by `scripts/extract-deployment-info.js` after every deploy.

### AppSync Schema (`aguiHandler.schema.ts`)

| Type | Purpose |
|---|---|
| `AgentEvent` | Custom type: `sessionId`, `eventType`, `messageId`, `delta?`, `done?` |
| `publishAgentEvent` | Mutation — NONE_DS pass-through; triggers the subscription |
| `onAgentEvent` | Subscription — filters by `sessionId`; browser subscribes before calling `invokeHandler` |
| `invokeHandler` | Mutation — NONE_DS stub at Amplify synth time; replaced by HTTP resolver by `extract-deployment-info.js` after `agentcore deploy` |

### AppSync HTTP Data Source (created by `extract-deployment-info.js`)

After `agentcore deploy`, `scripts/extract-deployment-info.js` calls the AWS CLI to:
1. Create IAM role `AppSync-AgUiHandler-{apiId}` — trusted by `appsync.amazonaws.com`, with `bedrock-agentcore:InvokeAgentRuntime` on the runtime ARN.
2. Create/update AppSync HTTP data source `AgUiHandlerRuntime` pointing at `bedrock-agentcore.{region}.amazonaws.com`, SigV4-signed.
3. Create/update the `Mutation.invokeHandler` resolver to a UNIT JS resolver that POSTs to `/runtimes/{arn}/invocations`.
4. Grant the runtime execution role `appsync:GraphQL` for `publishAgentEvent`.
5. Keep `agentcore.json` env var `APPSYNC_HTTP_ENDPOINT` in sync.

### Frontend (`web/app/(with-auth)/chat-handler/page.tsx`)

1. On mount, creates a `ChatSession` record (or reuses one from the URL `?sessionId=` param).
2. Subscribes to `onAgentEvent(sessionId)` via Amplify's `client.subscriptions.onAgentEvent(...)`.
3. On user submit, calls `client.mutations.invokeHandler({ sessionId, prompt })`.
4. As events arrive on the subscription, appends deltas to the in-progress assistant message.

---

## Deployment Order

```
pnpm run deploy
  1. ampx sandbox --once          → Amplify (schema + NONE_DS stub resolver)
  2. agentcore deploy             → Build Docker image, push to ECR, create/update runtime
  3. extract-deployment-info.js   → Wires AppSync HTTP resolver + IAM; writes deployment-info.json
  4. pnpm build (web)             → Next.js export
```

The sequence matters: Amplify must run first (creates AppSync API), then agentcore deploy (creates the runtime), then the wiring script (connects the two).

### Required IAM Permissions

After `extract-deployment-info.js` runs:

| Role | Permission | Purpose |
|---|---|---|
| `AppSync-AgUiHandler-*` | `bedrock-agentcore:InvokeAgentRuntime` | AppSync HTTP DS calls the runtime |
| AgentCore runtime execution role | `appsync:GraphQL` on `publishAgentEvent` | Container publishes AG-UI events |

---

## Testing

```bash
cd web
pnpm test:e2e e2e/chat-handler.spec.ts
```

Tests cover:
- Prompt input is visible
- Empty state is shown before messages
- Agent returns a response via subscription
- Message contains text after streaming completes
