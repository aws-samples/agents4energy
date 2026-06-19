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
  oauthClientId?: string | null;
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
        const [agentsRes, joinRes, serversRes, credsRes] = await Promise.all([
          amplifyClient.models.Agent.list({ filter: { enabled: { eq: true } } }),
          amplifyClient.models.AgentMcpServer.list(),
          amplifyClient.models.McpServer.list({ filter: { enabled: { eq: true } } }),
          amplifyClient.models.McpServerCredential.list(),
        ]);

        if (agentsRes.errors?.length) console.error('[useAgents] agents error', agentsRes.errors);
        if (joinRes.errors?.length) console.error('[useAgents] join error', joinRes.errors);
        if (serversRes.errors?.length) console.error('[useAgents] servers error', serversRes.errors);
        if (credsRes.errors?.length) console.error('[useAgents] credentials error', credsRes.errors);

        // Build a map of mcpServerId -> Bearer token (only non-expired ones).
        const tokenByServerId: Record<string, string> = {};
        for (const cred of credsRes.data ?? []) {
          if (!cred.accessToken) continue;
          if (cred.expiresAt && new Date(cred.expiresAt).getTime() < Date.now()) continue;
          tokenByServerId[cred.mcpServerId] = cred.accessToken;
        }

        const serverById = Object.fromEntries((serversRes.data ?? []).map((s) => [s.id, s]));

        const serversByAgent: Record<string, McpServerInfo[]> = {};
        for (const join of joinRes.data ?? []) {
          const s = serverById[join.mcpServerId];
          if (!s) continue;
          if (!serversByAgent[join.agentId]) serversByAgent[join.agentId] = [];

          // Merge stored headers with the OAuth credential token.
          // The credential token is injected as Authorization: Bearer, overriding
          // any static Authorization header already on the server record.
          let headers = s.headers as McpServerInfo['headers'] ?? [];
          const bearerToken = tokenByServerId[s.id];
          if (bearerToken) {
            const existing = (headers ?? []).filter(
              (h) => h?.key?.toLowerCase() !== 'authorization',
            );
            headers = [...existing, { key: 'Authorization', value: `Bearer ${bearerToken}` }];
          }

          serversByAgent[join.agentId].push({
            id: s.id,
            name: s.name,
            url: s.url,
            headers,
            enabled: s.enabled ?? true,
            oauthClientId: s.oauthClientId ?? null,
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
