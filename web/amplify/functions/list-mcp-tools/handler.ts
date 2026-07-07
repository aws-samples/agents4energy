// Lists tools from an MCP server using exactly the same URL + headers the harness
// passes via remote_mcp. If this query succeeds, the agent can call those tools.
//
// Protocol: MCP Streamable HTTP (2025-03-26 / 2025-06-18).
// We POST initialize, then tools/list, to the server URL.
// The server may return SSE or plain JSON — we handle both.

const MCP_VERSION = '2025-03-26';

interface McpHeaderEntry {
  key: string;
  value: string;
}

interface ListMcpToolsArgs {
  url: string;
  headers?: McpHeaderEntry[] | null;
}

interface McpToolInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

interface McpTool {
  name: string;
  description?: string | null;
  inputSchema?: string | null; // JSON-encoded so AppSync can carry it
}

interface ListMcpToolsResult {
  tools: McpTool[];
  error?: string | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(entries: McpHeaderEntry[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Version': MCP_VERSION,
  };
  for (const h of entries ?? []) {
    if (h.key) out[h.key] = h.value;
  }
  return out;
}

async function mcpPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MCP server responded ${res.status}: ${text.slice(0, 200)}`);
  }

  const contentType = res.headers.get('content-type') ?? '';

  // SSE response — read until we get a result/error event
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch { /* skip malformed lines */ }
      }
    }
    throw new Error('MCP SSE response contained no parseable data lines');
  }

  return res.json();
}

// ── handler ───────────────────────────────────────────────────────────────────

export const handler = async (
  event: { arguments: ListMcpToolsArgs },
): Promise<ListMcpToolsResult> => {
  const { url, headers: headerEntries } = event.arguments;
  const headers = buildHeaders(headerEntries);

  try {
    // Step 1: initialize — required by the MCP spec before any other request.
    const initResp = await mcpPost(url, headers, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_VERSION,
        capabilities: {},
        clientInfo: { name: 'agentcore-web', version: '1.0' },
      },
    });

    // Some servers return errors on initialize but still respond to tools/list.
    // Only hard-fail on network/HTTP errors (thrown above).
    void initResp;

    // Step 2: tools/list
    const toolsResp = await mcpPost(url, headers, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const rpc = toolsResp as { result?: { tools?: unknown[] }; error?: { message?: string } };

    if (rpc.error) {
      return { tools: [], error: rpc.error.message ?? 'tools/list returned an error' };
    }

    const rawTools: unknown[] = rpc.result?.tools ?? [];
    const tools: McpTool[] = rawTools.map((t: any) => ({
      name: String(t.name ?? ''),
      description: t.description ? String(t.description) : null,
      inputSchema: t.inputSchema ? JSON.stringify(t.inputSchema) : null,
    }));

    return { tools };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { tools: [], error: message };
  }
};
