"use client"
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from 'react';
import dynamic from 'next/dynamic'

// import { amplifyClient } from '@/utils/amplify-utils';

import ChatBubble from '@cloudscape-design/chat-components/chat-bubble';
// import Alert from '@cloudscape-design/components/alert';
// import LiveRegion from '@cloudscape-design/components/live-region';
import ButtonGroup from "@cloudscape-design/components/button-group";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
// import Avatar from "@cloudscape-design/chat-components/avatar";

import ReactMarkdown from "react-markdown";
// import AutoScrollContainer from "@/components/ScrollableContainer"

// import { ChatBubbleAvatar } from './common-components';
import { ChatBubbleAvatar, AUTHORS } from '@/utils/ui-utils'
// import { AUTHORS } from './config'; //Message
// import { AUTHORS } from '@/utils/ui-utils'

import type { Schema } from '../../amplify/data/resource';
type Message = Schema["ChatMessage"]["createType"]

// import ChatUIMessage from '@/components/chat-ui/chat-ui-message'
// import ChatUIMessage from './ChatMessageElements'
const ChatUIMessage = dynamic(() => import('./ChatMessageElements'), { ssr: false });
// import ChatMessageElements from '@/components/ChatMessageElements'

// import '../styles/chat.scss';

// setMessages: React.Dispatch<React.SetStateAction<{
//     id?: string | undefined;
//     owner?: string | null | undefined;
//     chatSessionId?: Nullable<string> | undefined;
//     content: string;
//     trace?: Nullable<string> | undefined;
//     ... 8 more ...;
//     userFeedback?: "none" | ... 3 more ... | undefined;
// }[]>>

export default function Messages(
    { messages = [], getGlossary, isLoading, glossaryBlurbs, updateMessage }:
        { 
            messages: Array<Message>, 
            getGlossary: (message: Message) => void, 
            isLoading: boolean, 
            glossaryBlurbs: { [key: string]: string },
            // setMessages: React.Dispatch<React.SetStateAction<Schema['ChatMessage']['createType'][]>>
            updateMessage: (props: { message: Message}) => Promise<void>
        }
) {

    return (
        <div
            id="autoscroll-wrapper"
            style={{
                maxHeight: '100%', // Constrain to parent height
                // height: '100%',    // Take full height
                display: 'flex',
                // flexGrow: 1,
                flexDirection: 'column-reverse',
                overflowY: 'scroll'
                // overflow: 'scroll'
            }}
        >
            <div
            // className="messages"
            // role="region"
            // aria-label="Chat"
            // style={{
            //     // overflowY: 'auto',
            //     // maxHeight: '100%', // Constrain to parent height
            //     height: '100%',    // Take full height
            //     // display: 'flex',
            //     flexDirection: 'column',
            //     // overflow: ''
            // }}
            >

                {messages.map((message, index) => {

                    if (!message.role) return;

                    const author = AUTHORS[message.role];

                    if ( // This is for the task header message
                        message.role === 'ai' && message.content.startsWith('## ') && !message.content.includes('\n')
                    ) return <h1 key={message.content}>{message.content.slice(3)}</h1>


                    return (
                        <ChatBubble
                            // key={message.authorId + message.timestamp}
                            key={message.createdAt}
                            // avatar={<ChatBubbleAvatar {...author} loading={message.avatarLoading} />}
                            avatar={<ChatBubbleAvatar {...author} loading={(messages.length === index + 1) && isLoading} />}
                            ariaLabel={`${author?.name ?? 'Unknown'} at ${message.createdAt}`}
                            type={author?.type === 'gen-ai' ? 'incoming' : 'outgoing'}
                            showLoadingBar={(messages.length === index + 1) && isLoading}
                            // hideAvatar={message.hideAvatar}
                            hideAvatar={false}
                            // actions={message.actions}
                            actions={author?.type === 'gen-ai' ?
                                <ButtonGroup
                                    ariaLabel="Chat bubble actions"
                                    variant="icon"
                                    onItemClick={async ({ detail }) => {
                                        //TODO: Impliment user feedback
                                        // ["like", "dislike"].includes(detail.id) &&
                                        // setFeedback(detail.pressed ? detail.id : "")

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
                                                    // disabled: true
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
                                        // {
                                        //     type: "icon-button",
                                        //     id: "check",
                                        //     iconName: "check",
                                        //     text: "Data Quality Check",
                                        //     // popoverFeedback: (
                                        //     //   <StatusIndicator type="loading">
                                        //     //     Copied to clipboard
                                        //     //   </StatusIndicator>
                                        //     // )
                                        // }
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
}
