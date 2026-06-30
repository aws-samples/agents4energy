#!/usr/bin/env tsx
/**
 * Creates the AWS IAM OIDC provider + deploy role that the GitHub Actions
 * deploy workflow needs, then stores the role ARN as a GitHub Actions secret
 * and the AWS region as a repository variable.
 *
 * Usage:
 *   npx tsx scripts/setup-deploy-role.ts
 *   npx tsx scripts/setup-deploy-role.ts https://github.com/owner/repo
 *   npx tsx scripts/setup-deploy-role.ts --repo owner/name   # non-interactive
 *
 * Prerequisites:
 *   gh CLI authenticated (`gh auth login`)
 *   AWS CLI configured with credentials that have IAM + STS write access
 *
 * What it does:
 *   1. Creates (or reuses) the GitHub OIDC provider in IAM
 *   2. Creates (or updates) a role "github-actions-deploy-<repo-slug>" with:
 *        - Trust: tokens from the target repo (any branch)
 *        - Permissions: CloudFormation full access, S3 full access,
 *                       CloudFront full access, CDK bootstrap bucket access,
 *                       IAM pass-role (scoped to CDK-created roles)
 *   3. Sets AWS_ROLE_ARN as a GitHub Actions secret on the target repo
 *   4. Sets AWS_REGION as a GitHub Actions variable on the target repo
 */

import { execSync, spawnSync } from 'child_process';
import * as readline from 'readline';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd: string, opts: { silent?: boolean } = {}): string {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : undefined }).trim();
}

function gh(...args: string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function ghJson<T = unknown>(...args: string[]): T {
  return JSON.parse(gh(...args));
}

function aws(cmd: string): string {
  return run(`aws ${cmd}`, { silent: true });
}

function awsJson<T = unknown>(cmd: string): T {
  return JSON.parse(aws(cmd));
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (ans) => { rl.close(); res(ans.trim()); }));
}

// ─── Check prerequisites ───────────────────────────────────────────────────────

try { gh('auth', 'status'); } catch {
  console.error('Error: gh CLI is not authenticated. Run `gh auth login` first.');
  process.exit(1);
}

// ─── Resolve AWS account + region ─────────────────────────────────────────────

const identity = awsJson<{ Account: string; Arn: string }>('sts get-caller-identity');
const accountId = identity.Account;

let awsRegion: string;
try {
  awsRegion = aws('configure get region');
} catch {
  awsRegion = process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}
console.log(`AWS account: ${accountId}  region: ${awsRegion}\n`);

// ─── Pick a repository ─────────────────────────────────────────────────────────

const repoFlagIdx = process.argv.indexOf('--repo');
// Accept positional URL/slug arg (e.g. npx tsx setup-deploy-role.ts https://github.com/owner/repo)
const positionalArg = process.argv.slice(2).find(a => !a.startsWith('-') && process.argv[repoFlagIdx + 1] !== a) ?? '';
let selectedRepo: string = repoFlagIdx !== -1 ? process.argv[repoFlagIdx + 1] : positionalArg;
selectedRepo = selectedRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');

if (!selectedRepo) {
  if (!process.stdin.isTTY) {
    console.error('Error: --repo <owner/name> is required in non-interactive mode.');
    process.exit(1);
  }

  console.log('Fetching your GitHub repositories…\n');
  const repos = ghJson<Array<{ nameWithOwner: string; description: string; isPrivate: boolean }>>(
    'repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate',
  );

  if (repos.length === 0) {
    console.error('No repositories found for your GitHub account.');
    process.exit(1);
  }

  repos.forEach((r, i) => {
    const privacy = r.isPrivate ? '(private)' : '(public)';
    const desc = r.description ? `  — ${r.description}` : '';
    console.log(`  ${String(i + 1).padStart(3)}. ${privacy} ${r.nameWithOwner}${desc}`);
  });

  const choice = await ask(`\nSelect a repository [1-${repos.length}]: `);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= repos.length) {
    console.error('Invalid selection.');
    process.exit(1);
  }
  selectedRepo = repos[idx].nameWithOwner;
}

console.log(`Configuring deploy role for: ${selectedRepo}\n`);

// ─── Create / reuse GitHub OIDC provider ──────────────────────────────────────

const OIDC_URL = 'https://token.actions.githubusercontent.com';
const OIDC_ARN = `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;

console.log('Checking OIDC provider…');
let oidcExists = false;
try {
  aws(`iam get-open-id-connect-provider --open-id-connect-provider-arn ${OIDC_ARN}`);
  oidcExists = true;
} catch { /* doesn't exist yet */ }

if (oidcExists) {
  console.log('  ✓ OIDC provider already exists');
} else {
  aws(
    `iam create-open-id-connect-provider` +
    ` --url ${OIDC_URL}` +
    ` --client-id-list sts.amazonaws.com` +
    // GitHub's current OIDC thumbprint (valid as of 2024; AWS validates the cert chain anyway)
    ` --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1`,
  );
  console.log('  ✓ OIDC provider created');
}

// ─── Create / update IAM role ─────────────────────────────────────────────────

// Slug the repo name for use in the role name (IAM names max 64 chars, alphanumeric + +=,.@-)
const repoSlug = selectedRepo.replace(/[^a-zA-Z0-9+=,.@-]/g, '-').slice(0, 46);
const roleName = `github-actions-deploy-${repoSlug}`;

const trustPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Federated: OIDC_ARN },
      Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${selectedRepo}:*` },
      },
    },
  ],
});

console.log(`\nChecking IAM role "${roleName}"…`);
let roleArn: string;
let roleExists = false;

try {
  const roleData = awsJson<{ Role: { Arn: string } }>(`iam get-role --role-name ${roleName}`);
  roleArn = roleData.Role.Arn;
  roleExists = true;
} catch { /* doesn't exist yet */ }

if (roleExists) {
  // Update the trust policy in case the repo name changed
  aws(`iam update-assume-role-policy --role-name ${roleName} --policy-document '${trustPolicy}'`);
  console.log(`  ✓ Role exists — trust policy refreshed`);
  console.log(`  ARN: ${roleArn!}`);
} else {
  const result = awsJson<{ Role: { Arn: string } }>(
    `iam create-role --role-name ${roleName} --assume-role-policy-document '${trustPolicy}'`,
  );
  roleArn = result.Role.Arn;
  console.log(`  ✓ Role created`);
  console.log(`  ARN: ${roleArn}`);
}

// ─── Attach permissions ────────────────────────────────────────────────────────

// Managed policies sufficient for: CDK deploy, CloudFormation, S3 sync, CloudFront invalidation
const MANAGED_POLICIES = [
  'arn:aws:iam::aws:policy/AWSCloudFormationFullAccess',
  'arn:aws:iam::aws:policy/AmazonS3FullAccess',
  'arn:aws:iam::aws:policy/CloudFrontFullAccess',
  'arn:aws:iam::aws:policy/service-role/AmplifyBackendDeployFullAccess',
];

console.log('\nAttaching managed policies…');
for (const policyArn of MANAGED_POLICIES) {
  aws(`iam attach-role-policy --role-name ${roleName} --policy-arn ${policyArn}`);
  console.log(`  ✓ ${policyArn.split('/').pop()}`);
}

// Inline policy: CDK bootstrap bucket + IAM PassRole scoped to CDK-created roles
const inlinePolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      // CDK needs to read/write the bootstrap bucket and ECR for asset publishing
      Sid: 'CdkBootstrap',
      Effect: 'Allow',
      Action: ['s3:*', 'ecr:*'],
      Resource: `arn:aws:s3:::cdk-*`,
    },
    {
      // CDK deploy passes execution roles to CloudFormation
      Sid: 'CdkPassRole',
      Effect: 'Allow',
      Action: 'iam:PassRole',
      Resource: `arn:aws:iam::${accountId}:role/cdk-*`,
    },
    {
      // CDK bootstrap & deploy need to read/write SSM parameter for bootstrap version
      // Amplify Gen 2 reads parameters under /amplify/* during backend deploy
      Sid: 'CdkSsm',
      Effect: 'Allow',
      Action: ['ssm:GetParameter', 'ssm:GetParametersByPath', 'ssm:PutParameter'],
      Resource: [
        `arn:aws:ssm:${awsRegion}:${accountId}:parameter/cdk-bootstrap/*`,
        `arn:aws:ssm:${awsRegion}:${accountId}:parameter/amplify/*`,
      ],
    },
  ],
});

aws(`iam put-role-policy --role-name ${roleName} --policy-name CdkDeploy --policy-document '${inlinePolicy}'`);
console.log('  ✓ CdkDeploy inline policy');

// Inline policy: AppSync field-level permissions for createChatSession + invokeAgent.
// AppSync IAM auth requires field-level ARNs (types/Mutation/fields/<name>),
// not the top-level /graphql resource.
const agentInvokePolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'AppSyncMutations',
      Effect: 'Allow',
      Action: 'appsync:GraphQL',
      Resource: [
        `arn:aws:appsync:${awsRegion}:${accountId}:apis/*/types/Mutation/fields/createChatSession`,
        `arn:aws:appsync:${awsRegion}:${accountId}:apis/*/types/Mutation/fields/invokeAgent`,
      ],
    },
  ],
});

aws(`iam put-role-policy --role-name ${roleName} --policy-name AgentInvoke --policy-document '${agentInvokePolicy}'`);
console.log('  ✓ AgentInvoke inline policy');

// ─── Set GitHub Actions secret + variable ─────────────────────────────────────

console.log('\nConfiguring GitHub Actions…');
gh('secret', 'set', 'AWS_ROLE_ARN', '--repo', selectedRepo, '--body', roleArn);
console.log(`  ✓ AWS_ROLE_ARN (secret) = ${roleArn}`);

gh('variable', 'set', 'AWS_REGION', '--repo', selectedRepo, '--body', awsRegion);
console.log(`  ✓ AWS_REGION (variable) = ${awsRegion}`);

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log(`
${'─'.repeat(72)}
Deploy role setup complete for ${selectedRepo}

  IAM role:    ${roleName}
  Role ARN:    ${roleArn}
  AWS account: ${accountId}
  AWS region:  ${awsRegion}

The deploy workflow will authenticate using OIDC — no long-lived credentials.
Push to any branch to trigger a deploy.
${'─'.repeat(72)}
`);
