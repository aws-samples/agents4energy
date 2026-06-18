'use client';
import { useChat } from '@ai-sdk/react';
import { HarnessChatTransport } from '@/lib/agentcore-transport';
import { useChatSession } from './use-chat-session';
import { useInitialMessages } from './use-initial-messages';
import { useAgents } from './use-agents';
import { useMemo, useRef } from 'react';
import type { UIMessage } from 'ai';
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
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSelectContent,
  PromptInputSelectItem,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { AgentOption } from './use-agents';

function ChatView({
  sessionIdRef,
  initialMessages,
  selectedAgent,
  agents,
  agentId,
  onAgentChange,
}: {
  sessionIdRef: React.RefObject<string | null>;
  initialMessages: UIMessage[];
  selectedAgent: AgentOption | undefined;
  agents: AgentOption[];
  agentId: string | null;
  onAgentChange: (id: string | null) => void;
}) {
  const agentConfigRef = useRef({ selectedAgent });
  agentConfigRef.current = { selectedAgent };

  const transport = useMemo(
    () =>
      new HarnessChatTransport({
        getSessionId: () => sessionIdRef.current,
        getAgentConfig: () => {
          const { selectedAgent } = agentConfigRef.current;
          return {
            agentId: selectedAgent?.id ?? null,
            systemPromptText: selectedAgent?.systemPromptText ?? null,
            modelId: selectedAgent?.modelId ?? null,
            mcpServers: selectedAgent?.mcpServers.map((s) => ({
              name: s.name,
              url: s.url,
              headers: Object.fromEntries(
                (s.headers ?? [])
                  .filter((h): h is { key: string; value: string } => !!h.key && !!h.value)
                  .map((h) => [h.key, h.value]),
              ),
            })),
          };
        },
      }),
    [sessionIdRef],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    messages: initialMessages,
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
              description={selectedAgent ? `Chatting with ${selectedAgent.name}` : 'Start a conversation to get started'}
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
          <PromptInputTools>
            {agents.length > 0 && (
              <PromptInputSelect
                value={agentId ?? ''}
                onValueChange={(val: unknown) => onAgentChange(val === '' ? null : String(val))}
              >
                <PromptInputSelectTrigger>
                  <PromptInputSelectValue placeholder="Default agent" />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  <PromptInputSelectItem value="">Default agent</PromptInputSelectItem>
                  {agents.map((a) => (
                    <PromptInputSelectItem key={a.id} value={a.id}>
                      {a.name}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            )}
          </PromptInputTools>
          <PromptInputSubmit status={status} onStop={stop} />
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}

const Chat = function Page() {
  const { ready, sessionId, sessionIdRef, agentId, setAgentId } = useChatSession();
  const initialMessagesState = useInitialMessages(ready ? sessionId : null);
  const agentsState = useAgents();

  const agents = agentsState.status === 'ready' ? agentsState.agents : [];
  const selectedAgent = agents.find((a) => a.id === agentId);

  if (!ready || initialMessagesState.status === 'loading') return null;

  return (
    <ChatView
      sessionIdRef={sessionIdRef}
      initialMessages={initialMessagesState.messages}
      selectedAgent={selectedAgent}
      agents={agents}
      agentId={agentId}
      onAgentChange={setAgentId}
    />
  );
}

export default Chat;
