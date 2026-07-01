#!/usr/bin/env bash
set -euo pipefail

# Full build + deploy pipeline (single command):
#   1. Deploy everything via npx ampx sandbox --once (Amplify + hosting + agent runtime)
#   2. Extract deployment info and wire AppSync resolver
#   3. Build the Next.js frontend
#   4. Upload to S3 and invalidate CloudFront cache

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Derive branch from git or DEPLOY_BRANCH env var
BRANCH="${DEPLOY_BRANCH:-$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)}"
# Normalise: replace slashes with dashes, lowercase, truncate to 14 chars (ampx --identifier limit is 15)
BRANCH_SLUG="$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | cut -c1-14)"

echo "Branch:      $BRANCH"
echo "Branch slug: $BRANCH_SLUG"
echo ""

# ── 0. Register QEMU ARM64 binfmt (needed to build ARM64 Docker images on AMD64 runners) ─
# Runs inside build.sh so it doesn't need a separate allowed tool entry.
if docker info --format '{{.Architecture}}' 2>/dev/null | grep -q 'x86_64\|amd64'; then
  echo "AMD64 runner detected — setting up QEMU ARM64 binfmt…"
  docker run --rm --privileged tonistiigi/binfmt --install arm64 2>/dev/null || true
fi

# ── 1. Deploy everything with a single ampx sandbox --once ───────────────────
echo "Deploying Amplify sandbox (including hosting + agent stacks)…"
(cd "$REPO_ROOT/web" && npx ampx sandbox --once --identifier "$BRANCH_SLUG")

# ── 1b. Patch amplify_outputs.json with custom outputs from CloudFormation ────
# ampx sandbox --once writes only the base outputs (auth/data/etc.) but omits
# the backend.addOutput({ custom: {...} }) values. Fetch them from the CFn
# customOutputs stack output and merge them in manually.
echo "Patching amplify_outputs.json with custom CloudFormation outputs…"
# ampx strips hyphens from the identifier when naming the stack
BRANCH_SLUG_CLEAN="$(echo "$BRANCH_SLUG" | tr -d '-')"
# Match the root sandbox stack only — filter out nested stacks by requiring no extra '-' after 'sandbox-<hash>'
# Root stack pattern: amplify-web-<slug>-sandbox-<8hexchars>  (no further hyphens except in the hash)
SANDBOX_STACK=$(aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?starts_with(StackName, 'amplify-web-${BRANCH_SLUG_CLEAN}-sandbox-')].StackName" \
  --output text | tr '\t' '\n' | grep -E '^amplify-web-[^-]+-sandbox-[a-f0-9]+$' | head -1)

if [ -n "$SANDBOX_STACK" ]; then
  echo "Found sandbox stack: $SANDBOX_STACK"
  CUSTOM_OUTPUTS_FILE=$(mktemp)
  aws cloudformation describe-stacks \
    --stack-name "$SANDBOX_STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='customOutputs'].OutputValue" \
    --output text > "$CUSTOM_OUTPUTS_FILE"
  CUSTOM_OUTPUTS=$(cat "$CUSTOM_OUTPUTS_FILE")
  if [ -n "$CUSTOM_OUTPUTS" ] && [ "$CUSTOM_OUTPUTS" != "None" ]; then
    # Write a small merge script to avoid shell quoting issues
    MERGE_SCRIPT=$(mktemp --suffix=.cjs)
    cat > "$MERGE_SCRIPT" <<'NODESCRIPT'
const fs = require('fs');
const outputsPath = process.argv[2];
const customFile = process.argv[3];
const existing = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
const customStr = fs.readFileSync(customFile, 'utf8').trim();
const customObj = JSON.parse(customStr);
const merged = Object.assign({}, existing, customObj);
fs.writeFileSync(outputsPath, JSON.stringify(merged, null, 2) + '\n');
console.log('Patched amplify_outputs.json with custom outputs');
NODESCRIPT
    node "$MERGE_SCRIPT" "$REPO_ROOT/web/amplify_outputs.json" "$CUSTOM_OUTPUTS_FILE"
    rm -f "$MERGE_SCRIPT" "$CUSTOM_OUTPUTS_FILE"
  else
    echo "Warning: no customOutputs found in stack $SANDBOX_STACK"
    rm -f "$CUSTOM_OUTPUTS_FILE"
  fi
else
  echo "Warning: could not find sandbox stack for identifier ${BRANCH_SLUG_CLEAN}"
fi

# ── 2. Extract deployment info and wire AppSync resolver ─────────────────────
echo "Extracting deployment info and wiring AppSync resolver…"
node "$REPO_ROOT/scripts/extract-deployment-info.js"

# ── 3. Build the Next.js frontend ─────────────────────────────────────────────
echo "Building Next.js app…"
NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter web build

# ── 4. Upload to S3 and invalidate CloudFront ────────────────────────────────
AMPLIFY_OUTPUTS="$REPO_ROOT/web/amplify_outputs.json"

if [ ! -f "$AMPLIFY_OUTPUTS" ]; then
  echo "Error: amplify_outputs.json not found at $AMPLIFY_OUTPUTS"
  exit 1
fi

BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('$AMPLIFY_OUTPUTS','utf8')).custom?.hosting_bucket_name ?? ''")
DIST_ID=$(node -p "JSON.parse(require('fs').readFileSync('$AMPLIFY_OUTPUTS','utf8')).custom?.hosting_distribution_id ?? ''")
DOMAIN=$(node -p "JSON.parse(require('fs').readFileSync('$AMPLIFY_OUTPUTS','utf8')).custom?.hosting_domain ?? ''")

if [ -z "$BUCKET" ] || [ -z "$DIST_ID" ]; then
  echo "Error: hosting_bucket_name or hosting_distribution_id missing from amplify_outputs.json"
  exit 1
fi

echo "Uploading to S3 bucket: $BUCKET (prefix: $BRANCH_SLUG)…"
aws s3 sync "$REPO_ROOT/web/out/" "s3://$BUCKET/$BRANCH_SLUG/" --delete

echo "Invalidating CloudFront distribution: $DIST_ID…"
AWS_PAGER="" aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" --paths "/$BRANCH_SLUG/*"

echo ""
echo "Deployed: https://$DOMAIN/$BRANCH_SLUG/"
