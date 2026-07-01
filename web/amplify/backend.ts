import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { listSessionMessages } from './functions/list-session-messages/resource';
import { updateSessionSummary } from './functions/update-session-summary/resource';
import { registerMcpTarget } from './functions/register-mcp-target/resource';
import { listMcpTools } from './functions/list-mcp-tools/resource';
import { invokeAgent } from './functions/invoke-agent/resource';
import { PolicyStatement, ServicePrincipal, Effect } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { Fn, Stack } from 'aws-cdk-lib';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { HostingConstruct } from './constructs/hostingConstruct';
import { AgentCoreRuntimeWithBuild } from './constructs/agentCoreRuntimeWithBuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Values injected by scripts/inject-agentcore-env.js before ampx pipeline-deploy runs.
// These are only needed for the existing memory/gateway wiring; the new AgentCore Runtime
// is now deployed by the agentStack construct below.
const AGENTCORE_MEMORY_ID  = process.env.AGENTCORE_MEMORY_ID  ?? '';
const AGENTCORE_MEMORY_ARN = process.env.AGENTCORE_MEMORY_ARN ?? '';
const AGENTCORE_GATEWAY_ID  = process.env.AGENTCORE_GATEWAY_ID  ?? '';
const AGENTCORE_GATEWAY_ARN = process.env.AGENTCORE_GATEWAY_ARN ?? '';
const AGENTCORE_HARNESS_ARN = process.env.AGENTCORE_HARNESS_ARN ?? '';
const AGENTCORE_REGION      = process.env.AGENTCORE_REGION ?? 'us-east-1';

const backend = defineBackend({
  auth,
  data,
  listSessionMessages,
  updateSessionSummary,
  registerMcpTarget,
  listMcpTools,
  invokeAgent,
});

backend.stack.tags.setTag('Project', 'workshop');
backend.stack.tags.setTag('RootStack', backend.stack.stackName);

// ============================================================================
// HOSTING STACK — S3 + CloudFront static website hosting
// ============================================================================

const hostingStack = backend.createStack('hosting');
const hosting = new HostingConstruct(hostingStack, 'Hosting');

// ============================================================================
// AGENT STACK — AgentCore Runtime (builds + deploys the Python handler)
// ============================================================================

const agentStack = backend.createStack('agent');

// Cognito discovery URL: https://cognito-idp.{region}.amazonaws.com/{userPoolId}
const userPoolId = backend.auth.resources.userPool.userPoolId;
const cognitoDiscoveryUrl = Fn.join('', [
  'https://cognito-idp.',
  Stack.of(backend.auth.resources.userPool).region,
  '.amazonaws.com/',
  userPoolId,
  '/.well-known/openid-configuration',
]);

const agUiHandlerRuntime = new AgentCoreRuntimeWithBuild(agentStack, 'AgUiHandler', {
  protocolConfiguration: 'AGUI',
  imageAssetDirectory: resolve(__dirname, '../../agent/handler'),
  cognitoDiscoveryUrl: cognitoDiscoveryUrl,
  allowedClients: [backend.auth.resources.userPoolClient.userPoolClientId],
  description: 'AG-UI handler runtime for the agentcore-amplify-fullstack app',
});

// ============================================================================
// BASIC AUTH CONFIGURATION
// ============================================================================

const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true };
cfnUserPoolClient.explicitAuthFlows = [
  'ALLOW_CUSTOM_AUTH',
  'ALLOW_REFRESH_TOKEN_AUTH',
  'ALLOW_USER_SRP_AUTH',
  'ALLOW_USER_PASSWORD_AUTH',
];

// ============================================================================
// AGENTCORE MEMORY — list-session-messages + update-session-summary Lambdas
// ============================================================================

backend.listSessionMessages.addEnvironment('AGENTCORE_MEMORY_ID', AGENTCORE_MEMORY_ID);
backend.updateSessionSummary.addEnvironment('AGENTCORE_MEMORY_ID', AGENTCORE_MEMORY_ID);

const listSessionMessagesLambda = backend.listSessionMessages.resources.lambda as LambdaFunction;
if (AGENTCORE_MEMORY_ARN) {
  listSessionMessagesLambda.addToRolePolicy(new PolicyStatement({
    actions: ['bedrock-agentcore:ListEvents', 'bedrock-agentcore:ListMemoryRecords'],
    resources: [AGENTCORE_MEMORY_ARN],
  }));
}

const updateSessionSummaryLambda = backend.updateSessionSummary.resources.lambda as LambdaFunction;
if (AGENTCORE_MEMORY_ARN) {
  updateSessionSummaryLambda.addToRolePolicy(new PolicyStatement({
    actions: ['bedrock-agentcore:BatchUpdateMemoryRecords'],
    resources: [AGENTCORE_MEMORY_ARN],
  }));
}

// ============================================================================
// REGISTER-MCP-TARGET Lambda — CreateGatewayTarget on the default gateway
// ============================================================================

backend.registerMcpTarget.addEnvironment('GATEWAY_ID', AGENTCORE_GATEWAY_ID);
backend.registerMcpTarget.addEnvironment('GATEWAY_REGION', AGENTCORE_REGION);

const registerMcpTargetLambda = backend.registerMcpTarget.resources.lambda as LambdaFunction;
registerMcpTargetLambda.addToRolePolicy(new PolicyStatement({
  actions: [
    'bedrock-agentcore:CreateGatewayTarget',
    'bedrock-agentcore:SynchronizeGatewayTargets',
  ],
  resources: ['*'],
}));

// ============================================================================
// INVOKE-AGENT Lambda — sub-agent dispatcher via AgentCore harness
// ============================================================================

backend.invokeAgent.addEnvironment('HARNESS_ARN', AGENTCORE_HARNESS_ARN);

const invokeAgentLambda = backend.invokeAgent.resources.lambda as LambdaFunction;

if (AGENTCORE_HARNESS_ARN) {
  invokeAgentLambda.addToRolePolicy(new PolicyStatement({
    actions: [
      'bedrock-agentcore:InvokeAgentRuntime',
      'bedrock-agentcore:InvokeHarness',
    ],
    resources: [AGENTCORE_HARNESS_ARN],
  }));
}

const SVC_SSM_PATH = '/agentcore/invoke-agent-service/password';
backend.invokeAgent.addEnvironment('COGNITO_USER_POOL_ID', backend.auth.resources.userPool.userPoolId);
backend.invokeAgent.addEnvironment('COGNITO_CLIENT_ID', backend.auth.resources.userPoolClient.userPoolClientId);
backend.invokeAgent.addEnvironment('SERVICE_ACCOUNT_USERNAME', 'invoke-agent-service@internal.local');
backend.invokeAgent.addEnvironment('SERVICE_ACCOUNT_SSM_PATH', SVC_SSM_PATH);

invokeAgentLambda.addToRolePolicy(new PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:${AGENTCORE_REGION}:${backend.stack.account}:parameter${SVC_SSM_PATH}`,
  ],
}));

// ============================================================================
// AUTHENTICATED USERS — SigV4-sign harness invoke requests directly
// ============================================================================

if (AGENTCORE_HARNESS_ARN) {
  backend.auth.resources.authenticatedUserIamRole.addToPrincipalPolicy(new PolicyStatement({
    actions: [
      'bedrock-agentcore:InvokeAgentRuntime',
      'bedrock-agentcore:InvokeHarness',
    ],
    resources: [AGENTCORE_HARNESS_ARN],
  }));
}

if (AGENTCORE_GATEWAY_ARN) {
  invokeAgentLambda.addPermission('AllowGatewayInvoke', {
    principal: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    action: 'lambda:InvokeFunction',
    sourceArn: AGENTCORE_GATEWAY_ARN,
  });
}

// Grant the runtime execution role permission to invoke the AgentCore runtime
// (needed for AppSync → runtime invocations post-deploy wiring)
agUiHandlerRuntime.executionRole.addToPrincipalPolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
  resources: ['*'],
}));

// ============================================================================
// AG-UI HANDLER — GraphQL API environment variable placeholder
// ============================================================================

const cfnGraphqlApi = backend.data.resources.cfnResources.cfnGraphqlApi;
cfnGraphqlApi.environmentVariables = { AGUI_RUNTIME_ARN: 'PLACEHOLDER' };

// ============================================================================
// EXPORTS — consumed by extract-deployment-info.js and the frontend
// ============================================================================

backend.addOutput({
  custom: {
    auth_authenticated_role_arn: backend.auth.resources.authenticatedUserIamRole.roleArn,
    auth_unauthenticated_role_arn: backend.auth.resources.unauthenticatedUserIamRole.roleArn,
    invoke_agent_lambda_arn: invokeAgentLambda.functionArn,
    // Hosting outputs
    hosting_bucket_name: hosting.bucket.bucketName,
    hosting_distribution_id: hosting.distribution.distributionId,
    hosting_domain: hosting.distributionDomainName,
    // AgentCore runtime outputs
    agui_runtime_arn: agUiHandlerRuntime.runtime.attrAgentRuntimeArn,
    agui_runtime_role_arn: agUiHandlerRuntime.executionRole.roleArn,
  },
});
