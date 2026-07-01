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
# Normalise: replace slashes with dashes, lowercase
BRANCH_SLUG="$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"

echo "Branch:      $BRANCH"
echo "Branch slug: $BRANCH_SLUG"
echo ""

# ── 1. Deploy everything with a single ampx sandbox --once ───────────────────
echo "Deploying Amplify sandbox (including hosting + agent stacks)…"
(cd "$REPO_ROOT/web" && npx ampx sandbox --once --identifier "$BRANCH_SLUG")

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
