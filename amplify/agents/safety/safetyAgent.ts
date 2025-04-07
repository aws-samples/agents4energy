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
    safetyAgentId?: string;
    safetyAgentAliasId?: string;
}

export function safetyAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'safety';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const safetyAgentRole = new iam.Role(scope, 'SafetyAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Safety-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Safety Agent'
    });

    // Add required permissions
    safetyAgentRole.addToPolicy(
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
    safetyAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(safetyAgentRole);
    
    // Default instruction for the safety agent
    const defaultInstruction = `You are a safety expert for the energy industry. You help companies understand and implement best practices for workplace safety and hazard prevention.
    
    You can provide information on:
    - OSHA regulations and compliance
    - Personal protective equipment (PPE) requirements
    - Job safety analysis (JSA) procedures
    - Confined space entry protocols
    - Hazardous materials handling
    - Emergency response planning
    - Safety training programs
    - Incident investigation and reporting
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Always prioritize human safety above all else
    4. Reference industry standards and best practices
    5. Acknowledge the unique safety challenges in energy operations
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create safety knowledge base and s3 data source for the KB
    const safetyKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-safety`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to safety practices in the energy industry.`,
        description: 'Safety Knowledge Base',
    });
    const s3docsDataSource = safetyKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-safety",
        inclusionPrefixes: ['safety-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with safety management in the energy sector.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: safetyAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: safetyKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for safety practices in energy',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const safetyAgent = new bedrock.CfnAgent(
        scope,
        'SafetyAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const safetyAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'SafetyAgentAlias',
        {
            agentId: safetyAgent.attrAgentId,
            agentAliasName: `${resourcePrefix}-agent-alias-${stackUUID}`
        }
    );

    safetyAgentAlias.addDependency(safetyAgent);

    // Apply removal policies
    safetyAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    safetyAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'SafetyAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: safetyAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'SafetyAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when safety agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = safetyAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        safetyAgent,
        safetyAgentAlias,
        safetyAgentRole,
        metric
    };
}
