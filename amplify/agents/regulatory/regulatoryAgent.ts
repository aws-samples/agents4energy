import { aws_bedrock as bedrock } from "aws-cdk-lib";
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';


interface BedrockAgentBuilderProps {
    description?: string,
    regulatoryKbId: string
}

// Create the agent 
export function buildRegulatoryAgent (scope: Construct, props: BedrockAgentBuilderProps) {

    // Create a bedrock execution role for the agent and use the role arn in the agent props.
    const agentRole = new cdk.aws_iam.Role(scope, 'BedrockAgentRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: 'BedrockAgentRole',
        description: 'Bedrock agent execution role',
        // Managed policy of full access for testing only, use principle of least priviledge in guideance
        // TODO: adjust this policy after testing
        managedPolicies: [cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')]
    })
    
    // Configure the agent properties
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: 'RegulatoryAgent',
        description: 'This agent is designed to help with regulatory compliance.',
        knowledgeBases: [{
            description: 'Regulatory Knowledge Base',
            knowledgeBaseId: props.regulatoryKbId,
            knowledgeBaseState: 'ENABLED',
        }],
        autoPrepare: true,
        // Use the arn from the role created above (agentRole) so we can auto-prepare the agent and create alias for the agent
        agentResourceRoleArn: agentRole.roleArn,
        // Specify the agent instructions 
       instruction: `You are a helpful regulatory assistant that uses your knowledge base to answer user questions. Always answer the question as factually correct as possible and cite your sources from your knowledge base.`,
      
       // Specify the agent model 
       foundationModel: 'anthropic.claude-3-haiku-20240307-v1:0',

       /*THE FOLLOWING COMMENTED SECTION IS AN EXAMPLE OF OVERRIDING THE DEFAULT PROMPT
         RESULTS WERE TESTED BETTER WHEN USING THE BEDROCK DEFAULT PROMPTS */
       
       // Set the prompt override configuration. Note the promptConfiguration is an array that can hold multiple configs (i.e. PRE_PROCESSING, ORCHESTRATION, KNOWLEDGE_BASE_RESPONSE, etc.),
       // here we are defining the promptConfiguration for orchestration.
    //    promptOverrideConfiguration: {
    //     promptConfigurations: [{
    //         // Set the inference configuration parameters (note that inference configuration cannot be empty when prompt type is PRE_PROCESSING and promptCreationMode is set to OVERRIDDEN)
    //         inferenceConfiguration: {
    //             maximumLength: 4096,
    //             temperature: 1,
    //             topP: 0.9,
    //             topK: 250
    //         },
    //         // Override the default agent prompt and use the basePromptTemplate defined here instead
    //         promptCreationMode: 'OVERRIDDEN',
    //         // This is an orchestration prompt type, to override pre-processing, post processing, and knowledge base response generation prompts add additional prompt configurations to this array. Note there are rules around prompt templates depending on 
    //         // the prompt type. For more information refer to: https://docs.aws.amazon.com/bedrock/latest/userguide/advanced-prompts-configure.html
    //         promptType: 'ORCHESTRATION',
    //         // Set the base prompt template you want to use instead of the default (the engineered prompt). In this prompt, we also put sensitive topic guardrails in place to further test the agent response.
    //         basePromptTemplate: `{
    //                                         "anthropic_version": "bedrock-2023-05-31",
    //                                         "system": "
    //                                             $instruction$
    //                                             You are an AI assistant named Regulatory Expert, created to provide information and guidance on regulatory matters to users. 
    //                                             You have access to a comprehensive knowledge base on environmental and other government regulations related to the energy industry in the United States
    //                                             including; The Environmental Protection Agency (EPA), The Occupational Safety and Health Administration (OSHA), The Pipeline and Hazardous Materials Safety Administration (PHMSA),
    //                                             The Bureau of Safety and Environmental Enforcement (BSEE), The Federal Energy Regulatory Commission (FERC), and the Bureau of Land Management (BLM).
    //                                             Your role is to provide factual, objective information to users, while citing your sources in your answers.
                                               

    //                                             $prompt_session_attributes$
    //                                             ",
    //                                         "messages": [
    //                                             {
    //                                                 "role" : "user",
    //                                                 "content" : "$question$"
    //                                             },
    //                                             {
    //                                                 "role" : "assistant",
    //                                                 "content" : "$agent_scratchpad$"
    //                                             }
    //                                         ]
    //                                     }`,
    //         promptState: 'ENABLED'                       
    //     }]
    //    }
       
    }
    
    
    // Agent declaration
    const regulatoryAgent = new bedrock.CfnAgent(
        scope,
        'RegulatoryAgent',
        cfnAgentProps
    );

    // Create an alias to the regulatoryAgent (needed for UI integration)
    const regulatoryAgentAlias = new bedrock.CfnAgentAlias(
       scope,
       'RegulatoryAgentAlias',
       {
           agentId: regulatoryAgent.attrAgentId,
           agentAliasName: 'RegulatoryAgentAlias'
       }          
    );

    // Add a dependency so the agent gets created before the alias
    regulatoryAgentAlias.addDependency(regulatoryAgent);

     //Create a CFN Output containing the agentId attribute
    new cdk.CfnOutput(scope, 'agentId', {
        value: regulatoryAgent.attrAgentId
    });

    //Create a CFN Output containing the agentAliasId attribute
    new cdk.CfnOutput(scope, 'agentAliasId', {
        value: regulatoryAgentAlias.attrAgentAliasId
    });

  return {
    regulatoryAgent: regulatoryAgent, 
    regulatoryAgentAlias: regulatoryAgentAlias
    };    
  
};
