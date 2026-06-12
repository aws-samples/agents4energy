import { a } from '@aws-amplify/backend';

/**
 * Chat Schema
 * Models for managing chat sessions and messages
 */
export const chatSchema = a.schema({
  
  ChatSession: a.model({
    name: a.string(),
    // Slug of the Agent this session is scoped to. Drives model + system prompt + gateway tools.
    agentId: a.string(),
    messages: a.hasMany("ChatMessage", "chatSessionId"),
    mapLayers: a.hasMany("MapLayer", "chatSessionId"),
    mapBounds: a.json(), // Optional: store last view bounds as [west, south, east, north]
    lineageSummary: a.json(), // Optional: consolidated list of datasets accessed during the session
  })
    .authorization((allow) => [allow.owner(), allow.authenticated(), allow.guest()]),

  Roles: a.enum(["user", "assistant", "system"]),

  ChatMessage: a
    .model({
      chatSessionId: a.id(),
      chatSession: a.belongsTo("ChatSession", 'chatSessionId'),

      // Core UIMessage fields
      role: a.ref("Roles").required(),

      // Store the entire parts array as JSON
      // This preserves the exact UIMessage structure
      parts: a.json().required(),

      // Optional: metadata field for custom metadata
      metadata: a.json(),

      // Keep for querying/filtering
      chatSessionIdUnderscoreAgentId: a.string(),

      // Status tracking
      responseComplete: a.boolean(),

      // Auto-generated fields
      owner: a.string(),
      createdAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("chatSessionId").sortKeys(["createdAt"]),
      index("chatSessionIdUnderscoreAgentId").sortKeys(["createdAt"])
    ])
    .authorization((allow) => [allow.owner(), allow.authenticated().to(["read", "create"]), allow.guest().to(["read"])]),

  Settings: a.model({
    name: a.string(),
    value: a.string(),
  })
    .authorization((allow) => [allow.owner(), allow.authenticated()]),
});
