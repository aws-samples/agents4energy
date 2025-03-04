// Agents4Energy - Petrophysics Agent
import * as cdk from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as bedrockCdk from 'aws-cdk-lib/aws-bedrock';

interface AgentProps {
    vpc: ec2.Vpc,
    s3Bucket: s3.IBucket,
    s3Deployment: cdk.aws_s3_deployment.BucketDeployment
}

export function petrophysicsAgentBuilder(scope: Construct, props: AgentProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'petrophysics';
    const environment = scope.node.tryGetContext('environment') || 'dev';

    // Unique ID for resource names
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3)

    // Create IAM role for the Bedrock Agent
    const petrophysicsAgentRole = new iam.Role(scope, 'PetrophysicsAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `BedrockAgentRole-${stackUUID}`,
        path: '/service-role/',
        description: 'Execution role for Bedrock Petrophysics Agent'
    });

    // Add required Bedrock permissions
    petrophysicsAgentRole.addToPolicy(
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
    petrophysicsAgentRole.addToPolicy(
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
    props.s3Bucket.grantRead(petrophysicsAgentRole);

    // Default instruction for the petrophysics agent
    const defaultInstruction = `You are a helpful petrophysics assistant that uses your knowledge base to answer user questions.
    Always answer questions factually and cite your sources from the knowledge base.
    When providing petrophysical guidance:
    1. Reference specific technical documents and standards from the knowledge base
    2. Explain complex petrophysical concepts in clear terms
    3. Provide context for calculations and interpretations
    4. Highlight any assumptions or limitations in the analysis
    5. Suggest related petrophysical parameters to consider
    6. If uncertain, recommend consulting domain experts`;

    // Create petrophysics knowledge base and s3 data source
    const petrophysicsKnowledgeBase = new bedrock.VectorKnowledgeBase(scope, `KB-petrophysics`, {
        embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to petrophysical analysis and interpretation in oil and gas wells.`,
        description: 'Petrophysics Knowledge Base',
    });

    const s3docsDataSource = petrophysicsKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-petrophysics",
        inclusionPrefixes: ['petrophysics-agent/'],
    });

    // Create the Bedrock agent
    const cfnAgentProps: bedrockCdk.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: 'This agent is designed to help with petrophysical analysis and interpretation.',
        instruction: defaultInstruction,
        foundationModel: 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: petrophysicsAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
            knowledgeBaseId: petrophysicsKnowledgeBase.knowledgeBaseId,
            description: 'Knowledge Base for petrophysical analysis',
            knowledgeBaseState: 'ENABLED'
        }],
    };

    // Create the Bedrock agent
    const petrophysicsAgent = new bedrockCdk.CfnAgent(
        scope,
        'PetrophysicsAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const petrophysicsAgentAlias = new bedrockCdk.CfnAgentAlias(
        scope,
        'PetrophysicsAgentAlias',
        {
            agentId: petrophysicsAgent.attrAgentId,
            agentAliasName: `${resourcePrefix}-agent-alias-${stackUUID}`
        }
    );

    petrophysicsAgentAlias.addDependency(petrophysicsAgent);

    // Apply removal policies
    petrophysicsAgent.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    petrophysicsAgentAlias.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Create CloudWatch metrics
    const metric = new cdk.aws_cloudwatch.Metric({
        namespace: 'PetrophysicsAgent',
        metricName: 'Invocations',
        dimensionsMap: {
            AgentId: petrophysicsAgent.attrAgentId,
            Environment: environment
        }
    });

    // Create CloudWatch alarm
    new cdk.aws_cloudwatch.Alarm(scope, 'PetrophysicsAgentErrorAlarm', {
        metric: metric,
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alert when petrophysics agent encounters multiple errors',
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });

    // Add trust policy conditions
    const cfnRole = petrophysicsAgentRole.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument.Statement.0.Condition', {
        StringEquals: {
            'aws:SourceAccount': cdk.Stack.of(scope).account
        }
    });

    return {
        petrophysicsAgent,
        petrophysicsAgentAlias,
        petrophysicsAgentRole,
        metric
    };
}
