#!/usr/bin/env bash
set -euo pipefail

# Run the deploy GitHub Action locally using `act`.
# Resolves credentials from your current AWS CLI credential chain (SSO, assume-role,
# env vars, ~/.aws/credentials — whatever `aws` would use) and injects them into act,
# bypassing the OIDC step that only works on real GitHub runners.
#
# Usage:
#   pnpm act:deploy          # simulate a push on the current branch
#   pnpm act:deploy -n       # dry run — print steps without executing
#   pnpm act:deploy --job deploy --verbose
#
# Prerequisites:
#   brew install act
#   Docker Desktop running

command -v act >/dev/null 2>&1 || { echo "act not found — install with: brew install act"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker not found — start Docker Desktop first"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running — start Docker Desktop first"; exit 1; }

# Resolve credentials from the current CLI credential chain.
# --format env outputs: export AWS_ACCESS_KEY_ID=... etc.
echo "Resolving AWS credentials…"
eval "$(aws configure export-credentials --format env)"
echo "  ✓ Credential chain: $(aws sts get-caller-identity --query Arn --output text)"

REGION="${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo us-east-1)}"

# Clean up any leftover containers from a previous aborted run
docker ps -aq --filter "name=act-Deploy-deploy" | xargs -r docker rm -f >/dev/null 2>&1 || true

act push \
  --workflows .github/workflows/deploy.yml \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest \
  --container-architecture linux/amd64 \
  --rm \
  --secret AWS_ROLE_ARN="" \
  --env AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  --env AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  ${AWS_SESSION_TOKEN:+--env AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN"} \
  --var AWS_REGION="$REGION" \
  "$@"
