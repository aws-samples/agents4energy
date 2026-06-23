#!/usr/bin/env tsx
/**
 * Called by .github/workflows/agent-mention.yml to handle @agent-<slug> mention events.
 *
 * 1. Reads the GitHub event from GITHUB_EVENT_PATH
 * 2. Finds the first @agent-<slug> mention in the comment body
 * 3. Calls the invokeAgent GraphQL mutation (AppSync API key auth)
 * 4. Posts the agent's reply as a comment using GITHUB_TOKEN
 *
 * Required environment variables (set by setup-github-integration.ts):
 *   GITHUB_EVENT_PATH   — path to the event JSON file (built-in Actions env)
 *   GITHUB_TOKEN        — built-in token for posting comments
 *   APPSYNC_ENDPOINT    — GraphQL endpoint URL
 *   APPSYNC_API_KEY     — API key with publicApiKey access to invokeAgent mutation
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

const INVOKE_AGENT_MUTATION = `
  mutation InvokeAgent($agentSlug: String!, $prompt: String!, $sessionId: String) {
    invokeAgent(agentSlug: $agentSlug, prompt: $prompt, sessionId: $sessionId) {
      response
      sessionId
    }
  }
`;

async function callGraphQL(
  endpoint: string,
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`AppSync HTTP ${res.status}: ${await res.text()}`);
  }

  const body = await res.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`AppSync errors: ${body.errors.map(e => e.message).join(', ')}`);
  }
  return body.data;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');

  const endpoint = process.env.APPSYNC_ENDPOINT;
  if (!endpoint) throw new Error('APPSYNC_ENDPOINT is not set');

  const apiKey = process.env.APPSYNC_API_KEY;
  if (!apiKey) throw new Error('APPSYNC_API_KEY is not set');

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
  const prompt = rawText.replace(`@agent-${agentSlug}`, '').trim() || event.issue?.title || rawText;

  console.log(`Agent: "${agentSlug}"  Issue: #${issueNumber}`);
  console.log(`Prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

  const data = await callGraphQL(endpoint, apiKey, INVOKE_AGENT_MUTATION, {
    agentSlug,
    prompt,
  }) as { invokeAgent: { response: string; sessionId: string } };

  const response = data.invokeAgent.response;
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
