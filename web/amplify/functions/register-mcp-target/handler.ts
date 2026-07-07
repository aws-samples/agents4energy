import {
  BedrockAgentCoreControlClient,
  CreateGatewayTargetCommand,
} from '@aws-sdk/client-bedrock-agentcore-control';

const GATEWAY_ID = process.env.GATEWAY_ID!;
const REGION = process.env.GATEWAY_REGION || process.env.AWS_REGION || 'us-east-1';

const client = new BedrockAgentCoreControlClient({ region: REGION });

interface RegisterMcpTargetArgs {
  name: string;
  url: string;
  description?: string | null;
}

interface RegisterMcpTargetResult {
  gatewayTargetId: string;
}

// Sanitize to gateway target naming rules: starts with alphanumeric, no consecutive hyphens.
function safeName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'mcp-target';
}

export const handler = async (
  event: { arguments: RegisterMcpTargetArgs },
): Promise<RegisterMcpTargetResult> => {
  const { name, url, description } = event.arguments;

  const result = await client.send(
    new CreateGatewayTargetCommand({
      gatewayIdentifier: GATEWAY_ID,
      name: safeName(name),
      description: description ?? `MCP server: ${name}`,
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: url,
            // No credentialProviderConfigurations = NO_AUTH outbound.
            // The gateway's REQUEST interceptor Lambda promotes x-mcp-auth-token
            // → Authorization: Bearer <token> at invoke time.
          },
        },
      },
    }),
  );

  const gatewayTargetId = result.targetId;
  if (!gatewayTargetId) {
    throw new Error('CreateGatewayTarget returned no targetId');
  }

  return { gatewayTargetId };
};
