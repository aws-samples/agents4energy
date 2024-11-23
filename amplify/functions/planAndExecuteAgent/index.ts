import { stringify } from "yaml"
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { Schema } from '../../data/resource';

import { ChatBedrockConverse } from "@langchain/aws";
import { BaseMessage, AIMessage, ToolMessage, AIMessageChunk, HumanMessage, isAIMessageChunk } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { END, START, StateGraph, Annotation } from "@langchain/langgraph";
import { RunnableConfig } from "@langchain/core/runnables";
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";

import { AmplifyClientWrapper, getLangChainMessageTextContent } from '../utils/amplifyUtils'
import { publishResponseStreamChunk, updateChatSession } from '../graphql/mutations'

import { queryGQLToolBuilder } from './toolBox'

const PlanStepSchema = z.object({
    title: z.string(),
    role: z.enum(['ai', 'human']),//TODO: add the human role so human input can be awaited.
    description: z.string(),
    toolCalls: z.array(z.any()).optional(),
    result: z.string().optional()
});

type PlanStep = z.infer<typeof PlanStepSchema>;

const PlanExecuteState = Annotation.Root({
    input: Annotation<string>({
        reducer: (x, y) => y ?? x ?? "",
    }),
    plan: Annotation<PlanStep[]>({
        reducer: (x, y) => y ?? x ?? [],
    }),
    pastSteps: Annotation<PlanStep[]>({
        // reducer: (x, y) => x.concat(y),
        reducer: (x, y) => y ?? x ?? [],
    }),
    response: Annotation<string>({
        reducer: (x, y) => y ?? x,
    }),
    // currentStepIndex: Annotation<number>({
    //     reducer: (x, y) => y
    // })
})

function areListsEqual<T>(list1: T[], list2: T[]): boolean {
    return list1.length === list2.length && 
           list1.every((value, index) => value === list2[index]);
}


export const handler: Schema["invokePlanAndExecuteAgent"]["functionHandler"] = async (event) => {

    // console.log('event: ', event)
    // console.log('context: ', context)
    // console.log('Amplify env: ', env)
    // console.log('process.env: ', process.env)


    if (!(event.arguments.chatSessionId)) throw new Error("Event does not contain chatSessionId");
    if (!event.identity) throw new Error("Event does not contain identity");
    if (!('sub' in event.identity)) throw new Error("Event does not contain user");

    const amplifyClientWrapper = new AmplifyClientWrapper({
        chatSessionId: event.arguments.chatSessionId,
        env: process.env
    })

    try {
        console.log('Getting the current chat session info')
        const chatSession = await amplifyClientWrapper.getChatSession({ chatSessionId: event.arguments.chatSessionId })
        if (!chatSession) throw new Error(`Chat session ${event.arguments.chatSessionId} not found`)

        console.log('Getting messages for chat session: ', event.arguments.chatSessionId)
        await amplifyClientWrapper.getChatMessageHistory({
            latestHumanMessageText: event.arguments.lastMessageText
            // latestHumanMessageText: event.arguments.input
        })


        // console.log("mesages in langchain form: ", amplifyClientWrapper.chatMessages)
        if (!chatSession.pastSteps) {
            //This is the inital message to the planning agent
            const executeAgentChatSessionUpdate = await amplifyClientWrapper.amplifyClient.graphql({
                query: updateChatSession,
                variables: {
                    input: {
                        id: event.arguments.chatSessionId,
                        planGoal: event.arguments.lastMessageText   
                    }
                }
            })
        }


        // Define inputs to the agent
        const inputs = {
            // input: event.arguments.lastMessageText,
            input: chatSession?.planGoal || event.arguments.lastMessageText, //If the planGoal exists, this is a follow up message and so we preserve the intial goal
            plan: chatSession?.planSteps?.map(step => JSON.parse(step || "") as PlanStep),
            pastSteps: chatSession?.pastSteps?.map(step => JSON.parse(step || "") as PlanStep),
        }

        ///////////////////////////////////////////////
        ///////// Executor Agent Step /////////////////
        ///////////////////////////////////////////////

        // Select the model to use for the executor agent
        const executorAgentModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            temperature: 0
        });

        const agentExecutorTools = [
            queryGQLToolBuilder({
                amplifyClientWrapper: amplifyClientWrapper,
                chatMessageOwnerIdentity: event.identity.sub
            })
        ]

        //Create the executor agent
        const agentExecutor = createReactAgent({
            llm: executorAgentModel,
            tools: agentExecutorTools,
        });

        // const dummyAgentExecutorResponse = await agentExecutor.invoke({
        //     messages: [new HumanMessage("who is the winner of the us open")],
        //   });
        // console.log("Dummy Agent Executor Response:\n", dummyAgentExecutorResponse.slice(-1)[0])

        ///////////////////////////////////////////////
        ///////// Planning Step ///////////////////////
        ///////////////////////////////////////////////

        const plan = zodToJsonSchema(
            z.object({
                steps: z
                    .array(PlanStepSchema)
                    .describe("Different steps to follow. Sort in order of completion"),
            }),
        );
        const planFunction = {
            name: "plan",
            description: "This tool is used to plan the steps to follow",
            type: "object",
            parameters: plan,
        };

        const planTool = {
            type: "function",
            function: planFunction,
        };

        const plannerPrompt = ChatPromptTemplate.fromTemplate(
            `For the given objective, come up with a simple step by step plan. 
            This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps.
            The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.

            {objective}`,
        );

        const planningModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            temperature: 0
        }).withStructuredOutput(plan);

        // const planner = plannerPrompt.pipe(planningModel);

        // const dummyPlannerResponse = await planner.invoke({
        //     objective: "what is the hometown of the current Australia open winner?",
        // });
        // console.log("Dummy Planner Response:\n", dummyPlannerResponse)

        ///////////////////////////////////////////////
        ///////// Re-Planning Step ////////////////////
        ///////////////////////////////////////////////



        const replannerPrompt = ChatPromptTemplate.fromTemplate(
            `For the given objective, come up with a simple step by step plan. 
            This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps.
            The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.
            
            Your objective was this:
            {objective}
            
            Your original plan was this:
            {plan}
            
            You have currently done the follow steps:
            {pastSteps}
            
            Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that and use the 'response' function.
            Otherwise, fill out the plan.  
            Only add steps to the plan that still NEED to be done. Do not return previously done steps as part of the plan.`,
        );

        const replanner = replannerPrompt.pipe(planningModel);

        ///////////////////////////////////////////////
        ///////// Response Step ///////////////////////
        ///////////////////////////////////////////////

        const responderPrompt = ChatPromptTemplate.fromTemplate(
            `Respond to the user based on the origional objective and completed steps.
                
                Your objective was this:
                {input}

                The next steps (if any) are this:
                {plan}
                
                You have currently done the follow steps:
                {pastSteps}
                `,
        );


        const response = zodToJsonSchema(
            z.object({
                response: z.string().describe("Response to user."),
            }),
        );

        const responderModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            temperature: 0
        }).withStructuredOutput(response);

        const responder = responderPrompt.pipe(responderModel)

        ///////////////////////////////////////////////
        ///////// Create the Graph ////////////////////
        ///////////////////////////////////////////////
        async function executeStep(
            state: typeof PlanExecuteState.State,
            config?: RunnableConfig,
        ): Promise<Partial<typeof PlanExecuteState.State>> {
            const { result, ...task } = state.plan[0];//Remove the "Result" field from the task if it exists

            const input = {
                messages: [new HumanMessage(`
                    The following steps have been completed
                    <previousSteps>
                    ${stringify(state.pastSteps)}
                    </previousSteps>
                    
                    Now execute this task:
                    <task>
                    ${stringify(task)}
                    </task>
                    `)],
            };
            const { messages } = await agentExecutor.invoke(input, config);

            const resultText = getLangChainMessageTextContent(messages.slice(-1)[0]) || ""

            // console.log('past Steps: ', state.pastSteps)

            return {
                pastSteps: [
                    ...(state.pastSteps || []),
                    {
                        ...task,
                        result: resultText,
                    },
                ],
                plan: state.plan.slice(1),
            };
        }

        async function replanStep(
            state: typeof PlanExecuteState.State,
        ): Promise<Partial<typeof PlanExecuteState.State>> {
            // //If this isn't the intital replan, and there are no more plan steps, 
            // if (state.plan && state.plan.length === 0 && state.pastSteps === inputs.pastSteps) {
            //     //

            // }

            const pastSteps = (inputs.pastSteps && areListsEqual(inputs.pastSteps, state.pastSteps, )) ?
                [
                    ...state.pastSteps.slice(0, -1),
                    {
                        ...state.pastSteps[state.pastSteps.length - 1],
                        response: event.arguments.lastMessageText
                    }
                ]
                :
                state.pastSteps


            const newPlan = await replanner.invoke({
                objective: state.input,
                plan: stringify(state.plan),
                pastSteps: stringify(pastSteps)
            });

            return { plan: newPlan.steps };
        }

        async function respondStep(
            state: typeof PlanExecuteState.State,
        ): Promise<Partial<typeof PlanExecuteState.State>> {
            const response = await responder.invoke({
                input: state.input,
                plan: stringify(state.plan),
                pastSteps: stringify(state.pastSteps)
            });

            return { response: response.response };
        }

        function shouldEnd(state: typeof PlanExecuteState.State) {
            // If human input is requested, or there are no more steps, return true
            if (!state.plan) return "false"
            if (state.plan[0].role === "human") return "true"
            return state.plan.length === 0 ? "true" : "false";
            // return state.response ? "true" : "false";
        }
        const workflow = new StateGraph(PlanExecuteState)
            .addNode("agent", executeStep)
            .addNode("replan", replanStep)
            .addNode("respond", respondStep)
            .addEdge(START, "replan")
            .addEdge("agent", "replan")
            .addConditionalEdges("replan", shouldEnd, {
                true: "respond",
                false: "agent",
            })
            .addEdge("respond", END);

        // const workflow = new StateGraph(PlanExecuteState)
        //     .addNode("planner", planStep)
        //     .addNode("agent", executeStep)
        //     .addNode("replan", replanStep)
        //     .addNode("respond", respondStep)
        //     .addEdge(START, "planner")
        //     .addEdge("planner", "agent")
        //     .addEdge("agent", "replan")
        //     .addConditionalEdges("replan", shouldEnd, {
        //         true: "respond",
        //         false: "agent",
        //     })
        //     .addEdge("respond", END);

        // Finally, we compile it!
        // This compiles it into a LangChain Runnable,
        // meaning you can use it as you would any other runnable
        const agent = workflow.compile();

        ///////////////////////////////////////////////
        ///////// Invoke the Graph ////////////////////
        ///////////////////////////////////////////////



        // const input = {
        //     messages: amplifyClientWrapper.chatMessages,
        // }

        // const stream = await agent.stream(inputs, {
        //     recursionLimit: 50,
        //     streamMode: "messages"
        // });

        const eventStream = agent.streamEvents(
            inputs,
            {
                version: "v2",
            }
        );

        // https://js.langchain.com/v0.2/docs/how_to/chat_streaming/#stream-events
        // https://js.langchain.com/v0.2/docs/how_to/streaming/#using-stream-events
        // const stream = executorAgent.streamEvents(input, { version: "v2" });

        console.log('Listening for stream events')
        // for await (const streamEvent of stream) {
        for await (const streamEvent of eventStream) {
            // console.log('event: ', streamEvent.event)

            switch (streamEvent.event) {
                case "on_chat_model_stream":
                    // console.log('Message Chunk: ', stringify(streamEvent))
                    // console.log('Message Chunk: ', stringify({streamEvent.data.ch÷unk.content}))

                    const streamChunk = streamEvent.data.chunk as AIMessageChunk

                    // const chunkContent = streamEvent.data.chunk.kwargs.content
                    const chunkContent = getLangChainMessageTextContent(streamChunk)
                    // console.log("chunkContent: ", chunkContent)

                    if (chunkContent) {
                        console.log("chunkContent: ", chunkContent)
                        await amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
                            query: publishResponseStreamChunk,
                            variables: {
                                chatSessionId: event.arguments.chatSessionId,
                                chunk: chunkContent
                            }
                        })
                    }
                    break
                case "on_chain_stream":
                    console.log('on_chain_stream: ', stringify(streamEvent))
                    const chainStreamMessage = streamEvent.data.chunk
                    const chainMessageType = ("planner" in chainStreamMessage || "replan" in chainStreamMessage) ? "plan" :
                        ("agent" in chainStreamMessage) ? "agent" :
                            ("response" in chainStreamMessage) ? "response" :
                                "unknown"

                    switch (chainMessageType) {
                        case "plan":
                            const updatePlanResonse = await amplifyClientWrapper.amplifyClient.graphql({
                                query: updateChatSession,
                                variables: {
                                    input: {
                                        id: event.arguments.chatSessionId,
                                        planSteps: ((chainStreamMessage.planner || chainStreamMessage.replan) as typeof PlanExecuteState.State)
                                            .plan.map((step) => JSON.stringify(step, null, 2)),
                                    }
                                }
                            })

                            console.log("Update Plan Response:\n", stringify(updatePlanResonse))
                            break
                        case "agent":
                            const executeAgentChatSessionUpdate = await amplifyClientWrapper.amplifyClient.graphql({
                                query: updateChatSession,
                                variables: {
                                    input: {
                                        id: event.arguments.chatSessionId,
                                        pastSteps: (chainStreamMessage.agent as typeof PlanExecuteState.State).pastSteps.map((step) => JSON.stringify(step, null, 2)),
                                        planSteps: (chainStreamMessage.agent as typeof PlanExecuteState.State).plan.map((step) => JSON.stringify(step, null, 2)),
                                    }
                                }
                            })
                            break
                        case "response":
                            console.log('Response Event: ', chainStreamMessage)
                            const responseAIMessage = new AIMessage({
                                content: chainStreamMessage.respond.response,
                            })

                            console.log('Publishing AI Message: ', responseAIMessage, '. Content: ', responseAIMessage.content)

                            await amplifyClientWrapper.publishMessage({
                                chatSessionId: event.arguments.chatSessionId,
                                owner: event.identity.sub,
                                message: responseAIMessage
                            })
                            break
                        default:
                            console.log('on_chain_stream: unknown: ', stringify(chainStreamMessage))
                            break
                    }


            }

            // if (streamEvent.event === "on_chat_model_stream") {
            //     console.log('Message Chunk: ', streamEvent.data.chunk)

            //     const streamChunk = streamEvent.data.chunk as AIMessageChunk

            //     // const chunkContent = streamEvent.data.chunk.kwargs.content
            //     const chunkContent = getLangChainMessageTextContent(streamChunk)
            //     // console.log("chunkContent: ", chunkContent)
            //     if (chunkContent) {
            //         await amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
            //             query: publishResponseStreamChunk,
            //             variables: {
            //                 chatSessionId: event.arguments.chatSessionId,
            //                 chunk: chunkContent
            //             }
            //         })
            //     }

            // }

            // if (event === "on_chat_model_stream" && isAIMessageChunk(data.chunk)) {
            //     if (data.chunk.tool_call_chunks !== undefined && data.chunk.tool_call_chunks.length > 0) {
            //         console.log(data.chunk.tool_call_chunks);
            //     }
            // }

            // // console.log(`${stringify(message)}\n${_metadata}---`);
            // if (isAIMessageChunk(message) && message.tool_call_chunks?.length) {
            //     console.log(`${message.getType()} MESSAGE TOOL CALL CHUNK: ${message.tool_call_chunks[0].args}`);
            // } else {
            //     console.log(`${message.getType()} MESSAGE CONTENT: ${message.content}`);
            // }

            // if (isAIMessageChunk(message)) {

            // }

            // if ("planner" in message || "replan" in message) {
            //     //Set or update the plan
            //     const updatePlanResonse = await amplifyClientWrapper.amplifyClient.graphql({
            //         query: updateChatSession,
            //         variables: {
            //             input: {
            //                 id: event.arguments.chatSessionId,
            //                 planSteps: ((message.planner || message.replan) as typeof PlanExecuteState.State).plan.map((step) => JSON.stringify(step, null, 2)),
            //                 // planState: {
            //                 //     // plan: JSON.stringify(streamEvent.planner?.plan || streamEvent.replanner?.plan, null, 2),
            //                 //     plan: ((streamEvent.planner || streamEvent.replan) as typeof PlanExecuteState.State).plan.map((step) => JSON.stringify(step, null, 2))
            //                 //     // pastSteps: streamEvent.planner?.pastSteps || streamEvent.replanner?.pastSteps
            //                 // }
            //             }
            //         }
            //     })

            //     console.log("Update Plan Response:\n", stringify(updatePlanResonse))

            // }

            // if ("agent" in message) {
            //     // Update the completed steps

            //     const executeAgentChatSessionUpdate = await amplifyClientWrapper.amplifyClient.graphql({
            //         query: updateChatSession,
            //         variables: {
            //             input: {
            //                 id: event.arguments.chatSessionId,
            //                 pastSteps: (message.agent as typeof PlanExecuteState.State).pastSteps.map((step) => JSON.stringify(step, null, 2)),
            //                 planSteps: (message.agent as typeof PlanExecuteState.State).plan.map((step) => JSON.stringify(step, null, 2)),
            //             }
            //         }
            //     })

            //     console.log('Execut agent chat session update:\n', stringify(executeAgentChatSessionUpdate))

            // }

            // if ("respond" in message) {
            //     // Send a response to the user
            //     console.log('Response Event: ', message)
            //     const responseAIMessage = new AIMessage({
            //         content: message.respond.response,
            //     })

            //     console.log('Publishing AI Message: ', responseAIMessage, '. Content: ', responseAIMessage.content)

            //     await amplifyClientWrapper.publishMessage({
            //         chatSessionId: event.arguments.chatSessionId,
            //         owner: event.identity.sub,
            //         message: responseAIMessage
            //     })
            // }

        }

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