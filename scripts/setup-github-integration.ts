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
 *   2. Reads AppSync endpoint from deployment outputs; fetches the API key via AWS CLI
 *   3. Sets APPSYNC_ENDPOINT and APPSYNC_API_KEY as Actions secrets on the target repo
 *   4. Pushes .github/workflows/agent-mention.yml and scripts/github-agent-invoke.ts
 *      as a commit into the target repo (local files for this repo, GitHub API for external repos)
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

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function gh(...args: string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function ghJson<T = unknown>(...args: string[]): T {
  return JSON.parse(gh(...args));
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

const appSyncEndpoint: string | undefined = amplifyOutputs.data?.url;
if (!appSyncEndpoint) {
  console.error('Error: AppSync endpoint (data.url) not found in amplify_outputs.json.');
  process.exit(1);
}

const awsRegion: string = amplifyOutputs.data?.aws_region ?? 'us-east-1';

// Resolve the real AppSync apiId by matching the endpoint URL across all APIs.
// (The DNS prefix in the URL is NOT the apiId.)
console.log('Fetching AppSync API key…');
let appSyncApiKey: string;
try {
  const apisJson = run(`aws appsync list-graphql-apis --region ${awsRegion}`);
  const apis: Array<{ apiId: string; uris?: Record<string, string> }> = JSON.parse(apisJson).graphqlApis ?? [];
  const match = apis.find(api =>
    Object.values(api.uris ?? {}).some(u => u.includes(appSyncEndpoint.split('/graphql')[0])),
  );
  if (!match) throw new Error(`No AppSync API found with endpoint ${appSyncEndpoint}`);

  const keysJson = run(`aws appsync list-api-keys --api-id ${match.apiId} --region ${awsRegion}`);
  const keys: Array<{ id: string; expires: number }> = JSON.parse(keysJson).apiKeys ?? [];
  if (keys.length === 0) throw new Error('No API keys found — the API key authorization mode may not be enabled yet. Re-deploy the Amplify backend.');
  const key = keys.sort((a, b) => b.expires - a.expires)[0];
  appSyncApiKey = key.id;
  console.log(`  ✓ API key: ${appSyncApiKey} (expires ${new Date(key.expires * 1000).toLocaleDateString()})`);
} catch (err) {
  console.error(`Error fetching API key: ${err}`);
  console.error('Make sure your AWS CLI is configured for the deployment account.');
  process.exit(1);
}

// ─── Check gh CLI ─────────────────────────────────────────────────────────────

checkGhAuth();

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

  console.log('\nFetching your GitHub repositories…\n');
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

// ─── Set Actions variables and secrets ────────────────────────────────────────

console.log('Setting GitHub Actions config…');
gh('variable', 'set', 'APPSYNC_ENDPOINT', '--repo', selectedRepo, '--body', appSyncEndpoint);
console.log(`  ✓ APPSYNC_ENDPOINT (variable) = ${appSyncEndpoint}`);
// API key is a secret — GitHub will mask it in logs
gh('secret', 'set', 'APPSYNC_API_KEY', '--repo', selectedRepo, '--body', appSyncApiKey);
console.log(`  ✓ APPSYNC_API_KEY  (secret)   = ${appSyncApiKey}`);

// ─── Detect if the selected repo is this local repo ──────────────────────────

let currentRepoName = '';
try {
  currentRepoName = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' })
    .trim()
    .replace(/.*github\.com[:/]/, '')
    .replace(/\.git$/, '');
} catch { /* no remote set */ }

const isThisRepo = currentRepoName === selectedRepo;

// ─── Build files to commit ────────────────────────────────────────────────────

const invokeScriptContent = readFileSync(resolve(root, 'scripts/github-agent-invoke.ts'), 'utf8');

const workflowContent = `# Auto-generated by scripts/setup-github-integration.ts
name: Agent @mention handler

on:
  issue_comment:
    types: [created]
  issues:
    types: [assigned]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  invoke-agent:
    runs-on: ubuntu-latest
    # Only run when a comment contains @agent-<slug> and was not written by a bot
    if: |
      github.event.sender.type != 'Bot' && (
        github.event_name == 'issues' ||
        contains(github.event.comment.body, '@agent-')
      )

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install script dependencies
        run: npm install --no-save tsx @octokit/rest @aws-sdk/client-lambda

      - name: Invoke agent and post reply
        env:
          INVOKE_AGENT_LAMBDA_ARN: \${{ vars.INVOKE_AGENT_LAMBDA_ARN }}
          AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: ${awsRegion}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_BASE_REF: \${{ github.event.repository.default_branch }}
        run: npx tsx scripts/github-agent-invoke.ts
`;

// ─── Commit files ─────────────────────────────────────────────────────────────

console.log('\nPushing files to repo…');

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
    'scripts/github-agent-invoke.ts',
    invokeScriptContent,
    'Add GitHub @mention agent invoke script',
  );
  console.log('  ✓ scripts/github-agent-invoke.ts');

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

  AppSync endpoint:  ${appSyncEndpoint}
  AWS region:        ${awsRegion}

The workflow is active. Comment @agent-<slug> <prompt> on any issue
in ${selectedRepo} to invoke an agent.
${'─'.repeat(72)}
`);
