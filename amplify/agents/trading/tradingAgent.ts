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
    tradingAgentId?: string;
    tradingAgentAliasId?: string;
}

export function tradingAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'trading';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const tradingAgentRole = new iam.Role(scope, 'TradingAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Trading-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Trading Agent'
    });

    // Add required permissions
    tradingAgentRole.addToPolicy(
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
    tradingAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(tradingAgentRole);
    
    // Default instruction for the trading agent
    const defaultInstruction = `You are an energy trading expert. You help companies understand and optimize their trading strategies in energy markets.
    
    You can provide information on:
    - Crude oil and natural gas futures contracts
    - Energy market fundamentals and analysis
    - Price volatility and risk management
    - Hedging strategies and execution
    - Trading platforms and exchanges
    - Market analysis techniques
    - Regulatory compliance in energy trading
    - Portfolio optimization and risk analysis
    
    Sample questions you can answer:
    - What hedging strategy should we implement given the current market volatility?
    - How will this geopolitical event likely impact crude oil futures?
    - What's the optimal trading position for our natural gas portfolio this winter?
    - Can you analyze these market trends and recommend a trading strategy?
    - How should we adjust our risk management approach given these price forecasts?
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Consider both risk and reward in trading strategies
    4. Reference industry standards and best practices
    5. Acknowledge the volatility and complexity of energy markets
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create trading knowledge base and s3 data source for the KB
    const tradingKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-trading`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to energy trading and markets.`,
        description: 'Trading Knowledge Base',
    });
    const s3docsDataSource = tradingKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-trading",
        inclusionPrefixes: ['trading-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with energy trading strategies and market analysis.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: tradingAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: tradingKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for energy trading',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const tradingAgent = new bedrock.CfnAgent(
        scope,
        'TradingAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const tradingAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'TradingAgentAlias',
        {
            agentId: tradingAgent.attrAgentId,
            agentAliasName: `TRADE${stackUUID}`
        }
    );

    tradingAgentAlias.addDependency(tradingAgent);

    // Apply removal policies
    tradingAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    tradingAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'TradingAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: tradingAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'TradingAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when trading agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = tradingAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        tradingAgent,
        tradingAgentAlias,
        tradingAgentRole,
        metric
    };
}
