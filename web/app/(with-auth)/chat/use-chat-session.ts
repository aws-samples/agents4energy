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
};

export function useChatSession(): ChatSessionResult {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');

  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(sessionIdParam);
  const sessionIdRef = useRef<string | null>(sessionIdParam);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!sessionIdParam) {
        const { data: session, errors } = await amplifyClient.models.ChatSession.create({
          name: 'New Chat',
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
        setReady(true);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready, sessionId, sessionIdRef };
}
