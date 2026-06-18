'use client';
import { useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const amplifyClient = generateClient<Schema>({ authMode: 'userPool' });

export type AgentOption = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  systemPromptText?: string | null;
  modelId?: string | null;
};

export type AgentsState =
  | { status: 'loading' }
  | { status: 'ready'; agents: AgentOption[] };

export function useAgents(): AgentsState {
  const [state, setState] = useState<AgentsState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data, errors } = await amplifyClient.models.Agent.list({
          filter: { enabled: { eq: true } },
        });
        if (errors?.length) {
          console.error('[useAgents] list error', errors);
        }
        if (!cancelled) {
          setState({
            status: 'ready',
            agents: (data ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              slug: a.slug,
              description: a.description,
              systemPromptText: a.systemPromptText,
              modelId: a.modelId,
            })),
          });
        }
      } catch (err) {
        console.error('[useAgents] failed', err);
        if (!cancelled) setState({ status: 'ready', agents: [] });
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
