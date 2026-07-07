#!/usr/bin/env tsx
/**
 * Called by .github/workflows/agent-mention.yml to handle @agent-<slug> mention events.
 *
 * 1. Reads the GitHub event from GITHUB_EVENT_PATH
 * 2. Finds the first @agent-<slug> mention in the comment body
 * 3. SigV4-signs a createChatSession mutation against AppSync (IAM auth)
 * 4. Posts a comment with a live-chat link so the user can watch the agent work
 * 5. SigV4-signs a POST to the AgentCore runtime /invocations endpoint (sync mode),
 *    passing the session ID so AG-UI events flow to the chat session
 * 6. Posts the agent's final reply as a comment using GITHUB_TOKEN
 *
 * Required environment variables (set by setup-github-integration.ts):
 *   GITHUB_EVENT_PATH           — path to the event JSON file (built-in Actions env)
 *   GITHUB_TOKEN                — built-in token for posting comments
 *   INVOKE_AGENT_RUNTIME_ARN    — ARN of the AgUiHandler AgentCore runtime
 *   APPSYNC_ENDPOINT            — AppSync GraphQL endpoint URL
 *   APP_URL                     — Base URL of the deployed web app (optional)
 *   AWS_REGION                  — AWS region (default us-east-1)
 *   AWS_ACCESS_KEY_ID           — IAM credentials
 *   AWS_SECRET_ACCESS_KEY       — IAM credentials
 *   GITHUB_BASE_REF             — default branch of the repo (e.g. "main")
 */

import { Octokit } from '@octokit/rest';
import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';

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

interface RuntimeResponse {
  sessionId: string;
  response?: string;
  error?: string;
}

// ─── SigV4 helper ─────────────────────────────────────────────────────────────

function makeSigner(service: string, region: string, credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }) {
  return new SignatureV4({
    service,
    region,
    credentials,
    sha256: Sha256,
  });
}

async function sigV4Post(
  url: string,
  service: string,
  region: string,
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signer = makeSigner(service, region, credentials);
  const parsed = new URL(url);
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => { query[k] = v; });

  const signed = await signer.sign({
    method: 'POST',
    hostname: parsed.hostname,
    path: parsed.pathname,
    query,
    protocol: 'https:',
    headers: {
      host: parsed.hostname,
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body,
  });

  const { host: _host, ...signingHeaders } = signed.headers as Record<string, string>;

  return fetch(url, { method: 'POST', headers: signingHeaders, body });
}

// ─── AppSync: createChatSession via IAM auth ───────────────────────────────────

async function createChatSession(
  appsyncEndpoint: string,
  region: string,
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
  name: string,
): Promise<string> {
  const body = JSON.stringify({
    query: `mutation CreateChatSession($input: CreateChatSessionInput!) {
      createChatSession(input: $input) { id }
    }`,
    variables: { input: { name } },
  });

  const res = await sigV4Post(appsyncEndpoint, 'appsync', region, credentials, body);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AppSync createChatSession HTTP ${res.status}: ${text}`);
  }
  const json = await res.json() as { data?: { createChatSession?: { id: string } }; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`AppSync createChatSession errors: ${JSON.stringify(json.errors)}`);
  const id = json.data?.createChatSession?.id;
  if (!id) throw new Error('createChatSession returned no id');
  return id;
}

// ─── AgentCore runtime invocation via SigV4 ───────────────────────────────────

async function invokeRuntime(
  runtimeArn: string,
  region: string,
  payload: unknown,
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
): Promise<RuntimeResponse> {
  const encodedArn = encodeURIComponent(runtimeArn);
  const url = `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;
  const body = JSON.stringify(payload);

  const res = await sigV4Post(url, 'bedrock-agentcore', region, credentials, body);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Runtime HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<RuntimeResponse>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');

  const runtimeArn = process.env.INVOKE_AGENT_RUNTIME_ARN;
  if (!runtimeArn) throw new Error('INVOKE_AGENT_RUNTIME_ARN is not set');

  const appsyncEndpoint = process.env.APPSYNC_ENDPOINT ?? '';
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');

  const awsRegion = process.env.AWS_REGION ?? 'us-east-1';
  const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const awsSessionToken = process.env.AWS_SESSION_TOKEN;
  if (!awsAccessKeyId || !awsSecretAccessKey) throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set');

  const credentials = { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey, sessionToken: awsSessionToken };

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

  const rawText = event.comment?.body ?? event.issue?.body ?? '';

  const mentionMatch = rawText.match(/@agent(?:-([\w-]+))?(?=\s|$)/);
  if (!mentionMatch) {
    console.log('No @agent mention found; skipping');
    return;
  }

  const agentSlug = mentionMatch[1] ?? 'default';
  const fullMention = mentionMatch[1] ? `@agent-${agentSlug}` : '@agent';
  const userPrompt = rawText.replace(fullMention, '').trim() || event.issue?.title || rawText;

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

  const octokit = new Octokit({ auth: githubToken });

  // Read the status comment ID written by the workflow's Acknowledge trigger step.
  const statusCommentIdFile = process.env.STATUS_COMMENT_ID_FILE ?? '/tmp/status_comment_id.txt';
  let statusCommentId: number | null = null;
  try {
    const raw = readFileSync(statusCommentIdFile, 'utf8').trim();
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) statusCommentId = parsed;
  } catch { /* file may not exist in local runs */ }

  // Create a ChatSession so AG-UI events are associated with a live-viewable session.
  let sessionId = randomUUID();
  if (appsyncEndpoint) {
    try {
      sessionId = await createChatSession(
        appsyncEndpoint,
        awsRegion,
        credentials,
        `GitHub #${issueNumber} — ${event.issue?.title ?? agentSlug}`,
      );
      console.log(`Chat session created: ${sessionId}`);

      // Update the status comment (or post a new one) with the live-chat link.
      const liveBody = appUrl
        ? `🤖 Agent is working… [Watch live](${appUrl}/chat-handler?sessionId=${sessionId})`
        : `🤖 Agent is working… (session \`${sessionId}\`)`;

      if (statusCommentId) {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: statusCommentId,
          body: liveBody,
        });
      } else {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: liveBody,
        });
      }
    } catch (err) {
      console.warn(`Could not create chat session: ${err}. Continuing with random session ID.`);
    }
  }

  const result = await invokeRuntime(
    runtimeArn,
    awsRegion,
    {
      sessionId,
      prompt,
      sync: true,
      githubToken,
      githubRepo: event.repository.full_name,
      githubBranch: defaultBranch,
    },
    credentials,
  );

  const response = result.response ?? result.error ?? '(no response)';
  console.log(`Agent responded (${response.length} chars)`);

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
