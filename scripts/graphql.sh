#!/usr/bin/env bash
# GraphQL runner — signs requests with AWS SigV4 (IAM auth) against the AppSync API.
# Reads endpoint and region from web/amplify_outputs.json.
#
# Usage:
#   ./scripts/graphql.sh '<query string>'
#   ./scripts/graphql.sh '<query string>' '<variables JSON>'
#
# Examples:
#   ./scripts/graphql.sh 'query { listChatSessions { items { id name createdAt } } }'
#   ./scripts/graphql.sh 'query GetSession($id: ID!) { getChatSession(id: $id) { id name } }' '{"id":"abc-123"}'
#
# Credentials are resolved automatically via `aws configure export-credentials`.
# Override by pre-setting AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUTS_FILE="$REPO_ROOT/web/amplify_outputs.json"

if [[ ! -f "$OUTPUTS_FILE" ]]; then
  echo "Error: $OUTPUTS_FILE not found. Run 'pnpm deploy' first." >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install it with 'brew install jq'." >&2
  exit 1
fi

GRAPHQL_URL=$(jq -r '.data.url' "$OUTPUTS_FILE")
AWS_REGION=$(jq -r '.data.aws_region' "$OUTPUTS_FILE")

if [[ -z "$GRAPHQL_URL" || "$GRAPHQL_URL" == "null" ]]; then
  echo "Error: Could not read .data.url from $OUTPUTS_FILE" >&2
  exit 1
fi

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  if ! command -v aws &>/dev/null; then
    echo "Error: AWS credentials not set and 'aws' CLI not found." >&2
    exit 1
  fi
  eval "$(aws configure export-credentials --format env 2>/dev/null)" || {
    echo "Error: Could not export AWS credentials. Run 'aws sso login' or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY." >&2
    exit 1
  }
fi

QUERY="${1:?Usage: $0 '<query>' [variables_json]}"
VARIABLES="${2:-{}}"

PAYLOAD=$(jq -n --arg q "$QUERY" --argjson v "$VARIABLES" '{"query":$q,"variables":$v}')

SIGV4_HEADER=(-H "X-Amz-Security-Token: ${AWS_SESSION_TOKEN}")
if [[ -z "${AWS_SESSION_TOKEN:-}" ]]; then
  SIGV4_HEADER=()
fi

curl -sf -X POST "$GRAPHQL_URL" \
  -H "Content-Type: application/json" \
  "${SIGV4_HEADER[@]}" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --aws-sigv4 "aws:amz:$AWS_REGION:appsync" \
  -d "$PAYLOAD" | jq .
