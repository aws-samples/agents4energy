import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { listSessionMessages } from './functions/list-session-messages/resource';
import { updateSessionSummary } from './functions/update-session-summary/resource';
import { registerMcpTarget } from './functions/register-mcp-target/resource';
import { listMcpTools } from './functions/list-mcp-tools/resource';
import { invokeAgent } from './functions/invoke-agent/resource';
import { Policy, PolicyStatement, ServicePrincipal, Effect, Role } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { Fn, Stack } from 'aws-cdk-lib';
import { HttpDataSource, CfnResolver } from 'aws-cdk-lib/aws-appsync';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { HostingConstruct } from './constructs/hostingConstruct';
import { AgentCoreRuntimeWithBuild } from './constructs/agentCoreRuntimeWithBuild';
import { AgentCoreApplication, type HarnessSpecInput } from './constructs/agentCoreApplication';
import { E2eTestUser } from './constructs/e2eTestUser/resource';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// AGENTCORE CONFIG — read agentcore.json + harness.json at synth time.
// These are the same files the `agentcore` CLI reads/writes; the CLI remains
// usable for local iteration (agentcore dev/validate), but production deploys
// no longer run `agentcore deploy` — this stack owns the resources directly.
// ============================================================================

const agentcoreRoot = resolve(__dirname, '../../agent/default/agentcore');
const projectSpec = JSON.parse(readFileSync(resolve(agentcoreRoot, 'agentcore.json'), 'utf8'));

const harnessSpecs: HarnessSpecInput[] = (projectSpec.harnesses ?? []).map(
  (entry: { name: string; path: string }) => {
    const harnessPath = resolve(agentcoreRoot, '..', entry.path, 'harness.json');
    return JSON.parse(readFileSync(harnessPath, 'utf8')) as HarnessSpecInput;
  },
);

// Physical gateway names are account+region unique in Bedrock AgentCore, so a
// fixed name in agentcore.json collides across sandboxes/branches deployed to
// the same account (see PR #30 review — "AlreadyExists" against a stale
// AgentCore-default-default stack). Suffix with the Amplify backend
// namespace+name (same CDK context keys the `ampx` deployer injects — see
// @aws-amplify/platform-core's CDKContextKey) so every sandbox/branch gets a
// distinct physical gateway name without hand-managed identifiers.
const sanitizeForResourceName = (value: string) =>
  value.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const toGatewayResourceName = (...segments: string[]) =>
  sanitizeForResourceName(segments.filter(Boolean).join('-'))
    .slice(0, 100)
    .replace(/-$/, '');

// Harness/Memory physical names don't have a `resourceName` escape hatch like
// the Gateway does — @aws/agentcore-cdk's BasePrimitiveConstruct always derives
// them as `${projectName}_${name}`, and `projectName` is the fixed "default"
// from agentcore.json. Make the *projectName* itself unique per deployment so
// harness role name / CfnMemory name / CfnHarness name stop colliding with the
// legacy AgentCore-default-default stack (or with each other across sandboxes).
// Harness/Memory names are constrained by the AgentCore API to
// ^[a-zA-Z][a-zA-Z0-9_]{0,47}$ (max 48 chars, alnum+underscore only) — tighter
// than the gateway's hyphen-friendly name, so no hyphens here and the combined
// "<projectName>_<resourceName>" must fit in 48 chars.
const sanitizeForAgentCoreName = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, '');

const toAgentCoreProjectName = (maxLength: number, ...segments: string[]) =>
  segments
    .filter(Boolean)
    .map(sanitizeForAgentCoreName)
    .filter(Boolean)
    .join('_')
    .slice(0, maxLength);

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

// `ampx` (sandbox and pipeline-deploy) injects these CDK context values before
// synth — see @aws-amplify/platform-core's CDKContextKey (amplify-backend-namespace/
// -name). namespace is the app id (or local package name for sandboxes); name is the
// branch (or sandbox identifier, e.g. the BRANCH_SLUG scripts/build.sh passes via
// `ampx sandbox --identifier`). Concatenating them gives every deployment — each
// branch, each developer's sandbox — its own physical gateway name.
const backendNamespace = backend.stack.node.tryGetContext('amplify-backend-namespace') as string | undefined;
const backendName = backend.stack.node.tryGetContext('amplify-backend-name') as string | undefined;

// ============================================================================
// HOSTING STACK — S3 + CloudFront static website hosting
// ============================================================================

const hostingStack = backend.createStack('hosting');
const hosting = new HostingConstruct(hostingStack, 'Hosting');

// ============================================================================
// AGENT STACK — AgentCore Runtime, Memory, Harness, Gateway
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

// harness.json's authorizerConfiguration is frozen at whatever it was when
// last written by scripts/configure-agentcore-auth.js (a pre-in-stack-CDK
// pipeline step) — it can reference a stale Cognito user pool/client from a
// prior deployment. Re-derive discoveryUrl/allowedClients from *this* stack's
// user pool here, the same way AgentCoreRuntimeWithBuild does above, so a
// harness declared as CUSTOM_JWT always authorizes against the Cognito user
// pool it's actually deployed alongside (see issue #56).
const harnessSpecsWithAuth: HarnessSpecInput[] = harnessSpecs.map((h) =>
  h.authorizerType === 'CUSTOM_JWT'
    ? {
        ...h,
        authorizerConfiguration: {
          customJwtAuthorizer: {
            discoveryUrl: cognitoDiscoveryUrl,
            allowedClients: [backend.auth.resources.userPoolClient.userPoolClientId],
          },
        },
      }
    : h,
);

// Memory/Harness/Gateway from agentcore.json — same-stack CDK tokens, no
// post-deploy control-plane resolution needed. `AgUiHandler` is excluded
// from `spec.runtimes` here since AgentCoreRuntimeWithBuild above already
// owns that CfnRuntime.
//
// `name` in agentcore.json is just the logical/config name — the physical
// CfnGateway name comes from `resourceName` when set (see Gateway.js in
// @aws/agentcore-cdk). Override it per-deployment so concurrent sandboxes/
// branches in the same account don't collide on physical gateway names.
const agentCoreGatewaysWithUniqueNames = projectSpec.agentCoreGateways?.length
  ? projectSpec.agentCoreGateways.map((gateway: { name: string; [key: string]: unknown }) => ({
      ...gateway,
      resourceName: toGatewayResourceName(projectSpec.name, gateway.name, backendNamespace ?? '', backendName ?? ''),
    }))
  : undefined;

// Harness/Memory physical names are `${projectName}_${name}`, capped at 48 chars
// total (alnum+underscore only). Reserve enough room for the longest configured
// harness/memory logical name plus the joining underscore, then fit the unique
// projectName into whatever's left.
const longestResourceNameLength = Math.max(
  1,
  ...harnessSpecs.map((h) => h.name.length),
  ...(projectSpec.memories ?? []).map((m: { name: string }) => m.name.length),
);
const uniqueProjectName = toAgentCoreProjectName(
  48 - 1 - longestResourceNameLength,
  projectSpec.name,
  backendNamespace ?? '',
  backendName ?? '',
);

const agentCoreApp = new AgentCoreApplication(agentStack, 'AgentCoreApplication', {
  projectName: uniqueProjectName,
  memories: projectSpec.memories ?? [],
  harnesses: harnessSpecsWithAuth,
  mcpSpec: agentCoreGatewaysWithUniqueNames
    ? {
        agentCoreGateways: agentCoreGatewaysWithUniqueNames,
        mcpRuntimeTools: projectSpec.mcpRuntimeTools,
      }
    : undefined,
});

const memoryName = harnessSpecs[0]?.memory?.name;
const harnessName = harnessSpecs[0]?.name;
const gatewayName = projectSpec.agentCoreGateways?.[0]?.name;

const AGENTCORE_MEMORY_ID = memoryName ? agentCoreApp.memoryId(memoryName) : '';
const AGENTCORE_MEMORY_ARN = memoryName ? agentCoreApp.memoryArn(memoryName) : '';
const AGENTCORE_GATEWAY_ID = gatewayName ? agentCoreApp.gatewayId(gatewayName) : '';
const AGENTCORE_GATEWAY_ARN = gatewayName ? agentCoreApp.gatewayArn(gatewayName) : '';
const AGENTCORE_GATEWAY_ENDPOINT = gatewayName ? agentCoreApp.gatewayEndpoint(gatewayName) : '';
const AGENTCORE_HARNESS_ARN = harnessName ? agentCoreApp.harnessArn(harnessName) : '';
const AGENTCORE_HARNESS_ROLE_ARN = harnessName ? agentCoreApp.harnessRoleArn(harnessName) : '';
const AGENTCORE_REGION = Stack.of(agentStack).region;

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
// E2E TEST USER — Cognito user + SSM-stored credentials for Playwright auth.
//
// Created via a CDK custom resource instead of the e2e suite bootstrapping
// its own user with AdminCreateUser at test time — that required granting
// cognito-idp:AdminCreateUser to whatever role runs the tests. Here that
// permission is scoped to the deploy-time custom resource's own role; the
// test runner only needs ssm:GetParameter (see web/e2e/auth.setup.ts).
// SSM paths are branch/sandbox-scoped so concurrent deployments don't share
// (or clobber) the same test user.
// ============================================================================

const e2eTestUserResourceId = toGatewayResourceName(backendNamespace ?? '', backendName ?? '') || 'default';
const E2E_TEST_USER_EMAIL_SSM_PATH = `/agentcore/e2e-test-user-${e2eTestUserResourceId}/email`;
const E2E_TEST_USER_PASSWORD_SSM_PATH = `/agentcore/e2e-test-user-${e2eTestUserResourceId}/password`;

new E2eTestUser(agentStack, 'E2eTestUser', {
  userPoolId: backend.auth.resources.userPool.userPoolId,
  userPoolArn: backend.auth.resources.userPool.userPoolArn,
  email: `e2e-test-${e2eTestUserResourceId}@agentcore.dev`,
  emailSsmPath: E2E_TEST_USER_EMAIL_SSM_PATH,
  passwordSsmPath: E2E_TEST_USER_PASSWORD_SSM_PATH,
});

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

// Grant the runtime execution role read access to the harness memory so the
// container can seed prior conversation turns into the Strands agent.
if (AGENTCORE_MEMORY_ARN) {
  agUiHandlerRuntime.executionRole.addToPrincipalPolicy(new PolicyStatement({
    actions: ['bedrock-agentcore:ListEvents'],
    resources: [AGENTCORE_MEMORY_ARN],
  }));
}

// ============================================================================
// AG-UI HANDLER — wire Mutation.invokeHandler to the AgentCore runtime.
//
// The schema declares invokeHandler with a NONE_DS stub handler (see
// aguiHandler.schema.ts) purely so the transformer synthesizes the field.
// Here we escape-hatch the transformer-generated CfnResolver + CfnDataSource
// in place so Amplify's CFn stack fully owns the real HTTP resolver — no
// post-deploy AppSync CLI wiring script needed.
// ============================================================================

// The data stack's resources (cfnGraphqlApi, resolver, new data source/role below)
// must all be created in the *same* CDK stack as backend.data — mixing scopes
// here (e.g. creating AgUiHandlerDataSource in agentStack) makes the data stack
// depend on the agent stack (via cfnGraphqlApi.environmentVariables) while the
// agent stack simultaneously depends on the data stack (via backend.data.resources
// .graphqlApi), producing a circular nested-stack dependency that CloudFormation
// rejects at deploy time.
const cfnGraphqlApi = backend.data.resources.cfnResources.cfnGraphqlApi;
const dataStack = Stack.of(cfnGraphqlApi);
cfnGraphqlApi.environmentVariables = { AGUI_RUNTIME_ARN: agUiHandlerRuntime.runtime.attrAgentRuntimeArn };

const appsyncRegion = Stack.of(agentStack).region;
const httpDsRole = new Role(dataStack, 'AgUiHandlerDataSourceRole', {
  assumedBy: new ServicePrincipal('appsync.amazonaws.com'),
  description: 'Role AppSync assumes to invoke the AgUiHandler AgentCore runtime',
});
httpDsRole.addToPrincipalPolicy(new PolicyStatement({
  actions: ['bedrock-agentcore:InvokeAgentRuntime'],
  resources: [
    agUiHandlerRuntime.runtime.attrAgentRuntimeArn,
    `${agUiHandlerRuntime.runtime.attrAgentRuntimeArn}/runtime-endpoint/*`,
  ],
}));

const agUiHandlerDataSource = new HttpDataSource(dataStack, 'AgUiHandlerDataSource', {
  api: backend.data.resources.graphqlApi,
  endpoint: `https://bedrock-agentcore.${appsyncRegion}.amazonaws.com`,
  authorizationConfig: {
    signingRegion: appsyncRegion,
    signingServiceName: 'bedrock-agentcore',
  },
  serviceRole: httpDsRole,
});

// Grant the runtime execution role permission to publish AG-UI events back to
// AppSync — agent.py's publish_event() SigV4-signs a `publishAgentEvent`
// mutation using the runtime's own (execution role) credentials against the
// appsync service (see docs/ag-ui-handler-pattern.md). Defined here (dataStack
// scope, same as httpDsRole above) rather than in agentStack: the field ARN is
// built from cfnGraphqlApi.attrApiId (a dataStack-native token), and dataStack
// already depends on agentStack one-directionally (via the runtime ARN used
// above) — attaching the reverse reference to agentStack's role from agentStack
// itself would reintroduce the circular nested-stack dependency described above.
new Policy(dataStack, 'AgUiHandlerPublishEventPolicy', {
  roles: [agUiHandlerRuntime.executionRole],
  statements: [
    new PolicyStatement({
      actions: ['appsync:GraphQL'],
      resources: [
        `arn:aws:appsync:${appsyncRegion}:${Stack.of(dataStack).account}:apis/${cfnGraphqlApi.attrApiId}/types/Mutation/fields/publishAgentEvent`,
      ],
    }),
  ],
});

// The `a.handler.custom()` field in aguiHandler.schema.ts synthesizes its CfnResolver
// directly under the `data` scope (id "Resolver_Mutation_invokeHandler") rather than
// inside the amplifyData nested stack, so it never gets the transformer's
// "graphqltransformer:resourceName" metadata and isn't reachable via
// backend.data.resources.cfnResources.cfnResolvers['Mutation.invokeHandler'].
const invokeHandlerResolver = backend.data.resources.graphqlApi.node.root.node
  .findAll()
  .find((child) => child.node.id === 'Resolver_Mutation_invokeHandler') as CfnResolver | undefined;
if (!invokeHandlerResolver) {
  throw new Error('Mutation.invokeHandler CfnResolver (Resolver_Mutation_invokeHandler) not found in construct tree.');
}

invokeHandlerResolver.dataSourceName = agUiHandlerDataSource.name;
invokeHandlerResolver.kind = 'UNIT';
// The transformer originally synthesized this as a PIPELINE resolver (for the
// NONE_DS stub function), which sets pipelineConfig. CloudFormation rejects a
// UNIT resolver that still carries a pipelineConfig ("Only pipeline resolver
// can have pipelineconfig"), so it must be explicitly cleared here.
invokeHandlerResolver.pipelineConfig = undefined;
invokeHandlerResolver.runtime = { name: 'APPSYNC_JS', runtimeVersion: '1.0.0' };
invokeHandlerResolver.code = `import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    method: 'POST',
    resourcePath: \`/runtimes/\${util.urlEncode(ctx.env.AGUI_RUNTIME_ARN)}/invocations?qualifier=DEFAULT\`,
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
        githubToken: ctx.args.githubToken,
        githubRepo: ctx.args.githubRepo,
        githubBranch: ctx.args.githubBranch,
      }),
    },
  };
}
export function response(ctx) {
  if (ctx.error) { util.error(ctx.error.message, ctx.error.type); }
  const body = JSON.parse(ctx.result.body);
  return { sessionId: body.sessionId || ctx.args.sessionId };
}`;
invokeHandlerResolver.node.addDependency(agUiHandlerDataSource);

// ============================================================================
// EXPORTS — consumed by the frontend via amplify_outputs.json custom outputs
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
    // AgentCore harness/memory/gateway outputs — replaces web/deployment-info.json
    agentcore_region: AGENTCORE_REGION,
    agentcore_memory_id: AGENTCORE_MEMORY_ID,
    agentcore_memory_arn: AGENTCORE_MEMORY_ARN,
    agentcore_harness_arn: AGENTCORE_HARNESS_ARN,
    agentcore_harness_role_arn: AGENTCORE_HARNESS_ROLE_ARN,
    agentcore_gateway_id: AGENTCORE_GATEWAY_ID,
    agentcore_gateway_arn: AGENTCORE_GATEWAY_ARN,
    agentcore_gateway_endpoint: AGENTCORE_GATEWAY_ENDPOINT,
    appsync_api_id: cfnGraphqlApi.attrApiId,
    // e2e test user credentials — see web/e2e/auth.setup.ts
    e2e_test_user_email_ssm_path: E2E_TEST_USER_EMAIL_SSM_PATH,
    e2e_test_user_password_ssm_path: E2E_TEST_USER_PASSWORD_SSM_PATH,
  },
});
