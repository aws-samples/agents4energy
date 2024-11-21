import { Schema } from '../../data/resource';
// import { env } from '$amplify/env/production-agent-function';

import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, AIMessage, ToolMessage, AIMessageChunk } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
// import { Pregel } from "@langchain/langgraph/pregel";

import { AmplifyClientWrapper, getLangChainMessageTextContent } from '../utils/amplifyUtils'
import { publishResponseStreamChunk } from '../graphql/mutations'

import { calculatorTool, wellTableToolBuilder, getTableDefinitionsTool, executeSQLQueryTool, plotTableFromToolResponseTool } from './toolBox';

async function retryOperation<T>(
    operation: () => Promise<T>,
    retries: number = 3,
    delay: number = 1000 // delay in milliseconds
): Promise<T> {
    let attempt = 0;
    while (attempt < retries) {
        try {
            return await operation();
        } catch (error) {
            attempt++;
            if (attempt >= retries) {
                throw error;
            }
            console.warn(`Retrying... Attempt ${attempt}/${retries}`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    // Fallback, should not be reached
    throw new Error("Operation failed after maximum retries");
}

export const handler: Schema["invokeProductionAgent"]["functionHandler"] = async (event) => {

    // console.log('event: ', event)
    // console.log('context: ', context)
    // console.log('Amplify env: ', env)
    // console.log('process.env: ', process.env)

    // const amplifyClientWrapper = generateAmplifyClientWrapper(process.env)

    

    if (!(event.arguments.chatSessionId)) throw new Error("Event does not contain chatSessionId");
    if (!event.identity) throw new Error("Event does not contain identity");

    const chatMessageOwnerIdentity = ('sub' in event.identity) ? event.identity.sub : event.arguments.messageOwnerIdentity

    if (!chatMessageOwnerIdentity) throw new Error(`Event does not contain user. Event:\n${JSON.stringify(event)}`);

    const amplifyClientWrapper = new AmplifyClientWrapper({
        chatSessionId: event.arguments.chatSessionId,
        env: process.env
    })

    const agentTools = [
        calculatorTool,
        wellTableToolBuilder(amplifyClientWrapper),
        // convertPdfToJsonTool,
        getTableDefinitionsTool,
        executeSQLQueryTool,
        plotTableFromToolResponseTool
    ];

    try {

        // If the usePreviousMessageContent field is true or undefined, get the messages. If not set the latest message text as the only message.
        if( !("usePreviousMessageContext" in event.arguments) || event.arguments.usePreviousMessageContext ) {
            console.log('Getting messages for chat session: ', event.arguments.chatSessionId)
            await amplifyClientWrapper.getChatMessageHistory({
                latestHumanMessageText: event.arguments.lastMessageText
            })
        } else {
            amplifyClientWrapper.chatMessages = [
                new HumanMessage({
                    content: event.arguments.lastMessageText
                })
            ]
        }
        
        // console.log("mesages in langchain form: ", amplifyClientWrapper.chatMessages)

        const agentModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            temperature: 0
        });


        //Add retry to the agent
        const agent = await retryOperation(async () => createReactAgent({
            llm: agentModel,
            tools: agentTools,
        }));

        // agent.nodes['agent'] = langchainNodeWithRetry(agent.nodes['agent'], 3, 1000);

        const input = {
            messages: amplifyClientWrapper.chatMessages,
        }

        // https://js.langchain.com/v0.2/docs/how_to/chat_streaming/#stream-events
        // https://js.langchain.com/v0.2/docs/how_to/streaming/#using-stream-events
        const stream = agent.streamEvents(input, { version: "v2" });

        console.log('Listening for stream events')
        for await (const streamEvent of stream) {
            // console.log(`${JSON.stringify(streamEvent, null, 2)}\n---`);

            if (streamEvent.event === "on_chat_model_stream") {
                // console.log('Message Chunk: ', streamEvent.data.chunk)

                const streamChunk = streamEvent.data.chunk as AIMessageChunk

                // const chunkContent = streamEvent.data.chunk.kwargs.content
                const chunkContent = getLangChainMessageTextContent(streamChunk)
                // console.log("chunkContent: ", chunkContent)
                if (chunkContent) {
                    await amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
                        query: publishResponseStreamChunk,
                        variables: {
                            chatSessionId: event.arguments.chatSessionId,
                            chunk: chunkContent
                        }
                    })
                }

            } else if (streamEvent.event === 'on_tool_end') {
                const streamChunk = streamEvent.data.output as ToolMessage
                // console.log('Tool Output: ', streamChunk)
                await amplifyClientWrapper.publishMessage({
                    chatSessionId: event.arguments.chatSessionId,
                    owner: chatMessageOwnerIdentity,
                    message: streamChunk
                })

            } else if (streamEvent.event === "on_chat_model_end") { //When there is a full response from the chat model
                // console.log('Message Output Chunk: ', streamEvent.data.output)
                const streamChunk = streamEvent.data.output as AIMessageChunk
                // console.log('Message Output Chunk as AIMessageChunk: ', streamChunk)

                if (!streamChunk) throw new Error("No output chunk found")
                const streamChunkAIMessage = new AIMessage({
                    content: streamChunk.content,
                    tool_calls: streamChunk.tool_calls
                })

                // console.log('Publishing AI Message: ', streamChunkAIMessage, '. Content: ', streamChunkAIMessage.content)

                await amplifyClientWrapper.publishMessage({
                    chatSessionId: event.arguments.chatSessionId,
                    owner: chatMessageOwnerIdentity,
                    message: streamChunkAIMessage
                })

            }

        }

        return "Invocation Successful!";

    } catch (error) {

        console.log('Error: ', error)

        if (error instanceof Error) {
            //If there is an error
            const AIErrorMessage = new AIMessage({ content: error.message + `\n model id: ${process.env.MODEL_ID}` })
            await amplifyClientWrapper.publishMessage({
                chatSessionId: event.arguments.chatSessionId,
                owner: chatMessageOwnerIdentity,
                message: AIErrorMessage
            })
            return error.message
        }
        return `Error: ${JSON.stringify(error)}`
    }

};