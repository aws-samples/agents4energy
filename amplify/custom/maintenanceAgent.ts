
import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';

interface MaintenanceAgentProps {
    s3BucketName: s3.Bucket,
}

export function maintenanceAgentBuilder(scope: Construct, props: MaintenanceAgentProps) {

    const rootStack = cdk.Stack.of(scope).nestedStackParent

    if (!rootStack) throw new Error('Root stack not found')


    

// === KNOWLEDGE BASE
    //This bedrock knowledgebase contains data and documents related to oil and gas maintenance activities.
    const maintKb = new bedrock.KnowledgeBase(scope, 'MaintKb', {
        embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are an expert at understanding mainteance.`,
        description: `This knowledge base contains data and documents related to oil and gas related maintenance activities.`
    });
    //Define the data source for the knowledge base.
    const maintDataSource = new bedrock.S3DataSource(scope, 'MaintDataSource', {
        bucket: props.s3BucketName,
        knowledgeBase: maintKb,
        dataSourceName: 'MaintData'
      });



// === AGENT
    // Create bedrock execution role for Agent
    const maintAgentRole = new cdk.aws_iam.Role(scope, 'MaintBedrockAgentExecutionRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: 'BedrockMaintAgentExecutionRole',
        // TODO: update this role to principal of least priviledge 
        managedPolicies: [
            cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')
        ]
    });
    // Configure the Agent properties
    const cfnAgentProps: bedrock.CfnAgentProps = {
        agentName: 'MaintAgent',
        instruction: 'You are an industrial maintenance specialist who has access to files and data about internal company operations.  Shift handover reports, maintenance logs, work permits, safety inspections and other data should be used to provide insights on the efficiency and safety of operations for the facility or operations manager.  To find information from the Computerized Maintenance Management System (CMMS), first try to use the action group tool to query the SQL database as it is is the definitive system of record for information.  The kb-maintenance Bedrock Knowledge base may also have information in documents.  Alert the user if you find discrepancies between the relational database and documents in the KB.  For each request, check both data sources and compare the data to see if it matches.  When running SQL statements, verify that the syntax is correct and results are returned from the CMMS database.  If you do not get results, rewrite the query and try again.',
        description: 'Maintenance assistant to provide insights on operations across the company about industrial facility repairs, potential issues, and preventative maintenance work',
        foundationModel: 'anthropic.claude-3-sonnet-20240229-v1:0',
        knowledgeBases: [{
            description: 'Maintenance Data Knowledge Base',
            knowledgeBaseId: maintKb.knowledgeBaseId,
            knowledgeBaseState: 'ENABLED'
        }],
        // Auto prepare the agent when it is deployed from the CDK
        autoPrepare: true,
        //Use the role created above
        agentResourceRoleArn: maintAgentRole.roleArn
    };
    // Agent declaration
    const maintAgent = new bedrock.CfnAgent(
        scope,
        'MaintAgent',
        cfnAgentProps
    );
    // Create an agent alias for the Agent
    const maintAgentAlias = new bedrock.CfnAgentAlias(
        scope,
        'MaintAgentAlias',
        {
            agentId: maintAgent.attrAgentId,
            agentAliasName: 'MaintAgentAlias'
        });
    // Add a dependency so the agent gets created before the agent alias
    maintAgentAlias.addDependency(maintAgent);


  
    // // IAM Role for Lambda
    // const lambdaRole = new iam.Role(scope, 'LambdaExecutionRole', {
    //     assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    //     managedPolicies: [
    //         iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    //     ],
    //     inlinePolicies: {
    //         'BedrockInvocationPolicy': new iam.PolicyDocument({
    //             statements: [
    //                 new iam.PolicyStatement({
    //                     actions: ["bedrock:InvokeModel"],
    //                     resources: [
    //                         `arn:aws:bedrock:${rootStack.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
    //                         `arn:aws:bedrock:${rootStack.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`
    //                     ],
    //                 }),
    //                 new iam.PolicyStatement({
    //                     actions: ["s3:GetObject"],
    //                     resources: [
    //                         `arn:aws:s3:::${props.s3BucketName}/*`
    //                     ],
    //                 }),
    //                 new iam.PolicyStatement({
    //                     actions: ["s3:ListBucket"],
    //                     resources: [
    //                         `arn:aws:s3:::${props.s3BucketName}`
    //                     ],
    //                 }),
    //                 new iam.PolicyStatement({
    //                     actions: ["rds-data:ExecuteStatement","rds-data:ExecuteSql"],
    //                     resources: [
    //                         `Resource": "arn:aws:rds:*:${rootStack.account}:cluster:*`
    //                     ],
    //                 }),
    //             ]
    //         })
    //     }
    // });
    
    
// === CLOUDFORMATION OUTPUTS
    //Knowledge Base ID
    new cdk.CfnOutput(scope, 'MaintKbId', {
      value: maintKb.knowledgeBaseId,
      description: 'Maintenance Knowledge Base ID',
      //Export the name of the deployed KB so it can be imported as a variable in other parts of the stack.
      exportName: 'MaintKbId'
    });
    //KB Data Source Id
    new cdk.CfnOutput(scope, 'MaintDataSourceId', {
      value: maintDataSource.dataSourceId,
      description: 'Maintenance Data Source ID',
      exportName: 'MaintDataSourceId'
    });
    //Agent ID
    new cdk.CfnOutput(scope, 'agentId', {
        value: maintAgent.attrAgentId,
        description: 'Agent ID',
        exportName: 'agentId'
    });
    //Agent Alias ID
    new cdk.CfnOutput(scope, 'agentAliasId', {
        value: maintAgentAlias.attrAgentAliasId,
        description: 'Agent Alias ID',
        exportName: 'agentAliasId'
    });
  
    // TODO: What should be returned?    
    return { 
        maintKb: maintKb,
        maintDataSource: maintDataSource,
        maintAgent: maintAgent,
        maintAgentAlias: maintAgentAlias
    }


};