"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceAgentBuilder = maintenanceAgentBuilder;
var cdk = require("aws-cdk-lib");
var aws_cdk_lib_1 = require("aws-cdk-lib");
var generative_ai_cdk_constructs_1 = require("@cdklabs/generative-ai-cdk-constructs");
var path_1 = require("path");
var url_1 = require("url");
function maintenanceAgentBuilder(scope, props) {
    var _a;
    var __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
    var stackName = cdk.Stack.of(scope).stackName;
    var stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3);
    var defaultDatabaseName = 'maintdb';
    var foundationModel = 'anthropic.claude-3-sonnet-20240229-v1:0';
    // const foundationModel = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    var agentName = "A4E-Maintenance-".concat(stackUUID);
    var agentRoleName = "AmazonBedrockExecutionRole_A4E_Maintenance-".concat(stackUUID);
    var agentDescription = 'Agent for energy industry maintenance workflows';
    var knowledgeBaseName = "A4E-KB-Maintenance-".concat(stackUUID);
    var postgresPort = 5432;
    var maxLength = 4096;
    console.log("Maintenance Stack UUID: ", stackUUID);
    var rootStack = cdk.Stack.of(scope).nestedStackParent;
    if (!rootStack)
        throw new Error('Root stack not found');
    // Agent-specific tags
    var maintTags = {
        Agent: 'Maintenance',
        Model: foundationModel
    };
    var bedrockAgentRole = new aws_cdk_lib_1.aws_iam.Role(scope, 'BedrockAgentRole', {
        roleName: agentRoleName,
        assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
        description: 'IAM role for Maintenance Agent to access KBs and query CMMS',
    });
    // ===== CMMS Database =====
    // Create Aurora PostgreSQL DB for CMMS - https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds.DatabaseCluster.html
    var maintDb = new aws_cdk_lib_1.aws_rds.DatabaseCluster(scope, 'MaintDB', {
        engine: aws_cdk_lib_1.aws_rds.DatabaseClusterEngine.auroraPostgres({
            version: aws_cdk_lib_1.aws_rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        defaultDatabaseName: defaultDatabaseName,
        enableDataApi: true,
        iamAuthentication: true,
        storageEncrypted: true,
        writer: aws_cdk_lib_1.aws_rds.ClusterInstance.serverlessV2('writer'),
        serverlessV2MinCapacity: 0.5,
        serverlessV2MaxCapacity: 4,
        vpcSubnets: {
            subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        vpc: props.vpc,
        port: postgresPort,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        deletionProtection: false
    });
    (_a = maintDb.secret) === null || _a === void 0 ? void 0 : _a.addRotationSchedule('RotationSchedule', {
        hostedRotation: aws_cdk_lib_1.aws_secretsmanager.HostedRotation.postgreSqlSingleUser({
            functionName: "SecretRotationMaintDb-".concat(stackUUID)
        }),
        automaticallyAfter: cdk.Duration.days(30)
    });
    var writerNode = maintDb.node.findChild('writer').node.defaultChild; // Set this as a dependency to cause a resource to wait until the database is queriable
    //Allow inbound traffic from the default SG in the VPC
    maintDb.connections.securityGroups[0].addIngressRule(aws_cdk_lib_1.aws_ec2.Peer.securityGroupId(props.vpc.vpcDefaultSecurityGroup), aws_cdk_lib_1.aws_ec2.Port.tcp(postgresPort), 'Allow inbound traffic from default SG');
    // Create a Lambda function that runs SQL statements to prepare the postgres cluster with sample data
    var prepDbFunction = new aws_cdk_lib_1.aws_lambda.Function(scope, "PrepDbFunction", {
        description: 'Agents4Energy CMMS data population function - will reset data with each run',
        runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_LATEST,
        handler: 'index.handler',
        timeout: cdk.Duration.minutes(15),
        code: aws_cdk_lib_1.aws_lambda.Code.fromAsset(path_1.default.join(__dirname, 'lambda')),
        environment: {
            MAINT_DB_CLUSTER_ARN: maintDb.clusterArn,
            MAINT_DB_SECRET_ARN: maintDb.secret.secretArn,
            DEFAULT_DATABASE_NAME: defaultDatabaseName
        }
    });
    prepDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: ['rds-data:ExecuteStatement'],
        resources: [maintDb.clusterArn],
    }));
    prepDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [maintDb.secret.secretArn],
    }));
    // Create a Custom Resource that invokes the lambda function to populate sample data into CMMS database
    var prepDb = new aws_cdk_lib_1.custom_resources.AwsCustomResource(scope, "PrepDatabase", {
        onCreate: {
            service: 'Lambda',
            action: 'invoke',
            parameters: {
                FunctionName: prepDbFunction.functionName,
                Payload: JSON.stringify({}), // No need to pass an event
            },
            physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.of('SqlExecutionResource'),
        },
        policy: aws_cdk_lib_1.custom_resources.AwsCustomResourcePolicy.fromStatements([
            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                actions: ['lambda:InvokeFunction'],
                resources: [prepDbFunction.functionArn],
            }),
        ]),
    });
    prepDb.node.addDependency(writerNode); // Now the prepDb resource will wait until the database is available before running the setup script.
    // ===== MAINTENANCE KNOWLEDGE BASE =====
    // Bedrock KB with OpenSearchServerless (OSS) vector backend
    var maintenanceKnowledgeBase = new generative_ai_cdk_constructs_1.bedrock.KnowledgeBase(scope, "KB-Maintenance", {
        embeddingsModel: generative_ai_cdk_constructs_1.bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        // name: knowledgeBaseName, //Note: The knowledge base name will contain the id of this construct "MaintKB" even without this key being set
        instruction: "You are a helpful question answering assistant. You answer user questions factually and honestly related to industrial facility maintenance and operations",
        description: 'Maintenance Knowledge Base',
    });
    var s3docsDataSource = maintenanceKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-maint",
        inclusionPrefixes: ['maintenance-agent/'],
        //chunkingStrategy: cdkLabsBedrock.ChunkingStrategy.NONE
    });
    var oilfieldServiceDataSource = maintenanceKnowledgeBase.addWebCrawlerDataSource({
        dataSourceName: "a4e-kb-ds-web",
        sourceUrls: ['https://novaoilfieldservices.com/learn/'],
        dataDeletionPolicy: generative_ai_cdk_constructs_1.bedrock.DataDeletionPolicy.RETAIN,
        chunkingStrategy: generative_ai_cdk_constructs_1.bedrock.ChunkingStrategy.HIERARCHICAL_TITAN
    });
    // ===== ACTION GROUP =====
    // Lambda Function
    var lambdaFunction = new aws_cdk_lib_1.aws_lambda.Function(scope, 'QueryCMMS', {
        //functionName: 'Query-CMMS',
        description: 'Agents4Energy tools to query CMMS database',
        runtime: aws_cdk_lib_1.aws_lambda.Runtime.PYTHON_3_12,
        code: aws_cdk_lib_1.aws_lambda.Code.fromAsset('amplify/functions/text2SQL/'),
        handler: 'maintenanceAgentAG.lambda_handler',
        timeout: cdk.Duration.seconds(90),
        environment: {
            database_name: defaultDatabaseName,
            db_resource_arn: maintDb.clusterArn,
            db_credentials_secrets_arn: maintDb.secret.secretArn,
        }
    });
    lambdaFunction.node.addDependency(maintDb);
    // Add DB query permissions to the Lambda function's role
    var policyRDS = new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ["rds-data:ExecuteStatement", "rds-data:ExecuteSql",],
        resources: [maintDb.clusterArn]
    });
    // Add Secret permissions to the Lambda function's role
    var policySecret = new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue",],
        resources: [maintDb.secret.secretArn]
    });
    // Add the policies to the Lambda function's role
    if (lambdaFunction.role) {
        lambdaFunction.role.addToPrincipalPolicy(policyRDS);
        lambdaFunction.role.addToPrincipalPolicy(policySecret);
    }
    else {
        console.warn("Lambda function role is undefined, cannot add policy.");
    }
    // ===== BEDROCK AGENT =====
    //const agentMaint = new BedrockAgent(scope, 'MaintenanceAgent', {
    var agentMaint = new aws_cdk_lib_1.aws_bedrock.CfnAgent(scope, 'MaintenanceAgent', {
        agentName: agentName,
        description: agentDescription,
        instruction: "You are an industrial maintenance specialist who has access to files and data about internal company operations.  \n        Shift handover reports, maintenance logs, work permits, safety inspections and other data should be used to provide insights on the efficiency and \n        safety of operations for the facility or operations manager.  To find information from the Computerized Maintenance Management System (CMMS), first \n        try to use the action group tool to query the SQL database as it is is the definitive system of record for information.  \n        \n        The kb-maintenance Bedrock Knowledge base may also have information in documents.  Alert the user if you find discrepancies between the relational \n        database and documents in the KB.  For each request, check both data sources and compare the data to see if it matches.  When running SQL statements, \n        verify that the syntax is correct and results are returned from the CMMS database.  If you do not get results, rewrite the query and try again.",
        foundationModel: foundationModel,
        autoPrepare: true,
        knowledgeBases: [{
                description: 'Maintenance Knowledge Base',
                knowledgeBaseId: maintenanceKnowledgeBase.knowledgeBaseId,
                // the properties below are optional
                knowledgeBaseState: 'ENABLED',
            }],
        actionGroups: [{
                actionGroupName: 'Query-CMMS-AG',
                actionGroupExecutor: {
                    lambda: lambdaFunction.functionArn,
                },
                actionGroupState: 'ENABLED',
                description: 'Action group to perform SQL queries against CMMS database',
                functionSchema: {
                    functions: [{
                            name: 'get_tables',
                            description: 'get a list of usable tables from the database',
                        }, {
                            name: 'get_tables_information',
                            description: 'get the column level details of a list of tables',
                            parameters: {
                                'tables_list': {
                                    type: 'array',
                                    description: 'list of tables',
                                    required: true,
                                },
                            },
                        }, {
                            name: 'execute_statement',
                            description: 'Execute a SQL query against the CMMS databases',
                            parameters: {
                                'sql_statement': {
                                    type: 'string',
                                    description: 'the SQL query to execute',
                                    required: true,
                                },
                            },
                        }
                    ],
                },
            }],
        agentResourceRoleArn: bedrockAgentRole.roleArn,
        promptOverrideConfiguration: {
            promptConfigurations: [{
                    basePromptTemplate: "{\n        \"anthropic_version\": \"bedrock-2023-05-31\",\n        \"system\": \"\n            $instruction$\n            You have been provided with a set of functions to answer the user's question.\n            You must call the functions in the format below:\n            <function_calls>\n            <invoke>\n                <tool_name>$TOOL_NAME</tool_name>\n                <parameters>\n                <$PARAMETER_NAME>$PARAMETER_VALUE</$PARAMETER_NAME>\n                ...\n                </parameters>\n            </invoke>\n            </function_calls>\n            Here are the functions available:\n            <functions>\n            $tools$\n            </functions>\n            You will ALWAYS follow the below guidelines when you are answering a question:\n            <guidelines>\n            - Think through the user's question, extract all data from the question and the previous conversations before creating a plan.\n            - The CMMS database is the system of record.  Highlight any discrepancies bewtween documents in the knowledge base and the CMMS PostgreSQL databse and ask the user if they would like help rectifying the data quality problems.\n            - ALWAYS optimize the plan by using multiple functions <invoke> at the same time whenever possible.\n            - equipment table contains the equipid unique identifier column that is used in the maintenance table to indicate the piece of equipment that the maintenance was performed on.\n            - locationid column in the locations table is the unique identifier for each facilty, unit, or wellpad.\n            - Locations with a type of Facility (FCL) contain units and the unit locations have the facility they are contained in the facility column.  For example, the Biodiesel Unit is at the Sandy Point Refilery (Location 928)\n            - NEVER attempt to join equipid ON locationid or installlocationid as these fields are different values and data types.\n            - ALWAYS preface the table name with the schema when writing SQL.\n            - Perform queries using case insensitive WHERE clauses for text fields for more expansive data searching.\n            - PostgreSQL referential integrity constraints can be viewed in cmms_constraints.  Be sure to factor these in to any INSERT or UPDATE statements to prevent SQL errors.\n            - ALWAYS update the updatedby column to have the value MaintAgent and updateddate to be the current date and time when issuing UPDATE SQL statements to the CMMS database\n            - ALWAYS populate createdby column with a value of MaintAgent and createddate with current date and time when issuing INSERT SQL statements to the CMMS database\n            - If an UPDATE SQL statement indicates that 0 records were updated, retry the action by first querying the database to ensure the record exists, then update the existing record.  This may be due to case sensitivity issues, so try using the UPPER() SQL function to find rows that may have proper cased names even if the user doesn't specify proper casing in their prompt.\n            - if you receive an exception from CMMS queries, try using CAST to convert the types of both joined columns to varchar to prevent errors and retry the query.\n            - Never assume any parameter values while invoking a function.\n            $ask_user_missing_information$\n            - Provide your final answer to the user's question within <answer></answer> xml tags.\n            - Always output your thoughts within <thinking></thinking> xml tags before and after you invoke a function or before you respond to the user. \n            $knowledge_base_guideline$\n            $code_interpreter_guideline$\n            </guidelines>\n            $code_interpreter_files$\n            $memory_guideline$\n            $memory_content$\n            $memory_action_guideline$\n            $prompt_session_attributes$\n            \",\n                    \"messages\": [\n                        {\n                            \"role\" : \"user\",\n                            \"content\" : \"$question$\"\n                        },\n                        {\n                            \"role\" : \"assistant\",\n                            \"content\" : \"$agent_scratchpad$\"\n                        }\n                    ]\n            }",
                    inferenceConfiguration: {
                        maximumLength: maxLength,
                        stopSequences: ['</function_calls>', '</answer>', '</error>'],
                        temperature: 1,
                        topK: 250,
                        topP: 0.9,
                    },
                    promptCreationMode: 'OVERRIDDEN',
                    promptState: 'ENABLED',
                    promptType: 'ORCHESTRATION',
                }]
        }
    });
    // Add dependency on the KB so it gets created first
    agentMaint.node.addDependency(maintenanceKnowledgeBase);
    // Grant invoke permission to the Bedrock Agent
    var bedrockAgentArn = agentMaint.attrAgentArn;
    lambdaFunction.addPermission('BedrockInvokePermission', {
        principal: new aws_cdk_lib_1.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: bedrockAgentArn,
    });
    // Create a custom inline policy for Agent permissions
    var customAgentPolicy = new aws_cdk_lib_1.aws_iam.Policy(scope, 'A4E-MaintAgentPolicy', {
        //policyName: 'A4E-MaintAgentPolicy', // Custom policy name
        statements: [
            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                actions: ['bedrock:InvokeModel'],
                resources: [
                    "arn:aws:bedrock:".concat(rootStack.region, ":").concat(rootStack.account, ":inference-profile/*"),
                    // "arn:aws:bedrock:${rootStack.region}::foundation-model/amazon.nova-lite-v1:0",
                    // "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0",
                    // "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
                    // "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0",
                    // "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0",
                    "arn:aws:bedrock:us-*::foundation-model/*",
                ]
            }),
            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                actions: ['bedrock:Retrieve'],
                resources: [
                    maintenanceKnowledgeBase.knowledgeBaseArn
                ]
            }),
        ]
    });
    // Add custom policy to the Agent role
    bedrockAgentRole.attachInlinePolicy(customAgentPolicy);
    // Add tags to all resources in this scope
    cdk.Tags.of(scope).add('Agent', maintTags.Agent);
    cdk.Tags.of(scope).add('Model', maintTags.Model);
    //Add an agent alias to make the agent callable
    var maintenanceAgentAlias = new aws_cdk_lib_1.aws_bedrock.CfnAgentAlias(scope, 'maintenance-agent-alias', {
        agentId: agentMaint.attrAgentId,
        agentAliasName: "agent-alias"
    });
    return {
        defaultDatabaseName: defaultDatabaseName,
        maintenanceAgent: agentMaint,
        maintenanceAgentAlias: maintenanceAgentAlias
    };
}
