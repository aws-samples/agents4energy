'use client';
import { useChat } from '@ai-sdk/react';
import { HarnessChatTransport } from '@/lib/agentcore-transport';
import { useChatSession } from './use-chat-session';
import { useInitialMessages } from './use-initial-messages';
import { useAgents } from './use-agents';
import { useMemo, useRef, useState, useCallback } from 'react';
import type { UIMessage } from 'ai';
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
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { AgentOption, McpServerInfo } from './use-agents';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { WrenchIcon, Loader2Icon } from 'lucide-react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const amplifyClient = generateClient<Schema>({ authMode: 'userPool' });

type McpTool = {
  name: string;
  description?: string | null;
  inputSchema?: string | null;
};

type ServerToolsResult = {
  server: McpServerInfo;
  tools: McpTool[];
  error?: string | null;
};

function AgentToolsDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [results, setResults] = useState<ServerToolsResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    setResults(null);
    const settled = await Promise.all(
      agent.mcpServers.map(async (server): Promise<ServerToolsResult> => {
        try {
          const res = await amplifyClient.queries.listMcpTools({
            url: server.url,
            headers: (server.headers ?? [])
              .filter((h): h is { key: string; value: string } => !!h.key && !!h.value)
              .map((h) => ({ key: h.key, value: h.value })),
          });
          if (res.errors?.length) {
            return { server, tools: [], error: res.errors.map((e) => e.message).join('; ') };
          }
          return {
            server,
            tools: (res.data?.tools ?? []).filter((t): t is McpTool => t != null),
            error: res.data?.error,
          };
        } catch (err) {
          return { server, tools: [], error: String(err) };
        }
      }),
    );
    setResults(settled);
    setLoading(false);
  }, [agent]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      onOpenChange(next);
      if (next) fetchTools();
    },
    [onOpenChange, fetchTools],
  );

  const totalTools = results?.reduce((n, r) => n + r.tools.length, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Tools — {agent.name}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-1">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2Icon className="size-4 animate-spin" />
              Loading tools…
            </div>
          )}

          {results && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No MCP servers configured for this agent.
            </p>
          )}

          {results?.map((r) => (
            <div key={r.server.id}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {r.server.name}
                </span>
                <span className="text-xs text-muted-foreground">({r.server.url})</span>
              </div>

              {r.error && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-2">
                  {r.error}
                </p>
              )}

              {r.tools.length === 0 && !r.error && (
                <p className="text-xs text-muted-foreground pl-1">No tools returned.</p>
              )}

              <ul className="space-y-1.5">
                {r.tools.map((tool) => (
                  <li key={tool.name} className="rounded-lg border bg-muted/30 px-3 py-2">
                    <div className="text-sm font-medium font-mono">{tool.name}</div>
                    {tool.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{tool.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {results && (
          <DialogFooter showCloseButton>
            <span className="text-xs text-muted-foreground mr-auto self-center">
              {totalTools} tool{totalTools !== 1 ? 's' : ''} across {results.length} server{results.length !== 1 ? 's' : ''}
            </span>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChatView({
  sessionIdRef,
  initialMessages,
  selectedAgent,
  agents,
  agentId,
  onAgentChange,
}: {
  sessionIdRef: React.RefObject<string | null>;
  initialMessages: UIMessage[];
  selectedAgent: AgentOption | undefined;
  agents: AgentOption[];
  agentId: string | null;
  onAgentChange: (id: string | null) => void;
}) {
  const agentConfigRef = useRef({ selectedAgent });
  agentConfigRef.current = { selectedAgent };
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);

  const transport = useMemo(
    () =>
      new HarnessChatTransport({
        getSessionId: () => sessionIdRef.current,
        getAgentConfig: () => {
          const { selectedAgent } = agentConfigRef.current;
          return {
            agentId: selectedAgent?.id ?? null,
            systemPromptText: selectedAgent?.systemPromptText ?? null,
            modelId: selectedAgent?.modelId ?? null,
            mcpServers: selectedAgent?.mcpServers.map((s) => ({
              name: s.name,
              url: s.url,
              headers: Object.fromEntries(
                (s.headers ?? [])
                  .filter((h): h is { key: string; value: string } => !!h.key && !!h.value)
                  .map((h) => [h.key, h.value]),
              ),
            })),
          };
        },
      }),
    [sessionIdRef],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    messages: initialMessages,
    onError: (err) => console.error('[useChat] error:', err),
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="No messages yet"
              description={selectedAgent ? `Chatting with ${selectedAgent.name}` : 'Start a conversation to get started'}
            />
          )}
          {messages.map((message) => {
            const text = message.parts
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('');

            return (
              <Message key={message.id} from={message.role} data-testid={`message-${message.role}`}>
                <MessageContent>
                  {message.role === 'assistant' ? (
                    <MessageResponse isAnimating={isStreaming}>{text}</MessageResponse>
                  ) : (
                    text
                  )}
                </MessageContent>
              </Message>
            );
          })}

          {status === 'submitted' && (
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
          <span className="font-medium">Error: </span>{error.message}
        </div>
      )}

      <PromptInput onSubmit={({ text }) => sendMessage({ text })}>
        <PromptInputTextarea
          placeholder="Type a message…"
          disabled={isStreaming}
          autoFocus
        />
        <PromptInputFooter>
          <PromptInputTools />
          <div className="flex items-center gap-1">
            {agents.length > 0 && (
              <PromptInputSelect
                value={agentId ?? ''}
                onValueChange={(val: unknown) => onAgentChange(val === '' ? null : String(val))}
              >
                <PromptInputSelectTrigger>
                  {selectedAgent?.name ?? 'Default agent'}
                </PromptInputSelectTrigger>
                <PromptInputSelectContent align="end">
                  <PromptInputSelectItem value="">Default agent</PromptInputSelectItem>
                  {agents.map((a) => (
                    <PromptInputSelectItem key={a.id} value={a.id}>
                      {a.name}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            )}
            {selectedAgent && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="View agent tools"
                  onClick={() => setToolsDialogOpen(true)}
                >
                  <WrenchIcon />
                  <span className="sr-only">View agent tools</span>
                </Button>
                <AgentToolsDialog
                  agent={selectedAgent}
                  open={toolsDialogOpen}
                  onOpenChange={setToolsDialogOpen}
                />
              </>
            )}
            <PromptInputSubmit status={status} onStop={stop} />
          </div>
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}

const Chat = function Page() {
  const { ready, sessionId, sessionIdRef, agentId, setAgentId } = useChatSession();
  const initialMessagesState = useInitialMessages(ready ? sessionId : null);
  const agentsState = useAgents();

  const agents = agentsState.status === 'ready' ? agentsState.agents : [];
  const selectedAgent = agents.find((a) => a.id === agentId);

  if (!ready || initialMessagesState.status === 'loading') return null;

  return (
    <ChatView
      sessionIdRef={sessionIdRef}
      initialMessages={initialMessagesState.messages}
      selectedAgent={selectedAgent}
      agents={agents}
      agentId={agentId}
      onAgentChange={setAgentId}
    />
  );
}

export default Chat;
