"use client"
import React, { useEffect, useState } from 'react';
import type { Schema } from '@/../amplify/data/resource';
import { amplifyClient, invokeBedrockModelParseBodyGetText } from '@/utils/amplify-utils';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter } from 'next/navigation';

import { formatDate } from "@/utils/date-utils";
import DropdownMenu from '@/components/DropDownMenu';

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

// type BedrockAnthropicBodyType = {
//     id: string;
//     type: string;
//     role: string;
//     model: string;
//     content: {
//         type: string;
//         text: string;
//     }[];
//     stop_reason: string;
//     stop_sequence: null;
//     usage: {
//         input_tokens: number;
//         output_tokens: number;
//     };
// };

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

// export const invokeBedrockModelParseBodyGetText = async (prompt: string) => {
//     console.log('Prompt: ', prompt)
//     const response = await amplifyClient.queries.invokeBedrock({ prompt: prompt })
//     console.log('Bedrock Response: ', response.data)
//     if (!(response.data && response.data.body)) {
//         console.log('No response from bedrock after prompt: ', prompt)
//         return
//     }
//     const bedrockResponseBody = JSON.parse(response.data.body) as BedrockAnthropicBodyType
//     console.log('Bedrock Response Body: ', bedrockResponseBody)
//     return bedrockResponseBody.content.map(item => item.text).join('\n')
// }

const invokeBedrockAgentParseBodyGetText = async (prompt: string, chatSession: Schema['ChatSession']['type']) => {
    console.log('Prompt: ', prompt)
    if (!chatSession.aiBotInfo?.aiBotAliasId) throw new Error('No Agent Alias ID found in invoke request')
    if (!chatSession.aiBotInfo?.aiBotId) throw new Error('No Agent ID found in invoke request')
    const response = await amplifyClient.queries.invokeBedrockAgent({
        prompt: prompt,
        agentId: chatSession.aiBotInfo?.aiBotId,
        agentAliasId: chatSession.aiBotInfo?.aiBotAliasId,
        sessionId: chatSession.id
    })
    console.log('Bedrock Agent Response: ', response.data)
    if (!(response.data)) {
        console.log('No response from bedrock agent after prompt: ', prompt)
        return
    }
    return response.data
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

const getSuggestedPromptsOutputStructure = {
    title: "outputStructure",
    description: "Fill out these arguments",
    type: "object",
    properties: {
        suggestedPrompts: {
            type: 'array',
            items: {
                type: 'string'
            },
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

    

    // Set isLoading to false if the last message is from ai and has no tool call
    useEffect(() => {
        console.log("Messages: ", messages)
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
                if (!suggestedPromptsResponse.data) throw new Error("No suggested prompts in response")
        
                const newSuggestedPrompts = JSON.parse(suggestedPromptsResponse.data).suggestedPrompts as string[]
                setSuggestedPromptes(newSuggestedPrompts)
            }
            fetchAndSetSuggestedPrompts()
        }
    }, [messages, activeChatSession])

    //Set the chat session from params
    useEffect(() => {
        if (params && params.chatSessionId) {
            amplifyClient.models.ChatSession.get({ id: params.chatSessionId }).then(({ data: chatSession }) => {
                if (chatSession) {
                    setActiveChatSession(chatSession)
                } else {
                    console.log(`Chat session ${params.chatSessionId} not found`)
                }
            })
        } else {
            console.log("No chat session id in params: ", params)
        }
    }, [params])

    // List the user's chat sessions
    useEffect(() => {
        console.log("user: ", user)
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

    function addChatMessage(body: string, role: "human" | "ai" | "tool") {
        const targetChatSessionId = activeChatSession?.id;

        if (targetChatSessionId) {
            return amplifyClient.models.ChatMessage.create({
                content: body,
                role: role,
                chatSessionId: targetChatSessionId
            })
        }
    }

    async function addUserChatMessage(body: string) {
        await addChatMessage(body, "human")
        sendMessageToChatBot(body);
    }

    async function sendMessageToChatBot(prompt: string) {
        setIsLoading(true);
        const responseText = (activeChatSession?.aiBotInfo?.aiBotAliasId) ? await invokeBedrockAgentParseBodyGetText(prompt, activeChatSession)
            : (activeChatSession?.aiBotInfo?.aiBotName === 'Foundation Model') ? await invokeBedrockModelParseBodyGetText(prompt)
                : 'defaultValue';

        console.log('Response Text: ', responseText)
        if (!responseText) throw new Error("No response from agent");
        addChatMessage(responseText, "ai")
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
                <Typography sx={{ textAlign: 'center' }}>Chatting with {activeChatSession?.aiBotInfo?.aiBotName} Alias Id: {activeChatSession?.aiBotInfo?.aiBotAliasId}</Typography>
                <Box sx={{ overflow: 'auto' }}>
                <DropdownMenu buttonText='New Chat Session'>
                        {
                            [
                                ...[
                                    {
                                        agentName: "Foundation Model",
                                        agentId: null
                                    },
                                ],
                                ...bedrockAgents?.agentSummaries.filter((agent) => (agent.agentStatus === "PREPARED")) || []
                            ]
                                .map((agent) => (
                                    <MenuItem
                                        key={agent.agentName}
                                        onClick={async () => {
                                            const agentAliasId = agent.agentId ? await getAgentAliasId(agent.agentId) : null//If the agent is not a bedrock agent then don't get the alias ID
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
                                        {session.firstMessage?.slice(0, 50)}
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
                {/* <Toolbar /> */}
                <ChatUI
                    onSendMessage={addUserChatMessage}
                    messages={messages}
                    running={isLoading}
                />
                <Box sx={{ mt: 5 }}>
                    {
                        !isLoading && (suggestedPrompts.length || !messages.length) ? (
                            <Typography variant="body2">
                                Suggested Follow Ups:
                            </Typography>
                        ) : (
                            <CircularProgress/>
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