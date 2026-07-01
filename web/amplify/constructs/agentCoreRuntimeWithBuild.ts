import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import {
  aws_ecr_assets as ecr_assets,
  aws_bedrockagentcore as bedrock_agent_core
} from 'aws-cdk-lib'

export interface AgentCoreRuntimeWithBuildProps {
  /**
   * Protocol configuration for the runtime ('MCP', 'HTTP', 'A2A', or 'AGUI')
   */
  protocolConfiguration: 'MCP' | 'HTTP' | 'A2A' | 'AGUI';

  /**
   * Directory path containing the Dockerfile and application code
   */
  imageAssetDirectory: string;

  /**
   * Optional environment variables to pass to the container
   */
  environment?: Record<string, string>;

  /**
   * Optional build arguments for Docker
   */
  buildArgs?: Record<string, string>;

  /**
   * Optional description for the runtime
   */
  description?: string;

  // For authentication with Cognito
  // Use either cognitoClientId (single client) or allowedClients (multiple clients)
  cognitoClientId?: string;
  allowedClients?: string[];
  cognitoDiscoveryUrl: string;
}

/**
 * CDK Construct that builds and deploys a container to ECR
 * and creates a Bedrock AgentCore Runtime to host it.
 * Supports MCP, HTTP, A2A, and AGUI protocol configurations.
 */
export class AgentCoreRuntimeWithBuild extends Construct {
  public readonly imageAsset: ecr_assets.DockerImageAsset;
  public readonly imageUri: string;
  public readonly imageTag: string;
  public readonly runtime: bedrock_agent_core.CfnRuntime;
  public readonly executionRole: cdk.aws_iam.Role;

  constructor(scope: Construct, id: string, props: AgentCoreRuntimeWithBuildProps) {
    super(scope, id);

    this.imageAsset = new ecr_assets.DockerImageAsset(this, 'RuntimeImage', {
      directory: props.imageAssetDirectory,

      buildArgs: {
        NODE_ENV: 'production',
        ...props?.buildArgs,
      },

      // Python-specific excludes + common ignores
      exclude: [
        'node_modules',
        '.git',
        '*.md',
        'dist',
        '.DS_Store',
        '*.log',
        '__pycache__',
        '**/__pycache__',
        '*.pyc',
        '*.pyo',
        '.venv',
        'venv',
        '.env',
        '*.egg-info',
        '.pytest_cache',
        '.mypy_cache',
        'htmlcov',
        '.coverage',
      ],

      // ARM64 required by AgentCore Runtime
      platform: ecr_assets.Platform.LINUX_ARM64,
    });

    this.imageUri = this.imageAsset.imageUri;
    this.imageTag = this.imageAsset.imageTag;

    this.executionRole = new cdk.aws_iam.Role(this, 'RuntimeExecutionRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: `Execution role for ${props.protocolConfiguration} runtime`,
    });

    this.imageAsset.repository.grantPull(this.executionRole);

    this.executionRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          'logs:DescribeLogStreams',
          'logs:CreateLogGroup'
        ],
        resources: [
          `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*`
        ],
      })
    );

    this.executionRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['logs:DescribeLogGroups'],
        resources: [
          `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:*`
        ],
      })
    );

    this.executionRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: [
          `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`
        ],
      })
    );

    this.executionRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets'
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'bedrock-agentcore'
          }
        },
      })
    );

    // cdk.Stack.of(this).stackName is a token in nested stacks — use Names.uniqueId() which is always concrete
    const uniqueId = cdk.Names.uniqueId(this);
    const agentRuntimeName = `${props.protocolConfiguration}_${uniqueId}`
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 48);

    this.runtime = new bedrock_agent_core.CfnRuntime(this, 'AgentRuntime', {
      agentRuntimeName: agentRuntimeName,

      protocolConfiguration: props.protocolConfiguration,

      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: this.imageUri,
        },
      },

      authorizerConfiguration: {
        customJwtAuthorizer: {
          allowedClients: props.allowedClients || (props.cognitoClientId ? [props.cognitoClientId] : []),
          discoveryUrl: props.cognitoDiscoveryUrl,
        }
      },

      networkConfiguration: {
        networkMode: 'PUBLIC',
      },

      roleArn: this.executionRole.roleArn,

      environmentVariables: props?.environment,

      description: props.description || `${props.protocolConfiguration} runtime for Bedrock AgentCore`,

      requestHeaderConfiguration: {
        requestHeaderAllowlist: ['X-Amzn-Bedrock-AgentCore-Runtime-Custom-Chat-Session-Id']
      },
    });

    this.runtime.node.addDependency(this.executionRole);
    this.runtime.node.addDependency(this.imageAsset);
  }
}
