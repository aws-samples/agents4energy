# Architecture: Amplify + AgentCore Integration

## Overview

This monorepo connects two independently deployed AWS services:

- **`web/`** — Next.js frontend backed by Amplify Gen 2 (Cognito auth, AppSync data)
- **`agent/`** — Bedrock AgentCore runtime deployed via the AgentCore CLI and CDK

The key design principle: **Amplify deploys first and owns auth. AgentCore CDK deploys second and reads Amplify's outputs to configure access.** Neither project modifies the other's infrastructure directly.

## Repository Structure

```
/
├── web/                        # Next.js + Amplify Gen 2
│   ├── amplify/
│   │   ├── backend.ts          # Amplify backend definition + cross-project exports
│   │   ├── auth/resource.ts    # Cognito User Pool + Identity Pool
│   │   └── data/resource.ts    # AppSync GraphQL API
│   └── amplify_outputs.json    # Written by Amplify after each deploy (DO NOT EDIT)
│
├── agent/                      # AgentCore runtime
│   ├── agentcore/
│   │   ├── agentcore.json      # AgentCore project config
│   │   ├── aws-targets.json    # Deployment target (account + region, written by predeploy)
│   │   └── cdk/                # CDK app that deploys the AgentCore stack
│   │       ├── bin/cdk.ts      # Entry point — reads amplify_outputs.json
│   │       └── lib/cdk-stack.ts # Stack — grants Amplify roles InvokeAgentRuntime
│   └── app/Default/main.ts     # Agent runtime code (Vercel AI + BedrockAgentCoreApp)
│
├── scripts/
│   └── set-aws-targets.sh      # Populates aws-targets.json from current AWS identity
└── package.json                # Root deploy script orchestrates the correct order
```

## How Cross-Project Configuration Works

### The Contract: `amplify_outputs.json`

Amplify writes `web/amplify_outputs.json` after every deploy. This file is the single source of truth for anything the `agent/` project needs from the Amplify deployment.

**Rule: any value the AgentCore CDK needs from Amplify must be exported via `backend.addOutput({ custom: { ... } })` in `web/amplify/backend.ts`.** Never call AWS APIs at CDK synth time to discover Amplify resources.

Currently exported under `custom`:

| Key | Value |
|-----|-------|
| `auth_authenticated_role_arn` | IAM role ARN that Cognito Identity Pool vends to signed-in users |
| `auth_unauthenticated_role_arn` | IAM role ARN for guest (unauthenticated) users |

### How the IAM Grant Works

1. A user signs in via Cognito User Pool (email/password).
2. The Cognito Identity Pool exchanges the User Pool token for temporary AWS credentials, scoped to the **authenticated IAM role**.
3. That role has an `InvokeAgentRuntime` policy attached — added by the AgentCore CDK stack, not by Amplify.
4. The frontend uses these credentials (via `fetchAuthSession()` from `aws-amplify/auth`) to call the AgentCore runtime directly.

The CDK stack reads the authenticated role ARN from `amplify_outputs.json` at synth time (`bin/cdk.ts` → `readAmplifyOutputs()`), imports it as a CDK `Role` reference, and attaches the policy. Amplify never touches the AgentCore stack; the AgentCore stack adds one policy to an Amplify-owned role.

## Deploy Flow

```
pnpm run deploy
  │
  ├─ predeploy: scripts/set-aws-targets.sh
  │    └─ writes agent/agentcore/aws-targets.json with current AWS account + region
  │
  ├─ build
  │    ├─ next build  (web/)
  │    └─ tsc         (agent/agentcore/cdk/)
  │
  ├─ ampx sandbox --once  (web/)
  │    ├─ deploys Cognito User Pool, Identity Pool, AppSync
  │    └─ writes web/amplify_outputs.json  ← includes custom role ARNs
  │
  └─ agentcore deploy --yes  (agent/)
       ├─ CDK synth reads web/amplify_outputs.json
       ├─ attaches InvokeAgentRuntime to the authenticated IAM role
       └─ deploys BedrockAgentCore Runtime + Memory
```

**Order matters.** Amplify must deploy before AgentCore so `amplify_outputs.json` contains the `custom` section when CDK synthesizes.

## Adding New Cross-Project Exports

To share a new value from Amplify with other projects in this monorepo:

1. Add it to `backend.addOutput({ custom: { ... } })` in `web/amplify/backend.ts`:
   ```ts
   backend.addOutput({
     custom: {
       my_new_value: someConstruct.someProperty,
     },
   });
   ```

2. Read it in `agent/agentcore/cdk/bin/cdk.ts`:
   ```ts
   const amplifyOutputs = readAmplifyOutputs(projectRoot);
   const myValue = amplifyOutputs.my_new_value;
   ```

3. Pass it as a prop to `AgentCoreStack` and use it in `lib/cdk-stack.ts`.

## Known Quirks

### `INIT_CWD` and pnpm workspaces

pnpm sets `INIT_CWD` to the directory where `pnpm run` was invoked (the repo root). The AgentCore CLI uses `INIT_CWD ?? process.cwd()` to locate `agentcore.json`, so running it via `pnpm --filter agent run deploy` from the repo root would send it looking in the wrong place.

Fix: the `deploy` script in `agent/package.json` uses `env -u INIT_CWD` to unset it, letting the CLI fall back to `process.cwd()` (the `agent/` directory).
