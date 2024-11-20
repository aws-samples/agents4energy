import { stringify } from "yaml"
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { Schema } from '../../data/resource';

import { ChatBedrockConverse } from "@langchain/aws";
import { BaseMessage, AIMessage, ToolMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
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
        console.log('Getting messages for chat session: ', event.arguments.chatSessionId)
        await amplifyClientWrapper.getChatMessageHistory({
            latestHumanMessageText: event.arguments.lastMessageText
            // latestHumanMessageText: event.arguments.input
        })

        // console.log("mesages in langchain form: ", amplifyClientWrapper.chatMessages)



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

        async function planStep(
            state: typeof PlanExecuteState.State,
        ): Promise<Partial<typeof PlanExecuteState.State>> {
            // const plan = await planner.invoke({ objective: state.input });
            // const plan = await planner.invoke({ objective: state.input });
            const plan = await replanner.invoke({
                objective: state.input,
                plan: stringify(state.plan),
                pastSteps: stringify(state.pastSteps)
            });
            return { plan: plan.steps };
        }

        async function replanStep(
            state: typeof PlanExecuteState.State,
        ): Promise<Partial<typeof PlanExecuteState.State>> {
            //No deciding to add more steps at the end
            if (state.plan.length === 0) {
                return { plan: [] };
            }

            const newPlan = await replanner.invoke({
                objective: state.input,
                plan: stringify(state.plan),
                pastSteps: stringify(state.pastSteps)
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
            return state.plan.length === 0 ? "true" : "false";
            // return state.response ? "true" : "false";
        }

        const workflow = new StateGraph(PlanExecuteState)
            .addNode("planner", planStep)
            .addNode("agent", executeStep)
            .addNode("replan", replanStep)
            .addNode("respond", respondStep)
            .addEdge(START, "planner")
            .addEdge("planner", "agent")
            .addEdge("agent", "replan")
            .addConditionalEdges("replan", shouldEnd, {
                true: "respond",
                false: "agent",
            })
            .addEdge("respond", END);

        // Finally, we compile it!
        // This compiles it into a LangChain Runnable,
        // meaning you can use it as you would any other runnable
        const app = workflow.compile();

        ///////////////////////////////////////////////
        ///////// Invoke the Graph ////////////////////
        ///////////////////////////////////////////////


        const config = { recursionLimit: 50 };
        // const inputs = {
        //     input: "what is the hometown of the 2005 Australian open winner?",
        // };

        const inputs = {
            input: event.arguments.lastMessageText,
        }

        // const input = {
        //     messages: amplifyClientWrapper.chatMessages,
        // }

        const stream = app.stream(inputs, config);

        // https://js.langchain.com/v0.2/docs/how_to/chat_streaming/#stream-events
        // https://js.langchain.com/v0.2/docs/how_to/streaming/#using-stream-events
        // const stream = executorAgent.streamEvents(input, { version: "v2" });

        console.log('Listening for stream events')
        // for await (const streamEvent of stream) {
        for await (const streamEvent of await stream) {
            console.log(`${stringify(streamEvent)}\n---`);

            if ("planner" in streamEvent || "replan" in streamEvent){
                //Set or update the plan
                const updatePlanResonse = await amplifyClientWrapper.amplifyClient.graphql({
                    query: updateChatSession,
                    variables: {
                        input: {
                            id: event.arguments.chatSessionId,
                            planSteps: ((streamEvent.planner || streamEvent.replan) as typeof PlanExecuteState.State).plan.map((step) => JSON.stringify(step, null, 2)),
                            // planState: {
                            //     // plan: JSON.stringify(streamEvent.planner?.plan || streamEvent.replanner?.plan, null, 2),
                            //     plan: ((streamEvent.planner || streamEvent.replan) as typeof PlanExecuteState.State).plan.map((step) => JSON.stringify(step, null, 2))
                            //     // pastSteps: streamEvent.planner?.pastSteps || streamEvent.replanner?.pastSteps
                            // }
                        }
                    }
                })

                console.log("Update Plan Response:\n", stringify(updatePlanResonse))

            }

            if ("agent" in streamEvent) {
                // Update the completed steps

                const executeAgentChatSessionUpdate = await amplifyClientWrapper.amplifyClient.graphql({
                    query: updateChatSession,
                    variables: {
                        input: {
                            id: event.arguments.chatSessionId,
                            pastSteps: (streamEvent.agent as typeof PlanExecuteState.State).pastSteps.map((step) => JSON.stringify(step, null, 2)),
                            planSteps: (streamEvent.agent as typeof PlanExecuteState.State).plan.map((step) => JSON.stringify(step, null, 2)),
                        }
                    }
                })

                console.log('Execut agent chat session update:\n', stringify(executeAgentChatSessionUpdate))

            }

            if ("respond" in streamEvent) {
                // Send a response to the user
                console.log('Response Event: ', streamEvent)
                const responseAIMessage = new AIMessage({
                    content: streamEvent.respond.response,
                })

                console.log('Publishing AI Message: ', responseAIMessage, '. Content: ', responseAIMessage.content)

                await amplifyClientWrapper.publishMessage({
                    chatSessionId: event.arguments.chatSessionId,
                    owner: event.identity.sub,
                    message: responseAIMessage
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
                owner: event.identity.sub,
                message: AIErrorMessage
            })
            return error.message
        }
        return `Error: ${JSON.stringify(error)}`
    }

};