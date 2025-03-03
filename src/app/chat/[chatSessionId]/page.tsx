"use client"
import { stringify } from 'yaml'
import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic'

import type { Schema } from '@/../amplify/data/resource';
import { amplifyClient} from '@/utils/amplify-utils';
import { formatDate } from "@/utils/date-utils";
import { defaultAgents } from '@/utils/config'
import { Message } from '@/utils/types'
import { withAuth } from '@/components/WithAuth';
import ChatBox from '@/components/ChatBox'
import type { SideNavigationProps } from '@cloudscape-design/components';

import { useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter } from 'next/navigation';
import { Tooltip } from '@mui/material';
import '@aws-amplify/ui-react/styles.css'

// Dynamic imports for Cloudscape components
const AppLayout = dynamic(
    () => import('@cloudscape-design/components').then((mod) => mod.AppLayout),
    { ssr: false }
);
const HelpPanel = dynamic(
    () => import('@cloudscape-design/components').then((mod) => mod.HelpPanel),
    { ssr: false }
);
// const Header = dynamic(
//     () => import('@cloudscape-design/components').then((mod) => mod.Header),
//     { ssr: false }
// );
// const Link = dynamic(
//     () => import('@cloudscape-design/components').then((mod) => mod.Link),
//     { ssr: false }
// );
const SideNavigation = dynamic(
    () => import('@cloudscape-design/components').then((mod) => mod.SideNavigation),
    { ssr: false }
);
const Tabs = dynamic(
    () => import('@cloudscape-design/components/tabs'),
    { ssr: false }
);
const ButtonDropdown = dynamic(
    () => import('@cloudscape-design/components/button-dropdown'),
    { ssr: false }
);
const Tiles = dynamic(
    () => import('@cloudscape-design/components/tiles'),
    { ssr: false }
);
// const PromptInput = dynamic(
//     () => import('@cloudscape-design/components/prompt-input'),
//     { ssr: false }
// );
const Container = dynamic(
    () => import('@cloudscape-design/components/container'),
    { ssr: false }
);
// const FormField = dynamic(
//     () => import('@cloudscape-design/components/form-field'),
//     { ssr: false }
// );
const Steps = dynamic(
    () => import('@cloudscape-design/components/steps'),
    { ssr: false }
);

// Dynamic import for custom components
// const Messages = dynamic(() => import('./messages'), { ssr: false });
const StorageBrowser = dynamic(
    () => import('@/components/StorageBrowser').then(mod => mod.StorageBrowser),
    { ssr: false }
);

const jsonParseHandleError = (jsonString: string) => {
    try {
        return JSON.parse(jsonString)
    } catch {
        console.warn(`Could not parse string: ${jsonString}`)
    }
}


// const invokeBedrockAgentParseBodyGetTextAndTrace = async (props: { prompt: string, chatSession: Schema['ChatSession']['type'], agentId?: string, agentAliasId?: string }) => {
//     const { prompt, chatSession } = props
//     const agentId = props.agentId || chatSession.aiBotInfo?.aiBotId
//     const agentAliasId = props.agentAliasId || chatSession.aiBotInfo?.aiBotAliasId
//     console.log(`Agent (id: ${agentId}, aliasId: ${agentAliasId}) Prompt:\n ${prompt} `)

//     if (!agentId) throw new Error('No Agent ID found in invoke request')
//     if (!agentAliasId) throw new Error('No Agent Alias ID found in invoke request')

//     const response = await amplifyClient.queries.invokeBedrockAgent({
//         prompt: prompt,
//         agentId: agentId,
//         agentAliasId: agentAliasId,
//         chatSessionId: chatSession.id
//     })
//     console.log('Bedrock Agent Response: ', response)

// }

// const setChatSessionFirstMessageSummary = async (firstMessageBody: string, targetChatSession: Schema['ChatSession']['type']) => {
//     const outputStructure = {
//         title: "SummarizeMessageIntnet",
//         description: "Summarize the intent of the user's message?",
//         type: "object",
//         properties: {
//             summary: {
//                 type: 'string',
//                 description: `Message intent summary in 20 characters or fewer.`,
//                 // maxLength: 20
//             }
//         },
//         required: ['summary'],
//     };

//     const structuredResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
//         chatSessionId: targetChatSession.id,
//         lastMessageText: firstMessageBody,
//         outputStructure: JSON.stringify(outputStructure)
//     })
//     console.log("Structured Output Response: ", structuredResponse)
//     if (structuredResponse.data) {
//         const messageIntent = jsonParseHandleError(structuredResponse.data)
//         if (messageIntent) {
//             await amplifyClient.models.ChatSession.update({
//                 id: targetChatSession.id,
//                 firstMessageSummary: messageIntent.summary as string
//             })
//         }

//     } else console.log('No structured output found in response: ', structuredResponse)
// }

// const invokeProductionAgent = async (prompt: string, chatSession: Schema['ChatSession']['type']) => {
//     amplifyClient.queries.invokeProductionAgent({ lastMessageText: prompt, chatSessionId: chatSession.id }).then(
//         (response) => {
//             console.log("bot response: ", response)
//         }
//     )
// }

// const combineAndSortMessages = ((arr1: Array<Message>, arr2: Array<Message>) => {
//     const combinedMessages = [...arr1, ...arr2]
//     const uniqueMessages = combinedMessages.filter((message, index, self) =>
//         index === self.findIndex((p) => p.id === message.id)
//     );
//     return uniqueMessages.sort((a, b) => {
//         if (!a.createdAt || !b.createdAt) throw new Error("createdAt is missing")
//         return a.createdAt.localeCompare(b.createdAt)
//     });
// })


function Page({ params }: { params?: { chatSessionId: string } }) {

    // const [messages, setMessages] = useState<Array<Schema["ChatMessage"]["createType"]>>([]);
    // const [userPrompt, setUserPrompt] = useState('');
    // const [isGenAiResponseLoading, setIsGenAiResponseLoading] = useState(false);
    // const [characterStreamMessage, setCharacterStreamMessage] = useState<Message>({ role: "ai", content: "", createdAt: new Date().toISOString() });
    const [chatSessions, setChatSessions] = useState<Array<Schema["ChatSession"]["type"]>>([]);
    const [groupedChatSessions, setGroupedChatSessions] = useState<SideNavigationProps.Item[]>([])
    const [initialActiveChatSession, setInitialActiveChatSession] = useState<Schema["ChatSession"]["type"]>();
    const [LiveUpdateActiveChatSession, setLiveUpdateActiveChatSession] = useState<Schema["ChatSession"]["type"]>();
    // const [suggestedPrompts, setSuggestedPromptes] = useState<string[]>([]);
    const [glossaryBlurbs, setGlossaryBlurbs] = useState<{ [key: string]: string }>({});
    const { user } = useAuthenticator((context) => [context.user]);
    const router = useRouter();
    const [navigationOpen, setNavigationOpen] = useState(true);

    // const [, setCharacterStream] = useState<{ content: string, index: number }[]>([{
    //     content: "\n\n\n",
    //     index: -1
    // }]);



    //Set the chat session from params
    useEffect(() => {
        if (params && params.chatSessionId) {
            amplifyClient.models.ChatSession.get({ id: params.chatSessionId }).then(({ data: chatSession }) => {
                if (chatSession) {
                    setInitialActiveChatSession(chatSession)

                    console.log('Loaded chat session. Ai Bot Info:', chatSession.aiBotInfo)

                } else {
                    console.log(`Chat session ${params.chatSessionId} not found`)
                }
            })
        } else {
            console.log("No chat session id in params: ", params)
        }
    }, [params])

    //Subscribe to updates of the active chat session
    useEffect(() => {
        if (params && params.chatSessionId) {
            amplifyClient.models.ChatSession.observeQuery({
                filter: {
                    // owner: { eq: user.userId }
                    id: { eq: params.chatSessionId }
                }
            }).subscribe({
                next: (data) => setLiveUpdateActiveChatSession(data.items[0]),
                error: (error) => console.error('Error subscribing the chat session', error)
            })
        } else {
            console.log("No chat session id in params: ", params)
        }
    }, [params])

    // // This runs when the chat session messages change
    // // The blurb below sets the suggested prompts and the isLoading indicator
    // useEffect(() => {

    //     // console.log("initialActiveChatSession hash: ", createHash('md5').update("dasf").digest('hex'))
    //     console.log("Messages: ", messages)
    //     // console.log("initialActiveChatSession: ", initialActiveChatSession)

    //     // console.log("Messages hash: ", createHash('md5').update(JSON.stringify(messages)).digest('hex'))
    //     // console.log("initialActiveChatSession hash: ", createHash('md5').update(JSON.stringify(initialActiveChatSession || "")).digest('hex'))

    //     //Reset the character stream when we get a new message
    //     setCharacterStream(() => {
    //         console.log("Resetting character stream")
    //         return [{
    //             content: "\n\n\n",
    //             index: -1
    //         }]
    //     })
    //     setCharacterStreamMessage(() => ({
    //         content: "",
    //         role: "ai",
    //         createdAt: new Date().toISOString()
    //     }))


    //     //Set the default prompts if this is the first message
    //     if (
    //         !messages.length && //No messages currently in the chat
    //         initialActiveChatSession &&
    //         initialActiveChatSession.aiBotInfo &&
    //         initialActiveChatSession.aiBotInfo.aiBotId &&
    //         initialActiveChatSession.aiBotInfo.aiBotId in defaultAgents
    //     ) setSuggestedPromptes(defaultAgents[initialActiveChatSession.aiBotInfo.aiBotId].samplePrompts)

    //     //If there are no messages, or the last message is an AI message with no tool calls, prepare for a human message
    //     if (
    //         messages.length &&
    //         messages[messages.length - 1].role === "ai" &&
    //         (!messages[messages.length - 1].tool_calls || messages[messages.length - 1].tool_calls === "[]") &&
    //         messages[messages.length - 1].responseComplete
    //     ) {
    //         console.log('Ready for human response')
    //         setIsGenAiResponseLoading(false)

    //         async function fetchAndSetSuggestedPrompts() {
    //             setSuggestedPromptes([])
    //             if (!initialActiveChatSession || !initialActiveChatSession.id) throw new Error("No active chat session")

    //             const suggestedPromptsResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
    //                 chatSessionId: initialActiveChatSession.id,
    //                 lastMessageText: "Suggest three follow up prompts",
    //                 usePastMessages: true,
    //                 outputStructure: JSON.stringify({
    //                     title: "RecommendNextPrompt", //title and description help the llm to know how to fill the arguments out
    //                     description: "Help the user chose the next prompt to send.",
    //                     type: "object",
    //                     properties: {// Change anyting in the properties according to the json schema reference: https://json-schema.org/understanding-json-schema/reference
    //                         suggestedPrompts: {
    //                             type: 'array',
    //                             items: {
    //                                 type: 'string'
    //                             },
    //                             minItems: 3,
    //                             maxItems: 3,
    //                             description: `
    //                             Prompts to suggest to a user when interacting with a large language model
    //                             `
    //                         }
    //                     },
    //                     required: ['suggestedPrompts'],
    //                 })
    //             })
    //             console.log("Suggested Prompts Response: ", suggestedPromptsResponse)
    //             if (suggestedPromptsResponse.data) {
    //                 const newSuggestedPrompts = jsonParseHandleError(suggestedPromptsResponse.data)
    //                 if (newSuggestedPrompts) setSuggestedPromptes(newSuggestedPrompts.suggestedPrompts as string[])
    //                 // const newSuggestedPrompts = JSON.parse(suggestedPromptsResponse.data).suggestedPrompts as string[]
    //             } else console.log('No suggested prompts found in response: ', suggestedPromptsResponse)
    //         }
    //         fetchAndSetSuggestedPrompts()
    //     } else if (messages.length) setIsGenAiResponseLoading(true) //This is so if you re-load a page while the agent is processing is loading is set to true.

    // }, [JSON.stringify(messages), JSON.stringify(initialActiveChatSession)])

    // List the user's chat sessions
    useEffect(() => {
        console.log("Listing User's Chat Sessions")
        if (user) {
            amplifyClient.models.ChatSession.observeQuery({
                filter: {
                    // owner: { eq: user.userId }
                    owner: { contains: user.userId }
                }
            }).subscribe({
                next: (data) => {
                    if (initialActiveChatSession) { // If there is an active chat session, show the other chat sessions with the same ai bot
                        setChatSessions(data.items.filter(item => item.aiBotInfo?.aiBotName === initialActiveChatSession?.aiBotInfo?.aiBotName))
                    } else if (!params?.chatSessionId) { //If no chat session is supplied, list all chat sessions.
                        setChatSessions(data.items)
                    }
                }
            })
        }

    }, [user, initialActiveChatSession, params?.chatSessionId])

    // Groupd the user's chat sessions
    useEffect(() => {
        console.log("Grouping Chat Sessions")
        const newGroupedChatSessions = groupChatsByMonth(chatSessions)
        setGroupedChatSessions(newGroupedChatSessions)
    }, [chatSessions])

    // // Subscribe to messages of the active chat session
    // useEffect(() => {
    //     console.log("Subscribing to messages of the active chat session")
    //     // setMessages([])
    //     if (initialActiveChatSession) {
    //         const sub = amplifyClient.models.ChatMessage.observeQuery({
    //             filter: {
    //                 chatSessionId: { eq: initialActiveChatSession.id }
    //             }
    //         }).subscribe({
    //             next: ({ items }) => { //isSynced is an option here to
    //                 setMessages((prevMessages) => {
    //                     //If the message has type plot, attach the previous tool_table_events and tool_table_trend messages to it.
    //                     const sortedMessages = combineAndSortMessages(prevMessages, items)

    //                     const sortedMessageWithPlotContext = sortedMessages.map((message, index) => {
    //                         const messageCatigory = getMessageCatigory(message)
    //                         if (messageCatigory === 'tool_plot') {
    //                             //Get the messages with a lower index than the tool_plot's index
    //                             const earlierMessages = sortedMessages.slice(0, index).reverse()

    //                             const earlierEventsTable = earlierMessages.find((previousMessage) => {
    //                                 const previousMessageCatigory = getMessageCatigory(previousMessage)
    //                                 return previousMessageCatigory === 'tool_table_events'
    //                             })

    //                             const earlierTrendTable = earlierMessages.find((previousMessage) => {
    //                                 const previousMessageCatigory = getMessageCatigory(previousMessage)
    //                                 return previousMessageCatigory === 'tool_table_trend'
    //                             })

    //                             return {
    //                                 ...message,
    //                                 previousTrendTableMessage: earlierTrendTable,
    //                                 previousEventTableMessage: earlierEventsTable
    //                             }
    //                         } else return message
    //                     })
    //                     return sortedMessageWithPlotContext
    //                 })
    //             }
    //         }
    //         )
    //         return () => sub.unsubscribe();
    //     }

    // }, [initialActiveChatSession])

    // // Subscribe to the token stream for this chat session
    // useEffect(() => {
    //     console.log("Subscribing to the token stream for this chat session")
    //     if (initialActiveChatSession) {
    //         const sub = amplifyClient.subscriptions.recieveResponseStreamChunk({ chatSessionId: initialActiveChatSession.id }).subscribe({
    //             next: (newChunk) => {
    //                 // console.log('Message Stream Chunk: ', chunk)
    //                 setCharacterStream((prevStream) => {

    //                     const chunkIndex = (typeof newChunk.index === 'undefined' || newChunk.index === null) ? (prevStream.length + 1) : newChunk.index

    //                     // console.log("Initial Chunk Index: ", newChunk.index, " Final Chunk Index: ", chunkIndex," Content: ", newChunk.chunk, ' First Chunk: ', prevStream[0])

    //                     const existingIndex = prevStream.findIndex(item => item.index === chunkIndex);
    //                     const chunkIndexInPrevStream = prevStream.findIndex(item => item.index > chunkIndex);
    //                     const newStream = prevStream

    //                     const formatedNewChunk = { index: chunkIndex, content: newChunk.chunk }

    //                     if (existingIndex !== -1) {
    //                         // Replace chunk with the same index
    //                         newStream[existingIndex] = formatedNewChunk
    //                     } else if (chunkIndexInPrevStream === -1) {
    //                         // If no larger index found, append to end
    //                         newStream.push(formatedNewChunk);
    //                     } else {
    //                         // Insert at the found position
    //                         newStream.splice(chunkIndexInPrevStream, 0, formatedNewChunk);
    //                     }

    //                     setCharacterStreamMessage({
    //                         content: newStream.map(chunk => chunk.content).join(""),
    //                         role: "ai",
    //                         createdAt: new Date().toISOString()
    //                     })

    //                     return newStream
    //                 })

    //                 // setCharacterStreamMessage((prevStreamMessage) => ({
    //                 //     content: prevStreamMessage ? (prevStreamMessage.content || "") + chunk : chunk,
    //                 //     role: "ai",
    //                 //     createdAt: new Date().toISOString()
    //                 // }))
    //             }
    //         }
    //         )
    //         return () => sub.unsubscribe();
    //     }

    // }, [initialActiveChatSession])



    async function createChatSession(chatSession: Schema['ChatSession']['createType']) {
        // setMessages([])
        amplifyClient.models.ChatSession.create(chatSession).then(({ data: newChatSession }) => {
            if (newChatSession) {
                router.push(`/chat/${newChatSession.id}`)
            }
        })
    }



    // async function addChatMessage(props: { body: string, role: "human" | "ai" | "tool", trace?: string, chainOfThought?: boolean }) {
    //     const targetChatSessionId = initialActiveChatSession?.id;

    //     setMessages((previousMessages) => [
    //         ...previousMessages,
    //         {
    //             id: "temp",
    //             content: props.body,
    //             role: "human",
    //             createdAt: new Date().toISOString(),
    //         }
    //     ])

    //     const newMessage = await amplifyClient.models.ChatMessage.create({
    //         content: props.body,
    //         trace: props.trace,
    //         role: props.role,
    //         chatSessionId: targetChatSessionId,
    //         chainOfThought: props.chainOfThought
    //     })

    //     // Remove the message with the id "temp"
    //     setMessages((previousMessages) => [
    //         ...previousMessages.filter(message => message.id != "temp"),
    //         newMessage.data!
    //     ])

    //     if (targetChatSessionId) {
    //         return newMessage
    //     }

    // }

    // // const onPromptSend = ({ detail: { value } }: { detail: { value: string } }) => {
    // async function addUserChatMessage({ detail: { value } }: { detail: { value: string } }) {
    //     if (!messages.length) {
    //         console.log("This is the initial message. Getting summary for chat session")
    //         if (!initialActiveChatSession) throw new Error("No active chat session")
    //         setChatSessionFirstMessageSummary(value, initialActiveChatSession)
    //     }
    //     // await addChatMessage({ body: body, role: "human" })
    //     sendMessageToChatBot(value);
    //     setUserPrompt("")
    // }

    // async function sendMessageToChatBot(prompt: string) {
    //     setIsGenAiResponseLoading(true);
    //     // await addChatMessage({ body: prompt, role: "human" })

    //     if (initialActiveChatSession?.aiBotInfo?.aiBotAliasId) {
    //         await invokeBedrockAgentParseBodyGetTextAndTrace({ prompt: prompt, chatSession: initialActiveChatSession })
    //         // if (!response) throw new Error("No response from agent");
    //     } else {
    //         switch (initialActiveChatSession?.aiBotInfo?.aiBotName) {
    //             case defaultAgents.FoundationModel.name:
    //                 await addChatMessage({ body: prompt, role: "human" })
    //                 console.log("invoking the foundation model")
    //                 const responseText = await invokeBedrockModelParseBodyGetText(prompt)
    //                 if (!responseText) throw new Error("No response from agent");
    //                 addChatMessage({ body: responseText, role: "ai" })
    //                 break
    //             case defaultAgents.MaintenanceAgent.name:
    //                 await addChatMessage({ body: prompt, role: "human" })
    //                 await invokeBedrockAgentParseBodyGetTextAndTrace({
    //                     prompt: prompt,
    //                     chatSession: initialActiveChatSession,
    //                     agentAliasId: (defaultAgents.MaintenanceAgent as BedrockAgent).agentAliasId,
    //                     agentId: (defaultAgents.MaintenanceAgent as BedrockAgent).agentId,
    //                 })
    //                 // console.log("MaintenanceAgentResponse: ", response)
    //                 // addChatMessage({ body: response!.text!, role: "ai" })
    //                 break
    //             case defaultAgents.ProductionAgent.name:
    //                 await addChatMessage({ body: prompt, role: "human", chainOfThought: true })
    //                 await invokeProductionAgent(prompt, initialActiveChatSession)
    //                 break;
    //             case defaultAgents.PlanAndExecuteAgent.name:
    //                 await addChatMessage({ body: prompt, role: "human" })
    //                 const planAndExecuteResponse = await amplifyClient.queries.invokePlanAndExecuteAgent({ lastMessageText: prompt, chatSessionId: initialActiveChatSession.id })
    //                 console.log('Plan and execute response: ', planAndExecuteResponse)
    //                 break;
    //             default:
    //                 throw new Error("No Agent Configured");
    //                 break;
    //         }
    //     }
    // }


    async function getGlossary(message: Message) {

        if (!message.chatSessionId) throw new Error(`No chat session id in message: ${message}`)

        if (message.chatSessionId in glossaryBlurbs) return


        const generateGlossaryResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
            chatSessionId: message.chatSessionId,
            lastMessageText: `Define any uncommon or industry specific terms in the message below\n<message>${message.content}</message>`,
            usePastMessages: false,
            outputStructure: JSON.stringify({
                title: "DefineGlossaryTerms", //title and description help the llm to know how to fill the arguments out
                description: "Create a JSON object which describes complex technical terms in the text. Only define terms which may be confuse some engineers",
                type: "object",
                properties: {// Change anyting in the properties according to the json schema reference: https://json-schema.org/understanding-json-schema/reference
                    glossaryArray: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                term: { type: 'string' },
                                definition: { type: 'string' }
                            },
                            required: ['term', 'description']
                        },
                        description: `Array of defined glossary terms`
                    }
                },
                required: ['glossaryArray'],
            })
        })
        console.log("Generate Glossary Response: ", generateGlossaryResponse)
        if (generateGlossaryResponse.data) {
            const newGeneratedGlossary = jsonParseHandleError(generateGlossaryResponse.data).glossaryArray as { term: string, definition: string }[]
            console.log('Generated Glossary Entry: ', newGeneratedGlossary)
            const newGlossaryBlurb = newGeneratedGlossary.map(glossaryEntry => `## ${glossaryEntry.term}: \n ${glossaryEntry.definition}`).join("\n\n")
            // const newGlossaryBlurb = newGeneratedGlossary.map(glossaryEntry => (<><h4>${glossaryEntry.term}</h4><p>{glossaryEntry.definition}</p></>)).join("\n")
            if (newGeneratedGlossary) setGlossaryBlurbs((prevGlossaryBlurbs) => ({ ...prevGlossaryBlurbs, [message.id || "ShouldNeverHappen"]: newGlossaryBlurb }))
            // const newSuggestedPrompts = JSON.parse(suggestedPromptsResponse.data).suggestedPrompts as string[]
        } else console.log('Error Generating Glossary: ', generateGlossaryResponse)
    }



    // Helper function to group chat sessions by month
    const groupChatsByMonth = (chatSessions: Array<Schema["ChatSession"]["type"]>): SideNavigationProps.Item[] => {
        const grouped = chatSessions.reduce((acc: { [key: string]: Array<Schema["ChatSession"]["type"]> }, session) => {
            if (!session.createdAt) throw new Error("Chat session missing createdAt timestamp");

            const date = new Date(session.createdAt);
            const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });

            if (!acc[monthYear]) {
                acc[monthYear] = [];
            }

            const insertIndex = acc[monthYear].findIndex(existingSession =>
                existingSession.createdAt && session.createdAt &&
                existingSession.createdAt < session.createdAt
            );
            // If no index found (insertIndex === -1), push to end, otherwise insert at index
            if (insertIndex === -1) {
                acc[monthYear].push(session);
            } else {
                acc[monthYear].splice(insertIndex, 0, session);
            }
            // acc[monthYear].push(session);


            return acc;
        }, {});

        return Object.entries(grouped).reverse().map(([monthYear, groupedChatSessions]): SideNavigationProps.Item => ({
            type: "section",
            text: monthYear,
            // controlId: "",
            items: [{
                type: "link",
                href: `/chat`,
                text: "",
                // controlId: "",
                info: <Tiles
                    onChange={({ detail }) => {
                        // setValue(detail.value);
                        router.push(`/chat/${detail.value}`);
                    }}
                    value={(params && params.chatSessionId) ? params.chatSessionId : "No Active Chat Session"}

                    items={
                        groupedChatSessions.map((groupedChatSession) => ({
                            controlId: groupedChatSession.id,
                            label: groupedChatSession.firstMessageSummary?.slice(0, 50),
                            description: `${formatDate(groupedChatSession.createdAt)} - AI: ${groupedChatSession.aiBotInfo?.aiBotName || 'Unknown'}`,
                            value: groupedChatSession.id
                        }))
                    }
                />
            }]
        }));
    };

    return (
        <div className='page-container'>
            <Tabs
                disableContentPaddings
                tabs={[
                    {
                        label: "Chat Agents",
                        id: "first",
                        content:
                            <AppLayout
                                navigationOpen={navigationOpen}
                                onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
                                tools={
                                    <HelpPanel
                                        header={
                                            <h2>Plan and Execute Steps</h2>
                                        }>
                                        {/* <pre>
                                            {JSON.stringify(LiveUpdateActiveChatSession, null, 2)}
                                        </pre> */}
                                        {[
                                            ...(LiveUpdateActiveChatSession?.pastSteps?.map((step) => ({ stepType: 'past', content: step })) ?? []),
                                            ...(LiveUpdateActiveChatSession?.planSteps?.map((step) => ({ stepType: 'plan', content: step })) ?? []),
                                        ].map((step) => {
                                            try {
                                                const stepContent = JSON.parse(step.content as string)
                                                return (
                                                    <Tooltip
                                                        key={step.content as string}
                                                        title={<pre
                                                            style={{ //Wrap long lines
                                                                whiteSpace: 'pre-wrap',
                                                                wordWrap: 'break-word',
                                                                overflowWrap: 'break-word',
                                                            }}
                                                        >
                                                            {stringify(stepContent)}
                                                        </pre>}
                                                        arrow
                                                        placement="left"
                                                        slotProps={{
                                                            tooltip: {
                                                                sx: {
                                                                    maxWidth: 2000,
                                                                },
                                                            },
                                                        }}
                                                    >

                                                        <div className="step-container" key={step.content as string}>
                                                            <Steps
                                                                // className='steps'
                                                                steps={[
                                                                    {
                                                                        status: (step.stepType === 'past' ? "success" : "loading"),
                                                                        header: stepContent.title,
                                                                        statusIconAriaLabel: (step.stepType === 'past' ? "Success" : "Loading")
                                                                    }
                                                                ]}
                                                            />
                                                        </div>
                                                    </Tooltip>
                                                )
                                            } catch {
                                                return <p>{step.content}</p>
                                            }
                                        })}
                                    </HelpPanel>}
                                navigation={
                                    <SideNavigation
                                        header={{
                                            href: '#',
                                            text: 'Sessions',
                                        }}
                                        items={groupedChatSessions}

                                    />


                                }
                                content={
                                    <ChatBox
                                            chatSession={initialActiveChatSession}
                                            glossaryBlurbs={glossaryBlurbs}
                                            getGlossary={getGlossary}
                                            // addUserChatMessage={addUserChatMessage}
                                        />

                                    // <div
                                    //     className='chat-container'
                                    //     style={{
                                    //         // maxHeight: '100%', // Constrain to parent height
                                    //         // height: '100%',    // Take full height
                                    //         // display: 'flex',
                                    //         flexDirection: 'column-reverse', //The intent is for this to enable auto-scrolling
                                    //         overflow: 'auto',
                                    //         // border: '1px solid #ccc',
                                    //         // borderRadius: '4px',
                                    //     }}
                                    // >
                                    //     <ChatBox
                                    //         chatSession={initialActiveChatSession}
                                    //         glossaryBlurbs={glossaryBlurbs}
                                    //         getGlossary={getGlossary}
                                    //         // addUserChatMessage={addUserChatMessage}
                                    //     />

                                    //     <Container
                                    //         header={
                                    //             <>
                                    //                 <Header variant="h3">Generative AI chat - {initialActiveChatSession?.aiBotInfo?.aiBotName}</Header>
                                    //                 <span className='prompt-label'>Try one of these example prompts</span>
                                    //                 <ButtonDropdown
                                    //                     ariaLabel="Suggested Prompts"
                                    //                     items={[
                                    //                         ...suggestedPrompts.map((prompt) => ({ id: prompt, text: prompt })),
                                    //                     ]}
                                    //                     onItemClick={({ detail }) => {
                                    //                         addUserChatMessage({ detail: { value: detail.id } });
                                    //                     }}
                                    //                 />
                                    //             </>
                                    //         }
                                    //         fitHeight
                                    //         disableContentPaddings
                                    //         footer={
                                    //             <FormField
                                    //                 stretch
                                    //                 constraintText={
                                    //                     <>
                                    //                         Use of this service is subject to the{' '}
                                    //                         <Link href="#" external variant="primary" fontSize="inherit">
                                    //                             AWS Responsible AI Policy
                                    //                         </Link>
                                    //                         .
                                    //                     </>
                                    //                 }
                                    //             >

                                    //                 <PromptInput
                                    //                     onChange={({ detail }) => setUserPrompt(detail.value)}
                                    //                     onAction={addUserChatMessage}
                                    //                     value={userPrompt}
                                    //                     actionButtonAriaLabel={isGenAiResponseLoading ? 'Send message button - suppressed' : 'Send message'}
                                    //                     actionButtonIconName="send"
                                    //                     ariaLabel={isGenAiResponseLoading ? 'Prompt input - suppressed' : 'Prompt input'}
                                    //                     placeholder="Ask a question"
                                    //                     autoFocus
                                    //                 />
                                    //             </FormField>
                                    //         }
                                    //     >

                                    //         <Messages
                                    //             messages={[
                                    //                 ...messages,
                                    //                 ...(characterStreamMessage.content !== "" ? [characterStreamMessage] : [])
                                    //             ]}
                                    //             getGlossary={getGlossary}
                                    //             isLoading={isGenAiResponseLoading}
                                    //             glossaryBlurbs={glossaryBlurbs}
                                    //         />
                                    //     </Container>
                                    // </div>

                                }
                            />,
                        action:
                            <ButtonDropdown
                                variant="icon"
                                ariaLabel="Query actions for first tab"
                                items={[
                                    // ...Object.entries(defaultAgents).map(([agentId, agentInfo]) => ({ agentId: agentId, agentName: agentInfo.name })),
                                    ...Object.entries(defaultAgents).map(([agentId, agentInfo]) => ({ id: agentId, text: agentInfo.name })),
                                ]}
                                expandToViewport={true}
                                onItemClick={async ({ detail }) => {
                                    const agentInfo = defaultAgents[detail.id];
                                    // const agentAliasId = agent.agentId && !(agent.agentId in defaultAgents) ? await getAgentAliasId(agent.agentId) : null
                                    createChatSession({ aiBotInfo: { aiBotName: agentInfo.name, aiBotId: detail.id } })
                                }}

                            />
                    },

                    {
                        label: "Links",
                        id: "fourth",
                        content:
                            <div className='links-container'>
                                <Container>
                                    <StorageBrowser />
                                </Container>
                            </div>,
                    },

                ]}
            />
        </div>
    );
};

export default withAuth(Page)