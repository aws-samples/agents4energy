import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import * as APITypes from "../graphql/API";
import { listChatMessageByChatSessionIdAndCreatedAt } from "../graphql/queries"
import { Schema } from '../../data/resource';

import { HumanMessage, AIMessage, ToolMessage, BaseMessage, MessageContentText, MessageContentImageUrl } from "@langchain/core/messages";

import { convertPdfToImages, getInfoFromPdf, listBedrockAgents } from '../graphql/queries'

export function generateAmplifyClientWrapper(env: any) {
    Amplify.configure(
        {
            API: {
                GraphQL: {
                    endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT, // replace with your defineData name
                    region: env.AWS_REGION,
                    defaultAuthMode: 'identityPool'
                }
            }
        },
        {
            Auth: {
                credentialsProvider: {
                    getCredentialsAndIdentityId: async () => ({
                        credentials: {
                            // accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
                            // secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
                            // sessionToken: process.env.AWS_SESSION_TOKEN || "",
                            accessKeyId: env.AWS_ACCESS_KEY_ID,
                            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
                            sessionToken: env.AWS_SESSION_TOKEN,
                        },
                    }),
                    clearCredentialsAndIdentityId: () => {
                        /* noop */
                    },
                },
            },
        }
    );

    const amplifyClient = generateClient<Schema>()

    // Create a GraphQL query for messages in the chat session
    type GeneratedMutation<InputType, OutputType> = string & {
        __generatedMutationInput: InputType;
        __generatedMutationOutput: OutputType;
    };
    const createChatMessage = /* GraphQL */ `mutation CreateChatMessage(
    $condition: ModelChatMessageConditionInput
    $input: CreateChatMessageInput!
  ) {
    createChatMessage(condition: $condition, input: $input) {
      role
      chatSessionId
      content
      createdAt
      id
      owner
      tool_call_id
      tool_calls
      tool_name
      updatedAt
      __typename
    }
  }
  ` as GeneratedMutation<
        APITypes.CreateChatMessageMutationVariables,
        APITypes.CreateChatMessageMutation
    >;

    function getLangChainMessageTextContent(message: HumanMessage | AIMessage | ToolMessage): string | void {
        // console.log('message type: ', message._getType())
        // console.log('Content type: ', typeof message.content)
        // console.log('(message.content[0] as MessageContentText).text', (message.content[0] as MessageContentText).text)

        let messageTextContent: string = ''


        if (message instanceof ToolMessage) {
            messageTextContent += `Tool Response (${message.name}): \n\n`
            console.log('Tool message: ', message)
            console.log('Tool message content type: ', typeof message.content)
        }

        if (typeof message.content === 'string') {
            messageTextContent += message.content
            // } else if ((message.content[0] as MessageContentText).text !== undefined) {
            //     messageTextContent += (message.content[0] as MessageContentText).text
        } else {
            message.content.forEach((contentBlock) => {
                if ((contentBlock as MessageContentText).text !== undefined) messageTextContent += (contentBlock as MessageContentText).text + '\n'
                // else if ((contentBlock as MessageContentImageUrl).image_url !== undefined) messageContent += message.content.text !== undefined
            })
        }

        return messageTextContent

    }

    type PublishMessagePropsType = {chatSessionId: string, owner: string, message: HumanMessage | AIMessage | ToolMessage }
    async function publishMessage(props: PublishMessagePropsType) {

        const messageTextContent = getLangChainMessageTextContent(props.message)

        let input: APITypes.CreateChatMessageInput = {
            chatSessionId: props.chatSessionId,
            content: messageTextContent || "AI Message:\n",
            // contentBlocks: JSON.stringify(props.message.content), //The images are too big for DDB error:  ValidationException: The model returned the following errors: Input is too long for requested model.
            owner: props.owner,
            tool_calls: "[]",
            tool_call_id: "",
            tool_name: ""
        }

        if (props.message instanceof HumanMessage) {
            input = { ...input, role: APITypes.ChatMessageRole.human }
        } else if (props.message instanceof AIMessage) {
            input = { ...input, role: APITypes.ChatMessageRole.ai, tool_calls: JSON.stringify(props.message.tool_calls) }
        } else if (props.message instanceof ToolMessage) {
            input = {
                ...input,
                role: APITypes.ChatMessageRole.tool,
                tool_call_id: props.message.tool_call_id,
                tool_name: props.message.name || 'no tool name supplied'
            }
        }

        console.log('Publishing mesage with input: ', input)

        await amplifyClient.graphql({
            query: createChatMessage,
            variables: {
                input: input,
            },
        })
            .catch((err: any) => {
                console.error('GraphQL Error: ', err);
            });
    }

    // If you use the amplifyClient: Client type, you get the error below
    //Excessive stack depth comparing types 'Prettify<DeepReadOnlyObject<RestoreArrays<UnionToIntersection<DeepPickFromPath<FlatModel, ?[number]>>, FlatModel>>>' and 'Prettify<DeepReadOnlyObject<RestoreArrays<UnionToIntersection<DeepPickFromPath<FlatModel, ?[number]>>, FlatModel>>>'.ts(2321)
    async function getChatMessageHistory(props: {chatSessionId: string, latestHumanMessageText: string }) {

        // console.log('event: ', event)
        // console.log('context: ', context)
        // console.log('Amplify env: ', env)

        // if (!(props.chatSessionId)) throw new Error("Event does not contain chatSessionId");

        // Get the chat messages from the chat session
        const chatSessionMessages = await amplifyClient.graphql({ //listChatMessageByChatSessionIdAndCreatedAt
            query: listChatMessageByChatSessionIdAndCreatedAt,
            variables: {
                limit: 20,
                chatSessionId: props.chatSessionId,
                sortDirection: APITypes.ModelSortDirection.DESC
            }
        })

        // console.log('messages from gql query: ', chatSessionMessages)

        const sortedMessages = chatSessionMessages.data.listChatMessageByChatSessionIdAndCreatedAt.items.reverse()

        // Remove all of the messages before the first message with the role of human
        const firstHumanMessageIndex = sortedMessages.findIndex((message) => message.role === 'human');
        const sortedMessagesStartingWithHumanMessage = sortedMessages.slice(firstHumanMessageIndex)

        //Here we're using the last 20 messages for memory
        const messages: BaseMessage[] = sortedMessagesStartingWithHumanMessage.map((message) => {
            if (message.role === 'human') {
                return new HumanMessage({
                    content: message.content,
                })
            } else if (message.role === 'ai') {
                // if (!message.contentBlocks) throw new Error(`No contentBlocks in message: ${message}`);
                return new AIMessage({
                    content: [{
                        type: 'text',
                        text: message.content
                    }],
                    // content: JSON.parse(message.contentBlocks),
                    tool_calls: JSON.parse(message.tool_calls || '[]')
                })
            } else {
                // if (!message.contentBlocks) throw new Error(`No contentBlocks in message: ${message}`);
                return new ToolMessage({
                    content: message.content,
                    // content: JSON.parse(message.contentBlocks),
                    tool_call_id: message.tool_call_id || "",
                    name: message.tool_name || ""
                })
            }
        })

        // If the last message is from AI, add the latestHumanMessageText to the end of the messages.
        if (
            messages &&
            messages[messages.length - 1] &&
            !(messages[messages.length - 1] instanceof HumanMessage)
        ) {
            messages.push(
                new HumanMessage({
                    content: props.latestHumanMessageText,
                })
            )
        } else {
            console.log('Last message in query is a human message')
        }

        console.log("mesages in langchain form: ", messages)
        return messages
    }

    async function testFunction(props: {chatSessionId: string, latestHumanMessageText: string }) {
        const convertPdfToImagesResponse = await amplifyClient.graphql({
            query: convertPdfToImages,
            variables: {
                s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00131.pdf"
            }
        })
        return JSON.parse(convertPdfToImagesResponse.data.convertPdfToImages || "").imageMessaggeContentBlocks
    }
    

    return {
        amplifyClient: amplifyClient,
        getChatMessageHistory: getChatMessageHistory,
        publishMessage: publishMessage,
        testFunction: testFunction
    };

}