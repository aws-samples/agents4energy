import { Schema } from '../../data/resource';
// import { env } from '$amplify/env/production-agent-function';

import { ChatBedrockConverse } from "@langchain/aws";
import { AIMessage, ToolMessage, AIMessageChunk } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AmplifyClientWrapper, getLangChainMessageTextContent } from '../utils/amplifyUtils'
import { publishResponseStreamChunk } from '../graphql/mutations'

import { calculatorTool, wellTableTool, convertPdfToJsonTool, getTableDefinitionsTool, executeSQLQueryTool, plotTableFromToolResponseToolBuilder } from './toolBox';

// Define the tools for the agent to use
// const agentTools = [calculatorTool, wellTableTool, convertPdfToJsonTool, getTableDefinitionsTool, executeSQLQueryTool];

export const handler: Schema["invokeProductionAgent"]["functionHandler"] = async (event) => {

    // console.log('event: ', event)
    // console.log('context: ', context)
    // console.log('Amplify env: ', env)
    // console.log('process.env: ', process.env)

    // const amplifyClientWrapper = generateAmplifyClientWrapper(process.env)
    

    if (!(event.arguments.chatSessionId)) throw new Error("Event does not contain chatSessionId");
    if (!event.identity) throw new Error("Event does not contain identity");
    if (!('sub' in event.identity)) throw new Error("Event does not contain user");

    const amplifyClientWrapper = new AmplifyClientWrapper({
        chatSessionId: event.arguments.chatSessionId,
        env: process.env
    })

    const agentTools = [
        calculatorTool, 
        wellTableTool, 
        convertPdfToJsonTool, 
        getTableDefinitionsTool, 
        executeSQLQueryTool, 
        plotTableFromToolResponseToolBuilder(amplifyClientWrapper)
    ];

    try {
        console.log('Getting messages for chat session: ', event.arguments.chatSessionId)
        await amplifyClientWrapper.getChatMessageHistory({
            latestHumanMessageText: event.arguments.input
        })

        // console.log("mesages in langchain form: ", amplifyClientWrapper.chatMessages)

        const agentModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            temperature: 0
        });

        const agent = createReactAgent({
            llm: agentModel,
            tools: agentTools,
        });

        const input = {
            messages: amplifyClientWrapper.chatMessages,
        }

        // https://js.langchain.com/v0.2/docs/how_to/chat_streaming/#stream-events
        // https://js.langchain.com/v0.2/docs/how_to/streaming/#using-stream-events
        const stream = agent.streamEvents(input, { version: "v2" });

        console.log('Listening for stream events')
        for await (const streamEvent of stream) {
            console.log(`${JSON.stringify(streamEvent, null, 2)}\n---`);

            if (streamEvent.event === "on_chat_model_stream"){
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
                    owner: event.identity.sub,
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
                    owner: event.identity.sub,
                    message: streamChunkAIMessage
                })

            }

        }

        
        // agent.streamEvents

        // for await (
        //     const chunk of await agent.stream(input, {
        //         streamMode: "values",
        //     })
        // ) {
        //     const newMessage: BaseMessage = chunk.messages[chunk.messages.length - 1];

        //     if (!(newMessage instanceof HumanMessage)) {
        //         console.log('new message: ', newMessage)
                

        //         console.log('publishMessageStreamChunkResponse: ', publishMessageStreamChunkResponse)

                // await amplifyClientWrapper.publishMessage({
                //     chatSessionId: event.arguments.chatSessionId,
                //     owner: event.identity.sub,
                //     message: newMessage
                // })




        //     }

        // }
        return "Invocation Successful!";

    } catch (error) {

        console.log('Error: ', error)

        if (error instanceof Error) {
            //If there is an error
            const AIErrorMessage = new AIMessage({ content: error.message + `\n model id: ${process.env.MODEL_ID}` })
            await amplifyClientWrapper.publishMessage({
                chatSessionId: event.arguments.chatSessionId,
                owner: event.identity.sub,
                message: AIErrorMessage
            })
            return error.message
        }
        return `Error: ${JSON.stringify(error)}`
    }

};