import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/invoke-agent';
import { randomUUID } from 'crypto';
import {
  BedrockAgentCoreClient,
  InvokeHarnessCommand,
  HarnessToolType,
  type HarnessTool,
} from '@aws-sdk/client-bedrock-agentcore';
import type { Schema } from '../../data/resource';

const HARNESS_ARN = process.env.HARNESS_ARN!;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

const agentCoreClient = new BedrockAgentCoreClient({ region: REGION });

interface InvokeAgentEvent {
  agentSlug: string;
  prompt: string;
  sessionId?: string;
}

interface InvokeAgentResult {
  response: string;
  sessionId: string;
}

function headersFromArray(
  headers: Array<{ key: string | null; value: string | null }> | null | undefined,
): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  for (const h of headers) {
    if (h.key && h.value) result[h.key] = h.value;
  }
  return result;
}

async function fetchAgentConfig(agentSlug: string) {
  const [agentsRes, joinRes, serversRes] = await Promise.all([
    client.models.Agent.list({ filter: { slug: { eq: agentSlug }, enabled: { eq: true } } }),
    client.models.AgentMcpServer.list(),
    client.models.McpServer.list({ filter: { enabled: { eq: true } } }),
  ]);

  const agent = agentsRes.data?.[0];
  if (!agent) return null;

  const serverById = Object.fromEntries((serversRes.data ?? []).map((s) => [s.id, s]));
  const mcpServers = (joinRes.data ?? [])
    .filter((j) => j.agentId === agent.id)
    .map((j) => serverById[j.mcpServerId])
    .filter(Boolean);

  return {
    systemPromptText: agent.systemPromptText ?? null,
    modelId: agent.modelId ?? null,
    mcpServers,
  };
}

export const handler = async (event: InvokeAgentEvent): Promise<InvokeAgentResult> => {
  const { agentSlug, prompt, sessionId: inputSessionId } = event;
  const sessionId = inputSessionId ?? randomUUID();

  const agentConfig = await fetchAgentConfig(agentSlug);
  if (!agentConfig) {
    return {
      response: `No enabled agent found with slug "${agentSlug}".`,
      sessionId,
    };
  }

  const tools: HarnessTool[] = (agentConfig.mcpServers ?? []).map((s) => ({
    type: HarnessToolType.REMOTE_MCP,
    name: s.name,
    config: {
      remoteMcp: {
        url: s.url,
        headers: s.headers?.length
          ? headersFromArray(s.headers.filter((h): h is { key: string | null; value: string | null } => h !== null))
          : undefined,
      },
    },
  }));

  const result = await agentCoreClient.send(
    new InvokeHarnessCommand({
      harnessArn: HARNESS_ARN,
      runtimeSessionId: sessionId,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      ...(agentConfig.systemPromptText ? { systemPrompt: [{ text: agentConfig.systemPromptText }] } : {}),
      ...(agentConfig.modelId ? { model: { bedrockModelConfig: { modelId: agentConfig.modelId } } } : {}),
      ...(tools.length ? { tools } : {}),
    }),
  );

  const chunks: string[] = [];
  for await (const event of result.stream ?? []) {
    if ('contentBlockDelta' in event && event.contentBlockDelta?.delta?.text) {
      chunks.push(event.contentBlockDelta.delta.text);
    }
  }

  return { response: chunks.join(''), sessionId };
};
