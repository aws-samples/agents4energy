import { defineFunction } from '@aws-amplify/backend';

export const listMcpTools = defineFunction({
  name: 'list-mcp-tools',
  entry: './handler.ts',
  timeoutSeconds: 15,
});
