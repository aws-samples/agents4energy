import { defineFunction } from '@aws-amplify/backend';

export const updateSessionSummary = defineFunction({
  name: 'update-session-summary',
  entry: './handler.ts',
  environment: {
    AGENTCORE_MEMORY_ID: process.env.AGENTCORE_MEMORY_ID ?? '',
  },
});
