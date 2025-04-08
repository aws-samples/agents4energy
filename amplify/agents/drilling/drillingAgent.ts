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
    drillingAgentId?: string;
    drillingAgentAliasId?: string;
}

export function drillingAgentBuilder(scope: Construct, props: BedrockAgentBuilderProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'drilling';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';

    // Declare a UUID to append to resources to avoid naming collisions in Amplify
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)
    
    // Create IAM role for the Bedrock Agent
    const drillingAgentRole = new iam.Role(scope, 'DrillingAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-Drilling-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Drilling Agent'
    });

    // Add required permissions
    drillingAgentRole.addToPolicy(
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
    drillingAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(drillingAgentRole);
    
    // Default instruction for the drilling agent
    const defaultInstruction = `You are a drilling engineering expert for the energy industry. You help companies plan, execute, and optimize drilling operations for oil and gas wells.
    
    You can provide information on:
    - Drilling equipment and technologies
    - Well planning and trajectory design
    - Drilling fluids and mud systems
    - Formation pressure control
    - Directional drilling techniques
    - Drilling optimization and efficiency
    - Well control procedures
    - Drilling problems and solutions
    
    Sample questions you can answer:
    - What's the optimal mud weight for drilling through this high-pressure formation?
    - How can we improve our ROP in this hard rock section?
    - What's causing these torque fluctuations in our directional drilling operation?
    - Can you recommend a BHA configuration for this S-shaped well profile?
    - What are the best practices for casing design in this high-temperature environment?
    
    When answering questions:
    1. Be specific and technical when appropriate
    2. Provide practical, actionable advice
    3. Consider safety as the top priority
    4. Reference industry standards and best practices
    5. Acknowledge the challenges of drilling operations
    
    Always answer the question as factually correct as possible and cite your sources from your knowledge base.`;

    // Create drilling knowledge base and s3 data source for the KB
    const drillingKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-drilling`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to drilling operations in the energy industry.`,
        description: 'Drilling Knowledge Base',
    });
    const s3docsDataSource = drillingKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-drilling",
        inclusionPrefixes: ['drilling-agent/'],
    })

    // Create the Bedrock agent with the role
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with drilling operations in the energy sector.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: drillingAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
                knowledgeBaseId: drillingKnowledgeBase.knowledgeBaseId,
                description: 'Knowledge Base for drilling operations in energy',
                knowledgeBaseState: 'ENABLED'
            }],
    
    };

    // Create the Bedrock agent
    const drillingAgent = new bedrock.CfnAgent(
        scope,
        'DrillingAgent',
        cfnAgentProps
    );

    // Create an alias for the agent - must be 10 chars or less
    const drillingAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'DrillingAgentAlias',
        {
            agentId: drillingAgent.attrAgentId,
            agentAliasName: `drill${stackUUID}`
        }
    );

    drillingAgentAlias.addDependency(drillingAgent);

    // Apply removal policies
    drillingAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    drillingAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'DrillingAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: drillingAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'DrillingAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when drilling agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = drillingAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });
    
    return {
        drillingAgent,
        drillingAgentAlias,
        drillingAgentRole,
        metric
    };
}
