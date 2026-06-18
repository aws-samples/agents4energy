import { a } from '@aws-amplify/backend';

/**
 * Agent Configuration Schema
 *
 * Agent         — a configurable logical agent identity (system prompt, model, connections)
 * McpServer     — any MCP-compatible endpoint (AgentCore gateway, plain MCP server, etc.)
 * AgentMcpServer — M:N join: which MCP servers are assigned to which agents
 * AgentSubAgent — M:N self-join: which agents a given agent can call as sub-agents
 */
export const agentConfigSchema = a.schema({

  McpServerHeaderEntry: a.customType({
    key: a.string(),
    value: a.string(),
  }),

  Agent: a.model({
    name: a.string().required(),
    // URL-safe routing slug, e.g. "ops-agent". Callers pass this as agentId.
    slug: a.string().required(),
    description: a.string(),
    // Inline system prompt text. Takes precedence over systemPromptS3Key when both are set.
    systemPromptText: a.string(),
    // S3 key for the system prompt file, e.g. "agents/ops-agent/system-prompt.md"
    // When set, overrides the DynamoDB Settings.system_prompt fallback.
    systemPromptS3Key: a.string(),
    // Bedrock model override. Falls back to DEFAULT_MODEL_ID env var when absent.
    modelId: a.string(),
    enabled: a.boolean().required().default(true),
    mcpServers: a.hasMany('AgentMcpServer', 'agentId'),
    // Agents that this agent can call as sub-agents (caller side)
    subAgents: a.hasMany('AgentSubAgent', 'agentId'),
    // Agents that can call this agent as a sub-agent (callee side)
    calledByAgents: a.hasMany('AgentSubAgent', 'subAgentId'),
  }).authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),

  // Unified MCP server record — covers AgentCore gateways and plain MCP endpoints.
  // serverType: "agentcore" | "mcp" (defaults to "mcp" if absent).
  // AgentCore servers use workload-identity Bearer auth; plain MCP servers may use
  // custom headers or no auth. authSecretArn / registryId / registryRecordId are
  // AgentCore-specific and ignored for plain MCP servers.
  McpServer: a.model({
    name: a.string().required(),
    url: a.string().required(),
    description: a.string(),
    serverType: a.string(),
    headers: a.ref('McpServerHeaderEntry').array(),
    // AgentCore-specific fields
    authSecretArn: a.string(),
    registryId: a.string(),
    registryRecordId: a.string(),
    signRequestsWithAwsCreds: a.boolean().default(false),
    enabled: a.boolean().required().default(true),
    agents: a.hasMany('AgentMcpServer', 'mcpServerId'),
  }).authorization((allow) => [
    allow.authenticated().to(['read', 'create', 'update', 'delete']),
    allow.owner(),
  ]),

  // M:N join between Agent and McpServer
  AgentMcpServer: a.model({
    agentId: a.id().required(),
    mcpServerId: a.id().required(),
    agent: a.belongsTo('Agent', 'agentId'),
    mcpServer: a.belongsTo('McpServer', 'mcpServerId'),
    // Subset of tool names this agent can use. Empty / null means all tools enabled.
    enabledTools: a.string().array(),
  }).authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),

  // Self-join: which agents a given agent can call as sub-agents
  AgentSubAgent: a.model({
    agentId: a.id().required(),       // the caller agent
    subAgentId: a.id().required(),    // the callee agent
    agent: a.belongsTo('Agent', 'agentId'),
    subAgent: a.belongsTo('Agent', 'subAgentId'),
  }).authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),
});
