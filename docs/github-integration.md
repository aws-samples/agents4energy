# GitHub Integration

Agents in this project can be invoked by @mentioning them in GitHub issue and PR comments, or by assigning an issue to the agent's bot account. The integration uses GitHub Actions with OIDC federation — no stored AWS credentials required.

## How it works

```
issue_comment event
    │
    ▼
GitHub Actions workflow  (.github/workflows/agent-mention.yml)
    │
    ├─ Parse @mention from comment body
    ├─ GitHub OIDC JWT  (permissions: id-token: write)
    │
    ▼
aws-actions/configure-aws-credentials  →  ephemeral IAM creds (STS AssumeRoleWithWebIdentity)
    │
    ▼
SigV4-signed GraphQL mutation  →  AppSync API  →  invoke-agent Lambda  →  AgentCore harness
    │
    ▼
actions/create-github-app-token  →  octokit.rest.issues.createComment  (reply posted)
```

## One-time AWS account setup

### 1. Register the GitHub OIDC identity provider

This is a **one-time step per AWS account**. It has already been completed for account `796988593450`:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
# → arn:aws:iam::796988593450:oidc-provider/token.actions.githubusercontent.com
```

If you are deploying to a different AWS account, run this command once in that account before deploying the Amplify backend.

### 2. Deploy the Amplify backend

The `github-actions-agent-invoker` IAM role is defined in `web/amplify/backend.ts` and created automatically on `pnpm deploy`. It:

- Trusts `token.actions.githubusercontent.com` JWTs from this repo
- Has `appsync:GraphQL` permission scoped to this project's AppSync API

After deploy, the role ARN is available in `amplify_outputs.json` under `custom.github_actions_agent_role_arn`.

## Repository variables

Run `scripts/setup-github-integration.ts` to set these automatically, or add them manually:

| Name | Type | Value |
|------|------|-------|
| `APPSYNC_ENDPOINT` | Variable | GraphQL endpoint URL (from `web/amplify_outputs.json`) |
| `AWS_AGENT_ROLE_ARN` | Variable | IAM role ARN (from `web/amplify_outputs.json`) |

No GitHub App or private key is required. The workflow uses the built-in `GITHUB_TOKEN` (replies appear as `github-actions[bot]`).

## Workflow

Create `.github/workflows/agent-mention.yml`:

```yaml
name: Agent @mention handler

on:
  issue_comment:
    types: [created]
  issues:
    types: [assigned]

permissions:
  id-token: write
  contents: read
  issues: write
  pull-requests: write

jobs:
  invoke-agent:
    runs-on: ubuntu-latest
    if: github.event.sender.type != 'Bot'

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::796988593450:role/github-actions-agent-invoker
          aws-region: us-east-1

      - name: Invoke agent and post reply
        uses: actions/github-script@v7
        env:
          APPSYNC_ENDPOINT: ${{ vars.APPSYNC_ENDPOINT }}
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const { execSync } = require('child_process')
            // Delegates to scripts/github-agent-invoke.ts
            execSync(`npx tsx scripts/github-agent-invoke.ts`, { stdio: 'inherit' })
```

## SigV4 signing

The workflow calls a helper script (`scripts/github-agent-invoke.ts`) that:

1. Reads the comment body and issue number from the GitHub Actions event context
2. Parses the @mention to identify the target agent slug
3. Signs the `invokeAgentAsync` GraphQL mutation with `@smithy/signature-v4` using the IAM credentials exported by `configure-aws-credentials`
4. Posts the agent's reply as a comment via Octokit

`fromNodeProviderChain()` automatically picks up `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` from the environment — no manual credential handling needed.

## Loop prevention

The workflow's `if: github.event.sender.type != 'Bot'` condition prevents the bot from responding to its own comments. The script additionally checks `sender.login` ends with `[bot]` before processing.

## Trigger strategies

| Trigger | Event | How to target an agent |
|---------|-------|------------------------|
| @mention in comment | `issue_comment.created` | Include `@agent-slug` in comment body |
| Issue assignment | `issues.assigned` | Assign the issue to the GitHub App bot account |
| PR comment | `issue_comment.created` | Comment on a PR (same event, `issue.pull_request` field is present) |
| Inline diff comment | `pull_request_review_comment.created` | Add a separate job subscribing to this event |

## AppSync authorization

The workflow uses `AWS_IAM` as the authorization mode for the AppSync mutation. The `github-actions-agent-invoker` role has `appsync:GraphQL` permission on the API ARN — the IAM policy is the authorization boundary, not Cognito User Pool groups.

Note: `allow.authenticated('identityPool')` in Amplify Gen 2 targets Cognito Identity Pool federated roles specifically and does **not** work for GitHub OIDC-assumed roles. The `invokeAgentAsync` mutation must include an authorization rule compatible with plain IAM principals when this integration is fully wired up.
