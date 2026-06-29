import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { listSessionMessages } from './functions/list-session-messages/resource';
import { updateSessionSummary } from './functions/update-session-summary/resource';
import { registerMcpTarget } from './functions/register-mcp-target/resource';
import { listMcpTools } from './functions/list-mcp-tools/resource';
import { invokeAgent } from './functions/invoke-agent/resource';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';

// Values injected by scripts/inject-agentcore-env.js before ampx pipeline-deploy runs.
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
listSessionMessagesLambda.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock-agentcore:ListEvents', 'bedrock-agentcore:ListMemoryRecords'],
  resources: [AGENTCORE_MEMORY_ARN],
}));

const updateSessionSummaryLambda = backend.updateSessionSummary.resources.lambda as LambdaFunction;
updateSessionSummaryLambda.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock-agentcore:BatchUpdateMemoryRecords'],
  resources: [AGENTCORE_MEMORY_ARN],
}));

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
//
// DynamoDB table access is granted by allow.resource(invokeAgent).to(['query'])
// in the schema — no separate addToRolePolicy needed here.
// ============================================================================

backend.invokeAgent.addEnvironment('HARNESS_ARN', AGENTCORE_HARNESS_ARN);

const invokeAgentLambda = backend.invokeAgent.resources.lambda as LambdaFunction;

invokeAgentLambda.addToRolePolicy(new PolicyStatement({
  actions: [
    'bedrock-agentcore:InvokeAgentRuntime',
    'bedrock-agentcore:InvokeHarness',
  ],
  resources: [AGENTCORE_HARNESS_ARN],
}));

// Service account Cognito credentials for harness Bearer token auth.
const SVC_SSM_PATH = '/agentcore/invoke-agent-service/password';
backend.invokeAgent.addEnvironment('COGNITO_USER_POOL_ID', backend.auth.resources.userPool.userPoolId);
backend.invokeAgent.addEnvironment('COGNITO_CLIENT_ID', backend.auth.resources.userPoolClient.userPoolClientId);
backend.invokeAgent.addEnvironment('SERVICE_ACCOUNT_USERNAME', 'invoke-agent-service@internal.local');
backend.invokeAgent.addEnvironment('SERVICE_ACCOUNT_SSM_PATH', SVC_SSM_PATH);

// SSM read for service account password (region/account derived from stack)
invokeAgentLambda.addToRolePolicy(new PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:${AGENTCORE_REGION}:${backend.stack.account}:parameter${SVC_SSM_PATH}`,
  ],
}));

// ============================================================================
// AUTHENTICATED USERS — SigV4-sign harness invoke requests directly
// ============================================================================

backend.auth.resources.authenticatedUserIamRole.addToPrincipalPolicy(new PolicyStatement({
  actions: [
    'bedrock-agentcore:InvokeAgentRuntime',
    'bedrock-agentcore:InvokeHarness',
  ],
  resources: [AGENTCORE_HARNESS_ARN],
}));

// Allow the AgentCore gateway service to invoke this Lambda as a gateway target.
invokeAgentLambda.addPermission('AllowGatewayInvoke', {
  principal: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
  action: 'lambda:InvokeFunction',
  sourceArn: AGENTCORE_GATEWAY_ARN,
});

// ============================================================================
// EXPORTS — consumed by AgentCore CDK stack and extract-deployment-info.js
// ============================================================================

backend.addOutput({
  custom: {
    auth_authenticated_role_arn: backend.auth.resources.authenticatedUserIamRole.roleArn,
    auth_unauthenticated_role_arn: backend.auth.resources.unauthenticatedUserIamRole.roleArn,
    invoke_agent_lambda_arn: invokeAgentLambda.functionArn,
  },
});

// ============================================================================
// AG-UI HANDLER — GraphQL API environment variable placeholder
//
// The invokeHandler HTTP data source + resolver are wired by
// scripts/extract-deployment-info.js after agentcore deploy. The placeholder
// ensures the env var slot exists from the first Amplify deploy onward.
// ============================================================================

const cfnGraphqlApi = backend.data.resources.cfnResources.cfnGraphqlApi;
cfnGraphqlApi.environmentVariables = { AGUI_RUNTIME_ARN: 'PLACEHOLDER' };
