import { z } from "zod";

import { tool } from "@langchain/core/tools";

import { AmplifyClientWrapper } from '../utils/amplifyUtils'
import { ToolMessageContentType } from '../../../src/utils/types'

import * as APITypes from "../graphql/API";
import { invokeBedrock, invokeProductionAgent, listChatMessageByChatSessionIdAndCreatedAt } from '../graphql/queries'
import { OnCreateChatMessageSubscription, ChatMessage } from '../graphql/API'

import { onCreateChatMessage } from '../graphql/subscriptions'

/////////////////////////////////////////////////
//////////// Query GraphQL API Tool /////////////
/////////////////////////////////////////////////

const queryGQLScheama = z.object({
    queryField: z
        .enum(["invokeBedrock", "invokeProductionAgent"]).describe(`
            Use invokeProductionAgent for:
                - Learning about a well's attributes, with data sources including well files, production volume databases.
                - General petroleum engineering knowledge
                - Diagnosing well problems
                - Steps to repair a well
                - Repair cost estimates
                - Financial returns estimates
            `.replace(/^\s+/gm, ''))
        .describe(`The type of operation to execute.`),
    invocationText: z.string().describe("The text to use to invoke the agent"),
});

export const queryGQLToolBuilder = (props: { amplifyClientWrapper: AmplifyClientWrapper, chatMessageOwnerIdentity: string }) => tool(
    async ({ queryField, invocationText }) => {
        const { amplifyClientWrapper, chatMessageOwnerIdentity } = props

        switch (queryField) {
            case "invokeBedrock":
                const invokeBedrockResponse = await amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
                    query: invokeBedrock,
                    variables: {
                        // chatSessionId: amplifyClientWrapper.chatSessionId,
                        // lastMessageText: "Hello World"
                        prompt: invocationText
                    }
                })

                // const responseData = JSON.parse(fileDataResponse.data.invokeBedrockWithStructuredOutput || "")

                return invokeBedrockResponse.data.invokeBedrock
            case "invokeProductionAgent":
                console.log("Invoking production agent with text: ", invocationText)
                amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
                    query: invokeProductionAgent,
                    variables: {
                        chatSessionId: amplifyClientWrapper.chatSessionId,
                        lastMessageText: invocationText,
                        usePreviousMessageContext: false,
                        messageOwnerIdentity: chatMessageOwnerIdentity
                    }
                }).catch((error) => {
                    console.log('Invoke production agent (timeout is expected): ', error)
                })
                

                //TODO: Replace this with a subscription
                const waitForResponse = async (): Promise<ChatMessage>  => {
                    return new Promise((resolve) => {
                        // Every few seconds check if the most recent chat message has the correct type
                        const interval = setInterval(async () => {
                            const testChatMessages = await amplifyClientWrapper.amplifyClient.graphql({
                                query: listChatMessageByChatSessionIdAndCreatedAt,
                                variables:
                                {
                                    chatSessionId: amplifyClientWrapper.chatSessionId,
                                    limit: 1,
                                    sortDirection: APITypes.ModelSortDirection.DESC
                                },
                            })

                            const mostRecentChatMessage = testChatMessages.data.listChatMessageByChatSessionIdAndCreatedAt.items[0]

                            if (mostRecentChatMessage) {
                                console.log("\nMost recent chat message:\n", mostRecentChatMessage)
                            }

                            if (mostRecentChatMessage &&
                                mostRecentChatMessage.role === APITypes.ChatMessageRole.ai &&
                                (!mostRecentChatMessage.tool_calls || mostRecentChatMessage.tool_calls === "[]")
                            ) {
                                console.log("Production Agent has returned a response. Ending the check for new messages loop")
                                clearInterval(interval)
                                resolve(mostRecentChatMessage)
                            }
                        }, 2000)
                    })
                }

                const completionChatMessage = await waitForResponse()

                console.log('Production Agent Response: ', completionChatMessage.content)

                return completionChatMessage.content

            ////https://aws.amazon.com/blogs/mobile/announcing-server-side-filters-for-real-time-graphql-subscriptions-with-aws-amplify/
            // const testSub = amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
            //     query: onCreateChatMessage,
            //     // variables: {}
            // }).subscribe({
            //     next: ({ data }) => {
            //         const chatMessage = data.onCreateChatMessage
            //         console.log("Production Agent Subscription Data 2:\n", chatMessage)
            //     },
            //     error: (error) => {
            //         console.log(error);

            //     },
            //     complete: () => {
            //         console.log("Subscription complete")
            //     },
            // })

            // testSub.unsubscribe()

            // const testChatResponse = await subscribeAndWaitForResponse2()
            // console.log('test chat response: ', testChatResponse)

            // const chatMessageSubscription = amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
            //     query: onCreateChatMessage,
            //     // variables: {
            //     //     // filter: {
            //     //     //     chatSessionId: {
            //     //     //         contains: amplifyClientWrapper.chatSessionId
            //     //     //     }
            //     //     // }
            //     // },
            // })

            // let subscription: ReturnType<typeof chatMessageSubscription.subscribe>

            // console.log("Subscribing to chat messages to check if the production agent has completed execution")

            // const subscribeAndWaitForResponse = async () => {
            //     return new Promise((resolve, reject) => {
            //         subscription = chatMessageSubscription.subscribe({
            //             next: ({ data }) => {
            //                 const chatMessage = data.onCreateChatMessage

            //                 console.log("Wait For Procution Agent To Complete Subscription Data:\n", chatMessage)
            //                 // If the chat message has the role of ai, and no tool calls, that message is the result to return
            // if (chatMessage.role === "ai" &&
            //     (!chatMessage.tool_calls || chatMessage.tool_calls === "[]")
            // ) {
            //     console.log("Production Agent has returned a response. Unsubscribing from chat messages.")
            //     // subscription.unsubscribe()
            //     resolve(chatMessage)
            // }
            //             },
            //             error: (error) => {
            //                 console.log(error);
            //                 reject(error)
            //             },
            //             complete: () => {
            //                 console.log("Subscription complete")
            //                 resolve("Subscription complete")
            //             },
            //         })
            //     })
            // }

            // const lastChatMessage = await subscribeAndWaitForResponse() as ChatMessage

            // console.log("Production Agent Last Chat Message: ", lastChatMessage)

            // return lastChatMessage.content
            // break;
            default:
                throw new Error(`Unknown query field: ${queryField}`);
        }

    },
    {
        name: "queryGQL",
        description: `
        Can query a GraphQL API. 
        Use queryField invokeProductionAgent to learn about a well's attributes, with data sources including well files, production volume databases, and general petroleum engineering knowledge.
        `.replaceAll(/^\s+/gm, ''),
        schema: queryGQLScheama,
    }
);

