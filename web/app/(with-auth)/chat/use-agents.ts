'use client';
import { useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const amplifyClient = generateClient<Schema>({ authMode: 'userPool' });

export type McpServerInfo = {
  id: string;
  name: string;
  url: string;
  headers: Array<{ key: string | null; value: string | null }> | null | undefined;
  enabled: boolean;
};

export type AgentOption = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  systemPromptText?: string | null;
  modelId?: string | null;
  mcpServers: McpServerInfo[];
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
        const [agentsRes, joinRes, serversRes] = await Promise.all([
          amplifyClient.models.Agent.list({ filter: { enabled: { eq: true } } }),
          amplifyClient.models.AgentMcpServer.list(),
          amplifyClient.models.McpServer.list({ filter: { enabled: { eq: true } } }),
        ]);

        if (agentsRes.errors?.length) console.error('[useAgents] agents error', agentsRes.errors);
        if (joinRes.errors?.length) console.error('[useAgents] join error', joinRes.errors);
        if (serversRes.errors?.length) console.error('[useAgents] servers error', serversRes.errors);

        const serverById = Object.fromEntries((serversRes.data ?? []).map((s) => [s.id, s]));

        const serversByAgent: Record<string, McpServerInfo[]> = {};
        for (const join of joinRes.data ?? []) {
          const s = serverById[join.mcpServerId];
          if (!s) continue;
          if (!serversByAgent[join.agentId]) serversByAgent[join.agentId] = [];
          serversByAgent[join.agentId].push({
            id: s.id,
            name: s.name,
            url: s.url,
            headers: s.headers as McpServerInfo['headers'],
            enabled: s.enabled ?? true,
          });
        }

        if (!cancelled) {
          setState({
            status: 'ready',
            agents: (agentsRes.data ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              slug: a.slug,
              description: a.description,
              systemPromptText: a.systemPromptText,
              modelId: a.modelId,
              mcpServers: serversByAgent[a.id] ?? [],
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
