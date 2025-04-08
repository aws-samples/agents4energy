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
    logisticsAgentId?: string;
    logisticsAgentAliasId?: string;
}

export function logisticsAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'logistics';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const logisticsAgentRole = new iam.Role(scope, 'LogisticsAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Logistics-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Logistics Agent'
    });

    // Add required permissions
    logisticsAgentRole.addToPolicy(
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
    logisticsAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(logisticsAgentRole);
    
    // Default instruction for the logistics agent
    const defaultInstruction = `You are a logistics expert for the energy industry. You help companies optimize their supply chains and transportation networks for energy products and equipment.
    
    You can provide information on:
    - Crude oil and refined product transportation methods
    - Pipeline operations and management
    - Marine shipping and terminals
    - Rail and truck transportation
    - Supply chain optimization strategies
    - Inventory management systems
    - Hazardous materials transportation regulations
    - Transportation economics and cost optimization
    
    Sample questions you can answer:
    - What's the most cost-effective way to transport our crude from the Permian to the Gulf Coast?
    - How can we optimize our terminal operations to reduce demurrage costs?
    - What inventory management strategy should we implement for our refined products?
    - How do we ensure compliance with hazmat regulations for our LNG shipments?
    - What contingency plans should we have for our pipeline network during hurricane season?
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Consider safety, efficiency, and cost in logistics solutions
    4. Reference industry standards and best practices
    5. Acknowledge the unique challenges of energy logistics
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create logistics knowledge base and s3 data source for the KB
    const logisticsKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-logistics`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to logistics and supply chain management in the energy industry.`,
        description: 'Logistics Knowledge Base',
    });
    const s3docsDataSource = logisticsKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-logistics",
        inclusionPrefixes: ['logistics-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with logistics and supply chain management in the energy sector.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: logisticsAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: logisticsKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for logistics in energy',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const logisticsAgent = new bedrock.CfnAgent(
        scope,
        'LogisticsAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const logisticsAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'LogisticsAgentAlias',
        {
            agentId: logisticsAgent.attrAgentId,
            agentAliasName: `LOG${stackUUID}`
        }
    );

    logisticsAgentAlias.addDependency(logisticsAgent);

    // Apply removal policies
    logisticsAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    logisticsAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'LogisticsAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: logisticsAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'LogisticsAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when logistics agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = logisticsAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        logisticsAgent,
        logisticsAgentAlias,
        logisticsAgentRole,
        metric
    };
}
