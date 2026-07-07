import { Construct } from 'constructs';
import { aws_bedrockagentcore as bedrock_agent_core, aws_iam as iam } from 'aws-cdk-lib';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import type {
  AgentCoreMemory as AgentCoreMemoryType,
  AgentCoreHarnessRole as AgentCoreHarnessRoleType,
  AgentCoreMcp as AgentCoreMcpType,
  HarnessRoleConfig,
  Memory,
  AgentCoreMcpSpec,
} from '@aws/agentcore-cdk';

// @aws/agentcore-cdk (alpha) only declares a "require" condition in its
// package.json exports map, so a static ESM `import` of its value bindings
// fails to resolve under Amplify's ESM bundling. Load it via createRequire,
// keeping the type imports above (which the compiler elides) for typing.
const require = createRequire(import.meta.url);
const {
  AgentCoreMemory,
  AgentCoreHarnessRole,
  AgentCoreMcp,
  setSessionProjectRoot,
}: typeof import('@aws/agentcore-cdk') = require('@aws/agentcore-cdk');

// AgentCoreMcp's constructor calls the CLI's findConfigRoot(), which walks up
// from process.cwd() looking for an agentcore/ directory. Under `ampx sandbox`
// cwd is web/, not the repo root, so it never finds agent/default/agentcore —
// point it there explicitly (mirrors what `agentcore` CLI commands do after `init`).
const __dirname = dirname(fileURLToPath(import.meta.url));
setSessionProjectRoot(resolve(__dirname, '../../../agent/default'));

export interface HarnessSpecInput {
  name: string;
  model: {
    provider: 'bedrock' | 'open_ai' | 'gemini';
    modelId: string;
    apiKeyArn?: string;
    apiFormat?: 'converse_stream' | 'responses' | 'chat_completions';
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
  };
  systemPrompt?: string;
  tools?: Array<{ type: string; name: string }>;
  memory?: { name?: string; arn?: string; actorId?: string };
  truncation?: {
    strategy: 'sliding_window' | 'summarization';
    config?: Record<string, unknown>;
  };
  authorizerType?: 'CUSTOM_JWT';
  authorizerConfiguration?: {
    customJwtAuthorizer?: {
      discoveryUrl: string;
      allowedClients?: string[];
      allowedAudience?: string[];
      allowedScopes?: string[];
    };
  };
}

export interface AgentCoreApplicationProps {
  /** Project name prefix used for physical resource names (matches agentcore.json `name`). */
  projectName: string;
  /** Memory resources to create (from agentcore.json `memories`). */
  memories: Memory[];
  /** Harness specs read from agent/default/app/<Harness>/harness.json. */
  harnesses: HarnessSpecInput[];
  /** Gateway/MCP spec (from agentcore.json `agentCoreGateways`), if any gateways are configured. */
  mcpSpec?: AgentCoreMcpSpec;
}

/**
 * Builds the AgentCore harness/memory/gateway resources directly inside the Amplify
 * CDK app so their ARNs are same-stack tokens instead of values discovered post-deploy
 * via the `agentcore` CLI's control-plane API. Mirrors what `agentcore deploy` builds
 * from `agentcore.json`/`harness.json`, minus the `AgUiHandler` runtime (owned by
 * `AgentCoreRuntimeWithBuild` to avoid a duplicate CfnRuntime).
 */
export class AgentCoreApplication extends Construct {
  public readonly memories: Map<string, AgentCoreMemoryType> = new Map();
  public readonly harnesses: Map<string, { harness: bedrock_agent_core.CfnHarness; role: AgentCoreHarnessRoleType }> = new Map();
  public readonly mcp?: AgentCoreMcpType;

  constructor(scope: Construct, id: string, props: AgentCoreApplicationProps) {
    super(scope, id);

    const { projectName } = props;

    for (const memorySpec of props.memories) {
      const memory = new AgentCoreMemory(this, `Memory${memorySpec.name}`, {
        projectName,
        memory: memorySpec,
      });
      this.memories.set(memorySpec.name, memory);
    }

    for (const harnessSpec of props.harnesses) {
      const roleConfig: HarnessRoleConfig = {
        name: harnessSpec.name,
        memoryName: harnessSpec.memory?.name,
        tools: harnessSpec.tools,
        apiKeyArn: harnessSpec.model.apiKeyArn,
        apiFormat: harnessSpec.model.apiFormat,
      };

      const role = new AgentCoreHarnessRole(this, `HarnessRole${harnessSpec.name}`, {
        projectName,
        harness: roleConfig,
      });

      const memory = harnessSpec.memory?.name ? this.memories.get(harnessSpec.memory.name) : undefined;
      if (memory) {
        role.addToPolicy(
          new iam.PolicyStatement({
            actions: [
              'bedrock-agentcore:ListMemoryRecords',
              'bedrock-agentcore:RetrieveMemoryRecords',
              'bedrock-agentcore:GetEvent',
              'bedrock-agentcore:GetMemory',
              'bedrock-agentcore:GetMemoryRecord',
              'bedrock-agentcore:ListActors',
              'bedrock-agentcore:ListEvents',
              'bedrock-agentcore:ListSessions',
              'bedrock-agentcore:CreateEvent',
              'bedrock-agentcore:DeleteEvent',
              'bedrock-agentcore:DeleteMemoryRecord',
            ],
            resources: [memory.memoryArn],
          }),
        );
      }

      const harness = new bedrock_agent_core.CfnHarness(this, `Harness${harnessSpec.name}`, {
        harnessName: `${projectName}_${harnessSpec.name}`,
        executionRoleArn: role.roleArn,
        model: {
          bedrockModelConfig:
            harnessSpec.model.provider === 'bedrock'
              ? {
                  modelId: harnessSpec.model.modelId,
                  maxTokens: harnessSpec.model.maxTokens,
                  temperature: harnessSpec.model.temperature,
                  topP: harnessSpec.model.topP,
                }
              : undefined,
          openAiModelConfig:
            harnessSpec.model.provider === 'open_ai'
              ? {
                  modelId: harnessSpec.model.modelId,
                  apiKeyArn: harnessSpec.model.apiKeyArn!,
                  maxTokens: harnessSpec.model.maxTokens,
                  temperature: harnessSpec.model.temperature,
                  topP: harnessSpec.model.topP,
                }
              : undefined,
          geminiModelConfig:
            harnessSpec.model.provider === 'gemini'
              ? {
                  modelId: harnessSpec.model.modelId,
                  apiKeyArn: harnessSpec.model.apiKeyArn!,
                  maxTokens: harnessSpec.model.maxTokens,
                  temperature: harnessSpec.model.temperature,
                  topP: harnessSpec.model.topP,
                  topK: harnessSpec.model.topK,
                }
              : undefined,
        },
        systemPrompt: harnessSpec.systemPrompt ? [{ text: harnessSpec.systemPrompt }] : undefined,
        tools: harnessSpec.tools?.map((tool) => ({
          type: tool.type,
          name: tool.name,
          config:
            tool.type === 'agentcore_browser'
              ? { agentCoreBrowser: {} }
              : tool.type === 'agentcore_code_interpreter'
                ? { agentCoreCodeInterpreter: {} }
                : undefined,
        })),
        memory: memory
          ? {
              agentCoreMemoryConfiguration: {
                arn: memory.memoryArn,
                actorId: harnessSpec.memory?.actorId,
              },
            }
          : undefined,
        truncation: harnessSpec.truncation
          ? {
              strategy: harnessSpec.truncation.strategy,
              config:
                harnessSpec.truncation.strategy === 'summarization'
                  ? { summarization: harnessSpec.truncation.config ?? {} }
                  : { slidingWindow: harnessSpec.truncation.config ?? {} },
            }
          : undefined,
        authorizerConfiguration: harnessSpec.authorizerConfiguration?.customJwtAuthorizer
          ? {
              customJwtAuthorizer: {
                discoveryUrl: harnessSpec.authorizerConfiguration.customJwtAuthorizer.discoveryUrl,
                allowedClients: harnessSpec.authorizerConfiguration.customJwtAuthorizer.allowedClients,
                allowedAudience: harnessSpec.authorizerConfiguration.customJwtAuthorizer.allowedAudience,
                allowedScopes: harnessSpec.authorizerConfiguration.customJwtAuthorizer.allowedScopes,
              },
            }
          : undefined,
      });

      harness.node.addDependency(role);

      this.harnesses.set(harnessSpec.name, { harness, role });
    }

    if (props.mcpSpec?.agentCoreGateways?.length) {
      this.mcp = new AgentCoreMcp(this, 'Mcp', {
        projectName,
        mcpSpec: props.mcpSpec,
      });
    }
  }

  /** ARN of a harness by its logical name (from harness.json's directory name), e.g. "MyHarness". */
  public harnessArn(name: string): string {
    const entry = this.harnesses.get(name);
    if (!entry) throw new Error(`Harness "${name}" not found in AgentCoreApplication`);
    return entry.harness.attrArn;
  }

  /** Execution role ARN of a harness by its logical name. */
  public harnessRoleArn(name: string): string {
    const entry = this.harnesses.get(name);
    if (!entry) throw new Error(`Harness "${name}" not found in AgentCoreApplication`);
    return entry.role.roleArn;
  }

  public memoryArn(name: string): string {
    const memory = this.memories.get(name);
    if (!memory) throw new Error(`Memory "${name}" not found in AgentCoreApplication`);
    return memory.memoryArn;
  }

  public memoryId(name: string): string {
    const memory = this.memories.get(name);
    if (!memory) throw new Error(`Memory "${name}" not found in AgentCoreApplication`);
    return memory.memoryId;
  }

  public gatewayArn(name: string): string {
    const gateway = this.mcp?.gateways.get(name);
    if (!gateway) throw new Error(`Gateway "${name}" not found in AgentCoreApplication`);
    return gateway.attrGatewayArn;
  }

  public gatewayId(name: string): string {
    const gateway = this.mcp?.gateways.get(name);
    if (!gateway) throw new Error(`Gateway "${name}" not found in AgentCoreApplication`);
    return gateway.attrGatewayIdentifier;
  }

  public gatewayEndpoint(name: string): string {
    const gateway = this.mcp?.gateways.get(name);
    if (!gateway) throw new Error(`Gateway "${name}" not found in AgentCoreApplication`);
    return gateway.attrGatewayUrl;
  }
}
