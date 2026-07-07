import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { fetchCredential, isExpiredOrExpiringSoon } from '@/lib/mcp-auth';

const amplifyClient = generateClient<Schema>({ authMode: 'userPool' });

export type McpToolResult = {
  tools: Array<{ name: string; description?: string | null; inputSchema?: string | null }>;
  error: string | null;
};

/**
 * List tools for a single MCP server, injecting an OAuth Bearer token when
 * the server has an oauthClientId and a valid stored credential.
 */
export async function listMcpToolsForServer(server: {
  id: string;
  url: string;
  oauthClientId?: string | null;
  headers: Array<{ key: string; value: string }>;
}): Promise<McpToolResult> {
  let headers = server.headers.filter((h) => h.key.trim());

  if (server.oauthClientId) {
    const cred = await fetchCredential(server.id).catch(() => null);
    if (cred && !isExpiredOrExpiringSoon(cred)) {
      headers = [
        ...headers.filter((h) => h.key.toLowerCase() !== 'authorization'),
        { key: 'Authorization', value: `Bearer ${cred.accessToken}` },
      ];
    }
  }

  const res = await (amplifyClient.graphql({
    query: /* GraphQL */ `
      query ListMcpTools($url: String!, $headers: [McpServerHeaderEntryInput]) {
        listMcpTools(url: $url, headers: $headers) {
          tools { name description inputSchema }
          error
        }
      }
    `,
    variables: {
      url: server.url,
      headers: headers.length > 0 ? headers : undefined,
    },
  }) as unknown as Promise<any>);

  const result = res.data?.listMcpTools;
  return {
    tools: result?.tools ?? [],
    error: result?.error ?? null,
  };
}
