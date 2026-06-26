#!/usr/bin/env bash
set -euo pipefail

# Full build + deploy pipeline:
#   1. Compile the CDK app
#   2. Deploy Amplify backend (sandbox --once)
#   3. Configure AgentCore ↔ Cognito auth
#   4. Deploy AgentCore harness + gateway
#   5. Extract deployment ARNs into web/deployment-info.json
#   6. Build the Next.js frontend

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --filter agentcore-cdk-app build

(cd "$REPO_ROOT/web" && npx ampx sandbox --once)

node "$REPO_ROOT/scripts/configure-agentcore-auth.js"

(cd "$REPO_ROOT/agent/default" && npx @aws/agentcore deploy --target default)

node "$REPO_ROOT/scripts/extract-deployment-info.js"

pnpm --filter web build
