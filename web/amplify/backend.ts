import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
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