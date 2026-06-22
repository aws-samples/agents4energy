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
 *   2. Reads IAM role ARN + AppSync endpoint from local deployment outputs
 *   3. Sets APPSYNC_ENDPOINT and AWS_AGENT_ROLE_ARN as Actions variables
 *   4. Writes .github/workflows/agent-mention.yml into this repo,
 *      or prints the YAML to stdout for external repos
 *
 * Prerequisites:
 *   gh CLI authenticated (`gh auth login`)
 *   `pnpm deploy` completed (web/amplify_outputs.json must exist)
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function gh(...args: string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
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

// ─── Load deployment outputs ──────────────────────────────────────────────────

const amplifyOutputsPath = resolve(root, 'web/amplify_outputs.json');
if (!existsSync(amplifyOutputsPath)) {
  console.error('Error: web/amplify_outputs.json not found. Run `pnpm deploy` first.');
  process.exit(1);
}
const amplifyOutputs = JSON.parse(readFileSync(amplifyOutputsPath, 'utf8'));

const roleArn: string | undefined = amplifyOutputs.custom?.github_actions_agent_role_arn;
if (!roleArn) {
  console.error('Error: github_actions_agent_role_arn not found in amplify_outputs.json. Re-deploy the Amplify backend.');
  process.exit(1);
}

const appSyncEndpoint: string | undefined = amplifyOutputs.data?.url;
if (!appSyncEndpoint) {
  console.error('Error: AppSync endpoint (data.url) not found in amplify_outputs.json.');
  process.exit(1);
}

const awsRegion: string = amplifyOutputs.data?.aws_region ?? 'us-east-1';

const lambdaArn: string | undefined = amplifyOutputs.custom?.invoke_agent_lambda_arn;
if (!lambdaArn) {
  console.error('Error: invoke_agent_lambda_arn not found in amplify_outputs.json. Re-deploy the Amplify backend.');
  process.exit(1);
}

// ─── Check gh CLI ─────────────────────────────────────────────────────────────

checkGhAuth();

// ─── Pick a repository ────────────────────────────────────────────────────────

const repoFlagIdx = process.argv.indexOf('--repo');
let selectedRepo: string = repoFlagIdx !== -1 ? process.argv[repoFlagIdx + 1] : '';

// Normalise full URLs to owner/name
selectedRepo = selectedRepo
  .replace(/^https?:\/\/github\.com\//, '')
  .replace(/\.git$/, '');

const isTTY = process.stdin.isTTY ?? false;

if (!selectedRepo) {
  if (!isTTY) {
    console.error('Error: --repo <owner/name> is required in non-interactive mode.');
    process.exit(1);
  }

  console.log('\nFetching your GitHub repositories…\n');
  const reposJson = gh('repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate');
  const repos: Array<{ nameWithOwner: string; description: string; isPrivate: boolean }> = JSON.parse(reposJson);

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

// ─── Set Actions variables ────────────────────────────────────────────────────

console.log('Setting GitHub Actions variables…');
gh('variable', 'set', 'APPSYNC_ENDPOINT', '--repo', selectedRepo, '--body', appSyncEndpoint);
console.log(`  ✓ APPSYNC_ENDPOINT          = ${appSyncEndpoint}`);
gh('variable', 'set', 'AWS_AGENT_ROLE_ARN', '--repo', selectedRepo, '--body', roleArn);
console.log(`  ✓ AWS_AGENT_ROLE_ARN        = ${roleArn}`);
gh('variable', 'set', 'INVOKE_AGENT_LAMBDA_ARN', '--repo', selectedRepo, '--body', lambdaArn);
console.log(`  ✓ INVOKE_AGENT_LAMBDA_ARN   = ${lambdaArn}`);

// ─── Detect if the selected repo is this local repo ──────────────────────────

let currentRepoName = '';
try {
  currentRepoName = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' })
    .trim()
    .replace(/.*github\.com[:/]/, '')
    .replace(/\.git$/, '');
} catch { /* no remote set */ }

const isThisRepo = currentRepoName === selectedRepo;

// ─── Generate workflow YAML ───────────────────────────────────────────────────

// External repos download the invoke script at runtime; this repo uses the
// local checked-out copy so local edits are reflected immediately.
const invokeStep = isThisRepo
  ? `      - name: Install script dependencies
        run: npm install --no-save tsx @aws-sdk/client-lambda @octokit/rest

      - name: Invoke agent and post reply
        env:
          INVOKE_AGENT_LAMBDA_ARN: \${{ vars.INVOKE_AGENT_LAMBDA_ARN }}
          AWS_REGION: ${awsRegion}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: npx tsx scripts/github-agent-invoke.ts`
  : `      - name: Download invoke script + install deps
        run: |
          mkdir -p _agent_invoke
          curl -fsSL https://raw.githubusercontent.com/waltmayf/agentcore-cli-agent/main/scripts/github-agent-invoke.ts \\
            -o _agent_invoke/github-agent-invoke.ts
          npm install --no-save tsx @aws-sdk/client-lambda @octokit/rest

      - name: Invoke agent and post reply
        env:
          INVOKE_AGENT_LAMBDA_ARN: \${{ vars.INVOKE_AGENT_LAMBDA_ARN }}
          AWS_REGION: ${awsRegion}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: npx tsx _agent_invoke/github-agent-invoke.ts`;

const workflowContent = `# Auto-generated by scripts/setup-github-integration.ts
name: Agent @mention handler

on:
  issue_comment:
    types: [created]
  issues:
    types: [assigned]

permissions:
  id-token: write
  contents: read
  issues: write
  pull-requests: write

jobs:
  invoke-agent:
    runs-on: ubuntu-latest
    # Skip bot-generated comments to prevent reply loops
    if: \${{ github.event.sender.type != 'Bot' }}

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_AGENT_ROLE_ARN }}
          aws-region: ${awsRegion}

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

${invokeStep}
`;

if (isThisRepo) {
  const workflowDir = resolve(root, '.github/workflows');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(resolve(workflowDir, 'agent-mention.yml'), workflowContent);
  console.log('\n✓ Workflow written to .github/workflows/agent-mention.yml');
  console.log('\n  Commit and push to activate:');
  console.log('    git add .github/workflows/agent-mention.yml');
  console.log('    git commit -m "Add GitHub @mention agent workflow"');
  console.log('    git push');
} else {
  console.log('\nAdd this file to the repo at .github/workflows/agent-mention.yml:\n');
  console.log('─'.repeat(72));
  console.log(workflowContent);
  console.log('─'.repeat(72));
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`
${'─'.repeat(72)}
Setup complete for ${selectedRepo}

  IAM role ARN:           ${roleArn}
  invoke-agent Lambda:    ${lambdaArn}
  AppSync endpoint:       ${appSyncEndpoint}
  AWS region:             ${awsRegion}

Next step: add scripts/github-agent-invoke.ts and push the workflow YAML.
${'─'.repeat(72)}
`);
