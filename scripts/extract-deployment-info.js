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

// Resolve runtime ARNs from the AgentCore control-plane API.
// Naming convention: <target>_<RuntimeName>-<suffix>  e.g. default_AgUiHandler-abc123
const runtimes = {};
// First, try to read from deployed-state.json directly (fastest, no API call needed)
for (const [name, r] of Object.entries(resources.runtimes ?? {})) {
  runtimes[name] = { runtimeArn: r.runtimeArn, roleArn: r.roleArn };
}
// If deployed-state.json didn't have runtimes, fall back to AWS CLI
if (Object.keys(runtimes).length === 0) {
  let runtimeListRaw;
  try {
    runtimeListRaw = execSync(
      `aws bedrock-agentcore-control list-agent-runtimes --region ${region} --output json`,
      { encoding: 'utf8' }
    );
  } catch (err) {
    console.warn('extract-deployment-info: could not list runtimes:', err.message);
  }
  if (runtimeListRaw) {
    const runtimePrefix = `${targetName}_`;
    for (const r of JSON.parse(runtimeListRaw)?.agentRuntimes ?? []) {
      if (r.agentRuntimeName?.startsWith(runtimePrefix)) {
        const logicalName = r.agentRuntimeName.slice(runtimePrefix.length).replace(/-[^-]+$/, '');
        runtimes[logicalName] = { runtimeArn: r.agentRuntimeArn };
      }
    }
  }
}

// ============================================================================
// Wire the AG-UI invokeHandler AppSync resolver
//
// The HTTP data source and resolver are fully managed here (no CFn ownership).
// After agentcore deploy creates the AgUiHandler runtime, this script:
//   1. Creates IAM role + AppSync HTTP data source (idempotent).
//   2. Creates or updates the Mutation.invokeHandler resolver.
//   3. Calls PutGraphqlApiEnvironmentVariables to set AGUI_RUNTIME_ARN.
//   4. Grants the runtime execution role appsync:GraphQL for publishAgentEvent.
//   5. Keeps agentcore.json APPSYNC_HTTP_ENDPOINT in sync.
// ============================================================================
const agUiHandlerRuntime = runtimes['AgUiHandler'];
const amplifyOutputsPath = resolve(root, 'web/amplify_outputs.json');
let amplifyOutputs;
try {
  amplifyOutputs = JSON.parse(readFileSync(amplifyOutputsPath, 'utf8'));
} catch {
  console.warn('extract-deployment-info: could not read amplify_outputs.json — skipping AppSync wiring');
}

if (agUiHandlerRuntime && amplifyOutputs) {
  const appsyncEndpoint = amplifyOutputs?.data?.url ?? '';
  const appsyncRegion = amplifyOutputs?.data?.aws_region ?? region;

  const sidecarPath = resolve(root, 'web/amplify-table-suffix.txt');
  let appsyncApiId;
  try {
    appsyncApiId = readFileSync(sidecarPath, 'utf8').trim();
  } catch {
    try {
      const cfnApiRaw = execSync(
        `aws appsync list-graphql-apis --region ${appsyncRegion} --output json`,
        { encoding: 'utf8' }
      );
      const apis = JSON.parse(cfnApiRaw)?.graphqlApis ?? [];
      const match = apis.find(a => a.uris?.GRAPHQL === appsyncEndpoint);
      appsyncApiId = match?.apiId;
    } catch (err) {
      console.warn('extract-deployment-info: could not resolve AppSync API ID:', err.message);
    }
  }

  if (appsyncApiId && appsyncEndpoint) {
    const runtimeArn = agUiHandlerRuntime.runtimeArn;
    const runtimeRoleArn = resources.runtimes?.AgUiHandler?.roleArn;
    const accountId = runtimeArn.split(':')[4];
    const DS_NAME = 'AgUiHandlerRuntime';
    const roleName = `AppSync-AgUiHandler-${appsyncApiId.slice(0, 8)}`;

    // 1. Ensure IAM role for AppSync → bedrock-agentcore exists, with exact runtime ARN.
    let httpDsRoleArn;
    try {
      httpDsRoleArn = execSync(
        `aws iam get-role --role-name ${roleName} --query 'Role.Arn' --output text`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
    } catch { /* will create */ }
    if (!httpDsRoleArn) {
      const trustPolicy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'appsync.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      });
      httpDsRoleArn = execSync(
        `aws iam create-role --role-name ${roleName} --assume-role-policy-document '${trustPolicy}' --query 'Role.Arn' --output text`,
        { encoding: 'utf8' }
      ).trim();
      console.log(`extract-deployment-info: created IAM role ${roleName}`);
    }
    const invokePolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: ['bedrock-agentcore:InvokeAgentRuntime'],
        Resource: [runtimeArn, `${runtimeArn}/runtime-endpoint/*`] }],
    });
    execSync(
      `aws iam put-role-policy --role-name ${roleName} --policy-name InvokeRuntime --policy-document '${invokePolicy}'`,
      { encoding: 'utf8' }
    );

    // 2. Create or update the AppSync HTTP data source.
    const runtimeBaseUrl = `https://bedrock-agentcore.${appsyncRegion}.amazonaws.com`;
    const httpDsConfig = JSON.stringify({
      endpoint: runtimeBaseUrl,
      authorizationConfig: {
        authorizationType: 'AWS_IAM',
        awsIamConfig: { signingRegion: appsyncRegion, signingServiceName: 'bedrock-agentcore' },
      },
    });
    let dsExists = false;
    try {
      execSync(
        `aws appsync get-data-source --api-id ${appsyncApiId} --name ${DS_NAME} --region ${appsyncRegion} --output json`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      dsExists = true;
    } catch { /* not found */ }
    try {
      if (dsExists) {
        execSync(
          `aws appsync update-data-source --api-id ${appsyncApiId} --name ${DS_NAME} --type HTTP --http-config '${httpDsConfig}' --service-role-arn ${httpDsRoleArn} --region ${appsyncRegion} --output json`,
          { encoding: 'utf8' }
        );
      } else {
        execSync(
          `aws appsync create-data-source --api-id ${appsyncApiId} --name ${DS_NAME} --type HTTP --http-config '${httpDsConfig}' --service-role-arn ${httpDsRoleArn} --region ${appsyncRegion} --output json`,
          { encoding: 'utf8' }
        );
      }
      console.log(`extract-deployment-info: upserted AppSync data source ${DS_NAME}`);
    } catch (err) {
      console.warn('extract-deployment-info: could not upsert AppSync data source:', err.message);
    }

    // 3. Create or update the invokeHandler resolver (script-owned, no CFn conflict).
    //    The encoded ARN is baked in at generation time (encodeURIComponent is not
    //    available in the AppSync JS runtime).
    const encodedArn = encodeURIComponent(runtimeArn);
    const resolverCode = `import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    method: 'POST',
    resourcePath: '/runtimes/${encodedArn}/invocations?qualifier=DEFAULT',
    params: {
      headers: {
        'Content-Type': 'application/json',
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': ctx.args.sessionId,
      },
      body: JSON.stringify({
        sessionId: ctx.args.sessionId,
        prompt: ctx.args.prompt,
        systemPrompt: ctx.args.systemPrompt,
        modelId: ctx.args.modelId,
        summary: ctx.args.summary,
      }),
    },
  };
}
export function response(ctx) {
  if (ctx.error) { util.error(ctx.error.message, ctx.error.type); }
  const body = JSON.parse(ctx.result.body);
  return { sessionId: body.sessionId || ctx.args.sessionId };
}`;
    const tmpResolverPath = resolve(root, 'tmp/invokeHandler-resolver.js');
    execSync(`mkdir -p ${resolve(root, 'tmp')}`, { encoding: 'utf8' });
    writeFileSync(tmpResolverPath, resolverCode);
    const resolverBaseArgs = `--api-id ${appsyncApiId} --type-name Mutation --field-name invokeHandler --kind UNIT --data-source-name ${DS_NAME} --runtime name=APPSYNC_JS,runtimeVersion=1.0.0 --code file://${tmpResolverPath} --region ${appsyncRegion} --output json`;
    let resolverExists = false;
    try {
      execSync(
        `aws appsync get-resolver --api-id ${appsyncApiId} --type-name Mutation --field-name invokeHandler --region ${appsyncRegion} --output json`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      resolverExists = true;
    } catch { /* not found */ }
    try {
      if (resolverExists) {
        execSync(`aws appsync update-resolver ${resolverBaseArgs}`, { encoding: 'utf8' });
      } else {
        execSync(`aws appsync create-resolver ${resolverBaseArgs}`, { encoding: 'utf8' });
      }
      console.log(`extract-deployment-info: upserted AppSync resolver Mutation.invokeHandler`);
    } catch (err) {
      console.warn('extract-deployment-info: could not upsert AppSync resolver:', err.message);
    }

    // 4. Set AGUI_RUNTIME_ARN on the AppSync API so the resolver can read ctx.env.
    //    PutGraphqlApiEnvironmentVariables overwrites all vars, so we fetch first.
    try {
      const existingVarsRaw = execSync(
        `aws appsync get-graphql-api --api-id ${appsyncApiId} --region ${appsyncRegion} --query 'graphqlApi.environmentVariables' --output json`,
        { encoding: 'utf8' }
      );
      const existingVars = JSON.parse(existingVarsRaw) ?? {};
      const mergedVars = { ...existingVars, AGUI_RUNTIME_ARN: runtimeArn };
      execSync(
        `aws appsync put-graphql-api-environment-variables --api-id ${appsyncApiId} --environment-variables '${JSON.stringify(mergedVars)}' --region ${appsyncRegion} --output json`,
        { encoding: 'utf8' }
      );
      console.log(`extract-deployment-info: set AGUI_RUNTIME_ARN on AppSync API ${appsyncApiId}`);
    } catch (err) {
      console.warn('extract-deployment-info: could not set AppSync env vars:', err.message);
    }

    // 5. Grant the runtime execution role permission to publish AG-UI events,
    //    invoke Bedrock for summarisation, and read AgentCore memory history.
    if (runtimeRoleArn) {
      const runtimeRoleName = runtimeRoleArn.split('/').pop();
      const memoryArn = Object.values(memories)[0]?.memoryArn ?? '';

      const publishPolicy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Action: ['appsync:GraphQL'],
          Resource: [
            `arn:aws:appsync:${appsyncRegion}:${accountId}:apis/${appsyncApiId}/types/Mutation/fields/publishAgentEvent`,
          ],
        }],
      });
      try {
        execSync(
          `aws iam put-role-policy --role-name ${runtimeRoleName} --policy-name AppSyncPublishAgentEvent --policy-document '${publishPolicy}'`,
          { encoding: 'utf8' }
        );
        console.log(`extract-deployment-info: granted runtime role ${runtimeRoleName} AppSync publish permission`);
      } catch (err) {
        console.warn('extract-deployment-info: could not grant runtime role AppSync permission:', err.message);
      }

      // Grant ListEvents on the memory so the container can seed prior conversation
      // turns into the Strands agent before each run.
      if (memoryArn) {
        const memoryReadPolicy = JSON.stringify({
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Allow',
            Action: ['bedrock-agentcore:ListEvents'],
            Resource: [memoryArn],
          }],
        });
        try {
          execSync(
            `aws iam put-role-policy --role-name ${runtimeRoleName} --policy-name MemoryListEvents --policy-document '${memoryReadPolicy}'`,
            { encoding: 'utf8' }
          );
          console.log(`extract-deployment-info: granted runtime role ${runtimeRoleName} memory ListEvents permission`);
        } catch (err) {
          console.warn('extract-deployment-info: could not grant runtime role memory permission:', err.message);
        }
      }
    }

    // 4. Keep agentcore.json env vars in sync so the container knows where to
    //    publish AG-UI events and which memory to write conversation turns to.
    const agentcoreJsonPath = resolve(root, 'agent/default/agentcore/agentcore.json');
    try {
      const agentcoreJson = JSON.parse(readFileSync(agentcoreJsonPath, 'utf8'));
      const agUiRuntime = agentcoreJson.runtimes?.find(r => r.name === 'AgUiHandler');
      if (agUiRuntime) {
        if (!agUiRuntime.envVars) agUiRuntime.envVars = [];
        const envUpdates = {
          APPSYNC_HTTP_ENDPOINT: appsyncEndpoint,
          AGENTCORE_MEMORY_ID: Object.values(memories)[0]?.memoryId ?? '',
        };
        let changed = false;
        for (const [name, value] of Object.entries(envUpdates)) {
          if (!value) continue;
          const idx = agUiRuntime.envVars.findIndex(e => e.name === name);
          if (idx >= 0) {
            if (agUiRuntime.envVars[idx].value !== value) {
              agUiRuntime.envVars[idx].value = value;
              changed = true;
            }
          } else {
            agUiRuntime.envVars.push({ name, value });
            changed = true;
          }
        }
        if (changed) {
          writeFileSync(agentcoreJsonPath, JSON.stringify(agentcoreJson, null, 2) + '\n');
          console.log(`extract-deployment-info: updated agentcore.json env vars`);
        }
      }
    } catch (err) {
      console.warn('extract-deployment-info: could not update agentcore.json:', err.message);
    }
  }
}

// Resolve the AppSync API ID at the outer scope by re-reading the sidecar or API list.
// appsyncApiId is declared inside the agUiHandlerRuntime block above, so we re-derive it here.
let outerAppsyncApiId = '';
if (amplifyOutputs) {
  const sidecarPath2 = resolve(root, 'web/amplify-table-suffix.txt');
  try {
    outerAppsyncApiId = readFileSync(sidecarPath2, 'utf8').trim();
  } catch {
    const appsyncUrl = amplifyOutputs?.data?.url ?? '';
    const appsyncRegion2 = amplifyOutputs?.data?.aws_region ?? region;
    try {
      const cfnApiRaw = execSync(`aws appsync list-graphql-apis --region ${appsyncRegion2} --output json`, { encoding: 'utf8' });
      const apis = JSON.parse(cfnApiRaw)?.graphqlApis ?? [];
      const match = apis.find(a => a.uris?.GRAPHQL === appsyncUrl);
      outerAppsyncApiId = match?.apiId ?? '';
    } catch { /* ignore */ }
  }
}

const appsync = amplifyOutputs ? {
  endpoint: amplifyOutputs?.data?.url ?? '',
  apiId: outerAppsyncApiId,
  region: amplifyOutputs?.data?.aws_region ?? region,
} : undefined;

const info = {
  target: targetName,
  region,
  harnesses,
  memories,
  runtimes,
  ...(gateway ? { gateway } : {}),
  ...(appsync ? { appsync } : {}),
};
writeFileSync(outputPath, JSON.stringify(info, null, 2) + '\n');
console.log(`extract-deployment-info: wrote ${outputPath}`);
console.log(JSON.stringify(info, null, 2));
