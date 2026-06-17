import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { listSessionMessages } from './functions/list-session-messages/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  listSessionMessages,
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
  },
});