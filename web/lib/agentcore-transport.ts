import { fetchAuthSession } from 'aws-amplify/auth';
import type { UIMessage } from 'ai';
import deploymentInfo from '../deployment-info.json';

export const AGENT_RUNTIME_ARN = deploymentInfo.runtimes.Default.runtimeArn;

export function getAgentCoreUrl(arn: string): string {
  const region = arn.split(':')[3];
  const encodedArn = encodeURIComponent(arn);
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;
}

export async function getAccessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error('No access token — sign in first.');
  return token;
}

export function extractPrompt(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  return (
    lastUser?.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('') ?? ''
  );
}
