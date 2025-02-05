// Agents4Energy - Corporate Agent
import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import { Stack, Fn, Aws, Token } from 'aws-cdk-lib';
import {
    aws_bedrock as bedrock,
    aws_iam as iam,
    aws_s3 as s3,
    aws_ec2 as ec2,
    custom_resources as cr
} from 'aws-cdk-lib';
import { bedrock as cdkLabsBedrock } from '@cdklabs/generative-ai-cdk-constructs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addLlmAgentPolicies } from '../../functions/utils/cdkUtils'

interface AgentProps {
    vpc: ec2.Vpc,
    s3Bucket: s3.IBucket,
    s3Deployment: cdk.aws_s3_deployment.BucketDeployment
}

export function corporateAgentBuilder(scope: Construct, props: AgentProps) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const stackName = cdk.Stack.of(scope).stackName;
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3);
    // list of models can be found here https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
    //const foundationModel = 'amazon.nova-micro-v1:0';
    const foundationModel = 'anthropic.claude-3-haiku-20240307-v1:0';
    const agentName = `A4E-Corporate-${stackUUID}`;
    //const agentRoleName = `AmazonBedrockExecutionRole_A4E_Corporate-${stackUUID}`;
    const agentDescription = 'Agent for energy industry corporate workflows';

    console.log("Corporate Stack UUID: ", stackUUID)

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    // Agent-specific tags
    const corporateTags = {
        Agent: 'Corporate',
        Model: foundationModel
    }

    // IAM Role for Agent
    const bedrockAgentRole = new iam.Role(scope, 'BedrockAgentRole', {
        //roleName: agentRoleName,
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        description: 'IAM role for Corporate Agent to access KBs with partnership, project, and policy documents',
    });


    // ===== CORPORATE KNOWLEDGE BASE =====
    // Bedrock KB with OpenSearchServerless (OSS) vector backend
    const corporateKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-Corporate`, {//${stackName.slice(-5)}
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to corporate organization, partnership contracts, project initiatives, and company policies`,
        description: 'Corporate Knowledge Base',
    });
    const s3docsDataSource = corporateKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-corporate",
        inclusionPrefixes: ['corporate-agent/'],
        //chunkingStrategy: cdkLabsBedrock.ChunkingStrategy.NONE
    })


    // ===== BEDROCK AGENT =====
    const agentCorporate = new bedrock.CfnAgent(scope, 'CorporateAgent', {
        agentName: agentName,
        description: agentDescription,
        instruction: `You are an corporate legal expert who has access to documents and files and data about internal company operations.  
        partnership agreements, memorandums of understanding, joint operating agreements, policies and other data should be used to provide insights on the efficiency and 
        legality of operations for leadership across the organization.`,
        foundationModel: foundationModel,
        autoPrepare: true,
        knowledgeBases: [{
            description: 'Corporate Knowledge Base',
            knowledgeBaseId: corporateKnowledgeBase.knowledgeBaseId,
            knowledgeBaseState: 'ENABLED',
        }],
        agentResourceRoleArn: bedrockAgentRole.roleArn,
    });
    // Add dependency on the KB so it gets created first
    agentCorporate.node.addDependency(corporateKnowledgeBase);

    // Create a custom inline policy for Agent permissions
    const customAgentPolicy = new iam.Policy(scope, 'A4E-CorporateAgentPolicy', {
        statements: [
            new iam.PolicyStatement({
                actions: ['bedrock:InvokeModel'],
                resources: [
                    `arn:aws:bedrock:${rootStack.region}:${rootStack.account}:inference-profile/*`,
                    `arn:aws:bedrock:us-*::foundation-model/*`,
                ]
            }),
            new iam.PolicyStatement({
                actions: ['bedrock:Retrieve'],
                resources: [
                    corporateKnowledgeBase.knowledgeBaseArn
                ]
            }),
        ]
    });
    // Add custom policy to the Agent role
    bedrockAgentRole.attachInlinePolicy(customAgentPolicy);

    // Add tags to all resources in this scope
    cdk.Tags.of(scope).add('Agent', corporateTags.Agent);
    cdk.Tags.of(scope).add('Model', corporateTags.Model);

    //Add an agent alias to make the agent callable
    const corporateAgentAlias = new bedrock.CfnAgentAlias(scope, 'corporate-agent-alias', {
        agentId: agentCorporate.attrAgentId,
        agentAliasName: `agent-alias`
    });

    return {
        corporateAgent: agentCorporate,
        corporateAgentAlias: corporateAgentAlias
    };
}
