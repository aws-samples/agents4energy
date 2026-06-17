#!/usr/bin/env node
// Reads Cognito config from web/amplify_outputs.json and writes the JWT
// authorizer configuration into agent/default/app/MyHarness/harness.json so
// the harness is deployed with CUSTOM_JWT inbound auth matching the Amplify
// Cognito user pool of the current deployer.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const amplifyOutputsPath = resolve(root, 'web/amplify_outputs.json');
const harnessJsonPath = resolve(root, 'agent/default/app/MyHarness/harness.json');

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

const harness = JSON.parse(readFileSync(harnessJsonPath, 'utf8'));
harness.authorizerType = 'CUSTOM_JWT';
harness.authorizerConfiguration = {
  customJwtAuthorizer: {
    discoveryUrl,
    allowedClients: [user_pool_client_id],
  },
};

writeFileSync(harnessJsonPath, JSON.stringify(harness, null, 2) + '\n');
console.log(`configure-agentcore-auth: configured JWT auth for harness ${harness.name}`);
console.log(`  discoveryUrl: ${discoveryUrl}`);
console.log(`  allowedClients: [${user_pool_client_id}]`);
