import { randomUUID } from 'crypto';
import {
  DynamoDBClient,
  ScanCommand,
  QueryCommand,
  BatchGetItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  SSMClient,
  GetParameterCommand,
} from '@aws-sdk/client-ssm';

const HARNESS_ARN = process.env.HARNESS_ARN!;
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const AGENT_TABLE = process.env.AGENT_TABLE!;
const MCP_SERVER_TABLE = process.env.MCP_SERVER_TABLE!;
const AGENT_MCP_SERVER_TABLE = process.env.AGENT_MCP_SERVER_TABLE!;
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID!;
const SERVICE_ACCOUNT_USERNAME = process.env.SERVICE_ACCOUNT_USERNAME!;
const SERVICE_ACCOUNT_SSM_PATH = process.env.SERVICE_ACCOUNT_SSM_PATH!;

// Suppress unused variable — COGNITO_USER_POOL_ID is wired via env but not used in code
void COGNITO_USER_POOL_ID;

const ddb = new DynamoDBClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });
const ssm = new SSMClient({ region: REGION });

// Cache the access token across warm invocations (~1 hour lifetime)
let cachedAccessToken: string | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;

  const passwordParam = await ssm.send(new GetParameterCommand({
    Name: SERVICE_ACCOUNT_SSM_PATH,
    WithDecryption: true,
  }));
  const password = passwordParam.Parameter?.Value;
  if (!password) throw new Error('Service account password not found in SSM');

  const authRes = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME: SERVICE_ACCOUNT_USERNAME,
      PASSWORD: password,
    },
  }));

  const token = authRes.AuthenticationResult?.AccessToken;
  if (!token) throw new Error('Failed to obtain Cognito access token for service account');

  cachedAccessToken = token;
  return token;
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

interface McpServerRecord {
  name: string;
  url: string;
  enabled?: boolean;
  headers?: Array<{ key: string | null; value: string | null } | null>;
}

function headersFromArray(
  headers: Array<{ key: string | null; value: string | null }> | null | undefined,
): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  for (const h of headers) {
    if (h?.key && h?.value) result[h.key] = h.value;
  }
  return result;
}

async function fetchAgentConfig(agentSlug: string) {
  const agentScan = await ddb.send(new ScanCommand({
    TableName: AGENT_TABLE,
    FilterExpression: '#slug = :slug AND #enabled = :enabled',
    ExpressionAttributeNames: { '#slug': 'slug', '#enabled': 'enabled' },
    ExpressionAttributeValues: { ':slug': { S: agentSlug }, ':enabled': { BOOL: true } },
  }));

  const agent = agentScan.Items?.[0] ? unmarshall(agentScan.Items[0]) : null;
  if (!agent) return null;

  const joinQuery = await ddb.send(new QueryCommand({
    TableName: AGENT_MCP_SERVER_TABLE,
    IndexName: 'gsi-Agent.mcpServers',
    KeyConditionExpression: 'agentId = :agentId',
    ExpressionAttributeValues: { ':agentId': { S: agent.id as string } },
  }));

  const mcpServerIds = (joinQuery.Items ?? [])
    .map((item: Record<string, AttributeValue>) => (unmarshall(item).mcpServerId as string))
    .filter(Boolean);

  let mcpServers: McpServerRecord[] = [];
  if (mcpServerIds.length > 0) {
    const keys = mcpServerIds.map((id: string) => ({ id: { S: id } }));
    const batchRes = await ddb.send(new BatchGetItemCommand({
      RequestItems: { [MCP_SERVER_TABLE]: { Keys: keys } },
    }));
    mcpServers = (batchRes.Responses?.[MCP_SERVER_TABLE] ?? [])
      .map((item: Record<string, AttributeValue>) => unmarshall(item) as McpServerRecord)
      .filter((s) => s.enabled !== false);
  }

  return {
    systemPromptText: (agent.systemPromptText as string) ?? null,
    modelId: (agent.modelId as string) ?? null,
    mcpServers,
  };
}

function buildTools(mcpServers: McpServerRecord[]) {
  return mcpServers.map((s) => ({
    type: 'remote_mcp' as const,
    name: s.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
    config: {
      remoteMcp: {
        url: s.url,
        headers: s.headers?.length
          ? headersFromArray(s.headers.filter((h): h is { key: string | null; value: string | null } => h !== null))
          : undefined,
      },
    },
  }));
}

async function invokeHarness(opts: {
  sessionId: string;
  prompt: string;
  systemPromptText: string | null;
  modelId: string | null;
  mcpServers: McpServerRecord[];
}): Promise<string> {
  const { sessionId, prompt, systemPromptText, modelId, mcpServers } = opts;

  const accessToken = await getAccessToken();

  const region = HARNESS_ARN.split(':')[3];
  const encodedArn = encodeURIComponent(HARNESS_ARN);
  const url = `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke?harnessArn=${encodedArn}`;

  const tools = buildTools(mcpServers);
  const body: Record<string, unknown> = {
    runtimeSessionId: sessionId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
  };
  if (systemPromptText) body.systemPrompt = [{ text: systemPromptText }];
  if (modelId) body.model = { bedrockModelConfig: { modelId } };
  if (tools.length) body.tools = tools;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    // Reset token cache on auth errors
    if (response.status === 401 || response.status === 403) cachedAccessToken = null;
    throw new Error(`Harness HTTP ${response.status}: ${text}`);
  }

  // Decode AWS binary event stream — same logic as scripts/invoke.ts
  const chunks: string[] = [];
  let raw = Buffer.alloc(0);

  for await (const chunk of response.body as unknown as AsyncIterable<Buffer>) {
    raw = Buffer.concat([raw, chunk]);

    while (raw.length >= 12) {
      const totalLen = raw.readUInt32BE(0);
      if (raw.length < totalLen) break;

      const headersLen = raw.readUInt32BE(4);
      let pos = 12;
      const headersEnd = pos + headersLen;
      const headers: Record<string, string> = {};

      while (pos < headersEnd) {
        const nameLen = raw[pos++];
        const name = raw.subarray(pos, pos + nameLen).toString('utf8');
        pos += nameLen;
        pos++; // value type byte
        const valLen = raw.readUInt16BE(pos); pos += 2;
        headers[name] = raw.subarray(pos, pos + valLen).toString('utf8');
        pos += valLen;
      }

      const payloadBytes = raw.subarray(12 + headersLen, totalLen - 4);
      let payload: Record<string, unknown> | null = null;
      try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { /* empty frame */ }

      if (headers[':event-type'] === 'contentBlockDelta') {
        const text = (payload?.delta as Record<string, unknown> | undefined)?.text as string | undefined;
        if (text) chunks.push(text);
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

  const response = await invokeHarness({
    sessionId,
    prompt,
    systemPromptText: agentConfig.systemPromptText,
    modelId: agentConfig.modelId,
    mcpServers: agentConfig.mcpServers,
  });

  return { response, sessionId };
};
