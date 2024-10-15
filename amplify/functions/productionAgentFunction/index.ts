// import { Amplify } from 'aws-amplify';
// import { generateClient } from 'aws-amplify/data';
// import { Schema } from '../../data/resource';
// import { env } from '$amplify/env/production-agent-function';

// import { ChatBedrockConverse } from "@langchain/aws";
// import { HumanMessage, AIMessage, ToolMessage, BaseMessage, MessageContentText } from "@langchain/core/messages";
// import { createReactAgent } from "@langchain/langgraph/prebuilt";

// import * as APITypes from "../graphql/API";
// import { listChatMessageByChatSessionIdAndCreatedAt } from "../graphql/queries"
// import { calculatorTool, wellTableTool } from './toolBox';

// Amplify.configure(
//     {
//         API: {
//             GraphQL: {
//                 endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT, // replace with your defineData name
//                 region: env.AWS_REGION,
//                 defaultAuthMode: 'identityPool'
//             }
//         }
//     },
//     {
//         Auth: {
//             credentialsProvider: {
//                 getCredentialsAndIdentityId: async () => ({
//                     credentials: {
//                         accessKeyId: env.AWS_ACCESS_KEY_ID,
//                         secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
//                         sessionToken: env.AWS_SESSION_TOKEN,
//                     },
//                 }),
//                 clearCredentialsAndIdentityId: () => {
//                     /* noop */
//                 },
//             },
//         },
//     }
// );

// const amplifyClient = generateClient<Schema>();

// // Define the tools for the agent to use
// const agentTools = [calculatorTool, wellTableTool];

// // Create a GraphQL query for messages in the chat session
// type GeneratedMutation<InputType, OutputType> = string & {
//     __generatedMutationInput: InputType;
//     __generatedMutationOutput: OutputType;
// };
// const createChatMessage = /* GraphQL */ `mutation CreateChatMessage(
//     $condition: ModelChatMessageConditionInput
//     $input: CreateChatMessageInput!
//   ) {
//     createChatMessage(condition: $condition, input: $input) {
//       role
//       chatSessionId
//       content
//       createdAt
//       id
//       owner
//       tool_call_id
//       tool_calls
//       tool_name
//       updatedAt
//       __typename
//     }
//   }
//   ` as GeneratedMutation<
//     APITypes.CreateChatMessageMutationVariables,
//     APITypes.CreateChatMessageMutation
// >;


// function getLangChainMessageContent(message: HumanMessage | AIMessage | ToolMessage): string | void {
//     // console.log('message type: ', message._getType())
//     // console.log('Content type: ', typeof message.content)
//     // console.log('(message.content[0] as MessageContentText).text', (message.content[0] as MessageContentText).text)

//     let messageContent: string = ''

//     if (message instanceof ToolMessage) {
//         messageContent += `Tool Response (${message.name}): \n\n`
//     }

//     if (typeof message.content === 'string') {
//         messageContent += message.content
//     } else if ((message.content[0] as MessageContentText).text !== undefined) {
//         messageContent += (message.content[0] as MessageContentText).text
//     }

//     return messageContent

// }

// async function publishMessage(chatSessionId: string, owner: string, message: HumanMessage | AIMessage | ToolMessage) {

//     const messageContent = getLangChainMessageContent(message)

//     let input: APITypes.CreateChatMessageInput = {
//         chatSessionId: chatSessionId,
//         content: messageContent || "AI Message:\n",
//         owner: owner,
//         tool_calls: "[]",
//         tool_call_id: "",
//         tool_name: ""
//     }

//     if (message instanceof HumanMessage) {
//         input = { ...input, role: APITypes.ChatMessageRole.human }
//     } else if (message instanceof AIMessage) {
//         input = { ...input, role: APITypes.ChatMessageRole.ai, tool_calls: JSON.stringify(message.tool_calls) }
//     } else if (message instanceof ToolMessage) {
//         input = { ...input, role: APITypes.ChatMessageRole.tool, tool_call_id: message.tool_call_id, tool_name: message.name || 'no tool name supplied' }
//     }

//     await amplifyClient.graphql({
//         query: createChatMessage,
//         variables: {
//             input: input,
//         },
//     })
//         .then((res) => {
//             // console.log('GraphQL Response: ', res);
//         })
//         .catch((err) => {
//             console.error('GraphQL Error: ', err);
//         });
// }

// export const handler: Schema["invokeProductionAgent"]["functionHandler"] = async (event) => {

//     // console.log('event: ', event)
//     // console.log('context: ', context)
//     // console.log('Amplify env: ', env)

//     if (!(event.arguments.chatSessionId)) throw new Error("Event does not contain chatSessionId");
//     if (!event.identity) throw new Error("Event does not contain identity");
//     if (!('sub' in event.identity)) throw new Error("Event does not contain user");

//     try {

//         // Get the chat messages from the chat session
//         const chatSessionMessages = await amplifyClient.graphql({ //listChatMessageByChatSessionIdAndCreatedAt
//             query: listChatMessageByChatSessionIdAndCreatedAt,
//             variables: {
//                 limit: 20,
//                 chatSessionId: event.arguments.chatSessionId,
//                 sortDirection: APITypes.ModelSortDirection.DESC
//             }
//         })

//         // console.log('messages from gql query: ', chatSessionMessages)

//         const sortedMessages = chatSessionMessages.data.listChatMessageByChatSessionIdAndCreatedAt.items.reverse()

//         // Remove all of the messages before the first message with the role of human
//         const firstHumanMessageIndex = sortedMessages.findIndex((message) => message.role === 'human');
//         const sortedMessagesStartingWithHumanMessage = sortedMessages.slice(firstHumanMessageIndex)

//         //Here we're using the last 20 messages for memory
//         const messages: BaseMessage[] = sortedMessagesStartingWithHumanMessage.map((message) => {
//             if (message.role === 'human') {
//                 return new HumanMessage({
//                     content: message.content,
//                 })
//             } else if (message.role === 'ai') {
//                 return new AIMessage({
//                     content: [{
//                         type: 'text',
//                         text: message.content
//                     }],
//                     tool_calls: JSON.parse(message.tool_calls || '[]')
//                 })
//             } else {
//                 return new ToolMessage({
//                     content: message.content,
//                     tool_call_id: message.tool_call_id || "",
//                     name: message.tool_name || ""
//                 })
//             }
//         })

//         // If the latest human message didn't make it into the query, add it here.
//         if (
//             messages &&
//             messages[messages.length - 1] &&
//             !(messages[messages.length - 1] instanceof HumanMessage)
//         ) {
//             messages.push(
//                 new HumanMessage({
//                     content: event.arguments.input,
//                 })
//             )
//         } else {
//             console.log('Last message in query is a human message')
//         }

//         console.log("mesages in langchain form: ", messages)

//         const agentModel = new ChatBedrockConverse({
//             model: process.env.MODEL_ID,
//             temperature: 0
//         });

//         const agent = createReactAgent({
//             llm: agentModel,
//             tools: agentTools,
//         });

//         const input = {
//             messages: messages,
//         }

//         for await (
//             const chunk of await agent.stream(input, {
//                 streamMode: "values",
//             })
//         ) {
//             const newMessage: BaseMessage = chunk.messages[chunk.messages.length - 1];

//             if (!(newMessage instanceof HumanMessage)) {
//                 console.log('newMessage: ', newMessage)
//                 await publishMessage(event.arguments.chatSessionId, event.identity.sub, newMessage)
//             }
//         }
//         return "Invocation Successful!";

//     } catch (error) {

//         if (error instanceof Error) {
//             const AIErrorMessage = new AIMessage({ content: error.message + `\n model id: ${process.env.MODEL_ID}` })
//             await publishMessage(event.arguments.chatSessionId, event.identity.sub, AIErrorMessage)
//         }
//         return "Error"
//     }

// };