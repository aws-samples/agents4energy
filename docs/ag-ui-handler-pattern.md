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
| `Dockerfile` | Uses `public.ecr.aws/docker/library/python:3.12-slim` (avoids Docker Hub rate limits in CodeBuild) |
| `requirements.txt` | `strands-agents`, `bedrock-agentcore`, `fastapi`, `uvicorn`, `httpx`, `boto3` |

The container:
1. Receives `{ sessionId, prompt, systemPrompt?, modelId? }`.
2. Returns `{ sessionId }` immediately (so the AppSync HTTP resolver completes fast).
3. Runs a [Strands agent](https://github.com/strands-agents/sdk-python) via FastAPI `BackgroundTasks` (runs after the response is sent, guaranteed to complete before the ASGI scope closes).
4. For each delta, calls the AppSync `publishAgentEvent` mutation using SigV4-signed HTTPS (IAM via the runtime execution role).
5. Memory save/load is handled automatically by `AgentCoreMemorySessionManager` (from `bedrock-agentcore` SDK) — no manual `CreateEvent` / `ListEvents` calls needed.

AG-UI event sequence:
```
user_message → run_started → text_message_start → text_message_content* → text_message_end → run_finished
```
`user_message` carries the prompt text as `delta` and is broadcast before `run_started` so all open windows can display the user bubble without waiting for `run_finished`.  On error: `run_error` (with `done: true`).

### Context and memory management

Memory is fully managed by `AgentCoreMemorySessionManager` (from `bedrock-agentcore`) passed to the Strands `Agent` constructor.  It automatically retrieves prior session context before each run and persists each turn after it — no manual `CreateEvent` / `ListEvents` API calls required.

Context compaction is handled by Strands' **`SummarizingConversationManager`** with `proactive_compression=True` — it compresses at ~70% of the model's context window automatically.

Long-term session summaries are produced asynchronously by AgentCore Memory's **`SUMMARIZATION`** strategy (configured in `agentcore.json` on `MyHarnessMemory`), which extracts a condensed running summary of each session without any ETL pipeline.

### AgentCore Runtime Config (`agentcore.json`)

```json
{
  "name": "AgUiHandler",
  "build": "Container",
  "codeLocation": "../handler",
  "entrypoint": "agent.py",
  "networkMode": "PUBLIC",
  "envVars": [
    { "name": "APPSYNC_HTTP_ENDPOINT", "value": "<AppSync URL>" },
    { "name": "AGENTCORE_MEMORY_ID", "value": "<MyHarnessMemory ID>" }
  ]
}
```

`networkMode: PUBLIC` is required for the container to reach AppSync over HTTPS.  Both env var values are kept in sync by `scripts/extract-deployment-info.js` after every deploy.

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
2. Calls `useInitialMessages(sessionId)` (shared with `/chat`) to restore prior turns from `MyHarnessMemory` via the `listSessionMessages` Lambda.
3. Subscribes to `onAgentEvent(sessionId)` via Amplify's `client.subscriptions.onAgentEvent(...)`.
4. On user submit, adds an optimistic user bubble and records the message text in `pendingUserMessageTextRef`, then calls `invokeHandler` via a raw GraphQL POST with the Cognito JWT (the mutation is created by the post-deploy script, not in the Amplify generated client).
5. As events arrive on the subscription:
   - `user_message`: skip if text matches `pendingUserMessageTextRef` (sender's own echo); otherwise add user bubble for other windows.
   - `text_message_*`: append deltas to the in-progress assistant message.
   - `run_finished`: re-fetch authoritative state from `MyHarnessMemory` via `listSessionMessages` — ensures all open windows converge to the same persisted messages.

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
| `AppSync-AgUiHandler-*` | `bedrock-agentcore:InvokeAgentRuntime` on `runtime/{id}` AND `runtime/{id}/runtime-endpoint/*` | AppSync HTTP DS calls the runtime |
| AgentCore runtime execution role | `appsync:GraphQL` on `publishAgentEvent` | Container publishes AG-UI events |

---

## Session Summary (AgentCore SUMMARIZATION strategy)

AgentCore Memory's `SUMMARIZATION` strategy asynchronously produces a rolling text summary of each
session under the namespace `/summaries/{actorId}/{sessionId}`.  The frontend integrates this in two
places:

1. **"Earlier messages summarised" banner** — shown above the message list when the session has a
   summary.  Prior turns already captured in the summary are excluded from the message list by the
   `listSessionMessages` Lambda (`handler.ts` skips events at or before `summaryTimestamp`).

2. **Session Summary button** — a scroll-text icon in `PromptInputTools` (only visible when a summary
   exists).  Clicking it opens a Dialog with the full summary text and an **Edit** button.

   **Editing the summary**: clicking Edit reveals an inline `<textarea>` pre-filled with the current
   text.  Saving calls the `updateSessionSummary` AppSync mutation (backed by the
   `web/amplify/functions/update-session-summary/` Lambda), which calls
   `BatchUpdateMemoryRecordsCommand` to overwrite the record in AgentCore Memory.  On success the
   dialog switches back to read mode with the updated text, and the new text is used as context on
   the next invocation.

   The `summaryRecordId` returned by `listSessionMessages` is threaded through the stack
   (`list-session-messages/handler.ts` → GraphQL schema `ListSessionMessagesResult` → `use-initial-messages.ts`
   → page state) and is required to identify the specific memory record to update.

`AgentCoreMemorySessionManager` fetches all necessary context (including summaries) directly from AgentCore Memory before each run — the `summary` field has been removed from the `invokeHandler` mutation.

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
- Messages persist after reloading the session (memory integration)
- **Summarisation banner** — intercepts `listSessionMessages` GraphQL response, injects a fake summary,
  and asserts the "Earlier messages summarised" banner renders
- **Summary edit dialog** — intercepts `listSessionMessages` (returns fake summary + `summaryRecordId`)
  and `updateSessionSummary` (returns success), opens the dialog, edits the text, saves, and asserts
  the updated text appears in read mode

### Required IAM additions (post-deploy, via extract-deployment-info.js)

| Policy | Actions | Purpose |
|---|---|---|
| Memory access on runtime role | `bedrock-agentcore:CreateEvent`, `bedrock-agentcore:ListEvents`, `bedrock-agentcore:GetMemory` on memory ARN | `AgentCoreMemorySessionManager` reads and writes conversation turns automatically |
