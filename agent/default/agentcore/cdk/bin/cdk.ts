#!/usr/bin/env node
import { AgentCoreStack } from '../lib/cdk-stack';
import { ConfigIO, type AwsDeploymentTarget } from '@aws/agentcore-cdk';
import { App, type Environment } from 'aws-cdk-lib';
import * as path from 'path';
import * as fs from 'fs';

interface AmplifyOutputs {
  data?: { url?: string };
  custom?: Record<string, string>;
}

function readSeedDataConfig(configRoot: string): {
  settingsTableName: string;
  agentTableName: string;
  mcpServerTableName: string;
  agentMcpServerTableName: string;
} | undefined {
  // Walk up from agentcore/ to find the web/amplify_outputs.json peer directory.
  // Typical layout: <repo>/agent/default/agentcore/ and <repo>/web/
  const repoRoot = path.resolve(configRoot, '..', '..', '..');
  const amplifyOutputsPath = path.join(repoRoot, 'web', 'amplify_outputs.json');
  if (!fs.existsSync(amplifyOutputsPath)) return undefined;

  let outputs: AmplifyOutputs;
  try {
    outputs = JSON.parse(fs.readFileSync(amplifyOutputsPath, 'utf8'));
  } catch {
    return undefined;
  }

  const graphqlUrl = outputs?.data?.url;
  if (!graphqlUrl) return undefined;

  // Extract AppSync API ID from: https://{customDomain}.appsync-api.{region}.amazonaws.com/graphql
  // The AppSync API ID is the tag value on the API, not the custom domain prefix.
  // We need it to construct the DynamoDB table names (format: <Model>-<apiId>-NONE).
  // The API ID is embedded in the CloudFormation stack resources — read it from the ARN
  // by calling AppSync. However, to avoid a runtime AWS call at synth time, we use the
  // AppSync API's tags. The simpler approach: read the amplify_outputs model_introspection
  // which lists models, and use the API's own stack resource suffix from the Amplify sandbox
  // stack name. Since Amplify sandbox writes the GRAPHQL URL using the custom endpoint but
  // the table names use the real API ID, we need to resolve this correlation.
  //
  // The table names follow pattern: <Model>-<amplifyApiId>-NONE
  // amplifyApiId != the custom domain prefix; it's the internal API resource ID.
  // We derive it by reading the AppSync API tags stored in amplify_outputs.json itself —
  // specifically, the model_introspection doesn't include it, but we can infer the API ID
  // from the stack name stored in tags. As a fallback, store it in a sidecar file.
  const sidecarPath = path.join(repoRoot, 'web', 'amplify-table-suffix.txt');
  if (!fs.existsSync(sidecarPath)) return undefined;

  const apiId = fs.readFileSync(sidecarPath, 'utf8').trim();
  if (!apiId) return undefined;

  return {
    settingsTableName: `Settings-${apiId}-NONE`,
    agentTableName: `Agent-${apiId}-NONE`,
    mcpServerTableName: `McpServer-${apiId}-NONE`,
    agentMcpServerTableName: `AgentMcpServer-${apiId}-NONE`,
  };
}

function readInvokeAgentLambdaArn(configRoot: string): string | undefined {
  const repoRoot = path.resolve(configRoot, '..', '..', '..');
  const amplifyOutputsPath = path.join(repoRoot, 'web', 'amplify_outputs.json');
  if (!fs.existsSync(amplifyOutputsPath)) return undefined;
  try {
    const outputs: AmplifyOutputs = JSON.parse(fs.readFileSync(amplifyOutputsPath, 'utf8'));
    return outputs.custom?.invoke_agent_lambda_arn;
  } catch {
    return undefined;
  }
}


function toEnvironment(target: AwsDeploymentTarget): Environment {
  return {
    account: target.account,
    region: target.region,
  };
}

function sanitize(name: string): string {
  return name.replace(/_/g, '-');
}

function toStackName(projectName: string, targetName: string): string {
  return `AgentCore-${sanitize(projectName)}-${sanitize(targetName)}`;
}

async function main() {
  // Config root is parent of cdk/ directory. The CLI sets process.cwd() to agentcore/cdk/.
  const configRoot = path.resolve(process.cwd(), '..');
  const configIO = new ConfigIO({ baseDir: configRoot });

  const spec = await configIO.readProjectSpec();
  const targets = await configIO.readAWSDeploymentTargets();

  // The vended CDK project compiles against the published @aws/agentcore-cdk
  // schema type, which may lag the CLI's own AgentCoreProjectSpec (e.g. payments,
  // harnesses, gateway fields). Cast once so those fields are reachable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const specAny = spec as any;

  // Extract MCP configuration from project spec.
  // Gateway fields are stored in agentcore.json but may not yet be on the
  const mcpSpec = specAny.agentCoreGateways?.length
    ? {
        agentCoreGateways: specAny.agentCoreGateways,
        mcpRuntimeTools: specAny.mcpRuntimeTools,
        unassignedTargets: specAny.unassignedTargets,
      }
    : undefined;

  // Read deployed state for credential ARNs (populated by pre-deploy identity setup)
  let deployedState: Record<string, unknown> | undefined;
  try {
    deployedState = JSON.parse(fs.readFileSync(path.join(configRoot, '.cli', 'deployed-state.json'), 'utf8'));
  } catch {
    // Deployed state may not exist on first deploy
  }

  if (targets.length === 0) {
    throw new Error('No deployment targets configured. Please define targets in agentcore/aws-targets.json');
  }

  // Read harness configs for role creation.
  const projectRoot = path.resolve(configRoot, '..');
  const harnessConfigs: {
    name: string;
    executionRoleArn?: string;
    memoryName?: string;
    containerUri?: string;
    hasDockerfile?: boolean;
    dockerfile?: string;
    codeLocation?: string;
    tools?: { type: string; name: string }[];
    apiKeyArn?: string;
    efsAccessPoints?: { accessPointArn: string; mountPath: string }[];
    s3AccessPoints?: { accessPointArn: string; mountPath: string }[];
    apiFormat?: 'converse_stream' | 'responses' | 'chat_completions';
  }[] = [];
  for (const entry of specAny.harnesses ?? []) {
    const harnessDir = path.resolve(projectRoot, entry.path);
    const harnessPath = path.resolve(harnessDir, 'harness.json');
    try {
      const harnessSpec = JSON.parse(fs.readFileSync(harnessPath, 'utf-8'));
      harnessConfigs.push({
        name: entry.name,
        executionRoleArn: harnessSpec.executionRoleArn,
        memoryName: harnessSpec.memory?.name,
        containerUri: harnessSpec.containerUri,
        hasDockerfile: !!harnessSpec.dockerfile,
        dockerfile: harnessSpec.dockerfile,
        codeLocation: harnessSpec.dockerfile ? harnessDir : undefined,
        tools: harnessSpec.tools,
        apiKeyArn: harnessSpec.model?.apiKeyArn,
        efsAccessPoints: harnessSpec.efsAccessPoints,
        s3AccessPoints: harnessSpec.s3AccessPoints,
        apiFormat: harnessSpec.model?.apiFormat,
      });
    } catch (err) {
      throw new Error(
        `Could not read harness.json for "${entry.name}" at ${harnessPath}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  const invokeAgentLambdaArn = readInvokeAgentLambdaArn(configRoot);

  const app = new App();

  for (const target of targets) {
    const env = toEnvironment(target);
    const stackName = toStackName(spec.name, target.name);

    // Extract credentials from deployed state for this target
    const targetState = (deployedState as Record<string, unknown>)?.targets as
      | Record<string, Record<string, unknown>>
      | undefined;
    const targetResources = targetState?.[target.name]?.resources as Record<string, unknown> | undefined;
    const credentials = targetResources?.credentials as
      | Record<string, { credentialProviderArn: string; clientSecretArn?: string }>
      | undefined;

    // Payment credential provider ARNs live in the same credentials map as identity credentials
    const paymentCredentials = credentials;

    const paymentSpec = specAny.payments?.length
      ? specAny.payments.map(
          (p: {
            name: string;
            description?: string;
            authorizerType: 'AWS_IAM' | 'CUSTOM_JWT';
            authorizerConfiguration?: unknown;
            autoPayment?: boolean;
            paymentToolAllowlist?: string[];
            networkPreferences?: string[];
            connectors: { name: string; provider?: string; credentialName: string }[];
          }) => ({
            name: p.name,
            description: p.description,
            authorizerType: p.authorizerType,
            authorizerConfiguration: p.authorizerConfiguration,
            autoPayment: p.autoPayment,
            paymentToolAllowlist: p.paymentToolAllowlist,
            networkPreferences: p.networkPreferences,
            connectors: p.connectors.map(c => {
              const credentialProviderArn = paymentCredentials?.[c.credentialName]?.credentialProviderArn;
              if (!credentialProviderArn) {
                // Fail fast with an actionable message rather than passing an empty
                // ARN that fails opaquely server-side at CreatePaymentConnector.
                throw new Error(
                  `Payment connector "${c.name}" on manager "${p.name}" references credential ` +
                    `"${c.credentialName}", but no deployed credential provider was found for it. ` +
                    `Run \`agentcore deploy\` so the credential provider is created first.`
                );
              }
              return { name: c.name, provider: c.provider, credentialProviderArn };
            }),
          })
        )
      : undefined;

    new AgentCoreStack(app, stackName, {
      spec,
      mcpSpec,
      credentials,
      harnesses: harnessConfigs.length > 0 ? harnessConfigs : undefined,
      paymentSpec,
      seedData: readSeedDataConfig(configRoot),
      invokeAgentLambdaArn,
      env,
      description: `AgentCore stack for ${spec.name} deployed to ${target.name} (${target.region})`,
      tags: {
        'agentcore:project-name': spec.name,
        'agentcore:target-name': target.name,
      },
    });
  }

  app.synth();
}

main().catch((error: unknown) => {
  console.error('AgentCore CDK synthesis failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
