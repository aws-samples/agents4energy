// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from 'react';

import { stringify } from 'yaml'

import ChatBubble from '@cloudscape-design/chat-components/chat-bubble';
import Alert from '@cloudscape-design/components/alert';
import LiveRegion from '@cloudscape-design/components/live-region';
import ButtonGroup from "@cloudscape-design/components/button-group";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Avatar from "@cloudscape-design/chat-components/avatar";

import { ChatBubbleAvatar } from './common-components';
import { AUTHORS } from './config'; //Message

import type { Schema } from '../../../../amplify/data/resource';
type Message = Schema["ChatMessage"]["createType"] 

import ChatUIMessage from '@/components/chat-ui/chat-ui-message'

import '../../styles/chat.scss';

export default function Messages({ messages = [] }: { messages: Array<Message> }) {
  const latestMessage: Message = messages[messages.length - 1];

  return (
    <div className="messages" role="region" aria-label="Chat">
      {/* <LiveRegion hidden={true} assertive={latestMessage?.type === 'alert'}>
        {latestMessage?.type === 'alert' && latestMessage.header}
        {latestMessage?.content}
      </LiveRegion> */}

      {messages.map((message, index) => {
        // if (message.type === 'alert') {
        //   return (
        //     <Alert
        //       key={'error-alert' + index}
        //       header={message.header}
        //       type="error"
        //       statusIconAriaLabel="Error"
        //       data-testid={'error-alert' + index}
        //     >
        //       {message.content}
        //     </Alert>
        //   );
        // }

        // if (!message.role) throw new Error(`Message does not have a role.\n${stringify(message)}`);

        if (!message.role) return;

        const author = AUTHORS[message.role];

        return (
          <ChatBubble
            // key={message.authorId + message.timestamp}
            key={message.createdAt}
            // avatar={<ChatBubbleAvatar {...author} loading={message.avatarLoading} />}
            avatar={<ChatBubbleAvatar {...author} loading={false} />}
            ariaLabel={`${author?.name ?? 'Unknown'} at ${message.createdAt}`}
            type={author?.type === 'gen-ai' ? 'incoming' : 'outgoing'}
            // hideAvatar={message.hideAvatar}
            hideAvatar={false}
            // actions={message.actions}
            actions={author?.type === 'gen-ai' ?
              <ButtonGroup
                ariaLabel="Chat bubble actions"
                variant="icon"
                items={[
                  {
                    type: "group",
                    text: "Feedback",
                    items: [
                      {
                        type: "icon-toggle-button",
                        id: "helpful",
                        iconName: "thumbs-up",
                        pressedIconName: "thumbs-up-filled",
                        text: "Helpful",
                        pressed: true
                      },
                      {
                        type: "icon-toggle-button",
                        id: "not-helpful",
                        iconName: "thumbs-down",
                        pressedIconName: "thumbs-down-filled",
                        text: "Not helpful",
                        pressed: false,
                        disabled: true
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
                    popoverFeedback: (
                      <StatusIndicator type="success">
                        Message copied
                      </StatusIndicator>
                    )
                  },
                  {
                    type: "icon-button",
                    id: "check",
                    iconName: "check",
                    text: "Data Quality Check",
                    popoverFeedback: (
                      <StatusIndicator type="success">
                        Copied to clipboard
                      </StatusIndicator>
                    )
                  }
                ]}
              />
            : null}
          >
            <ChatUIMessage
                      key={message.id}
                      message={message}
                      showCopyButton={false}
                      messages={messages.slice(0, messages.indexOf(message))}
                    />
          </ChatBubble>
        );
      })}
    </div>
  );
}
