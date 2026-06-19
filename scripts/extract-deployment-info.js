#!/usr/bin/env node
// Reads agent/default/agentcore/.cli/deployed-state.json after `agentcore deploy`
// and CloudFormation stack outputs for gateway ARN/endpoint,
// then writes web/deployment-info.json so the frontend can import ARNs at build time.
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
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

const memories = {};
for (const [name, m] of Object.entries(resources.memories ?? {})) {
  memories[name] = { memoryId: m.memoryId, memoryArn: m.memoryArn };
}

// Derive region from the stack name or fall back to the first memory ARN.
const firstMemoryArn = Object.values(memories)[0]?.memoryArn ?? '';
const region = firstMemoryArn.split(':')[3] || 'us-east-1';

// Resolve harness ARNs from the Harness control-plane API.
// The Harness API endpoint is bedrock-agentcore-control.{region}.amazonaws.com/harnesses
// (uses SigV4 with service name "bedrock-agentcore", not "bedrock-agentcore-control").
// Naming convention: <target>_<HarnessName>-<suffix>  e.g. default_MyHarness-PXjJuBIMNs
const harnesses = {};
let harnessListRaw;
try {
  // aws-curl-style request via Python botocore for SigV4 signing
  harnessListRaw = execSync(
    `python3 -c "
import boto3, json, urllib.request, urllib.error
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
creds = boto3.Session().get_credentials().get_frozen_credentials()
req = AWSRequest(method='GET', url='https://bedrock-agentcore-control.${region}.amazonaws.com/harnesses')
SigV4Auth(creds, 'bedrock-agentcore', '${region}').add_auth(req)
r = urllib.request.Request(req.url, headers=dict(req.headers), method='GET')
with urllib.request.urlopen(r) as resp:
    print(resp.read().decode())
"`,
    { encoding: 'utf8' }
  );
} catch (err) {
  console.warn('extract-deployment-info: could not list harnesses:', err.message);
}
if (harnessListRaw) {
  const harnessPrefix = `${targetName}_`;
  for (const h of JSON.parse(harnessListRaw)?.harnesses ?? []) {
    if (h.harnessName.startsWith(harnessPrefix)) {
      const logicalName = h.harnessName.slice(harnessPrefix.length);
      harnesses[logicalName] = { harnessArn: h.arn };
    }
  }
}

// Read gateway outputs from CloudFormation via AWS CLI (avoids SDK dependency in plain Node)
let gateway = null;
if (resources.stackName) {
  try {
    const raw = execSync(
      `aws cloudformation describe-stacks --stack-name ${resources.stackName} --region ${region} --query "Stacks[0].Outputs" --output json`,
      { encoding: 'utf8' }
    );
    const outputs = JSON.parse(raw) ?? [];
    const get = (key) => outputs.find(o => o.OutputKey === key)?.OutputValue;
    const gatewayArn = get('UserMcpGatewayArn');
    const gatewayId = get('UserMcpGatewayId');
    const gatewayEndpoint = get('UserMcpGatewayEndpoint');
    if (gatewayArn) {
      gateway = { gatewayArn, gatewayId, gatewayEndpoint };
    }
  } catch (err) {
    console.warn('extract-deployment-info: could not read CFN outputs:', err.message);
  }
}

const info = { target: targetName, region, harnesses, memories, ...(gateway ? { gateway } : {}) };
writeFileSync(outputPath, JSON.stringify(info, null, 2) + '\n');
console.log(`extract-deployment-info: wrote ${outputPath}`);
console.log(JSON.stringify(info, null, 2));
