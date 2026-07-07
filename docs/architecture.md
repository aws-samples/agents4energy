# Architecture: Amplify + AgentCore Integration

## Overview

This monorepo deploys everything from a single `npx ampx sandbox --once` command via Amplify Gen 2. The Amplify backend definition (`web/amplify/backend.ts`) uses CDK sub-stacks to deploy all infrastructure in a single CloudFormation deployment:

- **`web/`** — Next.js frontend backed by Amplify Gen 2 (Cognito auth, AppSync data)
- **`hostingStack`** — S3 + CloudFront static website hosting (defined in `backend.ts`)
- **`agentStack`** — Bedrock AgentCore Runtime (builds + deploys the Python handler from `agent/handler/`), plus the AgentCore Harness, Memory, and Gateway (built directly from `agent/default/agentcore/agentcore.json` via the `AgentCoreApplication` construct)

All of this is deployed together with a single `npx ampx sandbox --once --identifier <branch>` command — there is no separate `agentcore deploy` step in the production pipeline. `amplify_outputs.json` is written by Amplify and includes all ARNs and endpoints needed for the frontend. The `agentcore` CLI (`agentcore dev`, `agentcore validate`, etc.) remains usable for local iteration against the same `agentcore.json`/`harness.json` files — it just isn't part of the deploy path anymore.

### Per-Branch Routing (`basePath`)

Every branch/sandbox deploys to its own S3 prefix and is served at `https://<domain>/<branch-slug>/` — there is no content at the CloudFront root. To make the static export work from a sub-path, `web/next.config.ts` sets `basePath` from the `NEXT_BASE_PATH` env var, which `scripts/build.sh` sets to `/$BRANCH_SLUG` before building. This makes Next.js emit `/<branch-slug>/...` for every asset URL, route, and `redirect()` call automatically — `web/app/page.tsx` redirects `/` to `/chat`, which resolves to `/<branch-slug>/chat` once basePath is applied.

## Repository Structure

```
/
├── web/                        # Next.js + Amplify Gen 2
│   ├── amplify/
│   │   ├── backend.ts          # Amplify backend — auth, data, hostingStack, agentStack
│   │   ├── auth/resource.ts    # Cognito User Pool + Identity Pool
│   │   ├── data/resource.ts    # AppSync GraphQL API
│   │   └── constructs/
│   │       ├── hostingConstruct.ts          # S3 + CloudFront hosting
│   │       ├── agentCoreRuntimeWithBuild.ts # Builds Docker image + deploys CfnRuntime
│   │       └── agentCoreApplication.ts      # Harness + Memory + Gateway from agentcore.json
│   └── amplify_outputs.json    # Written by Amplify after each deploy (DO NOT EDIT)
│
├── agent/
│   ├── default/                # AgentCore CLI project root (agentcore.json, harness.json)
│   └── handler/                # Python handler (Dockerfile + agent.py)
│       └── Dockerfile
│
├── scripts/
│   ├── build.sh                # Single deploy: ampx sandbox → build → S3 upload
│   ├── deploy-web.sh           # Re-deploy just the frontend (reads amplify_outputs.json)
│   └── set-aws-targets.sh      # Populates aws-targets.json from current AWS identity
└── package.json                # Root deploy script
```

## How It Works

### Single Deployment Command

```
pnpm run deploy
  │
  ├─ predeploy: scripts/set-aws-targets.sh
  │
  └─ scripts/build.sh
       │
       ├─ npx ampx sandbox --once --identifier <branch>  (from web/)
       │    ├─ Deploys Cognito, AppSync, Lambda functions
       │    ├─ hostingStack: S3 bucket + CloudFront distribution
       │    ├─ agentStack:
       │    │    ├─ builds agent/handler/ Docker image → ECR, creates Bedrock AgentCore CfnRuntime
       │    │    ├─ AgentCoreApplication: Harness + Memory + Gateway from agentcore.json
       │    │    └─ escape-hatches Mutation.invokeHandler to an HTTP resolver targeting the runtime
       │    └─ writes web/amplify_outputs.json (all ARNs + endpoints)
       │
       ├─ pnpm --filter web build  (Next.js static export)
       │
       └─ aws s3 sync web/out/ s3://<bucket>/<branch>/
          aws cloudfront create-invalidation ...
```

### `amplify_outputs.json` — Single Source of Truth

Amplify writes `web/amplify_outputs.json` after every deploy. Everything the frontend and scripts need is in this file.

It's git-ignored (`web/.gitignore`) since it holds per-branch ARNs/endpoints, so it isn't visible anywhere unless you pull it off a live sandbox. `.github/workflows-drafts/deploy.yml` uploads it as a GitHub Actions build artifact (`amplify_outputs-<branch-slug>`, 30-day retention) after every deploy — download it from the workflow run's **Artifacts** section (or via `gh run download <run-id>`) to inspect what a given branch deployed without needing AWS console/CLI access.

Currently exported under `custom`:

| Key | Value |
|-----|-------|
| `auth_authenticated_role_arn` | IAM role ARN for signed-in Cognito users |
| `auth_unauthenticated_role_arn` | IAM role ARN for guest users |
| `invoke_agent_lambda_arn` | Lambda function ARN for the invoke-agent function |
| `hosting_bucket_name` | S3 bucket for static website files |
| `hosting_distribution_id` | CloudFront distribution ID (for cache invalidation) |
| `hosting_domain` | CloudFront domain name (e.g. `abc123.cloudfront.net`) |
| `agui_runtime_arn` | Bedrock AgentCore Runtime ARN for the AG-UI handler |
| `agui_runtime_role_arn` | Execution role ARN for the AgentCore runtime |
| `agentcore_region` | Region the AgentCore resources are deployed in |
| `agentcore_memory_id` / `agentcore_memory_arn` | AgentCore Memory identifiers (`MyHarnessMemory`) |
| `agentcore_harness_arn` / `agentcore_harness_role_arn` | AgentCore Harness (`MyHarness`) identifiers |
| `agentcore_gateway_id` / `agentcore_gateway_arn` / `agentcore_gateway_endpoint` | AgentCore Gateway identifiers |
| `appsync_api_id` | AppSync GraphQL API ID |

### Sub-Stacks in `backend.ts`

```ts
const hostingStack = backend.createStack('hosting');
const hosting = new HostingConstruct(hostingStack, 'Hosting');

const agentStack = backend.createStack('agent');
const agUiHandlerRuntime = new AgentCoreRuntimeWithBuild(agentStack, 'AgUiHandler', {
  protocolConfiguration: 'AGUI',
  imageAssetDirectory: path.resolve(__dirname, '../../../agent/handler'),
  cognitoDiscoveryUrl: '...',   // Cognito OIDC discovery URL
  allowedClients: [...],         // Cognito User Pool Client IDs
});
```

The `AgentCoreRuntimeWithBuild` construct builds the Docker image from `agent/handler/` (ARM64 cross-compile), pushes it to ECR, and creates a `CfnRuntime` with Cognito JWT authorization. The `HostingConstruct` creates an S3 bucket + CloudFront distribution with SPA routing.

## Adding New Cross-Project Exports

To share a new value from Amplify with the frontend or scripts:

1. Add it to `backend.addOutput({ custom: { ... } })` in `web/amplify/backend.ts`:
   ```ts
   backend.addOutput({
     custom: {
       my_new_value: someConstruct.someProperty,
     },
   });
   ```

2. Read it from `web/amplify_outputs.json`:
   ```ts
   import amplifyOutputs from './amplify_outputs.json';
   const myValue = amplifyOutputs.custom.my_new_value;
   ```

## Deploying Just the Frontend

After the backend is deployed, you can rebuild and redeploy just the Next.js frontend:

```bash
pnpm deploy:web [branch]
```

This reads S3 and CloudFront info from `amplify_outputs.json` and skips the Amplify backend deploy.
