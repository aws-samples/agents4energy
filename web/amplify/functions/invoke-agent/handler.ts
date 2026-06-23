import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/invoke-agent';
import { randomUUID } from 'crypto';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { HarnessToolType, type HarnessTool } from '@aws-sdk/client-bedrock-agentcore';
import type { Schema } from '../../data/resource';

const HARNESS_ARN = process.env.HARNESS_ARN!;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID!;
const SERVICE_ACCOUNT_EMAIL = process.env.SERVICE_ACCOUNT_EMAIL!;
const SERVICE_ACCOUNT_PASSWORD_PARAM = process.env.SERVICE_ACCOUNT_PASSWORD_PARAM!;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });
const ssmClient = new SSMClient({ region: REGION });

// Cache the access token — it's valid for 1 hour; Lambda execution model means
// it's safe to reuse across warm invocations within the token lifetime.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getServiceAccountToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  // Fetch password from SSM (cached in the Lambda execution environment)
  const paramResult = await ssmClient.send(
    new GetParameterCommand({
      Name: SERVICE_ACCOUNT_PASSWORD_PARAM,
      WithDecryption: true,
    }),
  );
  const password = paramResult.Parameter?.Value;
  if (!password) throw new Error('Service account password not found in SSM');

  const authResult = await cognitoClient.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: SERVICE_ACCOUNT_EMAIL,
        PASSWORD: password,
      },
    }),
  );

  const accessToken = authResult.AuthenticationResult?.AccessToken;
  if (!accessToken) throw new Error('Failed to obtain Cognito access token for service account');

  // Cognito access tokens expire in 1 hour (3600s)
  cachedToken = { value: accessToken, expiresAt: now + 3600_000 };
  return accessToken;
}

interface InvokeAgentArgs {
  agentSlug: string;
  prompt: string;
  sessionId?: string;
}

interface InvokeAgentEvent {
  arguments: InvokeAgentArgs;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHarnessTools(mcpServers: any[]): HarnessTool[] {
  return (mcpServers ?? []).map((s) => ({
    type: HarnessToolType.REMOTE_MCP,
    name: s.name,
    config: {
      remoteMcp: {
        url: s.url,
        headers: s.headers?.length
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? headersFromArray(s.headers.filter((h: any): h is { key: string | null; value: string | null } => h !== null))
          : undefined,
      },
    },
  }));
}

async function invokeHarnessHttp(opts: {
  sessionId: string;
  prompt: string;
  systemPromptText: string | null;
  modelId: string | null;
  tools: HarnessTool[];
  bearerToken: string;
}): Promise<string> {
  const { sessionId, prompt, systemPromptText, modelId, tools, bearerToken } = opts;
  const encodedArn = encodeURIComponent(HARNESS_ARN);
  const url = `https://bedrock-agentcore.${REGION}.amazonaws.com/harnesses/invoke?harnessArn=${encodedArn}`;

  const body: Record<string, unknown> = {
    runtimeSessionId: sessionId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
  };
  if (systemPromptText) body.systemPrompt = [{ text: systemPromptText }];
  if (modelId) body.model = { bedrockModelConfig: { modelId } };
  if (tools.length) {
    body.tools = tools.map((t) => ({ type: t.type, name: t.name, config: t.config }));
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Harness HTTP ${response.status}: ${text}`);
  }

  function u32(buf: Buffer, offset: number): number { return buf.readUInt32BE(offset); }
  function u16(buf: Buffer, offset: number): number { return buf.readUInt16BE(offset); }

  const chunks: string[] = [];
  let raw = Buffer.alloc(0);

  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    raw = Buffer.concat([raw, Buffer.from(chunk)]);

    while (raw.length >= 12) {
      const totalLen = u32(raw, 0);
      if (raw.length < totalLen) break;

      const headersLen = u32(raw, 4);
      let pos = 12;
      const headersEnd = pos + headersLen;
      const headers: Record<string, string> = {};

      while (pos < headersEnd) {
        const nameLen = raw[pos++];
        const name = raw.subarray(pos, pos + nameLen).toString('utf8');
        pos += nameLen;
        pos++;
        const valLen = u16(raw, pos);
        pos += 2;
        headers[name] = raw.subarray(pos, pos + valLen).toString('utf8');
        pos += valLen;
      }

      const payloadBytes = raw.subarray(12 + headersLen, totalLen - 4);
      let payload: Record<string, unknown> | null = null;
      try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { /* empty */ }

      if (headers[':event-type'] === 'contentBlockDelta') {
        const delta = (payload?.delta as Record<string, string> | null)?.text;
        if (delta) chunks.push(delta);
      }

      raw = raw.subarray(totalLen);
    }
  }

  return chunks.join('');
}

export const handler = async (event: InvokeAgentEvent): Promise<InvokeAgentResult> => {
  const { agentSlug, prompt, sessionId: inputSessionId } = event.arguments;
  const sessionId = inputSessionId ?? randomUUID();

  const agentConfig = await fetchAgentConfig(agentSlug);
  if (!agentConfig) {
    return {
      response: `No enabled agent found with slug "${agentSlug}".`,
      sessionId,
    };
  }

  const tools = buildHarnessTools(agentConfig.mcpServers);
  const bearerToken = await getServiceAccountToken();

  const response = await invokeHarnessHttp({
    sessionId,
    prompt,
    systemPromptText: agentConfig.systemPromptText,
    modelId: agentConfig.modelId,
    tools,
    bearerToken,
  });

  return { response, sessionId };
};
