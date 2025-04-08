// Implement the petrophysics agent

import { Construct } from 'constructs';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { bedrock as cdkLabsBedrock } from '@cdklabs/generative-ai-cdk-constructs';

interface PetrophysicsAgentProps {
    s3Bucket: s3.IBucket;
    s3Deployment: cdk.aws_s3_deployment.BucketDeployment;

    modelId?: string;
    vpc: ec2.Vpc;
    instruction?: string;
    description?: string;
}

export function petrophysicsAgentBuilder(scope: Construct, props: PetrophysicsAgentProps) {
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3);
    const resourcePrefix = 'A4E-Petrophysics';

    // Create IAM role for the Bedrock agent
    const petrophysicsAgentRole = new iam.Role(scope, 'PetrophysicsAgentRole', {
        roleName: `AmazonBedrockExecutionRole_${resourcePrefix}-${stackUUID}`,
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        description: 'IAM role for Petrophysics Agent to access knowledge bases',
    });

    // Add Bedrock permissions
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
    
    IMPORTANT: Distinguish between operational data queries and general knowledge queries:
    - For operational data queries (e.g., "Show me well logs with high porosity", "Which cores have the highest permeability?"), 
      use the structured data in your knowledge base to provide specific metrics, counts, and analysis.
    - For general knowledge queries (e.g., "How do neutron logs work?", "Explain density porosity calculation"), 
      provide conceptual explanations based on your knowledge base.
    
    Sample operational data queries:
    - "Which wells have the highest porosity measurements?"
    - "Show me core analysis results from the Eagle Ford formation"
    - "What's the average permeability in Well-A1?"
    - "Compare neutron porosity and density porosity across different wells"
    - "Which service company has the highest quality indicator for their logs?"
    
    Sample general knowledge queries:
    - "How do gamma ray logs help identify lithology?"
    - "What's the relationship between porosity and permeability?"
    - "How are neutron logs calibrated?"
    - "Explain the principles behind NMR logging"
    - "What factors affect resistivity measurements?"
    
    When providing petrophysical analysis:
    1. Reference specific well log data and measurements when available
    2. Explain the physical principles behind the measurements
    3. Discuss data quality and uncertainty where relevant
    4. Suggest additional measurements or analysis that could be valuable
    5. Provide context for how the analysis impacts reservoir characterization
    6. For operational data queries, include relevant metrics and specific data points from the well_logs.csv and core_analysis.csv files`;

    // Create petrophysics knowledge base
    const petrophysicsKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-petrophysics`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to petrophysics and well log analysis`,
        description: 'Petrophysics Knowledge Base',
    });

    const s3docsDataSource = petrophysicsKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-petrophysics",
        inclusionPrefixes: ['petrophysics-agent/'],
    });

    // Create the Bedrock agent
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: `${resourcePrefix}-agent-${stackUUID}`,
        description: props.description || 'This agent is designed to help with petrophysical analysis.',
        instruction: props.instruction || defaultInstruction,
        foundationModel: props.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
        agentResourceRoleArn: petrophysicsAgentRole.roleArn,
        autoPrepare: true,
        knowledgeBases: [{
            knowledgeBaseId: petrophysicsKnowledgeBase.knowledgeBaseId,
            description: 'Knowledge Base for petrophysics',
            knowledgeBaseState: 'ENABLED'
        }],
    };

    // Create the Bedrock agent
    const petrophysicsAgent = new bedrock.CfnAgent(
        scope,
        'PetrophysicsAgent',
        cfnAgentProps
    );

    // Create an alias for the agent
    const petrophysicsAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'PetrophysicsAgentAlias',
        {
            agentId: petrophysicsAgent.attrAgentId,
            agentAliasName: `PETRO${stackUUID}`
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
            AgentAlias: petrophysicsAgentAlias.agentAliasName
        }
    });

    return {
        petrophysicsAgent,
        petrophysicsAgentAlias,
        metric

    }
}
