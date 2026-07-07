#!/usr/bin/env tsx
/**
 * Interactive setup script for the GitHub @mention agent integration.
 *
 * Usage:
 *   npx tsx scripts/setup-github-integration.ts                          # interactive repo picker
 *   npx tsx scripts/setup-github-integration.ts --repo owner/name        # non-interactive
 *   npx tsx scripts/setup-github-integration.ts --repo https://github.com/owner/name.git
 *
 * What it does:
 *   1. Lists your GitHub repos and lets you pick one (or use --repo flag)
 *   2. Reads AppSync + runtime info from web/amplify_outputs.json
 *   3. Creates (or reuses) a GitHub OIDC IAM role with permission to call
 *      AppSync createChatSession + invokeAgent, and sets AWS_AGENT_ROLE_ARN
 *      as a GitHub Actions secret on the target repo
 *   4. Sets APPSYNC_ENDPOINT and APP_URL as Actions variables
 *   5. Pushes .github/workflows/agent-mention.yml to the target repo
 *
 * Prerequisites:
 *   gh CLI authenticated (`gh auth login`)
 *   AWS CLI configured with credentials for the deployment account
 *   `pnpm deploy` completed (web/amplify_outputs.json must exist)
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function checkGhAuth() {
  try { gh('auth', 'status'); } catch {
    console.error('Error: gh CLI is not authenticated. Run `gh auth login` first.');
    process.exit(1);
  }
}

/** Push a file to a GitHub repo via the Contents API. Creates or updates. */
function pushFileToRepo(repo: string, path: string, content: string, message: string) {
  const encoded = Buffer.from(content).toString('base64');

  let sha: string | undefined;
  try {
    const existing = ghJson<{ sha?: string }>('api', `repos/${repo}/contents/${path}`);
    sha = existing.sha;
  } catch { /* file doesn't exist yet */ }

  gh('api', `repos/${repo}/contents/${path}`,
    '-X', 'PUT',
    '-f', `message=${message}`,
    '-f', `content=${encoded}`,
    ...(sha ? ['-f', `sha=${sha}`] : []),
  );
}

// ─── Load deployment outputs ──────────────────────────────────────────────────

const amplifyOutputsPath = resolve(root, 'web/amplify_outputs.json');
if (!existsSync(amplifyOutputsPath)) {
  console.error('Error: web/amplify_outputs.json not found. Run `pnpm deploy` first.');
  process.exit(1);
}
const amplifyOutputs = JSON.parse(readFileSync(amplifyOutputsPath, 'utf8'));

const awsRegion: string = amplifyOutputs.custom?.agentcore_region ?? 'us-east-1';
const appsyncEndpoint: string = amplifyOutputs.data?.url ?? '';
const appsyncApiId: string = amplifyOutputs.custom?.appsync_api_id ?? '';
const appsyncRegion: string = amplifyOutputs.data?.aws_region ?? awsRegion;

console.log(`AWS region: ${awsRegion}`);
if (appsyncEndpoint) console.log(`AppSync endpoint: ${appsyncEndpoint}`);

// ─── Check gh CLI ─────────────────────────────────────────────────────────────

checkGhAuth();

// ─── Resolve AWS account ──────────────────────────────────────────────────────

const identity = awsJson<{ Account: string }>('sts get-caller-identity');
const resolvedAccountId = identity.Account;
console.log(`AWS account: ${resolvedAccountId}\n`);

// ─── Pick a repository ────────────────────────────────────────────────────────

const repoFlagIdx = process.argv.indexOf('--repo');
let selectedRepo: string = repoFlagIdx !== -1 ? process.argv[repoFlagIdx + 1] : '';

selectedRepo = selectedRepo
  .replace(/^https?:\/\/github\.com\//, '')
  .replace(/\.git$/, '');

const isTTY = process.stdin.isTTY ?? false;

if (!selectedRepo) {
  if (!isTTY) {
    console.error('Error: --repo <owner/name> is required in non-interactive mode.');
    process.exit(1);
  }

  console.log('Fetching your GitHub repositories…\n');
  const repos: Array<{ nameWithOwner: string; description: string; isPrivate: boolean }> = ghJson(
    'repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate',
  );

  if (repos.length === 0) {
    console.error('No repositories found for your GitHub account.');
    process.exit(1);
  }

  repos.forEach((r, i) => {
    const privacy = r.isPrivate ? '🔒' : '🌐';
    const desc = r.description ? `  — ${r.description}` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${privacy} ${r.nameWithOwner}${desc}`);
  });

  const choice = await ask(`\nSelect a repository [1-${repos.length}]: `);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= repos.length) {
    console.error('Invalid selection.');
    process.exit(1);
  }
  selectedRepo = repos[idx].nameWithOwner;
}

console.log(`\nConfiguring: ${selectedRepo}\n`);

// ─── Create / reuse GitHub OIDC provider ──────────────────────────────────────

const OIDC_URL = 'https://token.actions.githubusercontent.com';
const OIDC_ARN = `arn:aws:iam::${resolvedAccountId}:oidc-provider/token.actions.githubusercontent.com`;

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
    ` --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1`,
  );
  console.log('  ✓ OIDC provider created');
}

// ─── Create / update IAM role for agent invocation ───────────────────────────

const repoSlug = selectedRepo.replace(/[^a-zA-Z0-9+=,.@-]/g, '-').slice(0, 46);
const roleName = `github-actions-agent-invoke-${repoSlug}`;

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
} catch { /* doesn't exist yet */ roleArn = ''; }

if (roleExists) {
  aws(`iam update-assume-role-policy --role-name ${roleName} --policy-document '${trustPolicy}'`);
  console.log(`  ✓ Role exists — trust policy refreshed`);
  console.log(`  ARN: ${roleArn}`);
} else {
  const result = awsJson<{ Role: { Arn: string } }>(
    `iam create-role --role-name ${roleName} --assume-role-policy-document '${trustPolicy}'`,
  );
  roleArn = result.Role.Arn;
  console.log(`  ✓ Role created`);
  console.log(`  ARN: ${roleArn}`);
}

// Inline policy: AppSync field-level permissions for createChatSession + invokeAgent
const appsyncStatements = appsyncApiId ? [{
  Sid: 'AppSyncMutations',
  Effect: 'Allow',
  Action: 'appsync:GraphQL',
  Resource: [
    `arn:aws:appsync:${appsyncRegion}:${resolvedAccountId}:apis/${appsyncApiId}/types/Mutation/fields/createChatSession`,
    `arn:aws:appsync:${appsyncRegion}:${resolvedAccountId}:apis/${appsyncApiId}/types/Mutation/fields/invokeAgent`,
  ],
}] : [];

const agentInvokePolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [...appsyncStatements],
});

aws(`iam put-role-policy --role-name ${roleName} --policy-name AgentInvoke --policy-document '${agentInvokePolicy}'`);
console.log('  ✓ AgentInvoke inline policy (AppSync field-level ARNs)');

// ─── Read --app-url flag ──────────────────────────────────────────────────────

const appUrlFlagIdx = process.argv.indexOf('--app-url');
const appUrl: string = appUrlFlagIdx !== -1 ? process.argv[appUrlFlagIdx + 1] : '';

// ─── Set Actions secrets and variables ────────────────────────────────────────

console.log('\nSetting GitHub Actions config…');
gh('secret', 'set', 'AWS_AGENT_ROLE_ARN', '--repo', selectedRepo, '--body', roleArn);
console.log(`  ✓ AWS_AGENT_ROLE_ARN (secret) = ${roleArn}`);

if (appsyncEndpoint) {
  gh('variable', 'set', 'APPSYNC_ENDPOINT', '--repo', selectedRepo, '--body', appsyncEndpoint);
  console.log(`  ✓ APPSYNC_ENDPOINT (variable) = ${appsyncEndpoint}`);
}
if (appUrl) {
  gh('variable', 'set', 'APP_URL', '--repo', selectedRepo, '--body', appUrl);
  console.log(`  ✓ APP_URL (variable) = ${appUrl}`);
}

// ─── Build workflow content ───────────────────────────────────────────────────

const workflowContent = readFileSync(
  resolve(root, '.github/workflows/agent-mention.yml'),
  'utf8',
);

// ─── Detect if the selected repo is this local repo ──────────────────────────

let currentRepoName = '';
try {
  currentRepoName = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' })
    .trim()
    .replace(/.*github\.com[:/]/, '')
    .replace(/\.git$/, '');
} catch { /* no remote set */ }

const isThisRepo = currentRepoName === selectedRepo;

// ─── Commit workflow file ─────────────────────────────────────────────────────

console.log('\nPushing workflow to repo…');

if (isThisRepo) {
  const workflowDir = resolve(root, '.github/workflows');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(resolve(workflowDir, 'agent-mention.yml'), workflowContent);
  console.log('  ✓ .github/workflows/agent-mention.yml (written locally)');
  console.log('\n  Commit and push to activate:');
  console.log('    git add .github/workflows/agent-mention.yml');
  console.log('    git commit -m "Add GitHub @mention agent workflow"');
  console.log('    git push');
} else {
  pushFileToRepo(
    selectedRepo,
    '.github/workflows/agent-mention.yml',
    workflowContent,
    'Add GitHub @mention agent workflow',
  );
  console.log('  ✓ .github/workflows/agent-mention.yml');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`
${'─'.repeat(72)}
Setup complete for ${selectedRepo}

  IAM role:          ${roleName}
  Role ARN:          ${roleArn}
  AWS account:       ${resolvedAccountId}
  AWS region:        ${awsRegion}
${appsyncEndpoint ? `  AppSync endpoint:  ${appsyncEndpoint}\n` : ''
}The workflow is active. Comment @agent <prompt> on any issue
in ${selectedRepo} to invoke an agent.
${'─'.repeat(72)}
`);
