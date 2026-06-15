'use client';
import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  AGENT_RUNTIME_ARN,
  getAgentCoreUrl,
  getAccessToken,
} from '@/lib/agentcore-transport';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';

const Chat = function Page() {
  const transport = useMemo(() => new DefaultChatTransport({
    api: getAgentCoreUrl(AGENT_RUNTIME_ARN),
    async prepareSendMessagesRequest({ messages }) {
      const token = await getAccessToken();
      return {
        body: { messages },
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
      };
    },
  }), []);

  const { messages, sendMessage, status, stop, error } = useChat({
    // id: sessionId,
    transport,
    onError: (err) => console.error('[useChat] error:', err),
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="No messages yet"
              description="Start a conversation to get started"
            />
          )}
          {messages.map((message) => {
            const text = message.parts
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('');

            return (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.role === 'assistant' ? (
                    <MessageResponse isAnimating={isStreaming}>{text}</MessageResponse>
                  ) : (
                    text
                  )}
                </MessageContent>
              </Message>
            );
          })}

          {status === 'submitted' && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Thinking…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="font-medium">Error: </span>{error.message}
        </div>
      )}

      <PromptInput onSubmit={({ text }) => sendMessage({ text })}>
        <PromptInputTextarea
          placeholder="Type a message…"
          disabled={isStreaming}
          autoFocus
        />
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit status={status} onStop={stop} />
        </PromptInputFooter>
      </PromptInput>

    </>
  );
}

export default Chat