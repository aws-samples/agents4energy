#!/usr/bin/env tsx
/**
 * Called by .github/workflows/agent-mention.yml to handle @agent-<slug> mention events.
 *
 * 1. Reads the GitHub event from GITHUB_EVENT_PATH
 * 2. Finds the first @agent-<slug> mention in the comment body
 * 3. Invokes the agent Lambda directly (bypasses the 30s AppSync resolver timeout)
 * 4. Posts the agent's reply as a comment using GITHUB_TOKEN
 *
 * Required environment variables (set by setup-github-integration.ts):
 *   GITHUB_EVENT_PATH      — path to the event JSON file (built-in Actions env)
 *   GITHUB_TOKEN           — built-in token for posting comments
 *   INVOKE_AGENT_LAMBDA_ARN — ARN of the invoke-agent Lambda function
 *   AWS_REGION             — AWS region (default us-east-1)
 *   AWS_ACCESS_KEY_ID      — IAM credentials for Lambda invocation
 *   AWS_SECRET_ACCESS_KEY  — IAM credentials for Lambda invocation
 *   GITHUB_BASE_REF        — default branch of the repo (e.g. "main")
 */

import { Octokit } from '@octokit/rest';
import { readFileSync } from 'fs';

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  user: { login: string; type: string };
  pull_request?: unknown;
}

interface GitHubEvent {
  action: string;
  issue?: GitHubIssue;
  comment?: { id: number; body: string; user: { login: string; type: string } };
  sender: { login: string; type: string };
  repository: { full_name: string; owner: { login: string }; name: string };
}

// ─── Lambda invocation via @aws-sdk/client-lambda ────────────────────────────

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

async function invokeLambda(
  lambdaArn: string,
  region: string,
  payload: unknown,
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
): Promise<unknown> {
  const client = new LambdaClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
    },
  });

  const res = await client.send(new InvokeCommand({
    FunctionName: lambdaArn,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));

  const result = JSON.parse(Buffer.from(res.Payload!).toString()) as {
    errorType?: string; errorMessage?: string; response?: string; sessionId?: string;
  };
  if (result.errorType) throw new Error(`Lambda error: ${result.errorMessage}`);
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');

  const lambdaArn = process.env.INVOKE_AGENT_LAMBDA_ARN;
  if (!lambdaArn) throw new Error('INVOKE_AGENT_LAMBDA_ARN is not set');

  const awsRegion = process.env.AWS_REGION ?? 'us-east-1';
  const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const awsSessionToken = process.env.AWS_SESSION_TOKEN;
  if (!awsAccessKeyId || !awsSecretAccessKey) throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set');

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error('GITHUB_TOKEN is not set');

  const event: GitHubEvent = JSON.parse(readFileSync(eventPath, 'utf8'));

  // Loop prevention: never respond to bots
  const senderLogin = event.sender?.login ?? '';
  const senderType = event.sender?.type ?? '';
  if (senderType === 'Bot' || senderLogin.endsWith('[bot]')) {
    console.log(`Skipping bot sender: ${senderLogin}`);
    return;
  }

  const [owner, repo] = event.repository.full_name.split('/');
  const issueNumber = event.issue?.number;
  if (!issueNumber) {
    console.log('No issue number in event; skipping');
    return;
  }

  // comment body for issue_comment events; issue body for issues.assigned
  const rawText = event.comment?.body ?? event.issue?.body ?? '';

  // Match @agent-<slug> — the trigger pattern
  const mentionMatch = rawText.match(/@agent-([\w-]+)/);
  if (!mentionMatch) {
    console.log('No @agent-<slug> mention found; skipping');
    return;
  }

  const agentSlug = mentionMatch[1];
  const userPrompt = rawText.replace(`@agent-${agentSlug}`, '').trim() || event.issue?.title || rawText;

  // Inject structured context so the agent knows the repo, issue, and default branch.
  // The agent can use GitHub MCP tools (create_branch, create_or_update_file, create_pull_request, etc.)
  const defaultBranch = process.env.GITHUB_BASE_REF || 'main';
  const prompt = `\
You are acting on behalf of a GitHub user in the repository ${event.repository.full_name}.

CONTEXT:
- Repository: ${event.repository.full_name}
- Default branch: ${defaultBranch}
- Issue #${issueNumber}: ${event.issue?.title ?? '(no title)'}
- Issue body: ${(event.issue?.body ?? '').slice(0, 500)}
- Triggered by: @${event.sender.login}

USER REQUEST:
${userPrompt}

If your response involves code changes, create a new branch off ${defaultBranch}, commit the changes, and open a pull request. Reference issue #${issueNumber} in the PR description.`;

  console.log(`Agent: "${agentSlug}"  Issue: #${issueNumber}`);
  console.log(`Prompt: ${userPrompt.slice(0, 120)}${userPrompt.length > 120 ? '…' : ''}`);

  const result = await invokeLambda(
    lambdaArn,
    awsRegion,
    { arguments: { agentSlug, prompt } },
    { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey, sessionToken: awsSessionToken },
  ) as { response: string; sessionId: string };

  const response = result.response;
  console.log(`Agent responded (${response.length} chars)`);

  const octokit = new Octokit({ auth: githubToken });
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: response,
  });

  console.log('Reply posted');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
