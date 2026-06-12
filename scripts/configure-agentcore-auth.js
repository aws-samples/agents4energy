#!/usr/bin/env node
// Reads Cognito config from web/amplify_outputs.json and writes the JWT
// authorizer configuration into agent/agentcore/agentcore.json so the
// AgentCore runtime is deployed with CUSTOM_JWT inbound auth matching the
// Amplify Cognito user pool of the current deployer.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const amplifyOutputsPath = resolve(root, 'web/amplify_outputs.json');
const agentcoreJsonPath = resolve(root, 'agent/agentcore/agentcore.json');

let amplifyOutputs;
try {
  amplifyOutputs = JSON.parse(readFileSync(amplifyOutputsPath, 'utf8'));
} catch {
  console.error(`configure-agentcore-auth: cannot read ${amplifyOutputsPath}`);
  process.exit(1);
}

const auth = amplifyOutputs?.auth;
if (!auth?.user_pool_id || !auth?.user_pool_client_id || !auth?.aws_region) {
  console.error('configure-agentcore-auth: missing auth fields in amplify_outputs.json');
  process.exit(1);
}

const { user_pool_id, user_pool_client_id, aws_region } = auth;
const discoveryUrl = `https://cognito-idp.${aws_region}.amazonaws.com/${user_pool_id}/.well-known/openid-configuration`;

const spec = JSON.parse(readFileSync(agentcoreJsonPath, 'utf8'));

for (const runtime of spec.runtimes ?? []) {
  runtime.authorizerType = 'CUSTOM_JWT';
  runtime.authorizerConfiguration = {
    customJwtAuthorizer: {
      discoveryUrl,
      allowedClients: [user_pool_client_id],
    },
  };
}

writeFileSync(agentcoreJsonPath, JSON.stringify(spec, null, 2) + '\n');
console.log(`configure-agentcore-auth: configured JWT auth for user pool ${user_pool_id}`);
console.log(`  discoveryUrl: ${discoveryUrl}`);
console.log(`  allowedClients: [${user_pool_client_id}]`);
