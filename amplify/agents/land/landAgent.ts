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
    landAgentId?: string;
    landAgentAliasId?: string;
}

export function landAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'land';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const landAgentRole = new iam.Role(scope, 'LandAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Land-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Land Agent'
    });

    // Add required permissions
    landAgentRole.addToPolicy(
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
    landAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(landAgentRole);
    
    // Default instruction for the land agent
    const defaultInstruction = `You are a land management expert for the energy industry. You help companies understand and manage their land assets, mineral rights, and leases.
    
    You can provide information on:
    - Oil and gas leases and their components
    - Mineral rights and surface rights
    - Royalty calculations and payments
    - Land title examination and analysis
    - Lease acquisition and negotiation strategies
    - Division orders and ownership transfers
    - Unitization and pooling agreements
    - Right-of-way and easement management
    
    Sample questions you can answer:
    - What are the key terms we should negotiate in our new lease agreement?
    - How do we resolve this title discrepancy in the Johnson County property?
    - What's the process for unitizing these adjacent leases for more efficient development?
    - Can you explain the royalty calculation for this particular lease structure?
    - What documentation do we need for the upcoming lease renewal?
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Consider legal implications of land management decisions
    4. Reference industry standards and best practices
    5. Acknowledge regional differences in land management regulations
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create land knowledge base and s3 data source for the KB
    const landKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-land`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to land management in the energy industry.`,
        description: 'Land Management Knowledge Base',
    });
    const s3docsDataSource = landKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-land",
        inclusionPrefixes: ['land-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with land management in the energy sector.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: landAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: landKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for land management in energy',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const landAgent = new bedrock.CfnAgent(
        scope,
        'LandAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const landAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'LandAgentAlias',
        {
            agentId: landAgent.attrAgentId,
            agentAliasName: `LAND${stackUUID}`
        }
    );

    landAgentAlias.addDependency(landAgent);

    // Apply removal policies
    landAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    landAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'LandAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: landAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'LandAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when land agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = landAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        landAgent,
        landAgentAlias,
        landAgentRole,
        metric
    };
}
