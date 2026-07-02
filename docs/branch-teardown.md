# Branch Teardown

## What's Branch-Scoped

Each branch that runs `deploy.yml` creates two branch-scoped stacks:

| Stack | Resources | Identifier |
|---|---|---|
| Amplify sandbox | Cognito, AppSync, Lambda, DynamoDB | `--identifier <branch>` |
| Hosting CDK stack | S3 bucket + CloudFront distribution | `<branch>-<project>` |

The AgentCore harness, gateway, and memory (`agent/default/agentcore/`) are **not** branch-scoped — they deploy once to the single target named `default` in `aws-targets.json` and are shared by every branch. Deleting a branch must never tear these down.

## Deleting a Branch's Stack

`.github/workflows-drafts/delete-branch-stack.yml` is a draft workflow that runs on the `delete` event (branch deletion) and tears down the two branch-scoped stacks above:

1. Empties and `cdk destroy`s the hosting stack (`<branch>-<project>`)
2. Runs `ampx sandbox delete --identifier <branch>`

It's kept in `workflows-drafts/` rather than `.github/workflows/` because the Claude GitHub App can't write directly to `.github/workflows/` — copy it over manually to enable it:

```bash
cp .github/workflows-drafts/delete-branch-stack.yml .github/workflows/delete-branch-stack.yml
```

It reuses the same `AWS_ROLE_ARN` secret and `AWS_REGION` variable as `deploy.yml`, and can also be triggered manually via `workflow_dispatch` (pass the branch name) to clean up a stack whose branch was already deleted before this workflow existed.

Note: GitHub only fires `delete` events for workflow files that exist on the repository's default branch, so this workflow has no effect until it's merged there.
