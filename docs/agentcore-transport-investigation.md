# AgentCore Wire Protocol Investigation

## Question

Can the AgentCore harness be configured to emit a client-facing wire format (e.g. OpenAI-compatible SSE) that the Vercel AI SDK understands natively, eliminating the custom `ChatTransport` in `web/lib/agentcore-transport.ts`?

## Answer: Not yet — the custom transport is load-bearing

The AWS binary event stream (`vnd.amazon.eventstream`) is the only client-facing format for harness invocations. No harness config, request header, or endpoint variant changes what callers receive.

## What `apiFormat: "chat_completions"` actually does

`apiFormat` is **not** purely internal to the Strands orchestrator. The CDK code in `@aws/agentcore-cdk` (`AgentCoreHarnessRole.js`) shows that setting it to `chat_completions` or `responses` grants two extra IAM permissions to the harness execution role:

```
bedrock-mantle:CreateInference
bedrock-mantle:CallWithBearerToken
```

`bedrock-mantle` is an AWS-internal proxy layer that exposes Bedrock models via OpenAI-compatible and Responses API formats. So `chat_completions` routes the Strands→model hop through this proxy instead of calling `bedrock:InvokeModelWithResponseStream` directly.

**However**, this translation happens inside the harness container. The harness still responds to `InvokeHarness` callers using the AWS binary event stream regardless.

## AgentCore Runtime protocol support

The AgentCore Runtime service contract supports four client-facing protocols — but they are **separate deployment modes**, not toggles on a harness:

| Protocol | Port | Mount Path | Message Format | Use Case |
|----------|------|------------|----------------|----------|
| HTTP | 8080 | `/invocations`, `/ws` | REST JSON/SSE, WebSocket | Direct API calls, streaming |
| MCP | 8000 | `/mcp` | JSON-RPC | Tool servers |
| A2A | 9000 | `/` | JSON-RPC 2.0 | Agent-to-agent |
| AG-UI | 8080 | `/invocations`, `/ws` | Event streams (SSE/WebSocket) | Interactive UI |

AG-UI in particular emits frontend-friendly events (`RUN_STARTED`, `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`, etc.) and has Vercel AI SDK support. But deploying an AG-UI server means bringing your own container and owning the orchestration layer — losing the managed harness benefits (zero-infra, config-driven model/tools/memory/truncation).

## Why the custom transport exists

The Vercel AI SDK's built-in fetch transport expects:
- Standard `text/event-stream` SSE
- OpenAI-shaped JSON payloads (`choices[].delta.content`)

AgentCore harness invocations return AWS binary-framed events with `:event-type` / `contentBlockDelta` headers. The `decodeEventStream` helper in `web/lib/aws-event-stream.ts` and the `HarnessChatTransport` in `web/lib/agentcore-transport.ts` are the necessary adapter between these two formats.

## Path forward

The cleanest resolution would be AWS adding a client-facing AG-UI or OpenAI-compatible SSE mode to harness invocations. Until then, the custom transport is the correct pattern — it is a thin, well-scoped adapter with no business logic, analogous to what the Spring AI SDK for AgentCore does on the Java side.

The alternative (deploying a custom AG-UI server container) trades infrastructure simplicity for wire-format compatibility and is not worth it at this stage.
