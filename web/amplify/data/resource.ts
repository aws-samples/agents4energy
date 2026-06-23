import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { invokeAgent } from '../functions/invoke-agent/resource';

// Import modular schemas
import { chatSchema } from './schemas/chat.schema';
import { agentcoreMemorySchema } from './schemas/agentcoreMemory.schema';
import { agentConfigSchema } from './schemas/agentConfig.schema';

// Grant the invoke-agent Lambda function read access to the agent config models.
// allow.resource() must be applied to an individual schema, not a.combine().
const agentConfigSchemaWithFunctionAccess = agentConfigSchema.authorization((allow) => [
  allow.resource(invokeAgent).to(['query']),
]);

// Combine all schemas
const schema = a.combine([
  chatSchema,
  agentcoreMemorySchema,
  agentConfigSchemaWithFunctionAccess,
]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});