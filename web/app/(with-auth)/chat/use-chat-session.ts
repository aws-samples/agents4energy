'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const amplifyClient = generateClient<Schema>({ authMode: 'userPool' });

export type ChatSessionResult = {
  ready: boolean;
  sessionId: string | null;
  sessionIdRef: React.RefObject<string | null>;
  agentId: string | null;
  setAgentId: (id: string | null) => void;
};

export function useChatSession(): ChatSessionResult {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');
  const agentIdParam = searchParams.get('agentId');

  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(sessionIdParam);
  const sessionIdRef = useRef<string | null>(sessionIdParam);
  const [agentId, setAgentIdState] = useState<string | null>(agentIdParam);

  function setAgentId(id: string | null) {
    setAgentIdState(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('agentId', id);
    } else {
      params.delete('agentId');
    }
    router.replace(`?${params.toString()}`);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!sessionIdParam) {
        const { data: session, errors } = await amplifyClient.models.ChatSession.create({
          name: 'New Chat',
          agentId: agentIdParam ?? undefined,
        });
        if (errors || !session) {
          console.error('[useChatSession] failed to create session', errors);
          return;
        }
        if (cancelled) return;
        sessionIdRef.current = session.id;
        setSessionId(session.id);
        const params = new URLSearchParams(searchParams.toString());
        params.set('sessionId', session.id);
        router.replace(`?${params.toString()}`);
        setReady(true);
      } else {
        // Fetch existing session to get its agentId if not in URL
        if (!agentIdParam) {
          const { data: session } = await amplifyClient.models.ChatSession.get({ id: sessionIdParam });
          if (!cancelled && session?.agentId) {
            setAgentIdState(session.agentId);
          }
        }
        setReady(true);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready, sessionId, sessionIdRef, agentId, setAgentId };
}
