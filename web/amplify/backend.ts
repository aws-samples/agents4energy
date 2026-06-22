import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { listSessionMessages } from './functions/list-session-messages/resource';
import { registerMcpTarget } from './functions/register-mcp-target/resource';
import { listMcpTools } from './functions/list-mcp-tools/resource';
import { invokeAgent } from './functions/invoke-agent/resource';
import { PolicyStatement, ServicePrincipal, Role, Effect, FederatedPrincipal } from 'aws-cdk-lib/aws-iam';
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

// Allow this Lambda to invoke the harness using SigV4 IAM credentials.
invokeAgentLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['bedrock-agentcore:InvokeAgentRuntime'],
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
// GITHUB ACTIONS — IAM role for @mention agent invocation via OIDC
// ============================================================================

// GitHub owners/orgs whose repos are trusted to assume this role.
// Access is gated by which repos have the AWS_AGENT_ROLE_ARN variable +
// AGENT_APP_PRIVATE_KEY secret set (via scripts/setup-github-integration.ts).
const GITHUB_OWNERS = ['waltmayf', 'energy-digital-operations'];

const githubOidcProvider = `token.actions.githubusercontent.com`;

const githubActionsRole = new Role(backend.stack, 'GitHubActionsAgentRole', {
  roleName: 'github-actions-agent-invoker',
  assumedBy: new FederatedPrincipal(
    `arn:aws:iam::${backend.stack.account}:oidc-provider/${githubOidcProvider}`,
    {
      StringEquals: {
        [`${githubOidcProvider}:aud`]: 'sts.amazonaws.com',
      },
      StringLike: {
        // Trust any ref in any repo under the listed owners.
        [`${githubOidcProvider}:sub`]: GITHUB_OWNERS.map(o => `repo:${o}/*:*`),
      },
    },
    'sts:AssumeRoleWithWebIdentity',
  ),
});

// Allow the role to execute any GraphQL operation on the AppSync API.
githubActionsRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['appsync:GraphQL'],
    resources: [`${backend.data.resources.graphqlApi.arn}/*`],
  }),
);

// Allow the role to invoke the invoke-agent Lambda directly (used by
// scripts/github-agent-invoke.ts while invokeAgentAsync GraphQL mutation
// is not yet available).
githubActionsRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['lambda:InvokeFunction'],
    resources: [invokeAgentLambda.functionArn],
  }),
);

// Export the role ARN so it can be referenced in the GitHub Actions workflow.
backend.addOutput({
  custom: {
    github_actions_agent_role_arn: githubActionsRole.roleArn,
  },
});