import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { defineFunction } from '@aws-amplify/backend';

export const invokeBedrockAgentFunction = defineFunction({
  // optionally specify a name for the Function (defaults to directory name)
  name: 'invoke-bedrock-agent',
  // optionally specify a path to your handler (defaults to "./handler.ts")
  entry: '../functions/invokeBedrockAgent.ts',
  timeoutSeconds: 120
});

export const getStructuredOutputFromLangchainFunction = defineFunction({
  // optionally specify a name for the Function (defaults to directory name)
  name: 'get-structured-output',
  // optionally specify a path to your handler (defaults to "./handler.ts")
  entry: '../functions/getStructuredOutputFromLangchain.ts',
  timeoutSeconds: 120
});

/*== STEP 1 ===============================================================
The section below creates a Todo database table with a "content" field. Try
adding a new "isDone" field as a boolean. The authorization rule below
specifies that any unauthenticated user can "create", "read", "update", 
and "delete" any "Todo" records.
=========================================================================*/
const schema = a.schema({
  BedrockResponse: a.customType({
    body: a.string(),
    error: a.string(),
  }),

  ChatSession: a
    .model({
      messages: a.hasMany("ChatMessage", "chatSessionId"),
      firstMessage: a.string(),
      aiBotInfo: a.customType({
        aiBotName: a.string(),
        aiBotId: a.string(),
        aiBotAliasId: a.string(),
        aiBotVersion: a.string(),
      })
    })
    .authorization((allow) => [allow.owner(), allow.authenticated()]), //The allow.authenticated() allows other users to view chat sessions.

  ChatMessage: a
    .model({
      chatSessionId: a.id(),
      session: a.belongsTo("ChatSession", "chatSessionId"),
      content: a.string().required(),
      role: a.enum(["human", "ai", "tool"]),
      owner: a.string(),
      createdAt: a.datetime(),
      tool_call_id: a.string(), //This is the langchain tool call id
      tool_name: a.string(),
      tool_calls: a.json()
    })
    .secondaryIndexes((index) => [
      index("chatSessionId").sortKeys(["createdAt"])
    ])
    .authorization((allow) => [allow.owner(), allow.authenticated()]),



  invokeBedrock: a
    .query()
    .arguments({ prompt: a.string() })
    .returns(a.ref("BedrockResponse"))
    .authorization(allow => allow.authenticated())
    .handler(
      a.handler.custom({ entry: "./invokeBedrockModel.js", dataSource: "bedrockRuntimeDS" })
    ),

  listBedrockAgents: a
    .query()
    .returns(a.ref("BedrockResponse"))
    .authorization(allow => allow.authenticated())
    .handler(
      a.handler.custom({ entry: "./listBedrockAgents.js", dataSource: "bedrockAgentDS" })
    ),

  listBedrockAgentAliasIds: a
    .query()
    .arguments({ agentId: a.string() })
    .returns(a.ref("BedrockResponse"))
    .authorization(allow => allow.authenticated())
    .handler(
      a.handler.custom({ entry: "./listBedrockAgentAliasIds.js", dataSource: "bedrockAgentDS" })
    ),
  
  invokeBedrockAgent: a
    .query()
    .arguments({ prompt: a.string().required(), agentId: a.string().required(), agentAliasId: a.string().required(), sessionId: a.string().required() })
    .returns(a.string())
    .authorization(allow => allow.authenticated())
    .handler(
      a.handler.function(invokeBedrockAgentFunction)
      // a.handler.custom({ entry: "./invokeBedrockAgent.js", dataSource: "bedrockAgentRuntimeDS" })
    ),
  
  invokeBedrockWithStructuredOutput: a
    .query()
    .arguments({ lastMessageText: a.string().required(), outputStructure: a.string().required(), chatSessionId: a.string().required() })
    .returns(a.string())
    .authorization(allow => allow.authenticated())
    .handler(
      a.handler.function(getStructuredOutputFromLangchainFunction)
    ),
}).authorization(allow => [allow.resource(getStructuredOutputFromLangchainFunction)]);;

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  }
});
