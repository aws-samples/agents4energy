"use client"
import { stringify } from 'yaml'

import React, { useEffect, useState } from 'react';
import type { Schema } from '@/../amplify/data/resource';
import { amplifyClient, invokeBedrockModelParseBodyGetText } from '@/utils/amplify-utils';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter } from 'next/navigation';

import { formatDate } from "@/utils/date-utils";
import DropdownMenu from '@/components/DropDownMenu';
import SideBar from '@/components/SideBar';

import { defaultAgents, BedrockAgent } from '@/utils/config'
import { Message } from '@/utils/types'

import '@aws-amplify/ui-react/styles.css'

import {
    Typography,
    Box,
    MenuItem,
    IconButton,
    Card,
    CardContent,
    CardActions,
    Button,
    Tooltip
} from '@mui/material';

import DeleteIcon from '@mui/icons-material/Delete';

import { ChatUIProps } from "@/components/chat-ui/chat-ui";
import { withAuth } from '@/components/WithAuth';

import dynamic from 'next/dynamic'

import { createHash } from 'crypto';

const DynamicChatUI = dynamic<ChatUIProps>(() => import('../../components/chat-ui/chat-ui').then(mod => mod.ChatUI), {
    ssr: false,
});

type ListBedrockAgentsResponseType = {
    agentSummaries: {
        agentId: string;
        agentName: string;
        agentStatus: string;
        latestAgentVersion: string;
        updatedAt: string;
    }[];
}

type ListAgentIdsResponseType = {
    agentAliasSummaries:
    {
        agentAliasId: string,
        agentAliasName: string,
        agentAliasStatus: string,
        createdAt: string,
        description: string,
        routingConfiguration:
        {
            agentVersion: string,
            provisionedThroughput: string
        }[],
        updatedAt: string
    }[]
    ,
    nextToken: string
}

const jsonParseHandleError = (jsonString: string) => {
    try {
        return JSON.parse(jsonString)
    } catch {
        console.warn(`Could not parse string: ${jsonString}`)
    }
}

const invokeBedrockAgentParseBodyGetTextAndTrace = async (props: { prompt: string, chatSession: Schema['ChatSession']['type'], agentId?: string, agentAliasId?: string }) => {
    const { prompt, chatSession } = props
    const agentId = props.agentId || chatSession.aiBotInfo?.aiBotId
    const agentAliasId = props.agentAliasId || chatSession.aiBotInfo?.aiBotAliasId
    console.log(`Agent (id: ${agentId}, aliasId: ${agentAliasId}) Prompt:\n ${prompt} `)

    if (!agentId) throw new Error('No Agent ID found in invoke request')
    if (!agentAliasId) throw new Error('No Agent Alias ID found in invoke request')

    const response = await amplifyClient.queries.invokeBedrockAgent({
        prompt: prompt,
        agentId: agentId,
        agentAliasId: agentAliasId,
        chatSessionId: chatSession.id
    })
    console.log('Bedrock Agent Response: ', response)
}

const setChatSessionFirstMessageSummary = async (firstMessageBody: string, targetChatSession: Schema['ChatSession']['type']) => {
    const outputStructure = {
        title: "SummarizeMessageIntnet",
        description: "Summarize the intent of the user's message?",
        type: "object",
        properties: {
            summary: {
                type: 'string',
                description: `Message intent summary in 20 characters or fewer.`,
                // maxLength: 20
            }
        },
        required: ['summary'],
    };

    const structuredResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
        chatSessionId: targetChatSession.id,
        lastMessageText: firstMessageBody,
        outputStructure: JSON.stringify(outputStructure)
    })
    console.log("Structured Output Response: ", structuredResponse)
    if (structuredResponse.data) {
        const messageIntent = jsonParseHandleError(structuredResponse.data)
        if (messageIntent) {
            await amplifyClient.models.ChatSession.update({
                id: targetChatSession.id,
                firstMessageSummary: messageIntent.summary as string
            })
        }

    } else console.log('No structured output found in response: ', structuredResponse)
}

const invokeProductionAgent = async (prompt: string, chatSession: Schema['ChatSession']['type']) => {
    amplifyClient.queries.invokeProductionAgent({ lastMessageText: prompt, chatSessionId: chatSession.id }).then(
        (response) => {
            console.log("bot response: ", response)
        }
    )
}

const getAgentAliasId = async (agentId: string) => {
    const response = await amplifyClient.queries.listBedrockAgentAliasIds({ agentId: agentId })
    // console.log('get Agent Alias Id Response: ', response.data)
    if (!(response.data && response.data.body)) {
        console.warn('No response getting Agent Alias ID for Agent ID ', agentId)
        return
    }
    // const listAgnetAliasIdsResponseBody = JSON.parse(response.data.body) as ListAgentIdsResponseType
    const listAgnetAliasIdsResponseBody = jsonParseHandleError(response.data.body) as ListAgentIdsResponseType

    if (!listAgnetAliasIdsResponseBody) {
        console.warn('Could not parse responce body for getting Agent Alias ID for Agent ID ', agentId, '\n response body: ', response.data.body)
        return
    }
    //Get the most recently created AliasId
    const mostRecentAliasId = listAgnetAliasIdsResponseBody.agentAliasSummaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].agentAliasId

    return mostRecentAliasId
}

const combineAndSortMessages = ((arr1: Array<Message>, arr2: Array<Message>) => {
    const combinedMessages = [...arr1, ...arr2]
    const uniqueMessages = combinedMessages.filter((message, index, self) =>
        index === self.findIndex((p) => p.id === message.id)
    );
    return uniqueMessages.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) throw new Error("createdAt is missing")
        return a.createdAt.localeCompare(b.createdAt)
    });
})

// function Page({ params }: { params?: { chatSessionId: string } }) {
function Page({ searchParams }: { searchParams: { id?: string } }) {
    const [messages, setMessages] = useState<Array<Schema["ChatMessage"]["createType"]>>([]);
    // const [messages, setMessages] = useState<Array<Message>>([]);

    const [, setCharacterStream] = useState<{ content: string, index: number }[]>([{
        content: "\n\n\n",
        index: -1
    }]);
    const [characterStreamMessage, setCharacterStreamMessage] = useState<Message>({ role: "ai", content: "", createdAt: new Date().toISOString() });
    const [chatSessions, setChatSessions] = useState<Array<Schema["ChatSession"]["type"]>>([]);
    const [initialActiveChatSession, setInitialActiveChatSession] = useState<Schema["ChatSession"]["type"]>();
    const [LiveUpdateActiveChatSession, setLiveUpdateActiveChatSession] = useState<Schema["ChatSession"]["type"]>();
    const [suggestedPrompts, setSuggestedPromptes] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false);
    const [bedrockAgents, setBedrockAgents] = useState<ListBedrockAgentsResponseType>();

    const { user } = useAuthenticator((context) => [context.user]);
    const router = useRouter();

    //Set the chat session from params
    useEffect(() => {
        if (searchParams.id) {
            amplifyClient.models.ChatSession.get({ id: searchParams.id }).then(({ data: chatSession }) => {
                if (chatSession) {
                    setInitialActiveChatSession(chatSession)

                    console.log('Loaded chat session. Ai Bot Info:', chatSession.aiBotInfo)

                } else {
                    console.log(`Chat session ${searchParams.id} not found`)
                }
            })
        } else {
            console.log("No chat session id in params: ", searchParams)
        }
    }, [searchParams])

    //Subscribe to updates of the active chat session
    useEffect(() => {
        if (searchParams.id) {
            amplifyClient.models.ChatSession.observeQuery({
                filter: {
                    // owner: { eq: user.userId }
                    id: { eq: searchParams.id }
                }
            }).subscribe({
                next: (data) => setLiveUpdateActiveChatSession(data.items[0]),
                error: (error) => console.error('Error subscribing the chat session', error)
            })
        } else {
            console.log("No chat session id in params: ", searchParams)
        }
    }, [searchParams])

    // This runs when the chat session messages change
    // The blurb below sets the suggested prompts and the isLoading indicator
    useEffect(() => {

        // console.log("initialActiveChatSession hash: ", createHash('md5').update("dasf").digest('hex'))
        console.log("Messages: ", messages)
        console.log("initialActiveChatSession: ", initialActiveChatSession)

        console.log("Messages hash: ", createHash('md5').update(JSON.stringify(messages)).digest('hex'))
        console.log("initialActiveChatSession hash: ", createHash('md5').update(JSON.stringify(initialActiveChatSession || "")).digest('hex'))

        //Reset the character stream when we get a new message
        setCharacterStream(() => {
            console.log("Resetting character stream")
            return [{
                content: "\n\n\n",
                index: -1
            }]
        })
        setCharacterStreamMessage(() => ({
            content: "",
            role: "ai",
            createdAt: new Date().toISOString()
        }))


        //Set the default prompts if this is the first message
        if (
            !messages.length && //No messages currently in the chat
            initialActiveChatSession &&
            initialActiveChatSession.aiBotInfo &&
            initialActiveChatSession.aiBotInfo.aiBotId &&
            initialActiveChatSession.aiBotInfo.aiBotId in defaultAgents
        ) setSuggestedPromptes(defaultAgents[initialActiveChatSession.aiBotInfo.aiBotId].samplePrompts)

        //If there are no messages, or the last message is an AI message with no tool calls, prepare for a human message
        if (
            messages.length &&
            messages[messages.length - 1].role === "ai" &&
            (!messages[messages.length - 1].tool_calls || messages[messages.length - 1].tool_calls === "[]") &&
            messages[messages.length - 1].responseComplete
        ) {
            console.log('Ready for human response')
            setIsLoading(false)

            async function fetchAndSetSuggestedPrompts() {
                setSuggestedPromptes([])
                if (!initialActiveChatSession || !initialActiveChatSession.id) throw new Error("No active chat session")

                const suggestedPromptsResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
                    chatSessionId: initialActiveChatSession?.id,
                    lastMessageText: "Suggest three follow up prompts",
                    usePastMessages: true,
                    outputStructure: JSON.stringify({
                        title: "RecommendNextPrompt",
                        description: "Help the user chose the next prompt to send.",
                        type: "object",
                        properties: {
                            suggestedPrompts: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                },
                                minItems: 3,
                                maxItems: 3,
                                description: `
                                Prompts to suggest to a user when interacting with a large language model
                                `
                            }
                        },
                        required: ['suggestedPrompts'],
                    })
                })
                console.log("Suggested Prompts Response: ", suggestedPromptsResponse)
                if (suggestedPromptsResponse.data) {
                    const newSuggestedPrompts = jsonParseHandleError(suggestedPromptsResponse.data)
                    if (newSuggestedPrompts) setSuggestedPromptes(newSuggestedPrompts.suggestedPrompts as string[])
                    // const newSuggestedPrompts = JSON.parse(suggestedPromptsResponse.data).suggestedPrompts as string[]
                } else console.log('No suggested prompts found in response: ', suggestedPromptsResponse)
            }
            fetchAndSetSuggestedPrompts()
        } else if (messages.length) setIsLoading(true) //This is so if you re-load a page while the agent is processing is loading is set to true.

    }, [JSON.stringify(messages), JSON.stringify(initialActiveChatSession)])

    // List the user's chat sessions
    useEffect(() => {
        if (user) {
            amplifyClient.models.ChatSession.observeQuery({
                filter: {
                    // owner: { eq: user.userId }
                    owner: { contains: user.userId }
                }
            }).subscribe({
                next: (data) => setChatSessions(data.items)
            })
        }

    }, [user])

    // Subscribe to messages of the active chat session
    useEffect(() => {
        // setMessages([])
        if (initialActiveChatSession) {
            const sub = amplifyClient.models.ChatMessage.observeQuery({
                filter: {
                    chatSessionId: { eq: initialActiveChatSession.id }
                }
            }).subscribe({
                next: ({ items }) => { //isSynced is an option here to
                    setMessages((prevMessages) => combineAndSortMessages(prevMessages, items))
                }
            }
            )
            return () => sub.unsubscribe();
        }

    }, [initialActiveChatSession])

    // Subscribe to the token stream for this chat session
    useEffect(() => {
        if (initialActiveChatSession) {
            const sub = amplifyClient.subscriptions.recieveResponseStreamChunk({ chatSessionId: initialActiveChatSession.id }).subscribe({
                next: (newChunk) => {
                    // console.log('Message Stream Chunk: ', chunk)
                    setCharacterStream((prevStream) => {

                        const chunkIndex = (typeof newChunk.index === 'undefined' || newChunk.index === null) ? (prevStream.length + 1) : newChunk.index

                        // console.log("Initial Chunk Index: ", newChunk.index, " Final Chunk Index: ", chunkIndex," Content: ", newChunk.chunk, ' First Chunk: ', prevStream[0])

                        const existingIndex = prevStream.findIndex(item => item.index === chunkIndex);
                        const chunkIndexInPrevStream = prevStream.findIndex(item => item.index > chunkIndex);
                        const newStream = prevStream

                        const formatedNewChunk = { index: chunkIndex, content: newChunk.chunk }

                        if (existingIndex !== -1) {
                            // Replace chunk with the same index
                            newStream[existingIndex] = formatedNewChunk
                        } else if (chunkIndexInPrevStream === -1) {
                            // If no larger index found, append to end
                            newStream.push(formatedNewChunk);
                        } else {
                            // Insert at the found position
                            newStream.splice(chunkIndexInPrevStream, 0, formatedNewChunk);
                        }

                        setCharacterStreamMessage({
                            content: newStream.map(chunk => chunk.content).join(""),
                            role: "ai",
                            createdAt: new Date().toISOString()
                        })

                        return newStream
                    })
                }
            }
            )
            return () => sub.unsubscribe();
        }

    }, [initialActiveChatSession])

    // List the available bedrock agents
    useEffect(() => {
        const fetchListBedrockAgents = async () => {
            const response = await amplifyClient.queries.listBedrockAgents()
            console.log('List Agents Response: ', response.data)
            if (!(response.data && response.data.body)) {
                console.log('No response from listing bedrock agents')
                return
            }

            const listAgentsResponseBody = jsonParseHandleError(response.data.body) as ListBedrockAgentsResponseType
            if (!listAgentsResponseBody) {
                console.log('Could not parse response body from listing bedrock agents')
                return
            }

            console.log('List Bedrock Agents Response Body: ', listAgentsResponseBody)
            setBedrockAgents(listAgentsResponseBody)
            // return listAgentsResponseBody
        }
        fetchListBedrockAgents()
    }, [])

    async function createChatSession(chatSession: Schema['ChatSession']['createType']) {
        setMessages([])
        amplifyClient.models.ChatSession.create(chatSession).then(({ data: newChatSession }) => {
            if (newChatSession) {
                // router.push(`/chat/${newChatSession.id}`)
                router.push(`/chat?id=${newChatSession.id}`)
            }
        })
    }

    async function deleteChatSession(targetSession: Schema['ChatSession']['type']) {
        amplifyClient.models.ChatSession.delete({ id: targetSession.id })
        // Remove the target session from the list of chat sessions
        setChatSessions((previousChatSessions) => previousChatSessions.filter(existingSession => existingSession.id != targetSession.id))
    }

    async function addChatMessage(props: { body: string, role: "human" | "ai" | "tool", trace?: string, chainOfThought?: boolean }) {
        const targetChatSessionId = initialActiveChatSession?.id;

        setMessages((previousMessages) => [
            ...previousMessages,
            {
                id: "temp",
                content: props.body,
                role: "human",
                createdAt: new Date().toISOString(),
            }
        ])

        const newMessage = await amplifyClient.models.ChatMessage.create({
            content: props.body,
            trace: props.trace,
            role: props.role,
            chatSessionId: targetChatSessionId,
            chainOfThought: props.chainOfThought
        })

        // Remove the message with the id "temp"
        setMessages((previousMessages) => [
            ...previousMessages.filter(message => message.id != "temp"),
            newMessage.data!
        ])

        if (targetChatSessionId) {
            return newMessage
        }

    }

    async function addUserChatMessage(body: string) {
        if (!messages.length) {
            console.log("This is the initial message. Getting summary for chat session")
            if (!initialActiveChatSession) throw new Error("No active chat session")
            setChatSessionFirstMessageSummary(body, initialActiveChatSession)
        }

        sendMessageToChatBot(body);
    }

    async function sendMessageToChatBot(prompt: string) {
        setIsLoading(true);
        await addChatMessage({ body: prompt, role: "human" })
        if (initialActiveChatSession?.aiBotInfo?.aiBotAliasId) {
            await invokeBedrockAgentParseBodyGetTextAndTrace({ prompt: prompt, chatSession: initialActiveChatSession })
            // if (!response) throw new Error("No response from agent");
        } else {
            switch (initialActiveChatSession?.aiBotInfo?.aiBotName) {
                case defaultAgents.FoundationModel.name:
                    // await addChatMessage({ body: prompt, role: "human" })
                    console.log("invoking the foundation model")
                    const responseText = await invokeBedrockModelParseBodyGetText(prompt)
                    if (!responseText) throw new Error("No response from agent");
                    addChatMessage({ body: responseText, role: "ai" })
                    break
                case defaultAgents.MaintenanceAgent.name:
                    await invokeBedrockAgentParseBodyGetTextAndTrace({
                        prompt: prompt,
                        chatSession: initialActiveChatSession,
                        agentAliasId: (defaultAgents.MaintenanceAgent as BedrockAgent).agentAliasId,
                        agentId: (defaultAgents.MaintenanceAgent as BedrockAgent).agentId,
                    })
                    // console.log("MaintenanceAgentResponse: ", response)
                    // addChatMessage({ body: response!.text!, role: "ai" })
                    break
                case defaultAgents.ProductionAgent.name:
                    // await addChatMessage({ body: prompt, role: "human" chainOfThought: true})
                    await invokeProductionAgent(prompt, initialActiveChatSession)
                    break;
                case defaultAgents.PlanAndExecuteAgent.name:
                    // await addChatMessage({ body: prompt, role: "human" })
                    const planAndExecuteResponse = await amplifyClient.queries.invokePlanAndExecuteAgent({ lastMessageText: prompt, chatSessionId: initialActiveChatSession.id })
                    console.log('Plan and execute response: ', planAndExecuteResponse)
                    break;
                default:
                    throw new Error("No Agent Configured");
                    break;
            }
        }
    }

    return (
        <Box sx={{ display: 'flex', padding: 2 }}>
            <SideBar
                anchor='left'
            >
                <Box sx={{ overflow: 'auto' }}>
                    <DropdownMenu buttonText='New Chat Session'>
                        {
                            [
                                ...Object.entries(defaultAgents).map(([agentId, agentInfo]) => ({ agentId: agentId, agentName: agentInfo.name })),
                                ...bedrockAgents?.agentSummaries.filter((agent) => (agent.agentStatus === "PREPARED")) || []
                            ]
                                .map((agent) => (
                                    <MenuItem
                                        key={agent.agentName}
                                        onClick={async () => {
                                            const agentAliasId = agent.agentId && !(agent.agentId in defaultAgents) ? await getAgentAliasId(agent.agentId) : null
                                            createChatSession({ aiBotInfo: { aiBotName: agent.agentName, aiBotId: agent.agentId, aiBotAliasId: agentAliasId } })
                                        }}
                                    >
                                        <Typography sx={{ textAlign: 'center' }}>{agent.agentName}</Typography>
                                    </MenuItem>
                                ))
                        }
                    </DropdownMenu>


                    <Typography sx={{ textAlign: 'center' }}>My Chat Sessions:</Typography>
                    {chatSessions
                        .slice()
                        .sort((a, b) => {
                            if (!a.createdAt || !b.createdAt) throw new Error("createdAt is missing")
                            return a.createdAt < b.createdAt ? 1 : -1
                        })
                        .map((session) => (

                            <Card key={session.id} sx={{ marginBottom: 2, backgroundColor: '#f5f5f5', flexShrink: 0 }}>
                                <CardContent>
                                    <Typography variant="h6" component="div" noWrap>
                                        {session.firstMessageSummary?.slice(0, 50)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {formatDate(session.createdAt)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                        AI: {session.aiBotInfo?.aiBotName || 'Unknown'}
                                    </Typography>
                                </CardContent>
                                <CardActions>
                                    <Button
                                        size="small"
                                        // onClick={() => router.push(`/chat/${session.id}`)}
                                        onClick={() => router.push(`/chat?id=${session.id}`)}
                                    >
                                        Open Chat
                                    </Button>
                                    <IconButton
                                        aria-label="delete"
                                        onClick={() => deleteChatSession(session)}
                                        sx={{ marginLeft: 'auto' }}
                                    >
                                        <DeleteIcon />
                                    </IconButton>
                                </CardActions>
                            </Card>
                        ))
                    }
                </Box>
            </SideBar>


            {searchParams.id ? //Show the chat UI if there is an active chat session
                <Box
                    sx={{ alignItems: 'center', gap: 2, width: "100%" }}
                >
                    {/* <Toolbar /> */}

                    <Box>
                        <Typography variant="h4" gutterBottom>
                            Chat with {initialActiveChatSession?.aiBotInfo?.aiBotName}
                        </Typography>
                    </Box>
                    <Box>

                        <DynamicChatUI
                            onSendMessage={addUserChatMessage}
                            messages={[
                                ...messages,
                                ...(characterStreamMessage.content !== "" ? [characterStreamMessage] : [])
                            ]}
                            running={isLoading}
                        />


                    </Box>
                    <Box sx={{ mt: 5 }}>
                        {
                            !isLoading && (suggestedPrompts.length || !messages.length) ? (
                                <Typography variant="body2">
                                    Suggested Follow Ups:
                                </Typography>
                            ) : (
                                null
                                // <CircularProgress />
                            )
                        }
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {!isLoading && suggestedPrompts.map((prompt) => (
                            <div key={prompt}>
                                <Button onClick={() => addUserChatMessage(prompt)} >
                                    {prompt}
                                </Button>
                            </div>
                        ))
                        }
                    </Box>
                </Box>
                // </div>
                : null}
            {
                (initialActiveChatSession?.aiBotInfo?.aiBotName === defaultAgents.PlanAndExecuteAgent.name) ?
                    <SideBar
                        anchor='right'
                    >
                        <>
                            <Typography variant="h5" sx={{ textAlign: 'center' }}>Plan and execute steps:</Typography>
                            {LiveUpdateActiveChatSession?.pastSteps?.map((step) => {
                                try {
                                    const stepContent = JSON.parse(step as string)
                                    return (
                                        <Tooltip
                                            key={step as string}
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
                                            <Card
                                                key={step as string}
                                                sx={{
                                                    marginBottom: 2,
                                                    backgroundColor: '#e3f2fd',
                                                    flexShrink: 0,
                                                    cursor: 'pointer'
                                                }}
                                                onClick={() => {
                                                    const element = document.getElementById(`## ${stepContent.title}`);
                                                    if (element) {
                                                        element.scrollIntoView({
                                                            behavior: 'smooth',
                                                            block: 'center'
                                                        });
                                                    }
                                                }}
                                            >
                                                <CardContent>
                                                    <Typography variant="h6" component="div">
                                                        {stepContent.title}
                                                    </Typography>
                                                </CardContent>
                                            </Card>
                                        </Tooltip>
                                    )
                                } catch {
                                    return <p>{step}</p>
                                }
                            })}
                            {LiveUpdateActiveChatSession?.planSteps?.map((step) => {
                                try {
                                    const { result, ...stepContent } = JSON.parse(step as string)// Remove the result if it exists from the plan steps
                                    console.info(result)//TODO: remove this
                                    return (
                                        <Tooltip
                                            key={step as string}
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
                                                        maxWidth: 800,
                                                    },
                                                },
                                            }}
                                        >
                                            <Card key={step as string} sx={{ marginBottom: 2, backgroundColor: '#f5f5f5', flexShrink: 0 }}>
                                                <CardContent>
                                                    <Typography variant="h6" component="div">
                                                        {stepContent.title}
                                                    </Typography>
                                                </CardContent>
                                            </Card>
                                        </Tooltip>

                                    )
                                } catch {
                                    return <p>{step}</p>
                                }
                            })}
                        </>
                    </SideBar>
                    : null
            }

        </Box>

    );
};

export default withAuth(Page)