# Claude GitHub App with Amazon Bedrock

The `anthropics/claude-code-action` lets you `@claude` in any PR or issue comment to trigger Claude Code. When using Amazon Bedrock as the LLM backend, you run the action on **your own** GitHub Actions runner — you do **not** install the Anthropic-hosted GitHub App at `github.com/apps/claude` (that app routes requests through Anthropic's infrastructure and requires a claude.ai account). The `/install-github-app` slash command in Claude Code also only works for direct Anthropic API users, not Bedrock.

## How it differs from this project's @mention integration

| | This project (`agent-mention.yml`) | Claude GitHub App |
|---|---|---|
| Trigger | `@agent-<slug>` comment | `@claude` comment |
| Runtime | Your AgentCore Harness | Claude Code (Anthropic-hosted action) |
| Auth | SigV4 + IAM user credentials | OIDC → IAM role |
| Action | `scripts/github-agent-invoke.ts` | `anthropics/claude-code-action@v1` |

## Do you need a special IAM role?

**Yes.** GitHub Actions uses OIDC (OpenID Connect) to exchange a short-lived token for temporary AWS credentials. You need to:

1. Register GitHub's OIDC provider in your AWS account (one-time)
2. Create an IAM role that trusts it and grants Bedrock model invocation

This is safer than long-lived access keys — credentials expire after ~15 minutes and are never stored.

## Step 1 — Request Bedrock model access

Claude models in Bedrock are not enabled by default. Go to **AWS Console → Amazon Bedrock → Model access**, find the Anthropic Claude models, and request access. Do this in every AWS region where your workflows will run.

## Step 2 — Register the GitHub OIDC provider (one-time per AWS account)

In IAM → Identity providers, create an OpenID Connect provider:

- **Provider URL:** `https://token.actions.githubusercontent.com`
- **Audience:** `sts.amazonaws.com`

## Step 3 — Create the IAM role

Create a role with a trust policy that allows GitHub Actions to assume it via OIDC. Scope the condition to your org/repo:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/YOUR_REPO:*"
        }
      }
    }
  ]
}
```

Attach this inline permissions policy to the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    }
  ]
}
```

Note the role ARN — you'll need it as a GitHub secret.

## Step 4 — Add repository secrets

In your repo's **Settings → Secrets and variables → Actions**, add one secret:

| Name | Value |
|------|-------|
| `AWS_ROLE_TO_ASSUME` | ARN of the IAM role from Step 3 |

`ANTHROPIC_API_KEY` and any GitHub App credentials are **not** required — the workflow uses the built-in `github.token` for GitHub API access and OIDC for AWS.

The setup script handles all of this automatically:

```bash
bash scripts/setup-claude-github-action.sh              # interactive repo picker
bash scripts/setup-claude-github-action.sh owner/repo   # pass repo directly
```

## Step 5 — Add the workflow

Create `.github/workflows/claude.yml`:

```yaml
name: Claude Code Action

permissions:
  contents: write
  pull-requests: write
  issues: write
  id-token: write   # required for OIDC

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]

env:
  AWS_REGION: us-east-1   # must match region where you requested model access

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'issues' && contains(github.event.issue.body, '@claude'))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: ${{ env.AWS_REGION }}

      - uses: anthropics/claude-code-action@v1
        with:
          github_token: ${{ github.token }}
          use_bedrock: "true"
          claude_args: "--model us.anthropic.claude-sonnet-4-6 --max-turns 5"
```

## Bedrock-specific gotchas

**Model ID format** — Bedrock model IDs use a region prefix: `us.anthropic.claude-sonnet-4-6`, not `claude-sonnet-4-6`.

**Region must match model access** — If you request model access in `us-east-1` but set `AWS_REGION: us-west-2` in the workflow, invocations will fail. Request access in every region you use.

**Cross-region inference is not supported** — Bedrock does not automatically route to another region if the model is unavailable in yours. Either use a single region or request access in all target regions.

**Cost control** — Use `--max-turns` to cap the number of agentic iterations. Each turn consumes input + output tokens billed to your AWS account.
