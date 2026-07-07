'use client';
/**
 * /chat-handler
 *
 * AG-UI over AppSync subscription flow:
 *   1. Browser subscribes to onAgentEvent(sessionId)
 *   2. Browser calls invokeHandler(sessionId, prompt) mutation
 *   3. AgentCore runtime streams AG-UI events → AppSync subscription → UI
 *
 * Context compaction is handled by Strands' SummarizingConversationManager
 * (proactive_compression=True) inside the container — no frontend involvement needed.
 */
import { useEffect, useRef, useState, useCallback, useMemo, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { useInitialMessages, fetchSessionMessages } from '../chat/use-initial-messages';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ScrollTextIcon } from 'lucide-react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  done?: boolean;
  // True when this bubble was created from a text_message_content event with no
  // preceding text_message_start seen by this client (joined mid-stream) — its
  // text is a suffix of the real message, not the full thing.
  missingStart?: boolean;
};

function toChatMessages(fetched: Awaited<ReturnType<typeof fetchSessionMessages>>['messages']): ChatMessage[] {
  return fetched.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    text: (m.parts?.find((p) => (p as { type: string }).type === 'text') as { text: string } | undefined)?.text ?? '',
    done: true,
  }));
}

// Delays (ms) between re-checks of AgentCore memory after a run's terminal event.
// Memory indexing lags a completed turn by a few seconds, so an immediate fetch
// often returns stale/partial history — keep retrying for ~15s before giving up.
const POLL_DELAYS_MS = [0, 2000, 3000, 5000, 5000];

type AgUiEventType =
  | 'user_message'
  | 'run_started'
  | 'text_message_start'
  | 'text_message_content'
  | 'text_message_end'
  | 'run_finished'
  | 'run_error';

export default function ChatHandlerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');

  const [sessionId, setSessionId] = useState<string | null>(sessionIdParam);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const initialMessagesState = useInitialMessages(sessionId);
  const initialMessagesLoadedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Summary from AgentCore memory — shown in dialog, passed as context on next invocation.
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [summaryRecordId, setSummaryRecordId] = useState<string | null>(null);
  // Edit state for the summary dialog.
  const [editText, setEditText] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const activeMessageIdRef = useRef<string | null>(null);
  const pendingUserMessageTextRef = useRef<string | null>(null);
  // messageIds whose text_message_start we never saw (this client subscribed mid-stream) —
  // their locally-assembled text is only a suffix of the real message.
  const missingStartIdsRef = useRef<Set<string>>(new Set());

  const client = useMemo(
    () => generateClient<Schema>({ authMode: 'userPool' }),
    [],
  );

  // Re-fetch memory on a backoff schedule until a message we only saw the tail
  // end of (joined mid-stream) shows up with its full, authoritative text.
  const pollForMessageBackfill = useCallback((messageId: string) => {
    const attempt = (i: number) => {
      if (i >= POLL_DELAYS_MS.length) {
        missingStartIdsRef.current.delete(messageId);
        return;
      }
      setTimeout(() => {
        fetchSessionMessages(sessionId!).then(({ messages: fetched, summary, summaryRecordId: rid }) => {
          if (summary) setSessionSummary(summary);
          if (rid) setSummaryRecordId(rid);
          const authoritative = fetched.find((m) => m.id === messageId);
          if (!authoritative) {
            attempt(i + 1);
            return;
          }
          missingStartIdsRef.current.delete(messageId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    text: (authoritative.parts?.find((p) => (p as { type: string }).type === 'text') as { text: string } | undefined)?.text ?? m.text,
                    missingStart: false,
                  }
                : m,
            ),
          );
        }).catch(() => attempt(i + 1));
      }, POLL_DELAYS_MS[i]);
    };
    attempt(0);
  }, [sessionId]);

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

  // Seed messages from memory once the initial fetch completes (runs once per session).
  useEffect(() => {
    if (initialMessagesLoadedRef.current) return;
    if (initialMessagesState.status !== 'ready') return;
    initialMessagesLoadedRef.current = true;
    if (initialMessagesState.summary) setSessionSummary(initialMessagesState.summary);
    if (initialMessagesState.summaryRecordId) setSummaryRecordId(initialMessagesState.summaryRecordId);
    if (initialMessagesState.messages.length === 0) return;
    setMessages(toChatMessages(initialMessagesState.messages));
  }, [initialMessagesState]);

  // Subscribe to AG-UI events for this session.
  useEffect(() => {
    if (!sessionId) return;

    const sub = (client.subscriptions as any).onAgentEvent({ sessionId }).subscribe({
      next: (event: { sessionId: string; eventType: string; messageId: string; delta?: string | null; done?: boolean | null }) => {
        const eventType = event.eventType as AgUiEventType;

        if (eventType === 'user_message') {
          // Skip the echo for the window that sent the message.
          if (pendingUserMessageTextRef.current === event.delta) {
            pendingUserMessageTextRef.current = null;
            return;
          }
          setMessages((prev) => [
            ...prev,
            { id: event.messageId, role: 'user', text: event.delta ?? '', done: true },
          ]);
          return;
        }

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
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.messageId);
            if (idx === -1) {
              // Joined mid-stream: this delta belongs to a message whose
              // text_message_start already fired before we subscribed. Open a
              // bubble now so the stream renders immediately, flagged as
              // missing its beginning — it'll be replaced once memory catches up.
              missingStartIdsRef.current.add(event.messageId);
              activeMessageIdRef.current = event.messageId;
              setIsStreaming(true);
              return [
                ...prev,
                { id: event.messageId, role: 'assistant', text: event.delta ?? '', done: false, missingStart: true },
              ];
            }
            const next = [...prev];
            next[idx] = { ...next[idx], text: next[idx].text + event.delta };
            return next;
          });
          return;
        }

        if (eventType === 'text_message_end') {
          const hadMissingStart = missingStartIdsRef.current.has(event.messageId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId ? { ...m, done: true } : m,
            ),
          );
          if (hadMissingStart) {
            // We only ever saw the tail of this message. Poll memory until the
            // authoritative full text is indexed, then swap it in.
            pollForMessageBackfill(event.messageId);
          }
          return;
        }

        if (eventType === 'run_finished') {
          setIsStreaming(false);
          activeMessageIdRef.current = null;
          // Re-fetch from memory so every open window ends up with the
          // authoritative, persisted state regardless of what it streamed.
          // Also refreshes the summary in case AgentCore compacted this run.
          fetchSessionMessages(sessionId!).then(({ messages: fetched, summary, summaryRecordId: rid }) => {
            if (summary) setSessionSummary(summary);
            if (rid) setSummaryRecordId(rid);
            if (!fetched.length) return;
            setMessages(toChatMessages(fetched));
          }).catch(() => {});
        }
      },
      error: (err: unknown) => {
        console.error('[chat-handler] subscription error', err);
        setError('Subscription error — please refresh.');
        setIsStreaming(false);
      },
    });

    return () => sub.unsubscribe();
  }, [sessionId, client, pollForMessageBackfill]);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      if (!sessionId || isStreaming || !text.trim()) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        done: true,
      };
      pendingUserMessageTextRef.current = text;
      setMessages((prev) => [...prev, userMsg]);
      setError(null);

      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (!token) throw new Error('Not authenticated');

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
    [sessionId, isStreaming, sessionSummary],
  );

  const stopStreaming = useCallback(() => {
    setIsStreaming(false);
  }, []);

  const status = isStreaming ? 'streaming' : 'ready';

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent>
          {initialMessagesState.status === 'loading' && messages.length === 0 && (
            <Shimmer>Loading conversation…</Shimmer>
          )}

          {initialMessagesState.status === 'ready' && messages.length === 0 && !isStreaming && (
            <ConversationEmptyState
              title="AG-UI Handler Chat"
              description="Messages stream via AppSync subscription from the AgentCore runtime"
            />
          )}

          {sessionSummary && messages.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-prose items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
              <span className="font-medium">Earlier messages summarised</span>
              <span>— showing recent turns only</span>
            </div>
          )}

          {messages.map((message) => (
            <Message key={message.id} from={message.role} data-testid={`message-${message.role}`}>
              <MessageContent>
                {message.role === 'assistant' ? (
                  <MessageResponse isAnimating={isStreaming && !message.done}>
                    {message.missingStart ? `…${message.text}` : message.text}
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
          disabled={isStreaming || initialMessagesState.status === 'loading'}
          autoFocus
        />
        <PromptInputFooter>
          <PromptInputTools>
            {sessionSummary && (
              <Dialog onOpenChange={(open) => {
                if (open) { setEditText(sessionSummary); setIsEditing(false); setSaveError(null); }
              }}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DialogTrigger
                        data-testid="summary-button"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    <ScrollTextIcon className="size-4" />
                    <span className="sr-only">View session summary</span>
                  </TooltipTrigger>
                  <TooltipContent side="top">View session summary</TooltipContent>
                </Tooltip>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Session Summary</DialogTitle>
                  </DialogHeader>

                  {isEditing ? (
                    <textarea
                      className="min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      disabled={isSaving}
                      data-testid="summary-edit-textarea"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {sessionSummary}
                    </p>
                  )}

                  {saveError && (
                    <p className="text-xs text-destructive">{saveError}</p>
                  )}

                  <DialogFooter>
                    {isEditing ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setIsEditing(false); setSaveError(null); }}
                          disabled={isSaving}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={isSaving || !editText.trim() || !summaryRecordId}
                          data-testid="summary-save-button"
                          onClick={() => {
                            if (!summaryRecordId) return;
                            setSaveError(null);
                            startSaveTransition(async () => {
                              try {
                                await client.mutations.updateSessionSummary({
                                  memoryRecordId: summaryRecordId,
                                  text: editText.trim(),
                                });
                                setSessionSummary(editText.trim());
                                setIsEditing(false);
                              } catch (err) {
                                setSaveError(err instanceof Error ? err.message : 'Save failed');
                              }
                            });
                          }}
                        >
                          {isSaving ? 'Saving…' : 'Save'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditText(sessionSummary); setIsEditing(true); }}
                        data-testid="summary-edit-button"
                      >
                        Edit
                      </Button>
                    )}
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </PromptInputTools>
          <PromptInputSubmit status={status} onStop={stopStreaming} />
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}
