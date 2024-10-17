/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "./API";
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};

export const convertPdfToImagesAndAddMessages = /* GraphQL */ `query ConvertPdfToImagesAndAddMessages(
  $chatSessionId: String!
  $s3Key: String!
  $toolCallId: String!
) {
  convertPdfToImagesAndAddMessages(
    chatSessionId: $chatSessionId
    s3Key: $s3Key
    toolCallId: $toolCallId
  )
}
` as GeneratedQuery<
  APITypes.ConvertPdfToImagesAndAddMessagesQueryVariables,
  APITypes.ConvertPdfToImagesAndAddMessagesQuery
>;
export const getChatMessage = /* GraphQL */ `query GetChatMessage($id: ID!) {
  getChatMessage(id: $id) {
    chatSessionId
    content
    contentBlocks
    createdAt
    id
    owner
    role
    session {
      createdAt
      firstMessageSummary
      id
      owner
      updatedAt
      __typename
    }
    tool_call_id
    tool_calls
    tool_name
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetChatMessageQueryVariables,
  APITypes.GetChatMessageQuery
>;
export const getChatSession = /* GraphQL */ `query GetChatSession($id: ID!) {
  getChatSession(id: $id) {
    aiBotInfo {
      aiBotAliasId
      aiBotId
      aiBotName
      aiBotVersion
      __typename
    }
    createdAt
    firstMessageSummary
    id
    messages {
      nextToken
      __typename
    }
    owner
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetChatSessionQueryVariables,
  APITypes.GetChatSessionQuery
>;
export const getInfoFromPdf = /* GraphQL */ `query GetInfoFromPdf(
  $dataToExclude: AWSJSON
  $dataToInclude: AWSJSON
  $s3Key: String!
  $tableColumns: AWSJSON!
) {
  getInfoFromPdf(
    dataToExclude: $dataToExclude
    dataToInclude: $dataToInclude
    s3Key: $s3Key
    tableColumns: $tableColumns
  )
}
` as GeneratedQuery<
  APITypes.GetInfoFromPdfQueryVariables,
  APITypes.GetInfoFromPdfQuery
>;
export const invokeBedrock = /* GraphQL */ `query InvokeBedrock($prompt: String) {
  invokeBedrock(prompt: $prompt) {
    body
    error
    __typename
  }
}
` as GeneratedQuery<
  APITypes.InvokeBedrockQueryVariables,
  APITypes.InvokeBedrockQuery
>;
export const invokeBedrockAgent = /* GraphQL */ `query InvokeBedrockAgent(
  $agentAliasId: String!
  $agentId: String!
  $prompt: String!
  $sessionId: String!
) {
  invokeBedrockAgent(
    agentAliasId: $agentAliasId
    agentId: $agentId
    prompt: $prompt
    sessionId: $sessionId
  )
}
` as GeneratedQuery<
  APITypes.InvokeBedrockAgentQueryVariables,
  APITypes.InvokeBedrockAgentQuery
>;
export const invokeBedrockWithStructuredOutput = /* GraphQL */ `query InvokeBedrockWithStructuredOutput(
  $chatSessionId: String!
  $lastMessageText: String!
  $outputStructure: String!
) {
  invokeBedrockWithStructuredOutput(
    chatSessionId: $chatSessionId
    lastMessageText: $lastMessageText
    outputStructure: $outputStructure
  )
}
` as GeneratedQuery<
  APITypes.InvokeBedrockWithStructuredOutputQueryVariables,
  APITypes.InvokeBedrockWithStructuredOutputQuery
>;
export const invokeProductionAgent = /* GraphQL */ `query InvokeProductionAgent($chatSessionId: String, $input: String!) {
  invokeProductionAgent(chatSessionId: $chatSessionId, input: $input)
}
` as GeneratedQuery<
  APITypes.InvokeProductionAgentQueryVariables,
  APITypes.InvokeProductionAgentQuery
>;
export const listBedrockAgentAliasIds = /* GraphQL */ `query ListBedrockAgentAliasIds($agentId: String) {
  listBedrockAgentAliasIds(agentId: $agentId) {
    body
    error
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListBedrockAgentAliasIdsQueryVariables,
  APITypes.ListBedrockAgentAliasIdsQuery
>;
export const listBedrockAgents = /* GraphQL */ `query ListBedrockAgents {
  listBedrockAgents {
    body
    error
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListBedrockAgentsQueryVariables,
  APITypes.ListBedrockAgentsQuery
>;
export const listChatMessageByChatSessionIdAndCreatedAt = /* GraphQL */ `query ListChatMessageByChatSessionIdAndCreatedAt(
  $chatSessionId: ID!
  $createdAt: ModelStringKeyConditionInput
  $filter: ModelChatMessageFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  listChatMessageByChatSessionIdAndCreatedAt(
    chatSessionId: $chatSessionId
    createdAt: $createdAt
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      chatSessionId
      content
      contentBlocks
      createdAt
      id
      owner
      role
      tool_call_id
      tool_calls
      tool_name
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListChatMessageByChatSessionIdAndCreatedAtQueryVariables,
  APITypes.ListChatMessageByChatSessionIdAndCreatedAtQuery
>;
export const listChatMessages = /* GraphQL */ `query ListChatMessages(
  $filter: ModelChatMessageFilterInput
  $limit: Int
  $nextToken: String
) {
  listChatMessages(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      chatSessionId
      content
      contentBlocks
      createdAt
      id
      owner
      role
      tool_call_id
      tool_calls
      tool_name
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListChatMessagesQueryVariables,
  APITypes.ListChatMessagesQuery
>;
export const listChatSessions = /* GraphQL */ `query ListChatSessions(
  $filter: ModelChatSessionFilterInput
  $limit: Int
  $nextToken: String
) {
  listChatSessions(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      firstMessageSummary
      id
      owner
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListChatSessionsQueryVariables,
  APITypes.ListChatSessionsQuery
>;
