# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Guidance

### AWS CLI
If you would like to run an aws cli command you don't have access to, put the command in your response and ask the user to run it.

### Updating GitHub workflows
You can't direclty push changes to `.github/workflows/`, so instead update `.github/workflow-drafts/` and ask the user to copy the workflow to the other folder.

### GitHub Issues
If you discover a bug:
1. Check the current github issues cover the bug, and if so make sure the issue has sufficient context
2. If not, create a github issue. Use the github native relationships feature to describe blocking relationships with other issues.

### Docuemntation
Be sure to keep the documentation in the `./docs` folder fresh. After you make a change, make sure the relevant docs are still correct, and create a new doc if it's something either a developer or user would want to know about.

### Environment setup
The sandbox has network/internet access (e.g. `pnpm install`, `npm registry`, AWS API calls all work) — don't assume otherwise. Run `pnpm install` from the repo root before running `pnpm deploy`, `pnpm test:e2e`, or any other command below — fresh checkouts and sandboxes don't have `node_modules` installed. If a command fails, verify with a direct check (e.g. `curl`, `pnpm --version`) before concluding the environment lacks a capability — don't assume a limitation without testing it first.

## Commands

All commands run from the repo root unless noted.

```bash
# Install dependencies (run this first)
pnpm install

# Full build + deploy (Amplify sandbox → AgentCore → Next.js export)
pnpm deploy

# Tear down all infrastructure
pnpm destroy

# Frontend dev server (HTTPS on localhost:3000)
cd web && pnpm dev

# Frontend lint
cd web && pnpm lint

# E2E tests (from web/)
pnpm test:e2e                        # all tests, headless
pnpm test:e2e e2e/chat.spec.ts       # single file
pnpm test:e2e:ui                     # interactive UI mode

# Invoke the deployed agent from the CLI
npx tsx scripts/invoke.ts "Your prompt here"

# AgentCore CLI (from agent/default/)
agentcore deploy     # deploy harness + memory + gateway
agentcore status     # show deployment status
agentcore validate   # validate agentcore.json before deploying
agentcore dev        # run agent locally with hot-reload
```

Trust the cert once on macOS (from `web/`):
```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain certificates/rootCA.pem
```

## Monorepo Layout

| Path | What lives here |
|------|----------------|
| `web/` | Next.js 16 frontend (Amplify Gen 2 backend) |
| `web/amplify/` | Amplify backend — auth, data schema, Lambda functions |
| `web/amplify/data/schemas/` | Modular AppSync schemas: `chat`, `agentConfig`, `agentcoreMemory` |
| `web/amplify/functions/` | Lambda handlers: `invoke-agent`, `list-mcp-tools`, `list-session-messages`, `register-mcp-target` |
| `web/app/(with-auth)/` | Authenticated route group — `chat/` and `agents/` pages |
| `web/lib/` | Transport layer: `agentcore-transport.ts`, `aws-event-stream.ts`, `mcp-auth.ts` |
| `web/e2e/` | Playwright tests |
| `agent/default/` | AgentCore project — harness, memory, gateway config |
| `agent/default/agentcore/agentcore.json` | Declarative AgentCore resource definitions (source of truth) |
| `packages/shared-types/` | Types shared between `web` and other workspaces |
| `scripts/` | Dev utilities: `invoke.ts`, `extract-deployment-info.js`, `create-mcp-server.ts` |

## Architecture

The system has two independently deployed halves that share Cognito auth:

**AgentCore half** (`agent/default/agentcore/agentcore.json`): A Bedrock AgentCore Harness (`MyHarness`) backed by `openai.gpt-oss-120b`. Includes persistent memory (`MyHarnessMemory` with SEMANTIC, USER_PREFERENCE, SUMMARIZATION, and EPISODIC strategies), a MCP Gateway (`default-gateway`) that validates Cognito JWTs, and built-in `agentcore_browser` + `agentcore_code_interpreter` tools.

**Amplify half** (`web/amplify/backend.ts`): DynamoDB-backed AppSync API (Amplify Gen 2) managing `Agent`, `McpServer`, `ChatSession`, and `ChatMessage` records. Four Lambda functions handle: agent invocation via SigV4, MCP tool discovery, session message restoration from memory, and gateway target registration.

**Request path**: Browser → `HarnessChatTransport` (`web/lib/agentcore-transport.ts`) → `POST /harnesses/invoke` (Cognito JWT auth) → Harness → Bedrock model → binary AWS event stream → `aws-event-stream.ts` decoder → React streaming UI via AI SDK `useChat`.

**Agent config is runtime-injectable**: The selected `Agent` record's `systemPromptText`, `modelId`, and linked `McpServer` URLs are injected into every harness invoke. Changing an agent's config takes effect immediately — no redeployment.

**Deployment wiring**: After `agentcore deploy`, `scripts/extract-deployment-info.js` reads `agent/default/agentcore/.cli/deployed-state.json` and CloudFormation outputs, then writes `web/deployment-info.json` which the frontend imports at build time for ARNs.

See [docs/agentic-architecture.md](docs/agentic-architecture.md) for the full data flow diagram.

## Key Constraints

- `agentcore.json` is the source of truth for AgentCore resources — do not edit CDK output files directly. Renaming a resource destroys and recreates it.
- `web/deployment-info.json` is populated by the deploy script; do not hand-edit ARNs there.
- Amplify hardcodes the Memory ARN and Gateway ID in `web/amplify/backend.ts` — update those constants after any AgentCore redeploy that changes those resources.
- E2E tests run serially (workers=1) because tests share session state stored in `localStorage`.
