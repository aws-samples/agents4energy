#!/usr/bin/env tsx
// Fetches the e2e config (deployed app URL + Cognito pool info) published to
// SSM by scripts/extract-deployment-info.js, and writes it to web/e2e-config.json.
//
// This lets Playwright run against an already-deployed branch (CloudFront + S3)
// without a local build or `ampx sandbox` deploy — just a fresh checkout plus
// AWS credentials with ssm:GetParameter on /outputs/*.
//
// Usage:
//   npx tsx scripts/fetch-e2e-config.ts [branch]   # branch defaults to current git branch
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'web/e2e-config.json');

// Must match the BRANCH_SLUG convention in scripts/build.sh exactly (slashes to
// dashes, lowercase, truncate to 14 chars — the ampx --identifier limit is 15),
// since that's the slug `pnpm deploy` published the SSM parameter under.
function slugBranch(value: string): string {
  return value.replace(/\//g, '-').toLowerCase().slice(0, 14);
}
function slugRepo(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-/]+/g, '-');
}

const branchArg = process.argv[2];
const branch = slugBranch(
  branchArg ?? process.env.DEPLOY_BRANCH ?? execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(),
);

const repoSlug = slugRepo(
  process.env.GITHUB_REPOSITORY ??
    (() => {
      const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
      const match = remote.match(/[/:]([^/]+\/[^/]+?)(\.git)?$/);
      if (!match) throw new Error(`Could not parse repo slug from remote URL: ${remote}`);
      return match[1];
    })(),
);

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const ssmPath = `/outputs/${repoSlug}/${branch}/e2e-config`;

console.log(`Fetching e2e config from SSM: ${ssmPath} (region ${region})`);

const ssm = new SSMClient({ region });
const result = await ssm.send(new GetParameterCommand({ Name: ssmPath }));
const value = result.Parameter?.Value;
if (!value) {
  console.error(`No e2e config found at ${ssmPath}. Deploy branch "${branch}" first (pnpm deploy).`);
  process.exit(1);
}

writeFileSync(outputPath, JSON.stringify(JSON.parse(value), null, 2) + '\n');
console.log(`Wrote ${outputPath}`);
