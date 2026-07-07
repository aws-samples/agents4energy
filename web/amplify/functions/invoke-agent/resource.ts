import { defineFunction } from '@aws-amplify/backend';

export const invokeAgent = defineFunction({
  name: 'invoke-agent',
  entry: './handler.ts',
  timeoutSeconds: 300,
  environment: {
    HARNESS_ARN: '',
  },
});
