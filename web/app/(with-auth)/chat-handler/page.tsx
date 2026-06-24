'use client';
/**
 * /chat-handler
 *
 * AG-UI over AppSync subscription flow:
 *   1. Browser subscribes to onAgentEvent(sessionId)
 *   2. Browser calls invokeHandler(sessionId, prompt) mutation
 *   3. AgentCore runtime streams AG-UI events → AppSync subscription → UI
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
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

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  done?: boolean;
};

// AG-UI event types emitted by the handler runtime.
type AgUiEventType =
  | 'run_started'
  | 'text_message_start'
  | 'text_message_content'
  | 'text_message_end'
  | 'run_finished'
  | 'run_error';

const TERMINAL_EVENTS: AgUiEventType[] = ['run_finished', 'run_error', 'text_message_end'];

export default function ChatHandlerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');

  const [sessionId, setSessionId] = useState<string | null>(sessionIdParam);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);

  const client = useMemo(
    () => generateClient<Schema>({ authMode: 'userPool' }),
    [],
  );

  // Bootstrap: create a new session if none in URL.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!sessionIdParam) {
        const { data: session, errors } = await client.models.ChatSession.create({
          name: 'Handler Chat',
        });
        if (errors || !session || cancelled) return;
        setSessionId(session.id);
        const params = new URLSearchParams(searchParams.toString());
        params.set('sessionId', session.id);
        router.replace(`?${params.toString()}`);
      }
    }
    bootstrap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to AG-UI events for this session.
  useEffect(() => {
    if (!sessionId) return;

    const sub = (client.subscriptions as any).onAgentEvent({ sessionId }).subscribe({
      next: (event: { sessionId: string; eventType: string; messageId: string; delta?: string | null; done?: boolean | null }) => {
        const eventType = event.eventType as AgUiEventType;

        if (eventType === 'run_started') {
          setIsStreaming(true);
          setError(null);
          return;
        }

        if (eventType === 'run_error') {
          setError(event.delta ?? 'Agent run failed');
          setIsStreaming(false);
          return;
        }

        if (eventType === 'text_message_start') {
          activeMessageIdRef.current = event.messageId;
          setMessages((prev) => [
            ...prev,
            { id: event.messageId, role: 'assistant', text: '', done: false },
          ]);
          return;
        }

        if (eventType === 'text_message_content' && event.delta) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId
                ? { ...m, text: m.text + event.delta }
                : m,
            ),
          );
          return;
        }

        if (eventType === 'text_message_end' || eventType === 'run_finished') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId ? { ...m, done: true } : m,
            ),
          );
          if (eventType === 'run_finished') {
            setIsStreaming(false);
            activeMessageIdRef.current = null;
          }
        }
      },
      error: (err: unknown) => {
        console.error('[chat-handler] subscription error', err);
        setError('Subscription error — please refresh.');
        setIsStreaming(false);
      },
    });

    return () => sub.unsubscribe();
  }, [sessionId, client]);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      if (!sessionId || isStreaming || !text.trim()) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        done: true,
      };
      setMessages((prev) => [...prev, userMsg]);
      setError(null);

      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (!token) throw new Error('Not authenticated');

        // invokeHandler is a raw CfnResolver (not in the Amplify schema),
        // so call it via a direct GraphQL POST with the Cognito JWT.
        const outputs = (await import('@/amplify_outputs.json')).default as { data?: { url?: string } };
        const endpoint = outputs?.data?.url;
        if (!endpoint) throw new Error('AppSync endpoint not configured');

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token,
          },
          body: JSON.stringify({
            query: `mutation InvokeHandler($sessionId: String!, $prompt: String!, $systemPrompt: String, $modelId: String) {
              invokeHandler(sessionId: $sessionId, prompt: $prompt, systemPrompt: $systemPrompt, modelId: $modelId) {
                sessionId
              }
            }`,
            variables: { sessionId, prompt: text },
          }),
        });
        const json = await resp.json();
        if (json.errors?.length) {
          throw new Error(json.errors[0].message);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to invoke handler: ${msg}`);
        setIsStreaming(false);
      }
    },
    [sessionId, isStreaming],
  );

  const stopStreaming = useCallback(() => {
    // No client-side stop for the subscription-based flow;
    // the runtime will finish naturally.
    setIsStreaming(false);
  }, []);

  const status = isStreaming ? 'streaming' : 'ready';

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && !isStreaming && (
            <ConversationEmptyState
              title="AG-UI Handler Chat"
              description="Messages stream via AppSync subscription from the AgentCore runtime"
            />
          )}

          {messages.map((message) => (
            <Message key={message.id} from={message.role} data-testid={`message-${message.role}`}>
              <MessageContent>
                {message.role === 'assistant' ? (
                  <MessageResponse isAnimating={isStreaming && !message.done}>
                    {message.text}
                  </MessageResponse>
                ) : (
                  message.text
                )}
              </MessageContent>
            </Message>
          ))}

          {isStreaming && messages.at(-1)?.role !== 'assistant' && (
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
          <span className="font-medium">Error: </span>{error}
        </div>
      )}

      <PromptInput onSubmit={sendMessage}>
        <PromptInputTextarea
          placeholder="Type a message…"
          disabled={isStreaming}
          autoFocus
        />
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit status={status} onStop={stopStreaming} />
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}
