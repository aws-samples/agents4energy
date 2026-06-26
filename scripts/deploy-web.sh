#!/usr/bin/env bash
set -euo pipefail

# Build the Next.js app and deploy it to the S3 + CloudFront hosting stack.
# Mirrors what .github/workflows/deploy.yml does so local deploys are identical.
#
# Usage:
#   pnpm deploy:web [branch]        # branch defaults to current git branch
#
# Prerequisites:
#   AWS CLI configured (or AWS_* env vars set)
#   CDK hosting stack already deployed for the branch (runs `cdk deploy` if not)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BRANCH="${1:-$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)}"
# Normalise: replace slashes, lowercase — same transform as the workflow
BRANCH="$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"
STACK_NAME="agentcore-cli-hosting-$BRANCH"
CDK_DIR="$REPO_ROOT/agent/default/agentcore/cdk"
OUTPUTS_FILE="$CDK_DIR/hosting-outputs.json"

echo "Branch: $BRANCH"
echo "Stack:  $STACK_NAME"
echo ""

# ── 1. Ensure CDK app is compiled ─────────────────────────────────────────────
echo "Building CDK app…"
pnpm --filter agentcore-cdk-app build

# ── 2. Deploy / update the hosting stack ─────────────────────────────────────
echo "Deploying hosting stack…"

STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "Stack is in ROLLBACK_COMPLETE — deleting before redeploy"
  aws cloudformation delete-stack --stack-name "$STACK_NAME"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME"
fi

(cd "$CDK_DIR" && ./node_modules/.bin/cdk deploy "$STACK_NAME" \
  --require-approval never \
  --outputs-file hosting-outputs.json \
  --context "stackName=$STACK_NAME")

# Flatten nested CDK outputs JSON: { "StackName": { "Key": "val" } } → { "Key": "val" }
node -e "
  const raw = require('$OUTPUTS_FILE');
  const key = Object.keys(raw)[0];
  require('fs').writeFileSync('$OUTPUTS_FILE', JSON.stringify(raw[key], null, 2));
"

BUCKET=$(node -p "require('$OUTPUTS_FILE').BucketName")
DIST_ID=$(node -p "require('$OUTPUTS_FILE').DistributionId")
DOMAIN=$(node -p "require('$OUTPUTS_FILE').Domain")

echo "  Bucket: $BUCKET"
echo "  Distribution: $DIST_ID"
echo ""

# ── 3. Build the Next.js app ──────────────────────────────────────────────────
echo "Building web app…"
NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter web build

# ── 4. Sync to S3 and invalidate CloudFront ───────────────────────────────────
echo "Deploying to S3…"
aws s3 sync "$REPO_ROOT/web/out/" "s3://$BUCKET/$BRANCH/" --delete

echo "Invalidating CloudFront cache…"
AWS_PAGER="" aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" --paths "/$BRANCH/*"

echo ""
echo "Deployed: https://$DOMAIN/$BRANCH/"
