'use client';
import { useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import type { UIMessage } from 'ai';

// The harness SDK stores memory under the agent name ("default") as the actorId,
// not the Cognito user sub. This is visible in CloudWatch:
//   /users/default/preferences, /summaries/default/{sessionId}, etc.
const ACTOR_ID = 'default';

const amplifyClient = generateClient<Schema>({ authMode: 'userPool' });

export type InitialMessagesState =
  | { status: 'loading' }
  | { status: 'ready'; messages: UIMessage[] };

export function useInitialMessages(sessionId: string | null): InitialMessagesState {
  const [state, setState] = useState<InitialMessagesState>({ status: 'loading' });

  useEffect(() => {
    if (!sessionId) {
      setState({ status: 'ready', messages: [] });
      return;
    }

    // Reset to loading whenever sessionId changes so ChatView doesn't mount
    // with empty messages before the fetch completes.
    setState({ status: 'loading' });
    let cancelled = false;

    async function load() {
      try {
        const allEvents: NonNullable<Schema['ListSessionMessagesResult']['type']['events']> = [];
        let nextToken: string | null | undefined = null;

        do {
          const result = await amplifyClient.queries.listSessionMessages({
            sessionId: sessionId!,
            actorId: ACTOR_ID,
            ...(nextToken ? { nextToken } : {}),
          });

          console.log("initial messages: ", result)

          if (result.errors?.length) {
            console.error('[useInitialMessages] query error', result.errors);
            break;
          }

          allEvents.push(...(result.data?.events ?? []));
          nextToken = result.data?.nextToken;
        } while (nextToken);

        if (cancelled) return;

        const messages: UIMessage[] = allEvents
          .filter((e): e is NonNullable<typeof e> => e != null)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map((e, i) => ({
            id: e.eventId ?? `msg-${i}`,
            role: (e.role === 'assistant' || e.role === 'user' ? e.role : 'assistant') as UIMessage['role'],
            content: e.text,
            parts: [{ type: 'text' as const, text: e.text }],
            createdAt: e.timestamp ? new Date(e.timestamp) : new Date(),
          }));

        setState({ status: 'ready', messages });
      } catch (err) {
        console.error('[useInitialMessages] failed', err);
        if (!cancelled) setState({ status: 'ready', messages: [] });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [sessionId]);

  return state;
}
