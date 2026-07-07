import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore';

const client = new BedrockAgentCoreClient({ region: 'us-east-1' });

const harnessArn = 'arn:aws:bedrock-agentcore:us-east-1:796988593450:runtime/harness_default_MyHarness-dn3jQqGXDH';

try {
  const resp = await (client as any).send(new InvokeHarnessCommand({
    harnessArn,
    runtimeSessionId: 'test-session-123',
    messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
  } as any));
  console.log('Success, status:', resp?.$metadata?.httpStatusCode);
} catch (err: any) {
  console.error('Error message:', err.message);
  console.error('Error code:', err.$metadata?.httpStatusCode);
  console.error('Full error:', JSON.stringify({ name: err.name, code: err.Code, ...err.$metadata }, null, 2));
}
