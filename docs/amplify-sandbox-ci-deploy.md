# Amplify Backend Deployment: Sandbox CI Pattern

## Why Not `pipeline-deploy`?

`ampx pipeline-deploy` requires a pre-existing Amplify app (an `--app-id`). Creating one is a one-time manual or IaC step, and it couples your deploy pipeline to the Amplify Hosting service for branch linking. To avoid that dependency, this project uses the sandbox pattern instead.

## The Pattern

```bash
npx ampx sandbox --once --identifier $BRANCH_NAME --outputs-out-dir ./web
```

- `--once` — runs a single deployment and exits (no file watcher, CI-safe)
- `--identifier $BRANCH_NAME` — creates an isolated CloudFormation stack per branch (e.g. `main`, `feature-xyz`)
- `--outputs-out-dir ./web` — writes `amplify_outputs.json` to `web/`, where the Next.js app expects it

No Amplify app ID required.

## Hotswap Behavior

Sandbox always uses CDK `--hotswap-fallback` internally — this cannot be disabled. In practice the risk is limited:

- **Initial deploys** (stack doesn't exist yet) go through full CloudFormation
- **Structural changes** (new resources, IAM, etc.) always go through full CloudFormation
- Only incremental updates to Lambda code or AppSync resolvers get hotswapped

For this project's CI pipeline (where deploys are mostly structural or branch-fresh), this is acceptable.

## Tradeoffs vs `pipeline-deploy`

| Aspect | `sandbox --once` | `pipeline-deploy` |
|---|---|---|
| Requires Amplify app | No | Yes |
| Generates `amplify_outputs.json` | Yes | Yes |
| Full CloudFormation guaranteed | No (hotswap for Lambda/AppSync) | Yes |
| Amplify console visibility | No | Yes |
| Branch-isolated stacks | Yes (via `--identifier`) | Yes (via `--branch`) |
| CI-friendly (process exits) | Yes | Yes |

## Stack Naming

Sandbox stacks use a different naming convention than `pipeline-deploy` stacks. If you ever migrate to `pipeline-deploy`, it requires a full teardown and redeploy — there is no in-place migration path.
