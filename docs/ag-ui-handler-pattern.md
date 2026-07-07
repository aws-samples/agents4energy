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

`networkMode: PUBLIC` is required for the container to reach AppSync over HTTPS.  These `envVars` values in `agentcore.json` are only consulted by the standalone `agentcore` CLI (`agentcore dev`/`agentcore deploy`, used for local iteration).  The primary deploy path (`scripts/build.sh`, invoked by `pnpm deploy`) builds the `AgUiHandler` runtime directly from `web/amplify/backend.ts` via `AgentCoreRuntimeWithBuild`, which currently does **not** pass an `environment` prop — so `APPSYNC_HTTP_ENDPOINT` and `AGENTCORE_MEMORY_ID` are unset on that path, and `agent.py`'s `publish_event()`/memory-seeding calls silently no-op. Wiring these two env vars from `backend.ts` needs a custom resource (the AppSync URL is a token owned by the data stack, which the agent stack already depends on one-directionally) and is tracked as a follow-up.

### AppSync Schema (`aguiHandler.schema.ts`)

| Type | Purpose |
|---|---|
| `AgentEvent` | Custom type: `sessionId`, `eventType`, `messageId`, `delta?`, `done?` |
| `publishAgentEvent` | Mutation — NONE_DS pass-through; triggers the subscription |
| `onAgentEvent` | Subscription — filters by `sessionId`; browser subscribes before calling `invokeHandler` |
| `invokeHandler` | Mutation — NONE_DS stub at Amplify synth time; escape-hatched to a real HTTP resolver in `backend.ts` |

### AppSync HTTP Data Source (wired in-stack by `backend.ts`)

`web/amplify/backend.ts` wires the AGUI handler directly into the same CDK synth as the rest of the Amplify backend — no post-deploy script:
1. Creates IAM role `AgUiHandlerDataSourceRole` — trusted by `appsync.amazonaws.com`, with `bedrock-agentcore:InvokeAgentRuntime` on the runtime ARN (and its `/runtime-endpoint/*` suffix).
2. Creates the AppSync HTTP data source `AgUiHandlerDataSource` pointing at `bedrock-agentcore.{region}.amazonaws.com`, SigV4-signed.
3. Escape-hatches the transformer-generated `Mutation.invokeHandler` resolver to a UNIT JS resolver that POSTs to `/runtimes/{arn}/invocations` (reading the runtime ARN from `ctx.env.AGUI_RUNTIME_ARN`, set via `cfnGraphqlApi.environmentVariables`).
4. Grants the runtime execution role `appsync:GraphQL` scoped to the `Mutation.publishAgentEvent` field ARN, via an IAM `Policy` (`AgUiHandlerPublishEventPolicy`) attached in the *data* stack's scope — the field ARN needs the data stack's own `cfnGraphqlApi.attrApiId` token, and the data stack already depends on the agent stack one-directionally (for the runtime ARN), so defining this policy from the agent stack side would create a circular nested-stack dependency.

Both the HTTP data source's role and the publish-event policy live in the data stack for this reason — see the comments above `AgUiHandlerDataSourceRole` in `backend.ts`.

### Frontend (`web/app/(with-auth)/chat-handler/page.tsx`)

1. On mount, creates a `ChatSession` record (or reuses one from the URL `?sessionId=` param).
2. Calls `useInitialMessages(sessionId)` (shared with `/chat`) to restore prior turns from `MyHarnessMemory` via the `listSessionMessages` Lambda.
3. Subscribes to `onAgentEvent(sessionId)` via Amplify's `client.subscriptions.onAgentEvent(...)`.
4. On user submit, adds an optimistic user bubble and records the message text in `pendingUserMessageTextRef`, then calls `invokeHandler` via a raw GraphQL POST with the Cognito JWT (the mutation's real resolver is escape-hatched in `backend.ts`, so it isn't in the Amplify generated client's typed mutations).
5. As events arrive on the subscription:
   - `user_message`: skip if text matches `pendingUserMessageTextRef` (sender's own echo); otherwise add user bubble for other windows.
   - `text_message_*`: append deltas to the in-progress assistant message.
   - `run_finished`: re-fetch authoritative state from `MyHarnessMemory` via `listSessionMessages` — ensures all open windows converge to the same persisted messages.

---

## Deployment Order

```
pnpm run deploy
  1. ampx sandbox --once   → Single CDK synth: Amplify schema, hosting, AND the
                              AgUiHandler runtime + its AppSync HTTP resolver/IAM
                              (all owned by web/amplify/backend.ts)
  2. pnpm build (web)      → Next.js export
```

Everything AG-UI-related is created in one `ampx sandbox --once` pass — there is no separate `agentcore deploy` step or post-deploy wiring script for this runtime (unlike the harness/memory/gateway resources, which are also synthesized in the same pass from `agentcore.json`/`harness.json`, see `AgentCoreApplication` in `backend.ts`).

### Required IAM Permissions

Both wired directly in `web/amplify/backend.ts`:

| Role | Permission | Purpose |
|---|---|---|
| `AgUiHandlerDataSourceRole` | `bedrock-agentcore:InvokeAgentRuntime` on `runtime/{id}` AND `runtime/{id}/runtime-endpoint/*` | AppSync HTTP DS calls the runtime |
| AgentCore runtime execution role (`AgUiHandlerPublishEventPolicy`) | `appsync:GraphQL` on `Mutation.publishAgentEvent` field ARN | Container publishes AG-UI events |

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

### Required IAM additions (wired in `backend.ts`)

| Policy | Actions | Purpose |
|---|---|---|
| Memory access on runtime role | `bedrock-agentcore:ListEvents` on memory ARN | `AgentCoreMemorySessionManager` reads prior conversation turns before each run |

Note: only `ListEvents` is currently granted (see `backend.ts`, the block right after the AGUI runtime's `bedrock:InvokeModel*` grant). `AgentCoreMemorySessionManager` also persists each turn after a run, which needs write access (e.g. `CreateEvent`) on the memory ARN — not yet granted here. Since `AGENTCORE_MEMORY_ID` isn't even wired into the runtime's environment on this deploy path (see above), the session manager can't run at all currently, so this gap hasn't surfaced yet in practice.
