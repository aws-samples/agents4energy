'use client';

import { useChat } from '@ai-sdk/react';
import { AgentCoreTransport } from '@/lib/agentcore-transport';
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

function ChatView() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId') ?? undefined;

  const transport = useMemo(() => new AgentCoreTransport(), []);
  const { messages, sendMessage, status, stop, error } = useChat({
    id: sessionId,
    transport,
    onError: (err) => console.error('[useChat] error:', err),
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full px-4 py-6 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">AgentCore Chat</h1>
      </div>

      <Conversation className="flex-1">
        <ConversationContent>
          {JSON.stringify(messages, null, 2)}
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
    </div>
  );
}

// export default function ChatPage() {
//   return (
//     <Suspense>
//       <ChatView />
//     </Suspense>
//   );
// }

// 'use client';

// import { useChat } from '@ai-sdk/react';
// import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

export default function Page() {
  const transport = useMemo(() => new AgentCoreTransport(), []);
  const { messages, sendMessage, status, stop } = useChat({
    // transport: new DefaultChatTransport({
    //   api: '/api/chat',
    // }),
    transport
  });
  const [input, setInput] = useState('');

  return (
    <>
      {messages.map(message => (
        <div key={message.id}>
          {message.role === 'user' ? 'User: ' : 'AI: '}
          {message.parts.map((part, index) =>
            part.type === 'text' ? <span key={index}>{part.text}</span> : null,
          )}
        </div>
      ))}

      {(status === 'submitted' || status === 'streaming') && (
        <div>
          {status === 'submitted' && <p> Spinner </p>}
          <button type="button" onClick={() => stop()}>
            Stop
          </button>
        </div>
      )}

      <form
        onSubmit={e => {
          e.preventDefault();
          if (input.trim()) {
            sendMessage({ text: input });
            setInput('');
          }
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={status !== 'ready'}
          placeholder="Say something..."
        />
        <button type="submit" disabled={status !== 'ready'}>
          Submit
        </button>
      </form>
    </>
  );
}