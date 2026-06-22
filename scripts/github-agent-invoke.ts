#!/usr/bin/env tsx
/**
 * Called by .github/workflows/agent-mention.yml to handle @mention events.
 *
 * 1. Reads the GitHub event from GITHUB_EVENT_PATH
 * 2. Parses the first @mention to find the agent slug
 * 3. Invokes the invoke-agent Lambda (IAM credentials from OIDC step)
 * 4. Posts the reply as a comment using GITHUB_TOKEN
 *
 * Required environment variables (all set automatically in GitHub Actions):
 *   GITHUB_EVENT_PATH        — path to the event JSON file
 *   GITHUB_TOKEN             — built-in token for posting comments
 *   INVOKE_AGENT_LAMBDA_ARN  — set as a GitHub Actions variable by setup-github-integration.ts
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 *                            — set by aws-actions/configure-aws-credentials
 *   AWS_REGION               — set by aws-actions/configure-aws-credentials
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
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
  assignee?: { login: string };
}

interface InvokeAgentResult {
  response: string;
  sessionId: string;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');

  const lambdaArn = process.env.INVOKE_AGENT_LAMBDA_ARN;
  if (!lambdaArn) throw new Error('INVOKE_AGENT_LAMBDA_ARN is not set');

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

  // The first @word is the agent slug
  const mentionMatch = rawText.match(/@([\w-]+)/);
  if (!mentionMatch) {
    console.log('No @mention found in text; skipping');
    return;
  }

  const agentSlug = mentionMatch[1];
  // Prompt is the text with the @mention stripped out; fall back to issue title
  const prompt = rawText.replace(`@${agentSlug}`, '').trim() || event.issue?.title || rawText;

  console.log(`Agent: "${agentSlug}"  Issue: #${issueNumber}`);
  console.log(`Prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

  // Invoke the Lambda — SigV4 credentials are picked up automatically from env
  const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const invokeResult = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: lambdaArn,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ agentSlug, prompt })),
    }),
  );

  if (invokeResult.FunctionError) {
    const errBody = invokeResult.Payload
      ? Buffer.from(invokeResult.Payload).toString('utf8')
      : '(no payload)';
    throw new Error(`Lambda function error: ${errBody}`);
  }

  if (!invokeResult.Payload) throw new Error('Lambda returned no payload');

  const result: InvokeAgentResult = JSON.parse(
    Buffer.from(invokeResult.Payload).toString('utf8'),
  );
  console.log(`Agent responded (${result.response.length} chars)`);

  // Post the reply as a comment
  const octokit = new Octokit({ auth: githubToken });
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: result.response,
  });

  console.log('Reply posted');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
