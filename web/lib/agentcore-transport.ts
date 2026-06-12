import { fetchAuthSession } from 'aws-amplify/auth';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import deploymentInfo from '../deployment-info.json';

const AGENT_RUNTIME_ARN = deploymentInfo.runtimes.Default.runtimeArn;

function getAgentCoreUrl(arn: string): string {
  const region = arn.split(':')[3];
  const encodedArn = encodeURIComponent(arn);
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;
}

async function getAccessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error('No access token — sign in first.');
  return token;
}

function extractPrompt(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  return (
    lastUser?.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('') ?? ''
  );
}

export class AgentCoreTransport extends DefaultChatTransport<UIMessage> {
  constructor() {
    super({
      api: getAgentCoreUrl(AGENT_RUNTIME_ARN),
      async prepareSendMessagesRequest({ messages }) {
        const token = await getAccessToken();
        return {
          body: { prompt: extractPrompt(messages) },
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
        };
      },
    });
  }
}
