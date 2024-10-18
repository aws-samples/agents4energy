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

export const productionAgentFunction = defineFunction({
  name: "production-agent-function",
  entry: '../functions/productionAgentFunction/index.ts',
  timeoutSeconds: 900,
  environment: {
    // MODEL_ID: 'anthropic.claude-3-5-sonnet-20240620-v1:0'
    MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0'
  },
  runtime: 20
});

// export const convertPdfToImagesAndAddMessagesFunction = defineFunction({
//   name: "convert-pdf-to-image-function",
//   entry: '../functions/convertPdfToImages/index.ts',
//   timeoutSeconds: 900,
// });

const schema = a.schema({
  BedrockResponse: a.customType({
    body: a.string(),
    error: a.string(),
  }),

  ChatSession: a
    .model({
      messages: a.hasMany("ChatMessage", "chatSessionId"),
      firstMessageSummary: a.string(),
      aiBotInfo: a.customType({
        aiBotName: a.string(),
        aiBotId: a.string(),
        aiBotAliasId: a.string(),
        aiBotVersion: a.string(),
      })
    })
    .authorization((allow) => [allow.owner(), allow.authenticated()]), //The allow.authenticated() allows other users to view chat sessions.
  // TODO: let authenticated only read

  ChatMessage: a
    .model({
      chatSessionId: a.id(),
      session: a.belongsTo("ChatSession", "chatSessionId"),
      content: a.string().required(),
      contentBlocks: a.json(),
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
    .authorization(allow => [allow.authenticated()])
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
    ),

  invokeBedrockWithStructuredOutput: a
    .query()
    .arguments({ lastMessageText: a.string().required(), outputStructure: a.string().required(), chatSessionId: a.string().required() })
    .returns(a.string())
    .authorization(allow => allow.authenticated())
    .handler(
      a.handler.function(getStructuredOutputFromLangchainFunction)
    ),

  invokeProductionAgent: a
    .query()
    .arguments({
      input: a.string().required(),
      chatSessionId: a.string(),
    })
    .returns(a.json())
    .handler(a.handler.function(productionAgentFunction))
    .authorization((allow) => [allow.authenticated()]),

  getInfoFromPdf: a
    .query()
    .arguments({
      s3Key: a.string().required(),
      tableColumns: a.json().required(),
      dataToExclude: a.json(),
      dataToInclude: a.json()
    })
    .returns(a.json()),
  // .authorization(allow => allow.authenticated())
  // .handler(
  //   a.handler.
  // ),

  convertPdfToImages: a
    .query()
    .arguments({
      s3Key: a.string().required()
    })
    .returns(a.json())
    // .authorization(allow => [allow.authenticated()])
  ,
  // .authorization(allow => allow.authenticated()),

}).authorization(allow => [
  allow.resource(getStructuredOutputFromLangchainFunction),
  allow.resource(productionAgentFunction),
  // allow.resource(convertPdfToImagesAndAddMessagesFunction)
]);;

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
