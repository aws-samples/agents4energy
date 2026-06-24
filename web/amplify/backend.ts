import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { listSessionMessages } from './functions/list-session-messages/resource';
import { registerMcpTarget } from './functions/register-mcp-target/resource';
import { listMcpTools } from './functions/list-mcp-tools/resource';
import { invokeAgent } from './functions/invoke-agent/resource';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  listSessionMessages,
  registerMcpTarget,
  listMcpTools,
  invokeAgent,
});


backend.stack.tags.setTag('Project', 'workshop');
backend.stack.tags.setTag('RootStack', backend.stack.stackName);

// ============================================================================
// BASIC AUTH CONFIGURATION
// ============================================================================

// Disable self-signup - admin creates users manually
const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Enable USER_PASSWORD_AUTH so the invoke script and tests can authenticate directly
cfnUserPoolClient.explicitAuthFlows = [
  'ALLOW_CUSTOM_AUTH',
  'ALLOW_REFRESH_TOKEN_AUTH',
  'ALLOW_USER_SRP_AUTH',
  'ALLOW_USER_PASSWORD_AUTH',
];

// ============================================================================
// AGENTCORE MEMORY — list-session-messages Lambda
// ============================================================================

// Memory ID is deployed by the agentcore CDK stack; keep it in sync with
// web/deployment-info.json (populated by scripts/extract-deployment-info.js).
const AGENTCORE_MEMORY_ID = 'default_MyHarnessMemory-zz6wfiFFUs';
const AGENTCORE_MEMORY_ARN = `arn:aws:bedrock-agentcore:us-east-1:796988593450:memory/${AGENTCORE_MEMORY_ID}`;

// Inject the memory ID so the handler doesn't need to import deployment-info.json
backend.listSessionMessages.addEnvironment('AGENTCORE_MEMORY_ID', AGENTCORE_MEMORY_ID);

// Grant the Lambda permission to list events from the memory resource.
// Cast to concrete Function to access addToRolePolicy (IFunction doesn't expose it).
const listSessionMessagesLambda = backend.listSessionMessages.resources.lambda as LambdaFunction;
listSessionMessagesLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['bedrock-agentcore:ListEvents'],
    resources: [AGENTCORE_MEMORY_ARN],
  }),
);

// ============================================================================
// REGISTER-MCP-TARGET Lambda — CreateGatewayTarget on the default gateway
// ============================================================================

const GATEWAY_ID = 'default-default-gateway-5qwnlmsqe3';
const GATEWAY_REGION = 'us-east-1';
const GATEWAY_ARN = `arn:aws:bedrock-agentcore:${GATEWAY_REGION}:796988593450:gateway/${GATEWAY_ID}`;

backend.registerMcpTarget.addEnvironment('GATEWAY_ID', GATEWAY_ID);
backend.registerMcpTarget.addEnvironment('GATEWAY_REGION', GATEWAY_REGION);

const registerMcpTargetLambda = backend.registerMcpTarget.resources.lambda as LambdaFunction;
registerMcpTargetLambda.addToRolePolicy(
  new PolicyStatement({
    // CreateGatewayTarget internally calls SynchronizeGatewayTargets to refresh the gateway.
    actions: [
      'bedrock-agentcore:CreateGatewayTarget',
      'bedrock-agentcore:SynchronizeGatewayTargets',
    ],
    resources: ['*'],
  }),
);

// ============================================================================
// INVOKE-AGENT Lambda — sub-agent dispatcher via AgentCore harness
// ============================================================================

const HARNESS_ARN = 'arn:aws:bedrock-agentcore:us-east-1:796988593450:harness/default_MyHarness-PXjJuBIMNs';

backend.invokeAgent.addEnvironment('HARNESS_ARN', HARNESS_ARN);

const invokeAgentLambda = backend.invokeAgent.resources.lambda as LambdaFunction;

// Allow the Lambda to invoke the harness using its IAM execution role (AWS_IAM auth mode).
invokeAgentLambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'bedrock-agentcore:InvokeAgentRuntime',
      'bedrock-agentcore:InvokeHarness',
    ],
    resources: [HARNESS_ARN],
  }),
);

// Grant direct DynamoDB read access so the Lambda can look up agent config without going
// through AppSync (AppSync owner-auth silently filters out records with null owner).
// Table names are hardcoded to avoid a CDK circular dependency between the function and
// data stacks (function stack → data stack tables → data stack → function resolver).
const AMPLIFY_ENV_SUFFIX = 'w76u5er7b5gvvclhudegwckcse-NONE';
const ACCOUNT_ID = '796988593450';
const DDB_REGION = 'us-east-1';
backend.invokeAgent.addEnvironment('AGENT_TABLE', `Agent-${AMPLIFY_ENV_SUFFIX}`);
backend.invokeAgent.addEnvironment('MCP_SERVER_TABLE', `McpServer-${AMPLIFY_ENV_SUFFIX}`);
backend.invokeAgent.addEnvironment('AGENT_MCP_SERVER_TABLE', `AgentMcpServer-${AMPLIFY_ENV_SUFFIX}`);
invokeAgentLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:GetItem'],
    resources: [
      `arn:aws:dynamodb:${DDB_REGION}:${ACCOUNT_ID}:table/Agent-${AMPLIFY_ENV_SUFFIX}`,
      `arn:aws:dynamodb:${DDB_REGION}:${ACCOUNT_ID}:table/McpServer-${AMPLIFY_ENV_SUFFIX}`,
      `arn:aws:dynamodb:${DDB_REGION}:${ACCOUNT_ID}:table/AgentMcpServer-${AMPLIFY_ENV_SUFFIX}`,
      `arn:aws:dynamodb:${DDB_REGION}:${ACCOUNT_ID}:table/AgentMcpServer-${AMPLIFY_ENV_SUFFIX}/index/*`,
    ],
  }),
);

// Service account Cognito credentials for harness Bearer token auth.
const SVC_SSM_PATH = '/agentcore/invoke-agent-service/password';
backend.invokeAgent.addEnvironment('COGNITO_USER_POOL_ID', 'us-east-1_qG5061DTr');
backend.invokeAgent.addEnvironment('COGNITO_CLIENT_ID', '2hugv1ugrni8jts323q1ldiopt');
backend.invokeAgent.addEnvironment('SERVICE_ACCOUNT_USERNAME', 'invoke-agent-service@internal.local');
backend.invokeAgent.addEnvironment('SERVICE_ACCOUNT_SSM_PATH', SVC_SSM_PATH);
invokeAgentLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['ssm:GetParameter'],
    resources: [`arn:aws:ssm:${DDB_REGION}:${ACCOUNT_ID}:parameter${SVC_SSM_PATH}`],
  }),
);


// Allow authenticated browser users to SigV4-sign harness invoke requests directly.
// The Cognito Identity Pool maps signed-in users to this role.
backend.auth.resources.authenticatedUserIamRole.addToPrincipalPolicy(
  new PolicyStatement({
    actions: [
      'bedrock-agentcore:InvokeAgentRuntime',
      'bedrock-agentcore:InvokeHarness',
    ],
    resources: [HARNESS_ARN],
  }),
);

// Allow the AgentCore gateway service to invoke this Lambda as a gateway target.
invokeAgentLambda.addPermission('AllowGatewayInvoke', {
  principal: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
  action: 'lambda:InvokeFunction',
  sourceArn: GATEWAY_ARN,
});

// Export IAM role ARNs into amplify_outputs.json under `custom` so other
// projects in this monorepo can consume them without calling AWS APIs at
// build/synth time. Add any other cross-project outputs here using the
// same pattern.
backend.addOutput({
  custom: {
    auth_authenticated_role_arn:
      backend.auth.resources.authenticatedUserIamRole.roleArn,
    auth_unauthenticated_role_arn:
      backend.auth.resources.unauthenticatedUserIamRole.roleArn,
    // Exported for the AgentCore CDK stack to register as a gateway target.
    invoke_agent_lambda_arn: invokeAgentLambda.functionArn,
  },
});

// ============================================================================
// AG-UI HANDLER — GraphQL API environment variable placeholder
//
// The invokeHandler HTTP data source + resolver are created/updated by
// scripts/extract-deployment-info.js (AWS CLI) after agentcore deploy, so
// there is no CFn ownership conflict.
//
// We set a placeholder AGUI_RUNTIME_ARN on the API now so the env var slot
// exists. The post-deploy script updates it to the real runtime ARN via
// PutGraphqlApiEnvironmentVariables.
// ============================================================================
const cfnGraphqlApi = backend.data.resources.cfnResources.cfnGraphqlApi;
cfnGraphqlApi.environmentVariables = {
  AGUI_RUNTIME_ARN: 'PLACEHOLDER',
};
