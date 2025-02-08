import { aws_bedrock as bedrock } from "aws-cdk-lib";
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

interface BedrockAgentBuilderProps {
    description?: string;
    regulatoryKbId: string;
    modelId?: string;
    environment?: string;
    tags?: { [key: string]: string };
    vpc?: cdk.aws_ec2.IVpc;
    s3Bucket?: cdk.aws_s3.IBucket;
    s3Deployment?: cdk.aws_s3_deployment.BucketDeployment;

}

export function buildRegulatoryAgent(scope: Construct, props: BedrockAgentBuilderProps) {
    // Input validation
    if (!props.regulatoryKbId) {
        throw new Error('regulatoryKbId is required');
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

    const agentRole = new cdk.aws_iam.Role(scope, 'BedrockAgentRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `${resourcePrefix}-agent-role-${environment}`,
        description: 'Bedrock agent execution role',
        inlinePolicies: {
            'bedrock-permissions': new cdk.aws_iam.PolicyDocument({
                statements: [
                    new cdk.aws_iam.PolicyStatement({
                        actions: [
                            'bedrock:*',
                            'kendra:Query',
                            'cloudwatch:PutMetricData'
                        ],
                        resources: ['*']
                    })
                ]
            })
        }
    });

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
        instruction: `You are a helpful regulatory assistant that uses your knowledge base to answer user questions. Always answer the question as factually correct as possible and cite your sources from your knowledge base.`,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
    };

    const regulatoryAgent = new bedrock.CfnAgent(
        scope,
        'RegulatoryAgent',
        cfnAgentProps
    );

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
        regulatoryAgentAlias
    };
}
