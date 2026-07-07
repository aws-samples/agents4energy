'use client';

import { type ReactNode, useCallback, useEffect, useReducer, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  PlusIcon,
  Trash2Icon,
  ChevronRightIcon,
  WrenchIcon,
  BotIcon,
  CheckIcon,
  XIcon,
  ListIcon,
  ServerIcon,
  KeyRoundIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  StarIcon,
} from 'lucide-react';
import {
  type McpCredential,
  authenticateViaPkce,
  fetchCredential,
  revokeCredential,
  isExpiredOrExpiringSoon,
} from '@/lib/mcp-auth';
import { listMcpToolsForServer } from '@/lib/list-mcp-tools';

const amplifyClient = generateClient<Schema>({ authMode: 'userPool' });

async function listAll<T>(
  fn: (opts: { nextToken?: string }) => Promise<{ data: T[]; nextToken?: string | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let token: string | undefined;
  do {
    const res = await fn(token ? { nextToken: token } : {});
    all.push(...(res.data ?? []));
    token = res.nextToken ?? undefined;
  } while (token);
  return all;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpServerHeader = { key: string; value: string };

type McpServer = {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  enabled: boolean;
  headers: McpServerHeader[];
  oauthClientId?: string | null;
};

type AgentRecord = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  systemPromptText?: string | null;
  modelId?: string | null;
  enabled: boolean;
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toAgentRecord(a: any): AgentRecord {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description ?? null,
    systemPromptText: a.systemPromptText ?? null,
    modelId: a.modelId ?? null,
    enabled: a.enabled ?? true,
  };
}

function toMcpServer(s: any): McpServer {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    description: s.description ?? null,
    enabled: s.enabled ?? true,
    headers: ((s.headers ?? []) as Array<{ key?: string | null; value?: string | null }>).map(
      (h) => ({ key: h.key ?? '', value: h.value ?? '' }),
    ),
    oauthClientId: s.oauthClientId ?? null,
  };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type PageState =
  | { status: 'loading' }
  | {
      status: 'ready';
      agents: AgentRecord[];
      mcpServers: McpServer[];
      agentsNextToken: string | null;
      mcpServersNextToken: string | null;
    }
  | { status: 'error'; message: string };

type Action =
  | { type: 'loaded'; agents: AgentRecord[]; mcpServers: McpServer[]; agentsNextToken: string | null; mcpServersNextToken: string | null }
  | { type: 'error'; message: string }
  | { type: 'upsertAgent'; agent: AgentRecord }
  | { type: 'deleteAgent'; id: string }
  | { type: 'upsertMcpServer'; server: McpServer }
  | { type: 'deleteMcpServer'; id: string }
  | { type: 'appendAgents'; agents: AgentRecord[]; nextToken: string | null }
  | { type: 'setAgents'; agents: AgentRecord[]; nextToken: string | null }
  | { type: 'appendMcpServers'; servers: McpServer[]; nextToken: string | null }
  | { type: 'setMcpServers'; servers: McpServer[]; nextToken: string | null };

function reducer(state: PageState, action: Action): PageState {
  if (action.type === 'loaded') {
    return {
      status: 'ready',
      agents: action.agents,
      mcpServers: action.mcpServers,
      agentsNextToken: action.agentsNextToken,
      mcpServersNextToken: action.mcpServersNextToken,
    };
  }
  if (action.type === 'error') {
    return { status: 'error', message: action.message };
  }
  if (state.status !== 'ready') return state;
  if (action.type === 'upsertAgent') {
    const exists = state.agents.some((a) => a.id === action.agent.id);
    return {
      ...state,
      agents: exists
        ? state.agents.map((a) => (a.id === action.agent.id ? action.agent : a))
        : [...state.agents, action.agent],
    };
  }
  if (action.type === 'deleteAgent') {
    return { ...state, agents: state.agents.filter((a) => a.id !== action.id) };
  }
  if (action.type === 'upsertMcpServer') {
    const exists = state.mcpServers.some((s) => s.id === action.server.id);
    return {
      ...state,
      mcpServers: exists
        ? state.mcpServers.map((s) => (s.id === action.server.id ? action.server : s))
        : [...state.mcpServers, action.server],
    };
  }
  if (action.type === 'deleteMcpServer') {
    return { ...state, mcpServers: state.mcpServers.filter((s) => s.id !== action.id) };
  }
  if (action.type === 'appendAgents') {
    // dedupe by id
    const existing = new Set(state.agents.map((a) => a.id));
    const newOnes = action.agents.filter((a) => !existing.has(a.id));
    return { ...state, agents: [...state.agents, ...newOnes], agentsNextToken: action.nextToken };
  }
  if (action.type === 'setAgents') {
    return { ...state, agents: action.agents, agentsNextToken: action.nextToken };
  }
  if (action.type === 'appendMcpServers') {
    const existing = new Set(state.mcpServers.map((s) => s.id));
    const newOnes = action.servers.filter((s) => !existing.has(s.id));
    return { ...state, mcpServers: [...state.mcpServers, ...newOnes], mcpServersNextToken: action.nextToken };
  }
  if (action.type === 'setMcpServers') {
    return { ...state, mcpServers: action.servers, mcpServersNextToken: action.nextToken };
  }
  return state;
}

// ---------------------------------------------------------------------------
// Agent form state
// ---------------------------------------------------------------------------

type EditForm = {
  name: string;
  slug: string;
  description: string;
  systemPromptText: string;
  modelId: string;
  enabled: boolean;
  mcpServerIds: string[];
  subAgentIds: string[];
};

function agentToForm(a: AgentRecord): EditForm {
  return {
    name: a.name,
    slug: a.slug,
    description: a.description ?? '',
    systemPromptText: a.systemPromptText ?? '',
    modelId: a.modelId ?? '',
    enabled: a.enabled,
    mcpServerIds: [],
    subAgentIds: [],
  };
}

function emptyAgentForm(): EditForm {
  return { name: '', slug: '', description: '', systemPromptText: '', modelId: '', enabled: true, mcpServerIds: [], subAgentIds: [] };
}

// ---------------------------------------------------------------------------
// MCP server form state
// ---------------------------------------------------------------------------

type McpServerForm = {
  name: string;
  url: string;
  description: string;
  enabled: boolean;
  headers: McpServerHeader[];
  oauthClientId: string;
};

function serverToForm(s: McpServer): McpServerForm {
  return {
    name: s.name,
    url: s.url,
    description: s.description ?? '',
    enabled: s.enabled,
    headers: s.headers.map((h) => ({ ...h })),
    oauthClientId: s.oauthClientId ?? '',
  };
}

function emptyServerForm(): McpServerForm {
  return { name: '', url: '', description: '', enabled: true, headers: [], oauthClientId: '' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// useFavorites hook
// ---------------------------------------------------------------------------

function useFavorites(storageKey: string): [Set<string>, (id: string) => void] {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });
  const toggle = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  }, [storageKey]);
  return [favorites, toggle];
}

// ---------------------------------------------------------------------------
// MCP tools dialog
// ---------------------------------------------------------------------------

type McpToolItem = { name: string; description?: string | null; inputSchema?: string | null };

function McpToolsDialog({
  server,
  open,
  onClose,
}: {
  server: McpServer | null;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [tools, setTools] = useState<McpToolItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !server) return;
    setLoading(true);
    setTools([]);
    setError(null);

    (async () => {
      try {
        const result = await listMcpToolsForServer(server);
        setTools(result.tools);
        setError(result.error);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WrenchIcon className="size-4" />
            {server?.name} — tools
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          )}
          {!loading && error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
          )}
          {!loading && !error && tools.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No tools found.</p>
          )}
          {!loading && tools.length > 0 && (
            <ul className="space-y-2 py-1">
              {tools.map((t) => (
                <li key={t.name} className="rounded-lg border px-3 py-2 space-y-0.5">
                  <p className="text-sm font-mono font-medium">{t.name}</p>
                  {t.description && (
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog (generic)
// ---------------------------------------------------------------------------

function DeleteConfirmDialog({
  title,
  description,
  open,
  onConfirm,
  onCancel,
  saving,
}: {
  title: string;
  description: ReactNode;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">{description}</div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={saving}>
            {saving ? <Spinner className="mr-1.5" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// MCP server edit panel
// ---------------------------------------------------------------------------

function McpServerEditPanel({
  server,
  onSave,
  onDelete,
  onClose,
}: {
  server: McpServer | null; // null = creating new
  onSave: (form: McpServerForm, id: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<McpServerForm>(server ? serverToForm(server) : emptyServerForm());
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [credential, setCredential] = useState<McpCredential | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [authPhase, setAuthPhase] = useState<'idle' | 'discovering' | 'waiting' | 'error'>('idle');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    setForm(server ? serverToForm(server) : emptyServerForm());
    setError(null);
    setCredential(null);
    setAuthPhase('idle');
    setAuthError(null);
    // Load existing credential when editing a saved server with OAuth configured.
    if (server?.id && server.oauthClientId) {
      setCredLoading(true);
      fetchCredential(server.id).then(setCredential).catch(() => null).finally(() => setCredLoading(false));
    }
  }, [server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField<K extends keyof McpServerForm>(key: K, value: McpServerForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addHeader() {
    setForm((prev) => ({ ...prev, headers: [...prev.headers, { key: '', value: '' }] }));
  }

  function updateHeader(index: number, field: 'key' | 'value', value: string) {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    }));
  }

  function removeHeader(index: number) {
    setForm((prev) => ({ ...prev, headers: prev.headers.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.url.trim()) { setError('URL is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(form, server?.id ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!server) return;
    setDeleting(true);
    try {
      await onDelete(server.id);
      setDeleteOpen(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handleRevoke() {
    if (!credential) return;
    try {
      await revokeCredential(credential.id);
      setCredential(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleAuthenticate() {
    if (!server?.id || !form.oauthClientId.trim()) return;
    setAuthPhase('discovering');
    setAuthError(null);
    try {
      const cred = await authenticateViaPkce({
        mcpServerId: server.id,
        mcpServerUrl: form.url || server.url,
        oauthClientId: form.oauthClientId.trim(),
        existingCredentialId: credential?.id,
      });
      setCredential(cred);
      setAuthPhase('idle');
    } catch (err: unknown) {
      setAuthPhase('error');
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  }

  // Use the saved server for tool listing; only available when editing an existing record.
  // Inject the OAuth credential token (if any) so the list-tools call is authenticated.
  const toolsServer: McpServer | null = server ? (() => {
    const staticHeaders = form.headers.filter((h) => h.key.trim());
    const headers = credential && !isExpiredOrExpiringSoon(credential)
      ? [
          ...staticHeaders.filter((h) => h.key.toLowerCase() !== 'authorization'),
          { key: 'Authorization', value: `Bearer ${credential.accessToken}` },
        ]
      : staticHeaders;
    return { ...server, url: form.url, headers };
  })() : null;

  const credStatus: 'none' | 'valid' | 'expiring' | 'loading' =
    credLoading ? 'loading' :
    !credential ? 'none' :
    isExpiredOrExpiringSoon(credential) ? 'expiring' : 'valid';

  return (
    <div className="flex flex-col h-full" data-testid="mcp-server-edit-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h2 className="font-semibold text-base">
          {server ? 'Edit MCP server' : 'New MCP server'}
        </h2>
        <div className="flex items-center gap-2">
          {server && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setToolsOpen(true)}
                data-testid="list-tools-button"
              >
                <ListIcon />
                List tools
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                data-testid="delete-mcp-server-button"
              >
                <Trash2Icon />
                Delete
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
            <XIcon />
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Identity */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Identity
          </h3>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Name
              <Input
                className="mt-1"
                placeholder="My MCP Server"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                data-testid="input-mcp-name"
              />
            </label>
            <label className="text-sm font-medium">
              URL
              <Input
                className="mt-1 font-mono text-xs"
                placeholder="https://..."
                value={form.url}
                onChange={(e) => setField('url', e.target.value)}
                data-testid="input-mcp-url"
              />
            </label>
            <label className="text-sm font-medium">
              Description
              <Input
                className="mt-1"
                placeholder="Short description (optional)"
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              OAuth2 client ID
              <Input
                className="mt-1 font-mono text-xs"
                placeholder="Leave blank if no OAuth required"
                value={form.oauthClientId}
                onChange={(e) => setField('oauthClientId', e.target.value)}
                data-testid="input-mcp-oauth-client-id"
              />
              <span className="text-xs font-normal text-muted-foreground mt-0.5 block">
                When set, users authenticate via a browser popup (OAuth2 PKCE) before making MCP calls.
              </span>
            </label>

            {/* OAuth server requirements — shown when a client ID is entered */}
            {form.oauthClientId.trim() && (
              <div className="rounded-lg border border-dashed px-3 py-2.5 space-y-1.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground text-xs">MCP server requirements for OAuth</p>
                <ul className="space-y-1 list-none">
                  <li className="flex gap-1.5"><span className="shrink-0 text-muted-foreground">1.</span><span>Serve <span className="font-mono">GET /.well-known/oauth-protected-resource</span> — lists the authorization server URL.</span></li>
                  <li className="flex gap-1.5"><span className="shrink-0 text-muted-foreground">2.</span><span>Authorization server exposes <span className="font-mono">/.well-known/openid-configuration</span> with <span className="font-mono">authorization_endpoint</span> and <span className="font-mono">token_endpoint</span>.</span></li>
                  <li className="flex gap-1.5"><span className="shrink-0 text-muted-foreground">3.</span><span>App client has <span className="font-mono">https://localhost:3000/oauth/callback</span> registered as a redirect URI.</span></li>
                  <li className="flex gap-1.5"><span className="shrink-0 text-muted-foreground">4.</span><span>App client supports Authorization Code + PKCE (no client secret needed).</span></li>
                </ul>
              </div>
            )}
          </div>
        </section>

        <Separator />

        {/* Auth headers */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Auth headers
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addHeader}
              className="h-6 text-xs"
            >
              <PlusIcon className="size-3" />
              Add header
            </Button>
          </div>
          {form.headers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No headers. Add one if this server requires authentication.
            </p>
          ) : (
            <ul className="space-y-2">
              {form.headers.map((h, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Input
                    className="flex-1 font-mono text-xs"
                    placeholder="Header name"
                    value={h.key}
                    onChange={(e) => updateHeader(i, 'key', e.target.value)}
                  />
                  <Input
                    className="flex-1 font-mono text-xs"
                    placeholder="Value"
                    value={h.value}
                    onChange={(e) => updateHeader(i, 'value', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeHeader(i)}
                    aria-label="Remove header"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* OAuth credential status — only shown for saved servers with oauthClientId */}
        {server?.id && form.oauthClientId.trim() && (
          <>
            <Separator />
            <section className="space-y-3" data-testid="credential-section">
              <div className="flex items-center gap-1.5">
                <KeyRoundIcon className="size-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Your credentials
                </h3>
              </div>

              <div className="rounded-lg border px-3 py-2.5 flex items-center gap-3" data-testid="credential-status">
                {credStatus === 'loading' && (
                  <><Spinner className="size-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Checking…</span></>
                )}
                {credStatus === 'none' && authPhase === 'idle' && (
                  <><AlertCircleIcon className="size-4 text-muted-foreground shrink-0" /><span className="text-sm text-muted-foreground flex-1">Not authenticated.</span></>
                )}
                {credStatus === 'valid' && (
                  <><CheckCircle2Icon className="size-4 text-green-600 shrink-0" /><span className="text-sm flex-1">Authenticated{credential?.expiresAt ? ` · expires ${new Date(credential.expiresAt).toLocaleString()}` : ''}.</span></>
                )}
                {credStatus === 'expiring' && authPhase === 'idle' && (
                  <><AlertCircleIcon className="size-4 text-amber-500 shrink-0" /><span className="text-sm flex-1 text-amber-700">Token expiring soon — re-authenticate.</span></>
                )}
                {authPhase === 'discovering' && (
                  <><Spinner className="size-4 text-muted-foreground" /><span className="text-sm text-muted-foreground flex-1">Opening sign-in window…</span></>
                )}
                {authPhase === 'waiting' && (
                  <><Spinner className="size-4 text-muted-foreground" /><span className="text-sm text-muted-foreground flex-1">Waiting for sign-in to complete…</span></>
                )}
                {authPhase === 'error' && (
                  <><AlertCircleIcon className="size-4 text-destructive shrink-0" /><span className="text-sm text-destructive flex-1">{authError ?? 'Authentication failed.'}</span></>
                )}
                <div className="flex items-center gap-2 shrink-0">
                  {(credStatus === 'none' || credStatus === 'expiring') && authPhase === 'idle' && (
                    <Button type="button" size="sm" variant="outline" onClick={handleAuthenticate} data-testid="authenticate-button">
                      <KeyRoundIcon className="size-3.5" />
                      Authenticate
                    </Button>
                  )}
                  {authPhase === 'error' && (
                    <Button type="button" size="sm" variant="outline" onClick={handleAuthenticate} data-testid="authenticate-button">
                      <KeyRoundIcon className="size-3.5" />
                      Retry
                    </Button>
                  )}
                  {(credStatus === 'valid' || credStatus === 'expiring') && authPhase === 'idle' && (
                    <Button type="button" size="sm" variant="ghost" onClick={handleRevoke} className="text-destructive hover:text-destructive" data-testid="revoke-button">
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        <div className="h-2" />
      </div>

      {/* Footer */}
      <div className="border-t px-6 py-4 flex items-center justify-end gap-2 bg-muted/30">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving} data-testid="save-mcp-server-button">
          {saving ? <Spinner className="mr-1.5" /> : null}
          {server ? 'Save changes' : 'Add server'}
        </Button>
      </div>

      <DeleteConfirmDialog
        title="Delete MCP server?"
        description={
          <>
            <span className="font-medium text-foreground">{server?.name}</span> will be permanently
            deleted and removed from all agents that use it. This cannot be undone.
          </>
        }
        open={deleteOpen}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
        saving={deleting}
      />

      <McpToolsDialog
        server={toolsServer}
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent edit panel
// ---------------------------------------------------------------------------

function EditPanel({
  agent,
  allAgents,
  mcpServers,
  onSave,
  onDelete,
  onClose,
}: {
  agent: AgentRecord | null;
  allAgents: AgentRecord[];
  mcpServers: McpServer[];
  onSave: (form: EditForm, id: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<EditForm>(agent ? agentToForm(agent) : emptyAgentForm());
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolsServer, setToolsServer] = useState<McpServer | null>(null);
  const [joinsLoading, setJoinsLoading] = useState(false);

  // Local MCP servers state for the picker (may include servers not in the first-page list)
  const [pickerMcpServers, setPickerMcpServers] = useState<McpServer[]>(mcpServers);
  const [mcpPickerQuery, setMcpPickerQuery] = useState('');
  const [mcpPickerQueryActive, setMcpPickerQueryActive] = useState('');
  const [mcpPickerSearching, setMcpPickerSearching] = useState(false);

  // Sub-agent filter
  const [subAgentQuery, setSubAgentQuery] = useState('');

  // Sync pickerMcpServers when the prop changes (parent list updated)
  useEffect(() => {
    setPickerMcpServers((prev) => {
      // Keep any selected servers that aren't in the new prop list
      const propIds = new Set(mcpServers.map((s) => s.id));
      const extras = prev.filter((s) => !propIds.has(s.id) && form.mcpServerIds.includes(s.id));
      return [...mcpServers, ...extras];
    });
  }, [mcpServers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce MCP picker search
  useEffect(() => {
    const timer = setTimeout(() => setMcpPickerQueryActive(mcpPickerQuery), 300);
    return () => clearTimeout(timer);
  }, [mcpPickerQuery]);

  // MCP picker search effect
  useEffect(() => {
    if (!mcpPickerQueryActive) {
      // Restore prop list + any selected extras
      setPickerMcpServers((prev) => {
        const propIds = new Set(mcpServers.map((s) => s.id));
        const extras = prev.filter((s) => !propIds.has(s.id) && form.mcpServerIds.includes(s.id));
        return [...mcpServers, ...extras];
      });
      return;
    }

    let cancelled = false;
    setMcpPickerSearching(true);
    (amplifyClient.models.McpServer.list({
      filter: { name: { contains: mcpPickerQueryActive } },
      limit: 20,
    } as any) as Promise<{ data: any[]; nextToken?: string | null }>).then((res) => {
      if (cancelled) return;
      const searched = (res.data ?? []).map(toMcpServer);
      // Always include selected servers even if not in search results
      const selectedIds = new Set(form.mcpServerIds);
      const selectedExtras = pickerMcpServers.filter((s) => selectedIds.has(s.id) && !searched.some((x) => x.id === s.id));
      setPickerMcpServers([...selectedExtras, ...searched]);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setMcpPickerSearching(false);
    });
    return () => { cancelled = true; };
  }, [mcpPickerQueryActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setForm(agent ? agentToForm(agent) : emptyAgentForm());
    setError(null);
    setMcpPickerQuery('');
    setMcpPickerQueryActive('');
    setSubAgentQuery('');

    // Lazy-load join data when editing an existing agent
    if (agent?.id) {
      setJoinsLoading(true);
      Promise.all([
        listAll((opts) => amplifyClient.models.AgentMcpServer.list({ ...opts, filter: { agentId: { eq: agent.id } } })),
        listAll((opts) => amplifyClient.models.AgentSubAgent.list({ ...opts, filter: { agentId: { eq: agent.id } } })),
      ]).then(async ([mcpJoins, subJoins]) => {
        const mcpServerIds = mcpJoins.map((j) => j.mcpServerId);
        const subAgentIds = subJoins.map((j) => j.subAgentId);

        // Fetch any selected MCP servers not already in mcpServers prop
        const knownIds = new Set(mcpServers.map((s) => s.id));
        const missingIds = mcpServerIds.filter((id) => !knownIds.has(id));
        if (missingIds.length > 0) {
          const fetched = await Promise.all(
            missingIds.map((id) => amplifyClient.models.McpServer.get({ id }))
          );
          const fetchedServers = fetched
            .filter((r) => r.data != null)
            .map((r) => toMcpServer(r.data));
          setPickerMcpServers((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            return [...prev, ...fetchedServers.filter((s) => !existingIds.has(s.id))];
          });
        }

        setForm((prev) => ({ ...prev, mcpServerIds, subAgentIds }));
      }).catch(() => {}).finally(() => setJoinsLoading(false));
    }
  }, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleId(field: 'mcpServerIds' | 'subAgentIds', id: string) {
    setForm((prev) => {
      const current = prev[field];
      return {
        ...prev,
        [field]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.slug.trim()) { setError('Slug is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(form, agent?.id ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!agent) return;
    setDeleting(true);
    try {
      await onDelete(agent.id);
      setDeleteOpen(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleting(false);
    }
  }

  const eligibleSubAgents = allAgents.filter((a) => a.id !== agent?.id);
  const filteredSubAgents = subAgentQuery
    ? eligibleSubAgents.filter((a) => a.name.toLowerCase().includes(subAgentQuery.toLowerCase()))
    : eligibleSubAgents;

  // For MCP picker: selected servers first, then unselected
  const sortedPickerServers = [...pickerMcpServers].sort((a, b) => {
    const aChecked = form.mcpServerIds.includes(a.id) ? 0 : 1;
    const bChecked = form.mcpServerIds.includes(b.id) ? 0 : 1;
    return aChecked - bChecked;
  });

  return (
    <div className="flex flex-col h-full" data-testid="edit-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h2 className="font-semibold text-base">
          {agent ? 'Edit agent' : 'New agent'}
        </h2>
        <div className="flex items-center gap-2">
          {agent && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              data-testid="delete-agent-button"
            >
              <Trash2Icon />
              Delete
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
            <XIcon />
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Identity */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Identity
          </h3>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Name
              <Input
                className="mt-1"
                placeholder="My Agent"
                value={form.name}
                onChange={(e) => {
                  setField('name', e.target.value);
                  if (!agent) setField('slug', slugify(e.target.value));
                }}
                data-testid="input-name"
              />
            </label>
            <label className="text-sm font-medium">
              Slug
              <Input
                className="mt-1"
                placeholder="my-agent"
                value={form.slug}
                onChange={(e) => setField('slug', e.target.value)}
                data-testid="input-slug"
              />
            </label>
            <label className="text-sm font-medium">
              Description
              <Input
                className="mt-1"
                placeholder="Short description (optional)"
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
              />
            </label>
          </div>
        </section>

        <Separator />

        {/* Model */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Model
          </h3>
          <label className="text-sm font-medium">
            Model ID override
            <Input
              className="mt-1 font-mono text-xs"
              placeholder="Leave blank to use harness default"
              value={form.modelId}
              onChange={(e) => setField('modelId', e.target.value)}
              data-testid="input-model-id"
            />
          </label>
        </section>

        <Separator />

        {/* System prompt */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            System prompt
          </h3>
          <Textarea
            placeholder="Enter the agent's system prompt…"
            className="min-h-40 font-mono text-xs"
            value={form.systemPromptText}
            onChange={(e) => setField('systemPromptText', e.target.value)}
            data-testid="textarea-system-prompt"
          />
        </section>

        <Separator />

        {/* MCP tools */}
        <section className="space-y-3">
          <div className="flex items-center gap-1.5">
            <WrenchIcon className="size-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              MCP tool servers
            </h3>
            {joinsLoading && <Spinner className="size-3 text-muted-foreground" />}
          </div>
          {joinsLoading ? (
            <p className="text-xs text-muted-foreground">Loading assigned servers…</p>
          ) : (
            <>
              <Input
                placeholder="Search servers…"
                value={mcpPickerQuery}
                onChange={(e) => setMcpPickerQuery(e.target.value)}
                className="h-7 text-xs"
              />
              {mcpPickerSearching && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Spinner className="size-3" /> Searching…
                </div>
              )}
              {sortedPickerServers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {mcpPickerQueryActive ? 'No servers match your search.' : 'No MCP servers configured. Switch to the MCP Servers tab to add one.'}
                </p>
              ) : (
                <ul className="space-y-1.5" data-testid="mcp-server-list">
                  {sortedPickerServers.map((s) => {
                    const checked = form.mcpServerIds.includes(s.id);
                    return (
                      <li key={s.id} className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleId('mcpServerIds', s.id)}
                          className={cn(
                            'flex-1 flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                            checked
                              ? 'border-primary/40 bg-primary/5 text-foreground'
                              : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
                          )}
                          data-testid={`mcp-toggle-${s.id}`}
                        >
                          <span
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded border',
                              checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                            )}
                          >
                            {checked && <CheckIcon className="size-2.5" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="font-medium text-foreground">{s.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground truncate">{s.url}</span>
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setToolsServer(s)}
                          aria-label={`List tools for ${s.name}`}
                          title="List tools"
                          data-testid={`mcp-list-tools-${s.id}`}
                        >
                          <ListIcon className="size-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>

        <Separator />

        {/* Sub-agents */}
        <section className="space-y-3">
          <div className="flex items-center gap-1.5">
            <BotIcon className="size-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sub-agents
            </h3>
            {joinsLoading && <Spinner className="size-3 text-muted-foreground" />}
          </div>
          {eligibleSubAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other agents available to assign as sub-agents.
            </p>
          ) : (
            <>
              <Input
                placeholder="Filter sub-agents…"
                value={subAgentQuery}
                onChange={(e) => setSubAgentQuery(e.target.value)}
                className="h-7 text-xs"
              />
              {filteredSubAgents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agents match your filter.</p>
              ) : (
                <ul className="space-y-1.5" data-testid="sub-agent-list">
                  {filteredSubAgents.map((a) => {
                    const checked = form.subAgentIds.includes(a.id);
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => toggleId('subAgentIds', a.id)}
                          className={cn(
                            'w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                            checked
                              ? 'border-primary/40 bg-primary/5 text-foreground'
                              : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
                          )}
                          data-testid={`subagent-toggle-${a.id}`}
                        >
                          <span
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded border',
                              checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                            )}
                          >
                            {checked && <CheckIcon className="size-2.5" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="font-medium text-foreground">{a.name}</span>
                            {a.description && (
                              <span className="ml-2 text-xs text-muted-foreground truncate">
                                {a.description}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>

        <div className="h-2" />
      </div>

      {/* Footer */}
      <div className="border-t px-6 py-4 flex items-center justify-end gap-2 bg-muted/30">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving} data-testid="save-agent-button">
          {saving ? <Spinner className="mr-1.5" /> : null}
          {agent ? 'Save changes' : 'Create agent'}
        </Button>
      </div>

      <DeleteConfirmDialog
        title="Delete agent?"
        description={
          <>
            <span className="font-medium text-foreground">{agent?.name}</span> will be permanently
            deleted along with all its tool and sub-agent assignments. This cannot be undone.
          </>
        }
        open={deleteOpen}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
        saving={deleting}
      />

      <McpToolsDialog
        server={toolsServer}
        open={toolsServer !== null}
        onClose={() => setToolsServer(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const [pageState, dispatch] = useReducer(reducer, { status: 'loading' });
  const [activeTab, setActiveTab] = useState<'agents' | 'mcp-servers'>('agents');
  const [selectedAgentId, setSelectedAgentId] = useState<string | 'new' | null>(null);
  const [selectedMcpId, setSelectedMcpId] = useState<string | 'new' | null>(null);

  // Search state
  const [agentQuery, setAgentQuery] = useState('');
  const [agentQueryActive, setAgentQueryActive] = useState('');
  const [mcpQuery, setMcpQuery] = useState('');
  const [mcpQueryActive, setMcpQueryActive] = useState('');

  // Favorites
  const [agentFavorites, toggleAgentFavorite] = useFavorites('agent-favorites');
  const [mcpFavorites, toggleMcpFavorite] = useFavorites('mcp-server-favorites');

  // Load more state
  const [loadingMoreAgents, setLoadingMoreAgents] = useState(false);
  const [loadingMoreMcp, setLoadingMoreMcp] = useState(false);

  // Debounce agent search
  useEffect(() => {
    const timer = setTimeout(() => setAgentQueryActive(agentQuery), 300);
    return () => clearTimeout(timer);
  }, [agentQuery]);

  // Debounce MCP search
  useEffect(() => {
    const timer = setTimeout(() => setMcpQueryActive(mcpQuery), 300);
    return () => clearTimeout(timer);
  }, [mcpQuery]);

  // Agent search effect
  useEffect(() => {
    if (pageState.status !== 'ready') return;
    if (!agentQueryActive) {
      // Restore first-page list
      let cancelled = false;
      (async () => {
        const res = await (amplifyClient.models.Agent.list({ limit: 20 } as any) as Promise<{ data: any[]; nextToken?: string | null }>);
        if (cancelled) return;
        const agents = (res.data ?? []).map(toAgentRecord);
        const nextToken: string | null = res.nextToken ?? null;
        dispatch({ type: 'setAgents', agents, nextToken });
      })().catch(() => {});
      return () => { cancelled = true; };
    }

    let cancelled = false;
    (async () => {
      const res = await (amplifyClient.models.Agent.list({
        filter: { name: { contains: agentQueryActive } },
        limit: 20,
      } as any) as Promise<{ data: any[]; nextToken?: string | null }>);
      if (cancelled) return;
      const agents = (res.data ?? []).map(toAgentRecord);
      dispatch({ type: 'setAgents', agents, nextToken: null });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [agentQueryActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // MCP search effect
  useEffect(() => {
    if (pageState.status !== 'ready') return;
    if (!mcpQueryActive) {
      // Restore first-page list
      let cancelled = false;
      (async () => {
        const res = await (amplifyClient.models.McpServer.list({ limit: 20 } as any) as Promise<{ data: any[]; nextToken?: string | null }>);
        if (cancelled) return;
        const servers = (res.data ?? []).map(toMcpServer);
        const nextToken: string | null = res.nextToken ?? null;
        dispatch({ type: 'setMcpServers', servers, nextToken });
      })().catch(() => {});
      return () => { cancelled = true; };
    }

    let cancelled = false;
    (async () => {
      const res = await (amplifyClient.models.McpServer.list({
        filter: { name: { contains: mcpQueryActive } },
        limit: 20,
      } as any) as Promise<{ data: any[]; nextToken?: string | null }>);
      if (cancelled) return;
      const servers = (res.data ?? []).map(toMcpServer);
      dispatch({ type: 'setMcpServers', servers, nextToken: null });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [mcpQueryActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [agentsRes, serversRes] = await Promise.all([
          amplifyClient.models.Agent.list({ limit: 20 } as any) as Promise<{ data: any[]; nextToken?: string | null }>,
          amplifyClient.models.McpServer.list({ limit: 20 } as any) as Promise<{ data: any[]; nextToken?: string | null }>,
        ]);

        if (cancelled) return;

        const agentsNextToken: string | null = agentsRes.nextToken ?? null;
        const mcpServersNextToken: string | null = serversRes.nextToken ?? null;

        let agents: AgentRecord[] = (agentsRes.data ?? []).map(toAgentRecord);
        let mcpServers: McpServer[] = (serversRes.data ?? []).map(toMcpServer);

        // Fetch favorites that may not be in the first 20
        const storedAgentFavs: string[] = (() => {
          try {
            const raw = localStorage.getItem('agent-favorites');
            return raw ? JSON.parse(raw) as string[] : [];
          } catch { return []; }
        })();
        const storedMcpFavs: string[] = (() => {
          try {
            const raw = localStorage.getItem('mcp-server-favorites');
            return raw ? JSON.parse(raw) as string[] : [];
          } catch { return []; }
        })();

        const existingAgentIds = new Set(agents.map((a) => a.id));
        const missingAgentFavs = storedAgentFavs.filter((id) => !existingAgentIds.has(id));
        if (missingAgentFavs.length > 0) {
          const fetched = await Promise.all(missingAgentFavs.map((id) => amplifyClient.models.Agent.get({ id })));
          const extra = fetched.filter((r) => r.data != null).map((r) => toAgentRecord(r.data));
          agents = [...extra, ...agents];
        }

        const existingMcpIds = new Set(mcpServers.map((s) => s.id));
        const missingMcpFavs = storedMcpFavs.filter((id) => !existingMcpIds.has(id));
        if (missingMcpFavs.length > 0) {
          const fetched = await Promise.all(missingMcpFavs.map((id) => amplifyClient.models.McpServer.get({ id })));
          const extra = fetched.filter((r) => r.data != null).map((r) => toMcpServer(r.data));
          mcpServers = [...extra, ...mcpServers];
        }

        dispatch({ type: 'loaded', agents, mcpServers, agentsNextToken, mcpServersNextToken });
      } catch (err) {
        if (!cancelled) dispatch({ type: 'error', message: String(err) });
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Load more agents
  const handleLoadMoreAgents = useCallback(async () => {
    if (pageState.status !== 'ready' || !pageState.agentsNextToken) return;
    setLoadingMoreAgents(true);
    try {
      const res = await (amplifyClient.models.Agent.list({
        limit: 20,
        nextToken: pageState.agentsNextToken,
      } as any) as Promise<{ data: any[]; nextToken?: string | null }>);
      const agents = (res.data ?? []).map(toAgentRecord);
      const nextToken: string | null = res.nextToken ?? null;
      dispatch({ type: 'appendAgents', agents, nextToken });
    } finally {
      setLoadingMoreAgents(false);
    }
  }, [pageState]);

  // Load more MCP servers
  const handleLoadMoreMcp = useCallback(async () => {
    if (pageState.status !== 'ready' || !pageState.mcpServersNextToken) return;
    setLoadingMoreMcp(true);
    try {
      const res = await (amplifyClient.models.McpServer.list({
        limit: 20,
        nextToken: pageState.mcpServersNextToken,
      } as any) as Promise<{ data: any[]; nextToken?: string | null }>);
      const servers = (res.data ?? []).map(toMcpServer);
      const nextToken: string | null = res.nextToken ?? null;
      dispatch({ type: 'appendMcpServers', servers, nextToken });
    } finally {
      setLoadingMoreMcp(false);
    }
  }, [pageState]);

  // Save agent (create or update)
  const handleSaveAgent = useCallback(
    async (form: EditForm, id: string | null) => {
      if (pageState.status !== 'ready') return;

      if (id) {
        const updateRes = await amplifyClient.models.Agent.update({
          id,
          name: form.name,
          slug: form.slug,
          description: form.description || undefined,
          systemPromptText: form.systemPromptText || undefined,
          modelId: form.modelId || undefined,
          enabled: form.enabled,
        });
        if (updateRes.errors?.length) throw new Error(updateRes.errors.map((e) => e.message).join('; '));

        const existingAgent = pageState.agents.find((a) => a.id === id);
        if (existingAgent) {
          const existing = await listAll((opts) =>
            amplifyClient.models.AgentMcpServer.list({ ...opts, filter: { agentId: { eq: id } } }),
          );

          const toAdd = form.mcpServerIds.filter((sid) => !existing.some((j) => j.mcpServerId === sid));
          const toRemove = existing.filter((j) => !form.mcpServerIds.includes(j.mcpServerId));

          await Promise.all([
            ...toAdd.map((sid) => amplifyClient.models.AgentMcpServer.create({ agentId: id, mcpServerId: sid })),
            ...toRemove.map((j) => amplifyClient.models.AgentMcpServer.delete({ id: j.id })),
          ]);

          const existingSub = await listAll((opts) =>
            amplifyClient.models.AgentSubAgent.list({ ...opts, filter: { agentId: { eq: id } } }),
          );

          const subToAdd = form.subAgentIds.filter((sid) => !existingSub.some((j) => j.subAgentId === sid));
          const subToRemove = existingSub.filter((j) => !form.subAgentIds.includes(j.subAgentId));

          await Promise.all([
            ...subToAdd.map((sid) => amplifyClient.models.AgentSubAgent.create({ agentId: id, subAgentId: sid })),
            ...subToRemove.map((j) => amplifyClient.models.AgentSubAgent.delete({ id: j.id })),
          ]);
        }

        dispatch({
          type: 'upsertAgent',
          agent: toAgentRecord({
            id,
            name: form.name,
            slug: form.slug,
            description: form.description || null,
            systemPromptText: form.systemPromptText || null,
            modelId: form.modelId || null,
            enabled: form.enabled,
          }),
        });
      } else {
        const createRes = await amplifyClient.models.Agent.create({
          name: form.name,
          slug: form.slug,
          description: form.description || undefined,
          systemPromptText: form.systemPromptText || undefined,
          modelId: form.modelId || undefined,
          enabled: form.enabled,
        });
        if (createRes.errors?.length) throw new Error(createRes.errors.map((e) => e.message).join('; '));

        const newId = createRes.data!.id;

        await Promise.all([
          ...form.mcpServerIds.map((sid) => amplifyClient.models.AgentMcpServer.create({ agentId: newId, mcpServerId: sid })),
          ...form.subAgentIds.map((sid) => amplifyClient.models.AgentSubAgent.create({ agentId: newId, subAgentId: sid })),
        ]);

        dispatch({
          type: 'upsertAgent',
          agent: toAgentRecord({
            id: newId,
            name: form.name,
            slug: form.slug,
            description: form.description || null,
            systemPromptText: form.systemPromptText || null,
            modelId: form.modelId || null,
            enabled: form.enabled,
          }),
        });

        setSelectedAgentId(newId);
      }
    },
    [pageState],
  );

  // Delete agent
  const handleDeleteAgent = useCallback(async (id: string) => {
    const [joinRows, subRows] = await Promise.all([
      listAll((opts) => amplifyClient.models.AgentMcpServer.list({ ...opts, filter: { agentId: { eq: id } } })),
      listAll((opts) => amplifyClient.models.AgentSubAgent.list({ ...opts, filter: { agentId: { eq: id } } })),
    ]);
    await Promise.all([
      ...joinRows.map((j) => amplifyClient.models.AgentMcpServer.delete({ id: j.id })),
      ...subRows.map((j) => amplifyClient.models.AgentSubAgent.delete({ id: j.id })),
    ]);
    await amplifyClient.models.Agent.delete({ id });
    dispatch({ type: 'deleteAgent', id });
    setSelectedAgentId(null);
  }, []);

  // Save MCP server (create or update)
  const handleSaveMcpServer = useCallback(async (form: McpServerForm, id: string | null) => {
    const headers = form.headers
      .filter((h) => h.key.trim())
      .map((h) => ({ key: h.key.trim(), value: h.value }));
    const oauthClientId = form.oauthClientId.trim() || undefined;

    if (id) {
      const updateRes = await amplifyClient.models.McpServer.update({
        id,
        name: form.name,
        url: form.url,
        description: form.description || undefined,
        enabled: form.enabled,
        headers,
        oauthClientId,
      });
      if (updateRes.errors?.length) throw new Error(updateRes.errors.map((e) => e.message).join('; '));

      dispatch({
        type: 'upsertMcpServer',
        server: toMcpServer({ id, name: form.name, url: form.url, description: form.description || null, enabled: form.enabled, headers, oauthClientId: oauthClientId ?? null }),
      });
    } else {
      const createRes = await amplifyClient.models.McpServer.create({
        name: form.name,
        url: form.url,
        description: form.description || undefined,
        enabled: form.enabled,
        headers,
        oauthClientId,
      });
      if (createRes.errors?.length) throw new Error(createRes.errors.map((e) => e.message).join('; '));

      const newId = createRes.data!.id;
      dispatch({
        type: 'upsertMcpServer',
        server: toMcpServer({ id: newId, name: form.name, url: form.url, description: form.description || null, enabled: form.enabled, headers, oauthClientId: oauthClientId ?? null }),
      });
      setSelectedMcpId(newId);
    }
  }, []);

  // Delete MCP server — remove join rows first
  const handleDeleteMcpServer = useCallback(async (id: string) => {
    const joinRows = await listAll((opts) =>
      amplifyClient.models.AgentMcpServer.list({ ...opts, filter: { mcpServerId: { eq: id } } }),
    );
    await Promise.all(joinRows.map((j) => amplifyClient.models.AgentMcpServer.delete({ id: j.id })));
    await amplifyClient.models.McpServer.delete({ id });
    dispatch({ type: 'deleteMcpServer', id });
    setSelectedMcpId(null);
  }, []);

  const agents = pageState.status === 'ready' ? pageState.agents : [];
  const mcpServers = pageState.status === 'ready' ? pageState.mcpServers : [];
  const agentsNextToken = pageState.status === 'ready' ? pageState.agentsNextToken : null;
  const mcpServersNextToken = pageState.status === 'ready' ? pageState.mcpServersNextToken : null;
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const selectedMcpServer = mcpServers.find((s) => s.id === selectedMcpId) ?? null;

  const agentPanelOpen = selectedAgentId !== null;
  const mcpPanelOpen = selectedMcpId !== null;
  const panelOpen = activeTab === 'agents' ? agentPanelOpen : mcpPanelOpen;

  // Sort agents: favorites first
  const sortedAgents = [...agents].sort((a, b) => {
    const aFav = agentFavorites.has(a.id) ? 0 : 1;
    const bFav = agentFavorites.has(b.id) ? 0 : 1;
    return aFav - bFav;
  });

  // Sort MCP servers: favorites first
  const sortedMcpServers = [...mcpServers].sort((a, b) => {
    const aFav = mcpFavorites.has(a.id) ? 0 : 1;
    const bFav = mcpFavorites.has(b.id) ? 0 : 1;
    return aFav - bFav;
  });

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <div
        className={cn(
          'flex flex-col border-r bg-background transition-all',
          panelOpen ? 'w-72 shrink-0' : 'flex-1',
        )}
      >
        {/* Tab bar */}
        <div className="flex border-b shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('agents')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'agents'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            data-testid="tab-agents"
          >
            <BotIcon className="size-3.5" />
            Agents
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mcp-servers')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'mcp-servers'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            data-testid="tab-mcp-servers"
          >
            <ServerIcon className="size-3.5" />
            MCP Servers
          </button>
        </div>

        {/* List header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-medium text-muted-foreground">
            {activeTab === 'agents' ? 'All agents' : 'All servers'}
          </span>
          <Button
            size="sm"
            onClick={() => {
              if (activeTab === 'agents') setSelectedAgentId('new');
              else setSelectedMcpId('new');
            }}
            data-testid={activeTab === 'agents' ? 'new-agent-button' : 'new-mcp-server-button'}
          >
            <PlusIcon />
            {activeTab === 'agents' ? 'New agent' : 'Add server'}
          </Button>
        </div>

        {/* Search input */}
        {pageState.status === 'ready' && (
          <div className="px-4 py-2 border-b shrink-0">
            {activeTab === 'agents' ? (
              <Input
                placeholder="Search agents…"
                value={agentQuery}
                onChange={(e) => setAgentQuery(e.target.value)}
                className="h-7 text-xs"
                data-testid="agent-search-input"
              />
            ) : (
              <Input
                placeholder="Search MCP servers…"
                value={mcpQuery}
                onChange={(e) => setMcpQuery(e.target.value)}
                className="h-7 text-xs"
                data-testid="mcp-search-input"
              />
            )}
          </div>
        )}

        {/* List body */}
        <div className="flex-1 overflow-y-auto">
          {pageState.status === 'loading' && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          )}

          {pageState.status === 'error' && (
            <p className="text-sm text-destructive px-4 py-6">{pageState.message}</p>
          )}

          {/* Agents list */}
          {pageState.status === 'ready' && activeTab === 'agents' && (
            sortedAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-6">
                <BotIcon className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {agentQueryActive ? 'No agents match your search.' : 'No agents yet. Create one to get started.'}
                </p>
              </div>
            ) : (
              <>
                <ul data-testid="agent-list">
                  {sortedAgents.map((a) => (
                    <li key={a.id} className={cn('flex items-center border-b transition-colors hover:bg-muted/50', selectedAgentId === a.id && 'bg-muted/70')}>
                      <button
                        type="button"
                        onClick={() => setSelectedAgentId(a.id)}
                        className="flex-1 flex items-center gap-3 px-4 py-3 text-left text-sm min-w-0"
                        data-testid={`agent-row-${a.id}`}
                      >
                        <BotIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium truncate">{a.name}</span>
                          {a.description && (
                            <span className="block text-xs text-muted-foreground truncate">{a.description}</span>
                          )}
                          {!a.enabled && (
                            <span className="block text-[10px] text-muted-foreground italic mt-0.5">disabled</span>
                          )}
                        </span>
                        <ChevronRightIcon
                          className={cn(
                            'size-3.5 shrink-0 text-muted-foreground transition-transform',
                            selectedAgentId === a.id && 'rotate-90',
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleAgentFavorite(a.id)}
                        aria-label={agentFavorites.has(a.id) ? 'Remove from favorites' : 'Add to favorites'}
                        className="shrink-0 text-muted-foreground hover:text-amber-400 transition-colors px-2 py-3"
                        data-testid={`agent-fav-${a.id}`}
                      >
                        <StarIcon className={cn('size-3.5', agentFavorites.has(a.id) && 'fill-current text-amber-400')} />
                      </button>
                    </li>
                  ))}
                </ul>
                {agentsNextToken && !agentQueryActive && (
                  <div className="px-4 py-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={handleLoadMoreAgents}
                      disabled={loadingMoreAgents}
                      data-testid="load-more-agents"
                    >
                      {loadingMoreAgents ? <Spinner className="mr-1.5 size-3" /> : null}
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )
          )}

          {/* MCP servers list */}
          {pageState.status === 'ready' && activeTab === 'mcp-servers' && (
            sortedMcpServers.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-6">
                <ServerIcon className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {mcpQueryActive ? 'No MCP servers match your search.' : 'No MCP servers yet. Add one to get started.'}
                </p>
              </div>
            ) : (
              <>
                <ul data-testid="mcp-server-sidebar-list">
                  {sortedMcpServers.map((s) => (
                    <li key={s.id} className={cn('flex items-center border-b transition-colors hover:bg-muted/50', selectedMcpId === s.id && 'bg-muted/70')}>
                      <button
                        type="button"
                        onClick={() => setSelectedMcpId(s.id)}
                        className="flex-1 flex items-center gap-3 px-4 py-3 text-left text-sm min-w-0"
                        data-testid={`mcp-server-row-${s.id}`}
                      >
                        <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium truncate">{s.name}</span>
                          <span className="block text-xs text-muted-foreground font-mono truncate">{s.url}</span>
                          {!s.enabled && (
                            <span className="text-[10px] text-muted-foreground italic">disabled</span>
                          )}
                        </span>
                        <ChevronRightIcon
                          className={cn(
                            'size-3.5 shrink-0 text-muted-foreground transition-transform',
                            selectedMcpId === s.id && 'rotate-90',
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleMcpFavorite(s.id)}
                        aria-label={mcpFavorites.has(s.id) ? 'Remove from favorites' : 'Add to favorites'}
                        className="shrink-0 text-muted-foreground hover:text-amber-400 transition-colors px-2 py-3"
                        data-testid={`mcp-fav-${s.id}`}
                      >
                        <StarIcon className={cn('size-3.5', mcpFavorites.has(s.id) && 'fill-current text-amber-400')} />
                      </button>
                    </li>
                  ))}
                </ul>
                {mcpServersNextToken && !mcpQueryActive && (
                  <div className="px-4 py-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={handleLoadMoreMcp}
                      disabled={loadingMoreMcp}
                      data-testid="load-more-mcp-servers"
                    >
                      {loadingMoreMcp ? <Spinner className="mr-1.5 size-3" /> : null}
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>

      {/* Agent edit panel */}
      {activeTab === 'agents' && agentPanelOpen && (
        <div className="flex-1 min-w-0 flex flex-col" data-testid="agent-edit-panel">
          <EditPanel
            agent={selectedAgentId === 'new' ? null : selectedAgent}
            allAgents={agents}
            mcpServers={mcpServers}
            onSave={handleSaveAgent}
            onDelete={handleDeleteAgent}
            onClose={() => setSelectedAgentId(null)}
          />
        </div>
      )}

      {/* MCP server edit panel */}
      {activeTab === 'mcp-servers' && mcpPanelOpen && (
        <div className="flex-1 min-w-0 flex flex-col">
          <McpServerEditPanel
            server={selectedMcpId === 'new' ? null : selectedMcpServer}
            onSave={handleSaveMcpServer}
            onDelete={handleDeleteMcpServer}
            onClose={() => setSelectedMcpId(null)}
          />
        </div>
      )}
    </div>
  );
}
