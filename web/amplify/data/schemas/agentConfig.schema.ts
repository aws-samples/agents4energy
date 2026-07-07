import { a } from '@aws-amplify/backend';
import { registerMcpTarget } from '../../functions/register-mcp-target/resource';
import { listMcpTools } from '../../functions/list-mcp-tools/resource';
import { invokeAgent } from '../../functions/invoke-agent/resource';

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
    allow.authenticated().to(['read', 'create', 'update', 'delete']),
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
    // ID of the registered gateway target for this MCP server (set after CreateGatewayTarget).
    // Null until the user registers the server with the gateway.
    gatewayTargetId: a.string(),
    // OAuth2 client ID for servers that require PKCE auth.
    // When set, the UI shows an "Authenticate" button that runs the PKCE flow and
    // saves the resulting token in McpServerCredential (owner-scoped, per-user).
    oauthClientId: a.string(),
    enabled: a.boolean().required().default(true),
    agents: a.hasMany('AgentMcpServer', 'mcpServerId'),
    credentials: a.hasMany('McpServerCredential', 'mcpServerId'),
  }).authorization((allow) => [
    allow.authenticated().to(['read', 'create', 'update', 'delete']),
    allow.owner(),
  ]),

  // Per-user OAuth2 token for an MCP server that requires PKCE auth.
  // owner-only: DynamoDB owner field ensures each user sees only their own tokens.
  // invokeAgent Lambda read access is granted via the wrapper in resource.ts.
  McpServerCredential: a.model({
    mcpServerId: a.id().required(),
    mcpServer: a.belongsTo('McpServer', 'mcpServerId'),
    accessToken: a.string().required(),
    tokenType: a.string(),
    // ISO-8601 timestamp so the UI can warn when the token is approaching expiry.
    expiresAt: a.string(),
    // Refresh token for silent renewal (if the authorization server issued one).
    refreshToken: a.string(),
  }).authorization((allow) => [
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
    allow.authenticated().to(['read', 'create', 'update', 'delete']),
    allow.owner(),
  ]),

  // A single MCP tool descriptor returned by listMcpTools.
  McpTool: a.customType({
    name: a.string().required(),
    description: a.string(),
    // JSON-encoded JSON Schema for the tool's input parameters.
    inputSchema: a.string(),
  }),

  // Result type for listMcpTools — tools array plus an optional error message.
  // error is non-null when the Lambda could reach the server but it returned an
  // error (e.g. auth failure), giving the frontend something actionable to show.
  ListMcpToolsResult: a.customType({
    tools: a.ref('McpTool').array().required(),
    error: a.string(),
  }),

  // Query: probes the given MCP server with the same url + headers the harness
  // injects as a remote_mcp tool, then returns the tool listing.
  // If this query succeeds, the agent's remote_mcp invocation will too.
  listMcpTools: a
    .query()
    .arguments({
      url: a.string().required(),
      // Pass the McpServer's headers array so the Lambda uses identical auth.
      headers: a.ref('McpServerHeaderEntry').array(),
    })
    .returns(a.ref('ListMcpToolsResult'))
    .handler(a.handler.function(listMcpTools))
    .authorization((allow) => [allow.authenticated()]),

  // Return type for the registerMcpTarget mutation
  RegisterMcpTargetResult: a.customType({
    gatewayTargetId: a.string().required(),
  }),

  // Mutation: registers an MCP server URL as a gateway target and returns its target ID.
  // The caller is responsible for saving the returned gatewayTargetId to the McpServer record.
  registerMcpTarget: a
    .mutation()
    .arguments({
      name: a.string().required(),
      url: a.string().required(),
      description: a.string(),
    })
    .returns(a.ref('RegisterMcpTargetResult'))
    .handler(a.handler.function(registerMcpTarget))
    .authorization((allow) => [allow.authenticated()]),

  // Result type for invokeAgent mutation
  InvokeAgentResult: a.customType({
    response: a.string().required(),
    sessionId: a.string().required(),
  }),

  // Mutation: invoke a named agent synchronously and return its full response.
  // allow.guest() covers IAM-signed requests (e.g. GitHub Actions role) in
  // addition to authenticated Cognito users.
  invokeAgent: a
    .mutation()
    .arguments({
      agentSlug: a.string().required(),
      prompt: a.string().required(),
      sessionId: a.string(),
    })
    .returns(a.ref('InvokeAgentResult'))
    .handler(a.handler.function(invokeAgent))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  // Self-join: which agents a given agent can call as sub-agents
  AgentSubAgent: a.model({
    agentId: a.id().required(),       // the caller agent
    subAgentId: a.id().required(),    // the callee agent
    agent: a.belongsTo('Agent', 'agentId'),
    subAgent: a.belongsTo('Agent', 'subAgentId'),
  }).authorization((allow) => [
    allow.authenticated().to(['read', 'create', 'update', 'delete']),
    allow.owner(),
  ]),
});
