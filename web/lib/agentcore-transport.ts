import { fetchAuthSession } from 'aws-amplify/auth';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { decodeEventStream } from './aws-event-stream';
import deploymentInfo from '../deployment-info.json';

export const HARNESS_ARN = (deploymentInfo as any).harnesses?.MyHarness?.harnessArn as string;
export const DEPLOYMENT_REGION = ((deploymentInfo as any).region as string) ?? 'us-east-1';

export async function getAccessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error('No access token — sign in first.');
  return token;
}

export interface McpServerConfig {
  name: string;
  url: string;
  // Extra headers to forward when calling this MCP server (e.g. Authorization: Bearer <token>).
  headers?: Record<string, string>;
}

export interface AgentConfig {
  agentId?: string | null;
  systemPromptText?: string | null;
  // Bedrock model ID, e.g. "anthropic.claude-sonnet-4-5". When set, overrides harness default.
  modelId?: string | null;
  // MCP servers injected as remote_mcp tools for this invocation.
  mcpServers?: McpServerConfig[];
}

export class HarnessChatTransport implements ChatTransport<UIMessage> {
  private getSessionId: () => string | null;
  private getAgentConfig: () => AgentConfig;

  constructor(opts: {
    getSessionId: () => string | null;
    getAgentConfig?: () => AgentConfig;
  }) {
    this.getSessionId = opts.getSessionId;
    this.getAgentConfig = opts.getAgentConfig ?? (() => ({}));
  }

  sendMessages({
    messages,
    abortSignal,
  }: {
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    trigger: string;
    chatId: string;
    messageId: string | undefined;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const getSessionId = this.getSessionId;
    const getAgentConfig = this.getAgentConfig;

    return Promise.resolve(
      new ReadableStream<UIMessageChunk>({
        async start(controller) {
          try {
            const token = await getAccessToken();
            const agentConfig = getAgentConfig();

            const harnessMessages = messages.flatMap((m) => {
              if (m.role !== 'user' && m.role !== 'assistant') return [];
              const text = m.parts
                .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                .map((p) => p.text)
                .join('');
              if (!text) return [];
              return [{ role: m.role, content: [{ text }] }];
            });

            const sessionId = getSessionId() ?? crypto.randomUUID();
            const encodedArn = encodeURIComponent(HARNESS_ARN);
            const url = `https://bedrock-agentcore.${DEPLOYMENT_REGION}.amazonaws.com/harnesses/invoke?harnessArn=${encodedArn}`;

            const invokeBody: Record<string, unknown> = {
              runtimeSessionId: sessionId,
              messages: harnessMessages,
            };

            // Use the InvokeHarness API's first-class override fields so the harness
            // handles system prompt and model selection properly (no message injection).
            if (agentConfig.systemPromptText) {
              invokeBody.systemPrompt = [{ text: agentConfig.systemPromptText }];
            }
            if (agentConfig.modelId) {
              invokeBody.model = { bedrock: { modelId: agentConfig.modelId } };
            }
            if (agentConfig.mcpServers?.length) {
              invokeBody.tools = agentConfig.mcpServers.map((s) => ({
                type: 'remote_mcp',
                name: s.name,
                config: {
                  remoteMcp: {
                    url: s.url,
                    ...(s.headers && Object.keys(s.headers).length ? { headers: s.headers } : {}),
                  },
                },
              }));
            }

            const response = await fetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(invokeBody),
              signal: abortSignal,
            });

            if (!response.ok) {
              const errText = await response.text();
              throw new Error(`AgentCore error ${response.status}: ${errText}`);
            }

            const textId = crypto.randomUUID();
            controller.enqueue({ type: 'text-start', id: textId });

            for await (const event of decodeEventStream(response.body!)) {
              if (abortSignal?.aborted) break;
              const eventType = event.headers[':event-type'];
              if (eventType === 'contentBlockDelta') {
                const delta = (event.payload as any)?.delta?.text as string | undefined;
                if (delta) controller.enqueue({ type: 'text-delta', id: textId, delta });
              }
            }

            controller.enqueue({ type: 'text-end', id: textId });
            controller.close();
          } catch (err: any) {
            if (err?.name === 'AbortError' || abortSignal?.aborted) {
              controller.close();
            } else {
              controller.enqueue({ type: 'error', errorText: err?.message ?? String(err) });
              controller.close();
            }
          }
        },
      }),
    );
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk>> {
    return Promise.reject(new Error('Reconnect not supported'));
  }
}
