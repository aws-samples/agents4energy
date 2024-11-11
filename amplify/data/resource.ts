import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { defineFunction } from '@aws-amplify/backend';

export const invokeBedrockAgentFunction = defineFunction({
  name: 'invoke-bedrock-agent',
  entry: '../functions/invokeBedrockAgent.ts',
  timeoutSeconds: 120
});

export const getStructuredOutputFromLangchainFunction = defineFunction({
  name: 'get-structured-output',
  entry: '../functions/getStructuredOutputFromLangchain.ts',
  timeoutSeconds: 120
});

export const productionAgentFunction = defineFunction({
  name: "production-agent-function",
  entry: '../functions/productionAgentFunction/index.ts',
  timeoutSeconds: 900,
  environment: {
    // MODEL_ID: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0'
    // MODEL_ID: 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
    MODEL_ID: 'us.anthropic.claude-3-sonnet-20240229-v1:0'
    // MODEL_ID: 'us.anthropic.claude-3-haiku-20240307-v1:0'
  },
  runtime: 20
});

// export const addIamDirectiveFunction = defineFunction({
//   name: "add-iam-directive-function",
//   entry: '../functions/addIamDirectiveToAllAssets.ts',
//   timeoutSeconds: 60,
// });

// export const dummyFunction2 = defineFunction()

const schema = a.schema({

  BedrockResponse: a.customType({
    body: a.string(),
    error: a.string(),
  }),

  BedrockAgentResponse: a.customType({
    completion: a.string(),
    orchestrationTrace: a.string()
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
    .authorization((allow) => [allow.owner(), allow.authenticated().to(['read'])]), //The allow.authenticated() allows other users to view chat sessions.
  // TODO: let authenticated only read

  ChatMessage: a
    .model({
      chatSessionId: a.id(),
      session: a.belongsTo("ChatSession", "chatSessionId"),
      content: a.string().required(),
      contentBlocks: a.json(),
      trace: a.string(),
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
    .arguments({ prompt: a.string().required(), agentId: a.string().required(), agentAliasId: a.string().required(), chatSessionId: a.string().required() })
    .returns(a.ref("BedrockAgentResponse"))
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

  convertPdfToJson: a
    .query()
    .arguments({
      s3Key: a.string().required()
    })
    .returns(a.json()),

  //These assets enable token level streaming from the model
  ResponseStreamChunk: a
    .customType({
      chunk: a.string().required(),
      chatSessionId: a.string().required()
    }),

  publishResponseStreamChunk: a
    .mutation()
    .arguments({
      chunk: a.string().required(),
      chatSessionId: a.string().required(),
    })
    .returns(a.ref('ResponseStreamChunk'))
    .handler(a.handler.custom({ entry: './publishMessageStreamChunk.js' }))
    .authorization(allow => [allow.authenticated()]),

  recieveResponseStreamChunk: a
    .subscription()
    .for(a.ref('publishResponseStreamChunk'))
    .arguments({ chatSessionId: a.string().required() })
    .handler(a.handler.custom({ entry: './receiveMessageStreamChunk.js' }))
    .authorization(allow => [allow.authenticated()]),

}).authorization(allow => [
  allow.resource(getStructuredOutputFromLangchainFunction),
  allow.resource(productionAgentFunction),
  allow.resource(invokeBedrockAgentFunction),
]);

export type Schema = ClientSchema<typeof schema>;

// https://aws-amplify.github.io/amplify-backend/functions/_aws_amplify_backend.defineData.html
export const data = defineData({
  schema: { schemas: [schema] },
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  }
});
