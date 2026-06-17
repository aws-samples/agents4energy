import { defineFunction } from '@aws-amplify/backend';

export const listSessionMessages = defineFunction({
  name: 'list-session-messages',
  entry: './handler.ts',
  environment: {
    AGENTCORE_MEMORY_ID: process.env.AGENTCORE_MEMORY_ID ?? '',
  },
});
