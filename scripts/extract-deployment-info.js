#!/usr/bin/env node
// Reads agent/default/agentcore/.cli/deployed-state.json after `agentcore deploy`
// and writes web/deployment-info.json so the static frontend can import ARNs
// at build time without hardcoding them.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployedStatePath = resolve(root, 'agent/default/agentcore/.cli/deployed-state.json');
const outputPath = resolve(root, 'web/deployment-info.json');

let deployedState;
try {
  deployedState = JSON.parse(readFileSync(deployedStatePath, 'utf8'));
} catch {
  console.error(`extract-deployment-info: cannot read ${deployedStatePath}`);
  process.exit(1);
}

const targets = deployedState?.targets ?? {};
const targetName = Object.keys(targets)[0];
const resources = targets[targetName]?.resources ?? {};

const harnesses = {};
for (const [name, h] of Object.entries(resources.harnesses ?? {})) {
  harnesses[name] = { harnessArn: h.harnessArn };
}

const memories = {};
for (const [name, m] of Object.entries(resources.memories ?? {})) {
  memories[name] = { memoryId: m.memoryId, memoryArn: m.memoryArn };
}

const firstHarnessArn = Object.values(resources.harnesses ?? {})[0]?.harnessArn ?? '';
const region = firstHarnessArn.split(':')[3] ?? 'us-east-1';

const info = { target: targetName, region, harnesses, memories };

writeFileSync(outputPath, JSON.stringify(info, null, 2) + '\n');
console.log(`extract-deployment-info: wrote ${outputPath}`);
console.log(JSON.stringify(info, null, 2));
