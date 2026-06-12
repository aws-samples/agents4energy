#!/usr/bin/env bash
set -euo pipefail

TARGETS_FILE="agent/agentcore/aws-targets.json"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "${AWS_DEFAULT_REGION:-us-east-1}")

cat > "$TARGETS_FILE" <<EOF
[
  {
    "name": "default",
    "account": "$ACCOUNT",
    "region": "$REGION"
  }
]
EOF

echo "Set deployment target: account=$ACCOUNT region=$REGION"
