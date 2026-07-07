#!/usr/bin/env bash
set -euo pipefail

# Build the Next.js app and deploy it to the S3 + CloudFront hosting.
# Reads bucket/distribution info from web/amplify_outputs.json (written by ampx sandbox).
#
# Usage:
#   pnpm deploy:web [branch]        # branch defaults to current git branch
#
# Prerequisites:
#   AWS CLI configured (or AWS_* env vars set)
#   ampx sandbox already deployed (web/amplify_outputs.json must exist)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BRANCH="${1:-${DEPLOY_BRANCH:-$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)}}"
BRANCH_SLUG="$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"

AMPLIFY_OUTPUTS="$REPO_ROOT/web/amplify_outputs.json"

echo "Branch: $BRANCH_SLUG"
echo ""

if [ ! -f "$AMPLIFY_OUTPUTS" ]; then
  echo "Error: amplify_outputs.json not found at $AMPLIFY_OUTPUTS"
  echo "Run 'npx ampx sandbox --once --identifier $BRANCH_SLUG' from web/ first."
  exit 1
fi

BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('$AMPLIFY_OUTPUTS','utf8')).custom?.hosting_bucket_name ?? ''")
DIST_ID=$(node -p "JSON.parse(require('fs').readFileSync('$AMPLIFY_OUTPUTS','utf8')).custom?.hosting_distribution_id ?? ''")
DOMAIN=$(node -p "JSON.parse(require('fs').readFileSync('$AMPLIFY_OUTPUTS','utf8')).custom?.hosting_domain ?? ''")

if [ -z "$BUCKET" ] || [ -z "$DIST_ID" ]; then
  echo "Error: hosting_bucket_name or hosting_distribution_id missing from amplify_outputs.json"
  exit 1
fi

echo "  Bucket: $BUCKET"
echo "  Distribution: $DIST_ID"
echo ""

# ── Build the Next.js app ─────────────────────────────────────────────────────
echo "Building web app…"
NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter web build

# ── Sync to S3 and invalidate CloudFront ─────────────────────────────────────
echo "Deploying to S3…"
aws s3 sync "$REPO_ROOT/web/out/" "s3://$BUCKET/$BRANCH_SLUG/" --delete

echo "Invalidating CloudFront cache…"
AWS_PAGER="" aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" --paths "/$BRANCH_SLUG/*"

echo ""
echo "Deployed: https://$DOMAIN/$BRANCH_SLUG/"
