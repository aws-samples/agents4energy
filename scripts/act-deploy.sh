#!/usr/bin/env bash
set -euo pipefail

# Run the deploy GitHub Action locally using `act`.
# Resolves credentials from your current AWS CLI credential chain (SSO, assume-role,
# env vars, ~/.aws/credentials — whatever `aws` would use) and injects them into act,
# bypassing the OIDC step that only works on real GitHub runners.
#
# Usage:
#   pnpm act:deploy                # simulate a push on the current branch (deploy.yml)
#   pnpm act:deploy -n             # dry run — print steps without executing
#   pnpm act:deploy --draft        # run the draft workflow (.github/workflows-drafts/deploy.yml)
#   pnpm act:deploy --draft -n     # dry run against the draft
#   pnpm act:deploy --job deploy --verbose
#
# Prerequisites:
#   Docker Desktop running
#   act installed (brew install act) — or set ACT_BIN to a custom path

# ── Consume --draft flag before passing remaining args to act ─────────────────
WORKFLOW_FILE=".github/workflows/deploy.yml"
PASS_THROUGH=()
for arg in "$@"; do
  if [ "$arg" = "--draft" ]; then
    WORKFLOW_FILE=".github/workflows-drafts/deploy.yml"
  else
    PASS_THROUGH+=("$arg")
  fi
done

# ── Locate act binary (auto-install if missing and on Linux) ─────────────────
ACT_BIN="${ACT_BIN:-act}"
if ! command -v "$ACT_BIN" >/dev/null 2>&1; then
  echo "act not found — attempting to install…"
  if command -v brew >/dev/null 2>&1; then
    brew install act
  elif command -v curl >/dev/null 2>&1; then
    # Works on Linux CI runners (x86_64 / arm64)
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64)  ACT_ARCH="x86_64" ;;
      aarch64) ACT_ARCH="arm64"  ;;
      arm64)   ACT_ARCH="arm64"  ;;
      *)       echo "Unknown arch $ARCH — install act manually: https://github.com/nektos/act"; exit 1 ;;
    esac
    ACT_VERSION=$(curl -fsSL https://api.github.com/repos/nektos/act/releases/latest \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")
    curl -fsSL "https://github.com/nektos/act/releases/download/${ACT_VERSION}/act_Linux_${ACT_ARCH}.tar.gz" \
      -o /tmp/act.tar.gz
    tar -xzf /tmp/act.tar.gz -C /tmp act
    install -m755 /tmp/act /usr/local/bin/act
    ACT_BIN=act
    echo "  ✓ Installed act ${ACT_VERSION}"
  else
    echo "act not found — install with: brew install act"; exit 1
  fi
fi

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

PNPM_STORE="$(pnpm store path 2>/dev/null || echo "$HOME/.pnpm-store")"

"$ACT_BIN" push \
  --workflows "$WORKFLOW_FILE" \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest \
  --container-architecture linux/amd64 \
  --rm \
  --secret AWS_ROLE_ARN="" \
  --env AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  --env AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  ${AWS_SESSION_TOKEN:+--env AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN"} \
  --var AWS_REGION="$REGION" \
  --container-options "--volume $PNPM_STORE:$PNPM_STORE --dns 8.8.8.8" \
  "${PASS_THROUGH[@]+"${PASS_THROUGH[@]}"}"
