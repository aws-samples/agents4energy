import {
  AgentCoreApplication,
  AgentCoreMcp,
  type AgentCoreProjectSpec,
  type AgentCoreMcpSpec,
} from '@aws/agentcore-cdk';
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface HarnessConfig {
  name: string;
  executionRoleArn?: string;
  memoryName?: string;
  containerUri?: string;
  hasDockerfile?: boolean;
  dockerfile?: string;
  codeLocation?: string;
  tools?: { type: string; name: string }[];
  apiKeyArn?: string;
  efsAccessPoints?: { accessPointArn: string; mountPath: string }[];
  s3AccessPoints?: { accessPointArn: string; mountPath: string }[];
}

export interface AgentCoreStackProps extends StackProps {
  /**
   * The AgentCore project specification containing agents, memories, and credentials.
   */
  spec: AgentCoreProjectSpec;
  /**
   * The MCP specification containing gateways and servers.
   */
  mcpSpec?: AgentCoreMcpSpec;
  /**
   * Credential provider ARNs from deployed state, keyed by credential name.
   */
  credentials?: Record<string, { credentialProviderArn: string; clientSecretArn?: string }>;
  /**
   * Harness role configurations.
   */
  harnesses?: HarnessConfig[];
  /**
   * ARN of the Cognito Identity Pool authenticated IAM role from the Amplify deployment.
   * When provided, this role is granted InvokeAgentRuntime on all runtimes in this stack.
   */
  amplifyAuthRoleArn?: string;
}

/**
 * CDK Stack that deploys AgentCore infrastructure.
 *
 * This is a thin wrapper that instantiates L3 constructs.
 * All resource logic and outputs are contained within the L3 constructs.
 */
export class AgentCoreStack extends Stack {
  /** The AgentCore application containing all agent environments */
  public readonly application: AgentCoreApplication;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const { spec, mcpSpec, credentials, harnesses, amplifyAuthRoleArn } = props;

    // Create AgentCoreApplication with all agents and harness roles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const appProps: Record<string, unknown> = { spec };
    if (harnesses?.length) {
      appProps.harnesses = harnesses;
    }
    this.application = new AgentCoreApplication(this, 'Application', appProps as any);

    // Create AgentCoreMcp if there are gateways configured
    if (mcpSpec?.agentCoreGateways && mcpSpec.agentCoreGateways.length > 0) {
      new AgentCoreMcp(this, 'Mcp', {
        projectName: spec.name,
        mcpSpec,
        agentCoreApplication: this.application,
        credentials,
        projectTags: spec.tags,
      });
    }

    // Grant the Amplify Identity Pool authenticated role permission to invoke all runtimes.
    // The role ARN comes from the Amplify deployment (read from amplify_outputs.json at synth time).
    if (amplifyAuthRoleArn) {
      const authRole = iam.Role.fromRoleArn(this, 'AmplifyAuthRole', amplifyAuthRoleArn, {
        // Amplify owns this role; we only attach a policy, never mutate it otherwise.
        mutable: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appAny = this.application as any;
      const runtimeArns: string[] = appAny.runtimeArns ?? [];

      if (runtimeArns.length > 0) {
        authRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ['bedrock-agentcore:InvokeAgentRuntime'],
            resources: runtimeArns,
          })
        );
      } else {
        // Fallback: grant on all runtimes in this account/region when ARNs aren't
        // directly accessible from the L3 construct.
        authRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ['bedrock-agentcore:InvokeAgentRuntime'],
            resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`],
          })
        );
      }
    }

    // Stack-level output
    new CfnOutput(this, 'StackNameOutput', {
      description: 'Name of the CloudFormation Stack',
      value: this.stackName,
    });
  }
}
