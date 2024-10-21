"use client"
import React, { useEffect, useState } from 'react';
import type { Schema } from '@/../amplify/data/resource';
import { amplifyClient, invokeBedrockModelParseBodyGetText } from '@/utils/amplify-utils';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter } from 'next/navigation';

import { formatDate } from "@/utils/date-utils";
import DropdownMenu from '@/components/DropDownMenu';

import { defaultAgents } from '@/utils/config'

import '@aws-amplify/ui-react/styles.css'

import {
    Typography,
    Box,
    Drawer,
    Toolbar,
    MenuItem,
    IconButton,
    Card,
    CardContent,
    CardActions,
    Button,
    CircularProgress
} from '@mui/material';

import DeleteIcon from '@mui/icons-material/Delete';

import { ChatUI } from "@/components/chat-ui/chat-ui";
import { withAuth } from '@/components/WithAuth';

const drawerWidth = 240;

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

const invokeBedrockAgentParseBodyGetTextAndTrace = async (prompt: string, chatSession: Schema['ChatSession']['type']) => {
    console.log('Prompt: ', prompt)
    if (!chatSession.aiBotInfo?.aiBotAliasId) throw new Error('No Agent Alias ID found in invoke request')
    if (!chatSession.aiBotInfo?.aiBotId) throw new Error('No Agent ID found in invoke request')
    const response = await amplifyClient.queries.invokeBedrockAgent({
        prompt: prompt,
        agentId: chatSession.aiBotInfo?.aiBotId,
        agentAliasId: chatSession.aiBotInfo?.aiBotAliasId,
        chatSessionId: chatSession.id
    })
    console.log('Bedrock Agent Response: ', response.data)
    if (!(response.data)) {
        console.log('No response from bedrock agent after prompt: ', prompt)
        return
    }
    return {
        text: response.data.completion,
        trace: response.data.orchestrationTrace
    }
}

const setChatSessionFirstMessageSummary = async (firstMessageBody: string, targetChatSession: Schema['ChatSession']['type']) => {
    const outputStructure = {
        title: "SummarizeMessageIntnet",
        description: "What intent does the use have when sending this message?",
        type: "object",
        properties: {
            summary: {
                type: 'string',
                description: `message intent title`,
                maxLength: 20
            }
        },
        required: ['summary'],
    };

    const structuredResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
        chatSessionId: targetChatSession.id,
        lastMessageText: "",
        outputStructure: JSON.stringify(outputStructure)
    })
    console.log("Structured Output Response: ", structuredResponse)
    if (structuredResponse.data) {
        const messageIntentSummary = JSON.parse(structuredResponse.data).summary as string
        await amplifyClient.models.ChatSession.update({
            id: targetChatSession.id,
            firstMessageSummary: messageIntentSummary
        })
    } else console.log('No structured output found in response: ', structuredResponse)



}

const invokeProductionAgent = async (prompt: string, chatSession: Schema['ChatSession']['type']) => {
    amplifyClient.queries.invokeProductionAgent({ input: prompt, chatSessionId: chatSession.id }).then(
        (response) => {
            console.log("bot response: ", response)
        }
    )
}

const getAgentAliasId = async (agentId: string) => {
    const response = await amplifyClient.queries.listBedrockAgentAliasIds({ agentId: agentId })
    console.log('get Agent Alias Id Response: ', response.data)
    if (!(response.data && response.data.body)) {
        console.log('No response getting Agent Alias ID for Agent ID ', agentId)
        return
    }
    const listAgnetAliasIdsResponseBody = JSON.parse(response.data.body) as ListAgentIdsResponseType
    //Get the most recently created AliasId
    const mostRecentAliasId = listAgnetAliasIdsResponseBody.agentAliasSummaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].agentAliasId

    return mostRecentAliasId
}

const combineAndSortMessages = ((arr1: Array<Schema["ChatMessage"]["type"]>, arr2: Array<Schema["ChatMessage"]["type"]>) => {
    // const combinedMessages = [...new Set([...arr1, ...arr2])] //TODO find out why this does not remove duplicate messages
    const combinedMessages = [...arr1, ...arr2]
    const uniqueMessages = combinedMessages.filter((message, index, self) =>
        index === self.findIndex((p) => p.id === message.id)
    );
    return uniqueMessages.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) throw new Error("createdAt is missing")
        return a.createdAt.localeCompare(b.createdAt)
    });
})

//https://json-schema.org/understanding-json-schema/reference/array
const getSuggestedPromptsOutputStructure = {
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
};

function Page({ params }: { params?: { chatSessionId: string } }) {
    const [messages, setMessages] = useState<Array<Schema["ChatMessage"]["type"]>>([]);
    const [chatSessions, setChatSessions] = useState<Array<Schema["ChatSession"]["type"]>>([]);
    const [activeChatSession, setActiveChatSession] = useState<Schema["ChatSession"]["type"]>();
    const [suggestedPrompts, setSuggestedPromptes] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false);
    const [bedrockAgents, setBedrockAgents] = useState<ListBedrockAgentsResponseType>();

    const { user } = useAuthenticator((context) => [context.user]);
    const router = useRouter();

    //Set the chat session from params
    useEffect(() => {
        if (params && params.chatSessionId) {
            amplifyClient.models.ChatSession.get({ id: params.chatSessionId }).then(({ data: chatSession }) => {
                if (chatSession) {
                    setActiveChatSession(chatSession)

                    console.log('Loaded chat session. Ai Bot Info:', chatSession.aiBotInfo)

                    // if (
                    //     chatSession.aiBotInfo && 
                    //     chatSession.aiBotInfo.aiBotId && 
                    //     chatSession.aiBotInfo.aiBotId in defaultAgents
                    // ) setSuggestedPromptes(defaultAgents[chatSession.aiBotInfo.aiBotId].samplePrompts)

                } else {
                    console.log(`Chat session ${params.chatSessionId} not found`)
                }
            })
        } else {
            console.log("No chat session id in params: ", params)
        }
    }, [params])

    // Set isLoading to false if the last message is from ai and has no tool call
    useEffect(() => {
        console.log("Messages: ", messages)

        //Set the default prompts if this is the first message
        if (
            !messages.length && //No messages currently in the chat
            activeChatSession &&
            activeChatSession.aiBotInfo && 
            activeChatSession.aiBotInfo.aiBotId && 
            activeChatSession.aiBotInfo.aiBotId in defaultAgents
        ) setSuggestedPromptes(defaultAgents[activeChatSession.aiBotInfo.aiBotId].samplePrompts)

        if (
            messages.length &&
            messages[messages.length - 1].role === "ai" &&
            (!messages[messages.length - 1].tool_calls || messages[messages.length - 1].tool_calls === "[]")
        ) {
            console.log('Ready for human response')
            setIsLoading(false)

            async function fetchAndSetSuggestedPrompts() {
                setSuggestedPromptes([])
                if (!activeChatSession || !activeChatSession.id) throw new Error("No active chat session")

                const suggestedPromptsResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
                    chatSessionId: activeChatSession?.id,
                    lastMessageText: "Suggest three follow up prompts",
                    outputStructure: JSON.stringify(getSuggestedPromptsOutputStructure)
                })
                console.log("Suggested Prompts Response: ", suggestedPromptsResponse)
                if (suggestedPromptsResponse.data) {
                    const newSuggestedPrompts = JSON.parse(suggestedPromptsResponse.data).suggestedPrompts as string[]
                    setSuggestedPromptes(newSuggestedPrompts)
                } else console.log('No suggested prompts found in response: ', suggestedPromptsResponse)
            }
            fetchAndSetSuggestedPrompts()
        }
    }, [messages, activeChatSession])



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
        setMessages([])
        if (activeChatSession) {
            const sub = amplifyClient.models.ChatMessage.observeQuery({
                filter: {
                    chatSessionId: { eq: activeChatSession.id }
                }
            }).subscribe({
                next: ({ items }) => { //isSynced is an option here to
                    setMessages((prevMessages) => combineAndSortMessages(prevMessages, items))
                }
            }
            )
            return () => sub.unsubscribe();
        }

    }, [activeChatSession])

    // List the available bedrock agents
    useEffect(() => {
        const fetchListBedrockAgents = async () => {
            const response = await amplifyClient.queries.listBedrockAgents()
            console.log('List Agents Response: ', response.data)
            if (!(response.data && response.data.body)) {
                console.log('No response from listing bedrock agents')
                return
            }
            const listAgentsResponseBody = JSON.parse(response.data.body) as ListBedrockAgentsResponseType
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
                router.push(`/chat/${newChatSession.id}`)

            }
        })
    }

    async function deleteChatSession(targetSession: Schema['ChatSession']['type']) {
        amplifyClient.models.ChatSession.delete({ id: targetSession.id })
        // Remove the target session from the list of chat sessions
        setChatSessions((previousChatSessions) => previousChatSessions.filter(existingSession => existingSession.id != targetSession.id))
    }

    function addChatMessage(props: {body: string, role: "human" | "ai" | "tool", trace?: string}) {
        const targetChatSessionId = activeChatSession?.id;

        if (targetChatSessionId) {
            return amplifyClient.models.ChatMessage.create({
                content: props.body,
                trace: props.trace,
                role: props.role,
                chatSessionId: targetChatSessionId
            })
        }
    }

    async function addUserChatMessage(body: string) {
        if (!messages.length) {
            console.log("This is the initial message. Getting summary for chat session")
            if (!activeChatSession) throw new Error("No active chat session")
            setChatSessionFirstMessageSummary(body, activeChatSession)
        }
        await addChatMessage({body: body, role: "human"})
        sendMessageToChatBot(body);
    }

    async function sendMessageToChatBot(prompt: string) {
        setIsLoading(true);
        // const responseText = (activeChatSession?.aiBotInfo?.aiBotAliasId) ? await invokeBedrockAgentParseBodyGetText(prompt, activeChatSession)
        //     : (activeChatSession?.aiBotInfo?.aiBotName === 'Foundation Model') ? await invokeBedrockModelParseBodyGetText(prompt)
        //     : (activeChatSession?.aiBotInfo?.aiBotName === 'Production Agent') ? await invokeProductionAgentParseBodyGetText(prompt, activeChatSession)
        //     : 'No Agent Configured';

        if (activeChatSession?.aiBotInfo?.aiBotAliasId) {
            const response = await invokeBedrockAgentParseBodyGetTextAndTrace(prompt, activeChatSession)
            if (!response) throw new Error("No response from agent");
            // Agent function now adds messages directly
            // const { text, trace } = response
            // if (!text ) throw new Error("No text in response from agent");
            // if (!trace ) throw new Error("No text in response from agent");
            // addChatMessage({body: text, trace: trace, role: "ai"})
        } else if (activeChatSession?.aiBotInfo?.aiBotName === 'Foundation Model') {
            const responseText = await invokeBedrockModelParseBodyGetText(prompt)
            if (!responseText) throw new Error("No response from agent");
            addChatMessage({body: responseText, role: "ai"})
        } else if (activeChatSession?.aiBotInfo?.aiBotName === defaultAgents.ProductionAgent.name) {
            await invokeProductionAgent(prompt, activeChatSession)
        } else {
            throw new Error("No Agent Configured");
        }

        // console.log('Response Text: ', responseText)
        // if (!responseText) throw new Error("No response from agent");


        // addChatMessage(responseText, "ai")
    }


    return (
        <div>
            <Drawer
                anchor='left'
                open={true}
                variant="persistent"
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' }
                }}
            >
                <Toolbar />
                {/* <Typography sx={{ textAlign: 'center' }}>Chatting with {activeChatSession?.aiBotInfo?.aiBotName} Alias Id: {activeChatSession?.aiBotInfo?.aiBotAliasId}</Typography> */}
                <Box sx={{ overflow: 'auto' }}>
                    <DropdownMenu buttonText='New Chat Session'>
                        {
                            [
                                ...[
                                    {
                                        agentName: defaultAgents.ProductionAgent.name,
                                        agentId: 'ProductionAgent'
                                    },
                                    {
                                        agentName: "Foundation Model",
                                        agentId: "FoundationModel"
                                    },
                                ],
                                ...bedrockAgents?.agentSummaries.filter((agent) => (agent.agentStatus === "PREPARED")) || []
                            ]
                                .map((agent) => (
                                    <MenuItem
                                        key={agent.agentName}
                                        onClick={async () => {
                                            // const agentAliasId = agent.agentId ? await getAgentAliasId(agent.agentId) : null//If the agent is not a bedrock agent then don't get the alias ID
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
                                        onClick={() => router.push(`/chat/${session.id}`)}
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
            </Drawer>
            <div style={{ marginLeft: '260px', padding: '20px' }}>
                <Toolbar />
                <Box>
                    <Typography variant="h4" gutterBottom>
                        Chat with {activeChatSession?.aiBotInfo?.aiBotName}
                    </Typography>
                </Box>
                <Box>
                    <ChatUI
                        onSendMessage={addUserChatMessage}
                        messages={messages}
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
                            <CircularProgress />
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
            </div>
        </div>

    );
};

export default withAuth(Page)