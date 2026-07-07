#!/usr/bin/env node
// Reads agent/default/agentcore/.cli/deployed-state.json after `agentcore deploy`
// and writes key AgentCore resource identifiers to $GITHUB_ENV so that the
// subsequent `ampx pipeline-deploy` (Amplify backend build) can pick them up
// as process.env values in web/amplify/backend.ts.
//
// Variables written:
//   AGENTCORE_MEMORY_ID      — e.g. default_MyHarnessMemory-zz6wfiFFUs
//   AGENTCORE_MEMORY_ARN     — arn:aws:bedrock-agentcore:...:memory/...
//   AGENTCORE_GATEWAY_ID     — e.g. default-default-gateway-5qwnlmsqe3
//   AGENTCORE_GATEWAY_ARN    — arn:aws:bedrock-agentcore:...:gateway/...
//   AGENTCORE_RUNTIME_ID     — e.g. default_AgUiHandler-HISztIENHn
//   AGENTCORE_RUNTIME_ARN    — arn:aws:bedrock-agentcore:...:runtime/...
//   AGENTCORE_RUNTIME_ROLE_ARN — arn:aws:iam::...:role/...
//   AGENTCORE_REGION         — e.g. us-east-1
import { readFileSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const statePath = resolve(root, 'agent/default/agentcore/.cli/deployed-state.json');

let state;
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  console.error(`inject-agentcore-env: cannot read ${statePath}`);
  process.exit(1);
}

const resources = state?.targets?.default?.resources ?? {};

const memory = Object.values(resources.memories ?? {})[0] ?? {};
const gateway = Object.values(resources.mcp?.gateways ?? {})[0] ?? {};
const runtime = resources.runtimes?.AgUiHandler ?? {};

const region = (memory.memoryArn ?? runtime.runtimeArn ?? '').split(':')[3] || 'us-east-1';

// Resolve the harness ARN from web/deployment-info.json (committed to git,
// written by extract-deployment-info.js after each successful deploy).
// Fall back to the AWS CLI if the file is missing or has no harness entry
// (e.g. first deploy of a brand-new environment).
const deploymentInfoPath = resolve(root, 'web/deployment-info.json');
let harnessArn = '';
try {
  const info = JSON.parse(readFileSync(deploymentInfoPath, 'utf8'));
  harnessArn = Object.values(info.harnesses ?? {})[0]?.harnessArn ?? '';
} catch { /* file may not exist yet */ }

if (!harnessArn) {
  // Fallback: call the harnesses list API via a SigV4-signed HTTP request.
  // Uses the AWS CLI for credential resolution so boto3 is not required.
  try {
    const raw = execSync(
      `aws bedrock-agentcore-control list-agent-runtimes --region ${region} --output json`,
      { encoding: 'utf8' }
    );
    // The harness runtime follows the naming convention harness_<project>_<name>-<suffix>
    const runtimes = JSON.parse(raw)?.agentRuntimes ?? [];
    const harnessRuntime = runtimes.find(r => r.agentRuntimeName?.startsWith('harness_default_'));
    // The harness ARN uses the /harness/ path, not /runtime/ — derive it from the runtime ARN.
    if (harnessRuntime) {
      harnessArn = harnessRuntime.agentRuntimeArn.replace('/runtime/', '/harness/');
    }
  } catch (err) {
    console.warn(`inject-agentcore-env: could not resolve harness ARN via CLI: ${err.message}`);
  }
}

const vars = {
  AGENTCORE_MEMORY_ID: memory.memoryId ?? '',
  AGENTCORE_MEMORY_ARN: memory.memoryArn ?? '',
  AGENTCORE_GATEWAY_ID: gateway.gatewayId ?? '',
  AGENTCORE_GATEWAY_ARN: gateway.gatewayArn ?? '',
  AGENTCORE_RUNTIME_ID: runtime.runtimeId ?? '',
  AGENTCORE_RUNTIME_ARN: runtime.runtimeArn ?? '',
  AGENTCORE_RUNTIME_ROLE_ARN: runtime.roleArn ?? '',
  AGENTCORE_HARNESS_ARN: harnessArn,
  AGENTCORE_REGION: region,
};

const missing = Object.entries(vars).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.warn(`inject-agentcore-env: missing values for: ${missing.join(', ')}`);
}

const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  appendFileSync(githubEnvPath, lines);
  console.log('inject-agentcore-env: wrote to $GITHUB_ENV');
} else {
  // Local use: just print them
  for (const [k, v] of Object.entries(vars)) {
    console.log(`${k}=${v}`);
  }
}
