#!/usr/bin/env node
// Reads agent/agentcore/.cli/deployed-state.json after `agentcore deploy` and
// writes web/deployment-info.json so the static frontend can import the ARNs
// at build time without hardcoding them.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployedStatePath = resolve(root, 'agent/agentcore/.cli/deployed-state.json');
const outputPath = resolve(root, 'web/deployment-info.json');

let deployedState;
try {
  deployedState = JSON.parse(readFileSync(deployedStatePath, 'utf8'));
} catch {
  console.error(`extract-deployment-info: cannot read ${deployedStatePath}`);
  process.exit(1);
}

// Pick the first target (there is only one in this repo: "default").
const targets = deployedState?.targets ?? {};
const targetName = Object.keys(targets)[0];
const resources = targets[targetName]?.resources ?? {};

const runtimes = {};
for (const [name, r] of Object.entries(resources.runtimes ?? {})) {
  runtimes[name] = { runtimeId: r.runtimeId, runtimeArn: r.runtimeArn };
}

const info = {
  target: targetName,
  region: new URL(Object.values(resources.runtimes ?? {})[0]?.runtimeArn ?? 'arn:aws:bedrock-agentcore:us-east-1:0:runtime/x').pathname.split(':')[0].split('/').at(-1)
    ?? 'us-east-1',
  runtimes,
};

// Derive region properly from the ARN: arn:aws:bedrock-agentcore:<region>:<acct>:runtime/<id>
const firstArn = Object.values(resources.runtimes ?? {})[0]?.runtimeArn ?? '';
const arnParts = firstArn.split(':');
info.region = arnParts[3] ?? 'us-east-1';

writeFileSync(outputPath, JSON.stringify(info, null, 2) + '\n');
console.log(`extract-deployment-info: wrote ${outputPath}`);
console.log(JSON.stringify(info, null, 2));
