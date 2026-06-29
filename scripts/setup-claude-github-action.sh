#!/usr/bin/env bash
# Sets up the IAM role and GitHub repo secrets needed to run claude-code-action
# with Amazon Bedrock (OIDC auth, no long-lived keys).
#
# Usage:
#   bash scripts/setup-claude-github-action.sh                    # interactive repo picker
#   bash scripts/setup-claude-github-action.sh owner/repo         # pass repo directly
#
# Prerequisites:
#   - AWS CLI configured with credentials that can create IAM roles/policies
#   - GitHub CLI (gh) authenticated
#   - jq
set -euo pipefail

ROLE_NAME="GitHubActions-ClaudeCodeAction"
AWS_REGION="${AWS_REGION:-us-east-1}"

# ── Repo selection ────────────────────────────────────────────────────────────
if [[ $# -ge 1 ]]; then
  REPO="$1"
  echo "Using repo: $REPO"
else
  echo "Fetching your GitHub repositories..."
  # Get up to 100 repos the authenticated user has access to
  REPOS=$(gh repo list --limit 100 --json nameWithOwner -q '.[].nameWithOwner' 2>/dev/null)
  if [[ -z "$REPOS" ]]; then
    echo "Error: could not fetch repositories. Make sure 'gh auth login' has been run."
    exit 1
  fi

  # Arrow-key picker using shell select (works without fzf)
  echo ""
  echo "Select a repository (use arrow keys / number):"
  IFS=$'\n' read -r -d '' -a REPO_ARRAY <<< "$REPOS" || true
  select REPO in "${REPO_ARRAY[@]}"; do
    [[ -n "$REPO" ]] && break
    echo "Invalid selection, try again."
  done
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

echo ""
echo "Account:  $ACCOUNT_ID"
echo "Repo:     $REPO"
echo "Role:     $ROLE_NAME"
echo "Region:   $AWS_REGION"
echo ""

# ── 1. Trust policy ───────────────────────────────────────────────────────────
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${OIDC_PROVIDER_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${REPO}:*"
        }
      }
    }
  ]
}
EOF
)

# ── 2. Permissions policy ─────────────────────────────────────────────────────
PERMISSIONS_POLICY=$(cat <<EOF
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
EOF
)

# ── 3. Create or update the IAM role ─────────────────────────────────────────
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
  echo "Role $ROLE_NAME already exists — updating trust policy..."
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "$TRUST_POLICY"
else
  echo "Creating role $ROLE_NAME..."
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Assumed by GitHub Actions via OIDC for claude-code-action (Bedrock)" \
    > /dev/null
fi

echo "Attaching Bedrock permissions policy..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "BedrockInvoke" \
  --policy-document "$PERMISSIONS_POLICY"

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)
echo "Role ARN: $ROLE_ARN"

# ── 4. Set AWS_ROLE_TO_ASSUME secret ─────────────────────────────────────────
echo ""
echo "Setting secret AWS_ROLE_TO_ASSUME..."
gh secret set AWS_ROLE_TO_ASSUME --body "$ROLE_ARN" --repo "$REPO"

echo ""
echo "Done. Push .github/workflows/claude.yml and tag @claude in any issue or PR comment to test."
