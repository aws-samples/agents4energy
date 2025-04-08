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
    decarbAgentId?: string;
    decarbAgentAliasId?: string;
}

export function decarbAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'decarb';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const decarbAgentRole = new iam.Role(scope, 'DecarbAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Decarb-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Decarbonization Agent'
    });

    // Add required permissions
    decarbAgentRole.addToPolicy(
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
    decarbAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(decarbAgentRole);
    
    // Default instruction for the decarbonization agent
    const defaultInstruction = `You are a decarbonization expert for the energy industry. You help companies understand and implement strategies to reduce carbon emissions in their operations.
    
    You can provide information on:
    - Carbon capture technologies and their applications
    - Emissions reduction strategies for oil and gas operations
    - Renewable energy integration with traditional energy operations
    - Carbon accounting and reporting requirements
    - Hydrogen production methods and economics (blue, green, etc.)
    - Regulatory frameworks for emissions
    - Net-zero transition planning
    
    Sample questions you can answer:
    - What carbon capture technology would be most suitable for our natural gas processing facility?
    - How can we reduce methane emissions from our upstream operations?
    - What's the business case for implementing this emissions reduction project?
    - How should we structure our carbon accounting to meet upcoming regulations?
    - What renewable energy options could we integrate with our existing operations?
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Consider economic factors alongside environmental benefits
    4. Reference industry standards and best practices
    5. Acknowledge the challenges of decarbonization in the energy sector
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create decarbonization knowledge base and s3 data source for the KB
    const decarbKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-decarb`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to decarbonization strategies in the energy industry.`,
        description: 'Decarbonization Knowledge Base',
    });
    const s3docsDataSource = decarbKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-decarb",
        inclusionPrefixes: ['decarb-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with decarbonization strategies in the energy sector.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: decarbAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: decarbKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for decarbonization in energy',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const decarbAgent = new bedrock.CfnAgent(
        scope,
        'DecarbAgent',
        cfnAgentProps
    );

    // Create an alias for the agent - must be 10 chars or less
    const decarbAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'DecarbAgentAlias',
        {
            agentId: decarbAgent.attrAgentId,
            agentAliasName: `decarb${stackUUID}`
        }
    );

    decarbAgentAlias.addDependency(decarbAgent);

    // Apply removal policies
    decarbAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    decarbAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'DecarbAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: decarbAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'DecarbAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when decarbonization agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = decarbAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        decarbAgent,
        decarbAgentAlias,
        decarbAgentRole,
        metric
    };
}
