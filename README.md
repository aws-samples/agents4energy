# AgentCore CLI Agent

A Next.js + AWS Amplify Gen 2 application for deploying and chatting with AI agents backed by [Amazon Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/).

## Getting started

See [CLAUDE.md](CLAUDE.md) for the full command reference, monorepo layout, and architecture overview.

### Frontend dev server

```bash
cd web && pnpm dev
```

The dev server runs on HTTPS at `https://localhost:3000`. Trust the certificate once on macOS:

```bash
# Run once from web/
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain certificates/rootCA.pem
```

### Deploy

```bash
pnpm deploy   # Amplify sandbox + AgentCore + Next.js export
pnpm destroy  # Tear down all infrastructure
```

### Invoke the agent from the CLI

```bash
npx tsx scripts/invoke.ts "Your prompt here"
```

Reads credentials from `scripts/.env.local` (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`).

## Docs

| Document | What it covers |
|----------|----------------|
| [docs/agentic-architecture.md](docs/agentic-architecture.md) | Full data flow diagram and architecture overview |
| [docs/github-integration.md](docs/github-integration.md) | Invoking agents via GitHub @mentions and issue assignment |
| [docs/mcp-server-integration.md](docs/mcp-server-integration.md) | Connecting external MCP servers to an agent |
| [docs/e2e-testing.md](docs/e2e-testing.md) | Playwright E2E test conventions |

## GitHub integration

Agents can be invoked by @mentioning them in GitHub issue and PR comments. The integration uses GitHub Actions with OIDC federation — no stored AWS credentials needed.

See [docs/github-integration.md](docs/github-integration.md) for setup instructions, including the required one-time AWS account step:

```bash
# One-time per AWS account — already done for account 796988593450
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```
