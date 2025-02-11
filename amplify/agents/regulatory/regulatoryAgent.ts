import { aws_bedrock as bedrock } from "aws-cdk-lib";
import * as cdk from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

interface BedrockAgentBuilderProps {
    description?: string;
    regulatoryKbId: string;
    regulatoryBucket: s3.IBucket;
    modelId?: string;
    environment?: string;
    tags?: { [key: string]: string };
    instruction?: string;
}

export function buildRegulatoryAgent(scope: Construct, props: BedrockAgentBuilderProps) {
    // Input validation
    if (!props.regulatoryKbId) {
        throw new Error('regulatoryKbId is required');
    }
    if (!props.regulatoryBucket) {
        throw new Error('regulatoryBucket is required');
    }

    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'regulatory';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Common tags
    const commonTags = {
        Environment: environment,
        Service: 'regulatory-agent',
        ManagedBy: 'CDK',
        ...props.tags
    };

    // Apply common tags to scope
    Object.entries(commonTags).forEach(([key, value]) => {
        cdk.Tags.of(scope).add(key, value);
    });

    // Create IAM role for the Bedrock agent
    const agentRole = new iam.Role(scope, 'BedrockAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `${resourcePrefix}-agent-role-${environment}`,
        description: 'Bedrock agent execution role',
        inlinePolicies: {
            'bedrock-permissions': new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        actions: [
                            'bedrock:InvokeModel',
                            'bedrock:Retrieve',
                            'bedrock:RetrieveAndGenerate',
                            'kendra:Query',
                            'cloudwatch:PutMetricData'
                        ],
                        resources: ['*']
                    }),
                    new iam.PolicyStatement({
                        actions: [
                            's3:GetObject',
                            's3:ListBucket'
                        ],
                        resources: [
                            props.regulatoryBucket.bucketArn,
                            `${props.regulatoryBucket.bucketArn}/*`
                        ]
                    })
                ]
            })
        }
    });

    // Default instruction for the regulatory agent
    const defaultInstruction = `You are a helpful regulatory assistant that uses your knowledge base to answer user questions. 
    Always answer the question as factually correct as possible and cite your sources from your knowledge base. 
    When providing regulatory guidance:
    1. Always reference specific regulations or documents from the knowledge base
    2. Indicate if any information might be outdated
    3. Suggest related regulatory requirements the user should consider
    4. If uncertain, recommend consulting official regulatory bodies
    5. Provide context for why specific regulations exist when relevant`;

    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${environment}`,
        description: props.description || 'This agent is designed to help with regulatory compliance.',
        knowledgeBases: [{
            description: 'Regulatory Knowledge Base',
            knowledgeBaseId: props.regulatoryKbId,
            knowledgeBaseState: 'ENABLED',
        }],
        autoPrepare: true,
        agentResourceRoleArn: agentRole.roleArn,
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
    };

    // Create the Bedrock agent
    const regulatoryAgent = new bedrock.CfnAgent(
        scope,
        'RegulatoryAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const regulatoryAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'RegulatoryAgentAlias',
        {
            agentId: regulatoryAgent.attrAgentId,
            agentAliasName: `${resourcePrefix}-agent-alias-${environment}`
        }
    );

    regulatoryAgentAlias.addDependency(regulatoryAgent);

    // Apply removal policies
    regulatoryAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    regulatoryAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'RegulatoryAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: regulatoryAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'RegulatoryAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when regulatory agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Outputs
    new cdk.CfnOutput(scope, 'agentId', {
        value: regulatoryAgent.attrAgentId,
        description: 'Bedrock Agent ID'
    });

    new cdk.CfnOutput(scope, 'agentAliasId', {
        value: regulatoryAgentAlias.attrAgentAliasId,
        description: 'Bedrock Agent Alias ID'
    });

    return {
        regulatoryAgent,
        regulatoryAgentAlias,
        agentRole,
        metric
    };
}
