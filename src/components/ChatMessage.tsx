"use client"
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { memo } from 'react';
import dynamic from 'next/dynamic'

import ChatBubble from '@cloudscape-design/chat-components/chat-bubble';
import ButtonGroup from "@cloudscape-design/components/button-group";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
// import Avatar from "@cloudscape-design/chat-components/avatar";

import ReactMarkdown from "react-markdown";

import { useUserAttributes } from '@/components/UserAttributesProvider';
import { ChatBubbleAvatar, AuthorAvatarProps } from '@/utils/ui-utils'

import type { Schema } from '../../amplify/data/resource';
type Message = Schema["ChatMessage"]["createType"]

const ChatUIMessage = dynamic(() => import('./ChatMessageElements'), { ssr: false });

import '@/app/styles/chat.scss';

export default memo(function Messages(
    { messages = [], getGlossary, isLoading, glossaryBlurbs, updateMessage }:
        { 
            messages: Array<Message>, 
            getGlossary: (message: Message) => void, 
            isLoading: boolean, 
            glossaryBlurbs: { [key: string]: string },
            updateMessage: (props: { message: Message}) => Promise<void>
        }
) {
    const { userAttributes } = useUserAttributes();
    
    return (
        <div
            id="autoscroll-wrapper"
            style={{
                maxHeight: '100%',
                display: 'flex',
                flexDirection: 'column-reverse',
                overflowY: 'auto'
            }}
        >
            <div>
                {messages.map((message, index) => {
                    const author: AuthorAvatarProps = (message.role === 'human') ? {
                        type: 'user',
                        name: userAttributes?.email || "",
                        initials: (userAttributes?.email || "").slice(0,2),
                        loading: (messages.length === index + 1) && isLoading,
                    } : {
                        type: 'gen-ai',
                        name: 'GenAi',
                        loading: (messages.length === index + 1) && isLoading,
                    }

                    if (message.role === 'ai' && message.content.startsWith('## ') && !message.content.includes('\n')) {
                        return <h1 id={message.content} key={message.createdAt}>{message.content.slice(3)}</h1>
                    }

                    return (
                        <ChatBubble
                            key={message.createdAt}
                            avatar={<ChatBubbleAvatar {...author} loading={(messages.length === index + 1) && isLoading} />}
                            ariaLabel={`${author?.name ?? 'Unknown'} at ${message.createdAt}`}
                            type={author?.type === 'gen-ai' ? 'incoming' : 'outgoing'}
                            showLoadingBar={(messages.length === index + 1) && isLoading}
                            hideAvatar={false}
                            actions={author?.type === 'gen-ai' ?
                                <ButtonGroup
                                    ariaLabel="Chat bubble actions"
                                    variant="icon"
                                    onItemClick={async ({ detail }) => {
                                        switch (detail.id) {
                                            case "dislike":
                                                console.log("dislike");
                                                const messageWithDislike: Schema['ChatMessage']['createType'] = {
                                                    ...message,
                                                    userFeedback: "dislike"
                                                } 
                                                await updateMessage({message: messageWithDislike})
                                                break;
                                            case "like":
                                                console.log("like");
                                                const messageWithLike: Schema['ChatMessage']['createType'] = {
                                                    ...message,
                                                    userFeedback: "like"
                                                } 
                                                await updateMessage({message: messageWithLike})
                                                break;
                                            case "copy":
                                                navigator.clipboard.writeText(message.content)
                                                break
                                            case "glossary":
                                                getGlossary(message);
                                                break;
                                            case "check":
                                                console.log("check");
                                                break;
                                        }
                                    }}
                                    items={[
                                        {
                                            type: "group",
                                            text: "Feedback",
                                            items: [
                                                {
                                                    type: "icon-toggle-button",
                                                    id: "like",
                                                    iconName: "thumbs-up",
                                                    pressedIconName: "thumbs-up-filled",
                                                    text: "Helpful",
                                                    pressed: message.userFeedback === 'like'
                                                },
                                                {
                                                    type: "icon-toggle-button",
                                                    id: "dislike",
                                                    iconName: "thumbs-down",
                                                    pressedIconName: "thumbs-down-filled",
                                                    text: "Not helpful",
                                                    pressed: message.userFeedback === 'dislike',
                                                }
                                            ]
                                        },
                                        {
                                            type: "icon-button",
                                            id: "copy",
                                            iconName: "copy",
                                            text: "Copy to Clipboard",
                                            popoverFeedback: (
                                                <StatusIndicator type="success">
                                                    Copied to clipboard
                                                </StatusIndicator>
                                            )
                                        },
                                        {
                                            type: "icon-button",
                                            id: "glossary",
                                            iconName: "transcript",
                                            text: "Glossary",
                                            popoverFeedback:
                                                <StatusIndicator
                                                    type={(message.id && glossaryBlurbs && message.id in glossaryBlurbs && glossaryBlurbs[message.id].length > 1) ? 'success' : 'loading'}
                                                >
                                                    <ReactMarkdown>
                                                        {(message.id && message.id in glossaryBlurbs) ? glossaryBlurbs[message.id] : ""}
                                                    </ReactMarkdown>
                                                </StatusIndicator>
                                        },
                                    ]}
                                />
                                : null}
                        >
                            <ChatUIMessage
                                key={message.id}
                                message={message}
                                showCopyButton={false}
                            />
                        </ChatBubble>
                    );
                })}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Only re-render if these props change
    return prevProps.messages.length === nextProps.messages.length &&
           prevProps.isLoading === nextProps.isLoading &&
           JSON.stringify(prevProps.glossaryBlurbs) === JSON.stringify(nextProps.glossaryBlurbs);
});
