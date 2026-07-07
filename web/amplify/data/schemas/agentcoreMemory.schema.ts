import { a } from '@aws-amplify/backend';
import { listSessionMessages } from '../../functions/list-session-messages/resource';
import { updateSessionSummary } from '../../functions/update-session-summary/resource';

export const agentcoreMemorySchema = a.schema({
  ConversationalEvent: a.customType({
    eventId: a.string().required(),
    role: a.string().required(),
    text: a.string().required(),
    timestamp: a.string().required(),
  }),

  ListSessionMessagesResult: a.customType({
    events: a.ref('ConversationalEvent').array().required(),
    nextToken: a.string(),
    summary: a.string(),
    summaryTimestamp: a.string(),
    // AgentCore MemoryRecord ID for the summary — needed to call updateSessionSummary.
    summaryRecordId: a.string(),
  }),

  listSessionMessages: a
    .query()
    .arguments({
      sessionId: a.string().required(),
      actorId: a.string().required(),
      nextToken: a.string(),
    })
    .returns(a.ref('ListSessionMessagesResult'))
    .handler(a.handler.function(listSessionMessages))
    .authorization((allow) => [allow.authenticated()]),

  updateSessionSummary: a
    .mutation()
    .arguments({
      memoryRecordId: a.string().required(),
      text: a.string().required(),
    })
    .returns(a.boolean().required())
    .handler(a.handler.function(updateSessionSummary))
    .authorization((allow) => [allow.authenticated()]),
});
