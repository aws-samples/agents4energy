import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

// Import modular schemas
import { chatSchema } from './schemas/chat.schema';


// Combine all schemas
const schema = a.combine([
  chatSchema,
]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});