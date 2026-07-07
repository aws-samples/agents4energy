import { defineFunction } from '@aws-amplify/backend';

export const registerMcpTarget = defineFunction({
  name: 'register-mcp-target',
  entry: './handler.ts',
  environment: {
    GATEWAY_ID: process.env.GATEWAY_ID ?? '',
    GATEWAY_REGION: process.env.GATEWAY_REGION ?? '',
  },
});
