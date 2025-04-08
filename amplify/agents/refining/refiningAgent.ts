import * as cdk from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_ec2 } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { bedrock as cdkLabsBedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';

interface BedrockAgentBuilderProps {
    description?: string;
    modelId?: string;
    environment?: string;
    instruction?: string;
    vpc: aws_ec2.Vpc;
    s3Bucket: s3.IBucket;
    s3Deployment: cdk.aws_s3_deployment.BucketDeployment;
    refiningAgentId?: string;
    refiningAgentAliasId?: string;
}

export function refiningAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'refining';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const refiningAgentRole = new iam.Role(scope, 'RefiningAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Refining-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Refining Agent'
    });

    // Add required permissions
    refiningAgentRole.addToPolicy(
        new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:Retrieve',
                'bedrock:ListFoundationModels',
                'bedrock:ListCustomModels',
                'bedrock:InvokeAgent',
                'bedrock:RetrieveAgent'
            ],
            resources: [
                `arn:aws:bedrock:${cdk.Stack.of(scope).region}::foundation-model/*`,
                `arn:aws:bedrock:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:agent/*`,
                `arn:aws:bedrock:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:knowledge-base/*`
            ]
        })
    );

    // Add CloudWatch Logs permissions
    refiningAgentRole.addToPolicy(
        new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: [
                `arn:aws:logs:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:log-group:/aws/bedrock/*`
            ]
        })
    );

    // Add S3 access permissions
    props.s3Bucket.grantRead(refiningAgentRole);
    
    // Default instruction for the refining agent
    const defaultInstruction = `You are a refining expert for the energy industry. You help companies understand and optimize their refining operations and processes.
    
    You can provide information on:
    - Crude oil refining processes
    - Refinery unit operations and troubleshooting
    - Fluid catalytic cracking
    - Hydroprocessing
    - Distillation
    - Refinery economics
    - Product specifications
    - Process optimization
    - Safety in refining operations
    
    Sample questions you can answer:
    - How can we improve the yield from our FCC unit?
    - What's causing the pressure drop in our hydrocracker?
    - What are the best operating parameters for processing this high-sulfur crude?
    - How do we optimize our crude slate to maximize diesel production?
    - What maintenance schedule should we implement for our distillation columns?
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Consider both operational efficiency and safety implications
    3. Consider both operational efficiency and safety
    4. Reference industry standards and best practices
    5. Acknowledge the challenges specific to refining operations
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create refining knowledge base and s3 data source for the KB
    const refiningKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-refining`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to refining operations in the energy industry.`,
        description: 'Refining Knowledge Base',
    });
    const s3docsDataSource = refiningKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-refining",
        inclusionPrefixes: ['refining-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with refining operations in the energy sector.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: refiningAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: refiningKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for refining operations in energy',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const refiningAgent = new bedrock.CfnAgent(
        scope,
        'RefiningAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const refiningAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'RefiningAgentAlias',
        {
            agentId: refiningAgent.attrAgentId,
            agentAliasName: `REF${stackUUID}`
        }
    );

    refiningAgentAlias.addDependency(refiningAgent);

    // Apply removal policies
    refiningAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    refiningAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'RefiningAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: refiningAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'RefiningAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when refining agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = refiningAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        refiningAgent,
        refiningAgentAlias,
        refiningAgentRole,
        metric
    };
}
