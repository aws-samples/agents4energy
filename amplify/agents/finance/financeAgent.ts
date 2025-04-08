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
    financeAgentId?: string;
    financeAgentAliasId?: string;
}

export function financeAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'finance';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const financeAgentRole = new iam.Role(scope, 'FinanceAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Finance-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Finance Agent'
    });

    // Add required permissions
    financeAgentRole.addToPolicy(
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
    financeAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(financeAgentRole);
    
    // Default instruction for the finance agent
    const defaultInstruction = `You are a financial expert for the energy industry. You help companies understand and optimize their financial operations, investments, and reporting.
    
    You can provide information on:
    - Financial metrics for energy projects
    - Net present value (NPV) and internal rate of return (IRR) calculations
    - Capital expenditure planning
    - Operational expenditure optimization
    - Reserve valuation methodologies
    - Joint venture accounting and financial analysis
    - Depletion accounting
    - Energy project financing options
    - Risk assessment and management
    
    IMPORTANT: Distinguish between operational data queries and general knowledge queries:
    - For operational data queries (e.g., "Show me JV transactions with highest amounts", "Which projects are over budget?"), 
      use the structured data in your knowledge base to provide specific metrics, counts, and analysis.
    - For general knowledge queries (e.g., "How do I calculate NPV for a drilling project?", "Explain joint venture accounting"), 
      provide conceptual explanations based on your knowledge base.
    
    Sample operational data queries:
    - "What's the total CAPEX across all joint ventures this year?"
    - "Show me all transactions with Partner-001 that exceed $1 million"
    - "Which cost centers are over budget by more than 5%?"
    - "What's the average working interest percentage across all JV partners?"
    - "Compare actual vs. budget amounts for drilling projects in Q3"
    
    Sample general knowledge queries:
    - "What is the projected ROI for our new offshore drilling project?"
    - "How should we structure our joint venture agreement for field development?"
    - "What are the key financial metrics we should track for production assets?"
    - "Can you analyze our capital expenditure plan for the next fiscal year?"
    - "How do we optimize our tax strategy for renewable energy investments?"
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Consider both short-term and long-term financial implications
    4. Reference industry standards and best practices
    5. Acknowledge the financial challenges specific to the energy sector
    6. For operational data queries, include relevant metrics and specific data points from the jv_accounting.csv and budget_vs_actual.csv files
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create finance knowledge base and s3 data source for the KB
    const financeKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-finance`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to financial aspects of energy industry operations.`,
        description: 'Finance Knowledge Base',
    });
    const s3docsDataSource = financeKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-finance",
        inclusionPrefixes: ['finance-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with financial analysis and planning in the energy sector.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: financeAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: financeKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for financial operations in energy',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const financeAgent = new bedrock.CfnAgent(
        scope,
        'FinanceAgent',
        cfnAgentProps
    );

    // Create an alias for the agent - must be 10 chars or less
    const financeAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'FinanceAgentAlias',
        {
            agentId: financeAgent.attrAgentId,
            agentAliasName: `fin${stackUUID}`
        }
    );

    financeAgentAlias.addDependency(financeAgent);

    // Apply removal policies
    financeAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    financeAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'FinanceAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: financeAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'FinanceAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when finance agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = financeAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        financeAgent,
        financeAgentAlias,
        financeAgentRole,
        metric
    };
}
