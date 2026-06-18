import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

// Import modular schemas
import { chatSchema } from './schemas/chat.schema';
import { agentcoreMemorySchema } from './schemas/agentcoreMemory.schema';
import { agentConfigSchema } from './schemas/agentConfig.schema';


// Combine all schemas
const schema = a.combine([
  chatSchema,
  agentcoreMemorySchema,
  agentConfigSchema,
]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});