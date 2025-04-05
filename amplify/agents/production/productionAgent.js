"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productionAgentBuilder = productionAgentBuilder;
var yaml_1 = require("yaml");
var cdk = require("aws-cdk-lib");
var aws_cdk_lib_1 = require("aws-cdk-lib");
var generative_ai_cdk_constructs_1 = require("@cdklabs/generative-ai-cdk-constructs");
var aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
var path_1 = require("path");
var url_1 = require("url");
var bedrockKnowledgeBase_1 = require("../../constructs/bedrockKnowledgeBase");
var cdkUtils_1 = require("../../functions/utils/cdkUtils");
var defaultProdDatabaseName = 'proddb';
function productionAgentBuilder(scope, props) {
    var _a, _b;
    var __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
    var stackName = cdk.Stack.of(scope).stackName;
    var stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3);
    // console.log("Produciton Stack UUID Long: ", stackUUIDLong)
    console.log("Production Stack UUID: ", stackUUID);
    var rootStack = cdk.Stack.of(scope).nestedStackParent;
    if (!rootStack)
        throw new Error('Root stack not found');
    // Lambda function to apply a promp to a pdf file
    var lambdaLlmAgentRole = new aws_cdk_lib_1.aws_iam.Role(scope, 'LambdaExecutionRole', {
        assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
        inlinePolicies: {
            'BedrockInvocationPolicy': new aws_cdk_lib_1.aws_iam.PolicyDocument({
                statements: [
                    new aws_cdk_lib_1.aws_iam.PolicyStatement({
                        actions: ["bedrock:InvokeModel*"],
                        resources: [
                            "arn:aws:bedrock:".concat(rootStack.region, ":").concat(rootStack.account, ":inference-profile/*"),
                            "arn:aws:bedrock:us-*::foundation-model/*",
                        ],
                    }),
                    new aws_cdk_lib_1.aws_iam.PolicyStatement({
                        actions: ["s3:GetObject"],
                        resources: [
                            "arn:aws:s3:::".concat(props.s3Bucket.bucketName, "/*")
                        ],
                    }),
                    new aws_cdk_lib_1.aws_iam.PolicyStatement({
                        actions: ["s3:ListBucket"],
                        resources: [
                            "arn:aws:s3:::".concat(props.s3Bucket.bucketName)
                        ],
                    }),
                ]
            })
        }
    });
    var convertPdfToYamlFunction = new aws_lambda_nodejs_1.NodejsFunction(scope, 'ConvertPdfToYamlFunction', {
        runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_20_X,
        entry: path_1.default.join(__dirname, '..', '..', 'functions', 'convertPdfToYaml', 'index.ts'),
        bundling: {
            format: aws_lambda_nodejs_1.OutputFormat.CJS,
            loader: {
                '.node': 'file',
            },
            bundleAwsSDK: true,
            minify: true,
            sourceMap: true,
        },
        timeout: cdk.Duration.minutes(15),
        memorySize: 3000,
        role: lambdaLlmAgentRole,
        logRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
        environment: {
            DATA_BUCKET_NAME: props.s3Bucket.bucketName,
            // MODEL_ID: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0'
            // MODEL_ID: 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
            // 'MODEL_ID': 'us.anthropic.claude-3-sonnet-20240229-v1:0',
            // 'MODEL_ID': 'us.anthropic.claude-3-haiku-20240307-v1:0',
        },
        // layers: [imageMagickLayer, ghostScriptLayer]
    });
    convertPdfToYamlFunction.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ["textract:StartDocumentAnalysis", "textract:GetDocumentAnalysis"],
        resources: [
            "*" // textract:StartDocumentAnalysis does not support resource-level permissions: https://docs.aws.amazon.com/textract/latest/dg/security_iam_service-with-iam.html
        ],
    }));
    // This is a way to prevent a circular dependency error when interacting with the well fiel drive bucket
    var pdfDlQueue = new aws_cdk_lib_1.aws_sqs.Queue(scope, 'PdfToYamlDLQ', {
        retentionPeriod: cdk.Duration.days(14), // Keep failed messages for 14 days
        encryption: aws_cdk_lib_1.aws_sqs.QueueEncryption.KMS_MANAGED,
        enforceSSL: true
    });
    // Create the main queue for processing with improved security
    var pdfProcessingQueue = new aws_cdk_lib_1.aws_sqs.Queue(scope, 'PdfToYamlQueue', {
        visibilityTimeout: cdk.Duration.minutes(16), // Should match or exceed lambda timeout
        encryption: aws_cdk_lib_1.aws_sqs.QueueEncryption.KMS_MANAGED,
        enforceSSL: true,
        deadLetterQueue: {
            queue: pdfDlQueue,
            maxReceiveCount: 3 // Number of retries before sending to DLQ
        },
    });
    // Add a queue policy to enforce HTTPS
    for (var _i = 0, _c = [pdfDlQueue, pdfProcessingQueue]; _i < _c.length; _i++) {
        var queue = _c[_i];
        queue.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: 'DenyUnsecureTransport',
            effect: aws_cdk_lib_1.aws_iam.Effect.DENY,
            principals: [new aws_cdk_lib_1.aws_iam.AnyPrincipal()],
            actions: [
                'sqs:*'
            ],
            resources: [queue.queueArn],
            conditions: {
                'Bool': {
                    'aws:SecureTransport': 'false'
                }
            }
        }));
    }
    // Grant the Lambda permission to read from the queue
    pdfProcessingQueue.grantConsumeMessages(convertPdfToYamlFunction);
    // Add SQS as trigger for Lambda
    convertPdfToYamlFunction.addEventSource(new aws_cdk_lib_1.aws_lambda_event_sources.SqsEventSource(pdfProcessingQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(10),
        maxConcurrency: 90,
    }));
    var wellFileDriveBucket = aws_cdk_lib_1.aws_s3.Bucket.fromBucketName(scope, 'ExistingBucket', props.s3Bucket.bucketName);
    // Now update the S3 notification to send to SQS instead of directly to Lambda
    wellFileDriveBucket.addEventNotification(aws_cdk_lib_1.aws_s3.EventType.OBJECT_CREATED, new aws_cdk_lib_1.aws_s3_notifications.SqsDestination(pdfProcessingQueue), {
        prefix: 'production-agent/well-files/',
        suffix: '.pdf'
    });
    // Now update the S3 notification to send to SQS instead of directly to Lambda
    wellFileDriveBucket.addEventNotification(aws_cdk_lib_1.aws_s3.EventType.OBJECT_CREATED, new aws_cdk_lib_1.aws_s3_notifications.SqsDestination(pdfProcessingQueue), {
        prefix: 'production-agent/well-files/',
        suffix: '.PDF'
    });
    // //When a new pdf is uploaded to the well file drive, transform it into YAML and save it back to the well file drive
    // // Add S3 event notification
    // wellFileDriveBucket.addEventNotification(
    //     s3.EventType.OBJECT_CREATED, // Triggers on file upload
    //     new s3n.LambdaDestination(convertPdfToYamlFunction),
    //     {
    //         prefix: 'production-agent/well-files/', // Only trigger for files in this prefix
    //         suffix: '.pdf' // Only trigger for files with this extension
    //     }
    // );
    //https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds.DatabaseCluster.html
    var hydrocarbonProductionDb = new aws_cdk_lib_1.aws_rds.DatabaseCluster(scope, 'A4E-HydrocarbonProdDb', {
        engine: aws_cdk_lib_1.aws_rds.DatabaseClusterEngine.auroraPostgres({
            version: aws_cdk_lib_1.aws_rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        defaultDatabaseName: defaultProdDatabaseName,
        enableDataApi: true,
        iamAuthentication: true,
        storageEncrypted: true,
        backup: {
            retention: cdk.Duration.days(7),
            preferredWindow: '02:00-03:00'
        },
        deletionProtection: false,
        writer: aws_cdk_lib_1.aws_rds.ClusterInstance.serverlessV2('writer'),
        serverlessV2MinCapacity: 0.5,
        serverlessV2MaxCapacity: 2,
        vpcSubnets: {
            subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        vpc: props.vpc,
        port: 5432,
        removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    (_a = hydrocarbonProductionDb.secret) === null || _a === void 0 ? void 0 : _a.addRotationSchedule('RotationSchedule', {
        hostedRotation: aws_cdk_lib_1.aws_secretsmanager.HostedRotation.postgreSqlSingleUser({
            functionName: "SecretRotationProdDb-".concat(stackUUID)
        }),
        automaticallyAfter: cdk.Duration.days(30)
    });
    var writerNode = hydrocarbonProductionDb.node.findChild('writer').node.defaultChild;
    //Create a dedicated security group for database access
    var dbAccessSecurityGroup = new aws_cdk_lib_1.aws_ec2.SecurityGroup(scope, 'DbAccessSecurityGroup', {
        vpc: props.vpc,
        description: 'Security group for RDS database access',
        allowAllOutbound: false
    });
    // Add specific egress rule for database access only
    dbAccessSecurityGroup.addEgressRule(aws_cdk_lib_1.aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock), aws_cdk_lib_1.aws_ec2.Port.tcp(5432), 'Allow outbound traffic to database within VPC only');
    // Add specific egress rule for S3 access
    dbAccessSecurityGroup.addEgressRule(aws_cdk_lib_1.aws_ec2.Peer.ipv4('0.0.0.0/0'), aws_cdk_lib_1.aws_ec2.Port.tcp(443), 'Allow outbound HTTPS for S3 access');
    //Allow only specific inbound traffic on the database port
    hydrocarbonProductionDb.connections.allowFrom(dbAccessSecurityGroup, aws_cdk_lib_1.aws_ec2.Port.tcp(5432), 'Allow access from applications');
    // Create VPC endpoints for AWS services to minimize public internet exposure
    var s3Endpoint = new aws_cdk_lib_1.aws_ec2.GatewayVpcEndpoint(scope, 'S3Endpoint', {
        vpc: props.vpc,
        service: aws_cdk_lib_1.aws_ec2.GatewayVpcEndpointAwsService.S3
    });
    var secretsManagerEndpoint = new aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpoint(scope, 'SecretsManagerEndpoint', {
        vpc: props.vpc,
        service: aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        privateDnsEnabled: true,
        subnets: {
            subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
    });
    var athenaEndpoint = new aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpoint(scope, 'AthenaEndpoint', {
        vpc: props.vpc,
        service: aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpointAwsService.ATHENA,
        privateDnsEnabled: true,
        subnets: {
            subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
    });
    var lambdaEndpoint = new aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpoint(scope, 'LambdaEndpoint', {
        vpc: props.vpc,
        service: aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpointAwsService.LAMBDA,
        privateDnsEnabled: true,
        subnets: {
            subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
    });
    // Allow the security group to access the VPC endpoints
    secretsManagerEndpoint.connections.allowFrom(dbAccessSecurityGroup, aws_cdk_lib_1.aws_ec2.Port.tcp(443));
    athenaEndpoint.connections.allowFrom(dbAccessSecurityGroup, aws_cdk_lib_1.aws_ec2.Port.tcp(443));
    lambdaEndpoint.connections.allowFrom(dbAccessSecurityGroup, aws_cdk_lib_1.aws_ec2.Port.tcp(443));
    var athenaWorkgroup = new aws_cdk_lib_1.aws_athena.CfnWorkGroup(scope, 'FedQueryWorkgroup', {
        name: "".concat(stackName, "-fed_query_workgroup").slice(-64),
        description: 'Workgroup for querying federated data sources',
        recursiveDeleteOption: true,
        workGroupConfiguration: {
            resultConfiguration: {
                outputLocation: "s3://".concat(props.s3Bucket.bucketName, "/athena_query_results/"),
            },
        },
    });
    //Add policies to call the work gorup in the lambdaLlmAgentRole
    (0, cdkUtils_1.addLlmAgentPolicies)({
        role: lambdaLlmAgentRole,
        rootStack: rootStack,
        athenaWorkgroup: athenaWorkgroup,
        s3Bucket: props.s3Bucket
    });
    // Create the Postgres JDBC connector for Amazon Athena Federated Queries
    var jdbcConnectionString = "postgres://jdbc:postgresql://".concat(hydrocarbonProductionDb.clusterEndpoint.socketAddress, "/").concat(defaultProdDatabaseName, "?MetadataRetrievalMethod=ProxyAPI&${").concat((_b = hydrocarbonProductionDb.secret) === null || _b === void 0 ? void 0 : _b.secretName, "}");
    var postgressConnectorLambdaFunctionName = "query-postgres-".concat(stackUUID);
    new cdk.CfnOutput(scope, "ProdDbPostgresConnectorInputs", {
        value: (0, yaml_1.stringify)({
            DefaultConnectionString: jdbcConnectionString,
            LambdaFunctionName: postgressConnectorLambdaFunctionName,
            SecretNamePrefix: "A4E",
            SpillBucket: props.s3Bucket.bucketName,
            SpillPrefix: "athena-spill/".concat(rootStack.stackName),
            SecurityGroupIds: dbAccessSecurityGroup.securityGroupId,
            SubnetIds: props.vpc.privateSubnets.map(function (subnet) { return subnet.subnetId; }).join(',')
        })
    });
    // console.log("postgressConnectorLambdaFunctionName: ", postgressConnectorLambdaFunctionName)
    // const prodDbPostgresConnector = new CfnApplication(scope, 'ProdDbPostgresConnector', {
    //     location: {
    //         applicationId: `arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaPostgreSQLConnector`,
    //         semanticVersion: `2024.39.1`
    //     },
    //     parameters: {
    //         DefaultConnectionString: jdbcConnectionString,
    //         LambdaFunctionName: postgressConnectorLambdaFunctionName,
    //         SecretNamePrefix: `A4E`,
    //         SpillBucket: props.s3Bucket.bucketName,
    //         SpillPrefix: `athena-spill/${rootStack.stackName}`,
    //         SecurityGroupIds: props.vpc.vpcDefaultSecurityGroup,
    //         SubnetIds: props.vpc.privateSubnets.map(subnet => subnet.subnetId).join(',')
    //     }
    // });
    // //Create an athena datasource for postgres databases
    // const athenaPostgresCatalog = new athena.CfnDataCatalog(scope, 'PostgresAthenaDataSource', {
    //     name: `postgres_sample_${stackUUID}`.toLowerCase(),
    //     type: 'LAMBDA',
    //     description: 'Athena data source for postgres',
    //     parameters: {
    //         'function': `arn:aws:lambda:${rootStack.region}:${rootStack.account}:function:${postgressConnectorLambdaFunctionName}`
    //         // 'function': `arn:aws:lambda:${rootStack.region}:${rootStack.account}:function:${jdbcConnectorConfig.functionName}`
    //     },
    // });
    var sqlTableDefBedrockKnowledgeBase = new bedrockKnowledgeBase_1.AuroraBedrockKnowledgeBase(scope, "TableDefinition", {
        vpc: props.vpc,
        bucket: props.s3Bucket,
        schemaName: 'bedrock_integration'
    });
    var productionAgentTableDefDataSource = new aws_cdk_lib_1.aws_bedrock.CfnDataSource(scope, 'sqlTableDefinitions', {
        name: "sqlTableDefinition",
        dataSourceConfiguration: {
            type: 'S3',
            s3Configuration: {
                bucketArn: props.s3Bucket.bucketArn,
                inclusionPrefixes: ['production-agent/table-definitions/']
            },
        },
        vectorIngestionConfiguration: {
            chunkingConfiguration: {
                chunkingStrategy: 'NONE' // This sets the whole file as a single chunk
            }
        },
        knowledgeBaseId: sqlTableDefBedrockKnowledgeBase.knowledgeBase.attrKnowledgeBaseId
    });
    // const petroleumEngineeringKnowledgeBase = new AuroraBedrockKnowledgeBase(scope, "PetrolumEngineeringKB", {
    //     vpc: props.vpc,
    //     bucket: props.s3Bucket,
    //     schemaName: 'petroleum_kb',
    //     vectorStorePostgresCluster: sqlTableDefBedrockKnowledgeBase.vectorStorePostgresCluster
    // })
    // const PetroWikiKnowledgeBase = new BedrockKnowledgeBaseOSS(scope, 'PetroWikiKnowledgeBase', {
    //     knowledgeBaseName: "petrowiki"
    // })
    var petroleumEngineeringKnowledgeBase = new generative_ai_cdk_constructs_1.bedrock.KnowledgeBase(scope, "PetroleumKB", {
        embeddingsModel: generative_ai_cdk_constructs_1.bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: "You are a helpful question answering assistant. You answer\n        user questions factually and honestly related to petroleum engineering data",
        description: 'Petroleum Engineering Knowledge Base',
    });
    var petroleumEngineeringDataSource = petroleumEngineeringKnowledgeBase.addWebCrawlerDataSource({
        sourceUrls: ['https://petrowiki.spe.org/'],
        filters: {
            excludePatterns: ['https://petrowiki\.spe\.org/.+?/.+'] //Exclude pages with additional path segments
        },
        dataDeletionPolicy: generative_ai_cdk_constructs_1.bedrock.DataDeletionPolicy.RETAIN,
        chunkingStrategy: generative_ai_cdk_constructs_1.bedrock.ChunkingStrategy.HIERARCHICAL_TITAN
    });
    new aws_cdk_lib_1.custom_resources.AwsCustomResource(scope, 'StartIngestionPetroleumEngineeringDataSource', {
        onCreate: {
            service: '@aws-sdk/client-bedrock-agent',
            action: 'startIngestionJob',
            parameters: {
                dataSourceId: petroleumEngineeringDataSource.dataSourceId,
                knowledgeBaseId: petroleumEngineeringKnowledgeBase.knowledgeBaseId
            },
            physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.fromResponse('ingestionJob.ingestionJobId')
        },
        onDelete: {
            service: '@aws-sdk/client-bedrock-agent',
            action: 'stopIngestionJob',
            parameters: {
                dataSourceId: petroleumEngineeringDataSource.dataSourceId,
                knowledgeBaseId: petroleumEngineeringKnowledgeBase.knowledgeBaseId,
                ingestionJobId: new aws_cdk_lib_1.custom_resources.PhysicalResourceIdReference()
            },
            ignoreErrorCodesMatching: ".*" //The delete operation should always succeed. If ingestion job is already complete, stopping it will throw an error. That error will be ignored.
        },
        policy: aws_cdk_lib_1.custom_resources.AwsCustomResourcePolicy.fromStatements([
            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                actions: ['bedrock:startIngestionJob', 'bedrock:stopIngestionJob'],
                resources: [petroleumEngineeringKnowledgeBase.knowledgeBaseArn]
            })
        ])
    });
    lambdaLlmAgentRole.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ["bedrock:StartIngestionJob"],
        resources: [sqlTableDefBedrockKnowledgeBase.knowledgeBase.attrKnowledgeBaseArn]
    }));
    // Create a Glue Database
    var productionGlueDatabase = new aws_cdk_lib_1.aws_glue.CfnDatabase(scope, 'ProdGlueDb', {
        catalogId: rootStack.account,
        databaseName: "production_db_".concat(stackUUID),
        databaseInput: {
            name: "production_db_".concat(stackUUID),
            description: 'Database for storing additional information for the production agent'
        }
    });
    // Create IAM role for the Glue crawler
    var crawlerRole = new aws_cdk_lib_1.aws_iam.Role(scope, 'GlueCrawlerRole', {
        assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('glue.amazonaws.com'),
        managedPolicies: [
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
        ],
        inlinePolicies: {
            'GetListS3': new aws_cdk_lib_1.aws_iam.PolicyDocument({
                statements: [
                    new aws_cdk_lib_1.aws_iam.PolicyStatement({
                        actions: ['s3:GetObject', 's3:ListBucket'],
                        resources: [
                            props.s3Bucket.bucketArn,
                            props.s3Bucket.arnForObjects("*")
                        ],
                    })
                ]
            })
        }
    });
    // Create a Glue crawler
    var crawler = new aws_cdk_lib_1.aws_glue.CfnCrawler(scope, 'GlueCrawler', {
        role: crawlerRole.roleArn,
        databaseName: productionGlueDatabase.ref,
        targets: {
            s3Targets: [
                {
                    path: "s3://".concat(props.s3Bucket.bucketName, "/production-agent/structured-data-files/"),
                    exclusions: ['**DS_Store']
                },
            ],
        },
        tablePrefix: 'crawler_',
    });
    ////////////////////////////////////////////////////////////
    /////////////////// Configuration Assets ///////////////////
    ////////////////////////////////////////////////////////////
    var configureProdDbFunction = new aws_lambda_nodejs_1.NodejsFunction(scope, 'configureProdDbFunction', {
        runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_LATEST,
        entry: path_1.default.join(__dirname, '..', '..', 'functions', 'configureProdDb', 'index.ts'),
        timeout: cdk.Duration.seconds(300),
        vpc: props.vpc,
        securityGroups: [dbAccessSecurityGroup],
        vpcSubnets: {
            subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        logRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
        environment: {
            CLUSTER_ARN: hydrocarbonProductionDb.clusterArn,
            SECRET_ARN: hydrocarbonProductionDb.secret.secretArn,
            DATABASE_NAME: defaultProdDatabaseName,
            ATHENA_WORKGROUP_NAME: athenaWorkgroup.name,
            S3_BUCKET_NAME: props.s3Bucket.bucketName,
            // ATHENA_SAMPLE_DATA_SOURCE_NAME: athenaPostgresCatalog.name,
            TABLE_DEF_KB_ID: sqlTableDefBedrockKnowledgeBase.knowledgeBase.attrKnowledgeBaseId,
            TABLE_DEF_KB_DS_ID: productionAgentTableDefDataSource.attrDataSourceId,
        },
    });
    configureProdDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'rds-data:ExecuteStatement',
        ],
        resources: ["arn:aws:rds:".concat(rootStack.region, ":").concat(rootStack.account, ":*")],
        conditions: {
            'StringEquals': {
                'aws:ResourceTag/rootStackName': rootStack.stackName
            }
        }
    }));
    configureProdDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'secretsmanager:GetSecretValue',
        ],
        resources: ["arn:aws:secretsmanager:".concat(rootStack.region, ":").concat(rootStack.account, ":secret:*")],
        conditions: {
            'StringEquals': {
                'aws:ResourceTag/rootStackName': rootStack.stackName
            }
        }
    }));
    (0, cdkUtils_1.addLlmAgentPolicies)({
        role: configureProdDbFunction.role,
        rootStack: rootStack,
        athenaWorkgroup: athenaWorkgroup,
        s3Bucket: props.s3Bucket
    });
    configureProdDbFunction.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ['bedrock:startIngestionJob'],
        resources: [sqlTableDefBedrockKnowledgeBase.knowledgeBase.attrKnowledgeBaseArn],
    }));
    // Create a Custom Resource that invokes only if the dependencies change
    var invokeConfigureProdDbFunctionServiceCall = {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
            FunctionName: configureProdDbFunction.functionName,
            Payload: JSON.stringify({}), // No need to pass an event
            InvocationType: 'Event', // Call the lambda funciton asynchronously
        },
        physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.of('SqlExecutionResource'),
    };
    var prodDbConfigurator = new aws_cdk_lib_1.custom_resources.AwsCustomResource(scope, "configureProdDbAndExportTableInfo-".concat(props.s3Deployment.node.id), {
        onCreate: invokeConfigureProdDbFunctionServiceCall,
        onUpdate: invokeConfigureProdDbFunctionServiceCall,
        policy: aws_cdk_lib_1.custom_resources.AwsCustomResourcePolicy.fromStatements([
            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                actions: ['lambda:InvokeFunction'],
                resources: [configureProdDbFunction.functionArn],
            }),
        ]),
    });
    prodDbConfigurator.node.addDependency(writerNode);
    prodDbConfigurator.node.addDependency(props.s3Deployment.deployedBucket); //Make sure the bucket deployment is finished before writing to the bucket
    // Start the knowledge base ingestion job
    //// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/BedrockAgent.html#startIngestionJob-property
    var startIngestionJobResourceCall = {
        service: '@aws-sdk/client-bedrock-agent',
        action: 'startIngestionJob',
        parameters: {
            dataSourceId: productionAgentTableDefDataSource.attrDataSourceId,
            knowledgeBaseId: sqlTableDefBedrockKnowledgeBase.knowledgeBase.attrKnowledgeBaseId,
        },
        physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.of('startKbIngestion'),
        // If the call fails, ignore the error and continue
        ignoreErrorCodesMatching: '.*'
    };
    var prodTableKbIngestionJobTrigger = new aws_cdk_lib_1.custom_resources.AwsCustomResource(scope, "startKbIngestion1", {
        onCreate: startIngestionJobResourceCall,
        // onUpdate: startIngestionJobResourceCall,
        policy: aws_cdk_lib_1.custom_resources.AwsCustomResourcePolicy.fromStatements([
            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                actions: ['bedrock:startIngestionJob'],
                resources: [sqlTableDefBedrockKnowledgeBase.knowledgeBase.attrKnowledgeBaseArn],
            }),
        ]),
    });
    // prodTableKbIngestionJobTrigger.node.addDependency(productionAgentTableDefDataSource)
    prodTableKbIngestionJobTrigger.node.addDependency(prodDbConfigurator);
    //This function will get table definitions from any athena data source with the AgentsForEnergy tag, upload them to s3, and start a knoledge base ingestion job to present them to an agent 
    var recordTableDefAndStarkKBIngestionJob = new aws_lambda_nodejs_1.NodejsFunction(scope, 'RecordTableDefAndStartKbIngestionJob', {
        runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_20_X,
        entry: path_1.default.join(__dirname, '..', '..', 'functions', 'recordTableDefAndStartKBIngestion', 'index.ts'),
        bundling: {
            format: aws_lambda_nodejs_1.OutputFormat.CJS,
            loader: {
                '.node': 'file',
            },
            bundleAwsSDK: true,
            minify: true,
            sourceMap: true,
        },
        timeout: cdk.Duration.minutes(15),
        role: lambdaLlmAgentRole,
        vpc: props.vpc,
        securityGroups: [dbAccessSecurityGroup],
        vpcSubnets: {
            subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        logRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
        environment: {
            ATHENA_WORKGROUP_NAME: athenaWorkgroup.name,
            S3_BUCKET_NAME: props.s3Bucket.bucketName,
            TABLE_DEF_KB_ID: sqlTableDefBedrockKnowledgeBase.knowledgeBase.attrKnowledgeBaseId,
            TABLE_DEF_KB_DS_ID: productionAgentTableDefDataSource.attrDataSourceId,
            PROD_GLUE_DB_NAME: productionGlueDatabase.ref
        }
    });
    // recordTableDefAndStarkKBIngestionJob.addTest
    // // Trigger the recordTableDefAndStarkKBIngestionJob on the sample data source
    // new cr.AwsCustomResource(scope, `RecordAndIngestSampleData`, {
    //   onCreate: {
    //     service: 'Lambda',
    //     action: 'invoke',
    //     parameters: {
    //       FunctionName: recordTableDefAndStarkKBIngestionJob.functionName,
    //       Payload: JSON.stringify({}), // No need to pass SQL here
    //     },
    //     physicalResourceId: cr.PhysicalResourceId.of('SqlExecutionResource'),
    //   },
    //   policy: cr.AwsCustomResourcePolicy.fromStatements([
    //     new iam.PolicyStatement({
    //       actions: ['lambda:InvokeFunction'],
    //       resources: [recordTableDefAndStarkKBIngestionJob.functionArn],
    //     }),
    //   ]),
    // });
    // // Add dependency to ensure database is created before crawler
    // crawler.addDependency(productionGlueDatabase);
    // // Create the EventBridge rule
    // const newGlueTableRule = new events.Rule(scope, 'GlueTableCreationRule', {
    //     eventPattern: {
    //         source: ['aws.glue'],
    //         detailType: ['AWS API Call via CloudTrail'],
    //         detail: {
    //             eventSource: ['glue.amazonaws.com'],
    //             eventName: ['CreateTable'],
    //             requestParameters: {
    //                 databaseName: [productionGlueDatabase.ref], // Replace with your Glue database name
    //             },
    //         },
    //     },
    // });
    // Now we'll create assets which update the table definition knoledge base when an athena data source is updated
    var athenaDataSourceRule = new aws_cdk_lib_1.aws_events.Rule(scope, 'AthenaDataSourceRule', {
        eventPattern: {
            source: ['aws.athena'],
            detailType: ['AWS API Call via CloudTrail'],
            detail: {
                eventSource: ['athena.amazonaws.com'],
                eventName: [
                    'CreateDataCatalog',
                    'UpdateDataCatalog',
                    'TagResource',
                    'UntagResource',
                ],
                // You can add additional filters in the detail section if needed
                requestParameters: {
                    tags: {
                        'AgentsForEnergy': ['true']
                    }
                }
            }
        }
    });
    recordTableDefAndStarkKBIngestionJob.addPermission('EventBridgeInvoke', {
        principal: new aws_cdk_lib_1.aws_iam.ServicePrincipal('events.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: athenaDataSourceRule.ruleArn,
    });
    // Add targets for both the new athena data source rule, and the new glue table rule
    athenaDataSourceRule.addTarget(new aws_cdk_lib_1.aws_events_targets.LambdaFunction(recordTableDefAndStarkKBIngestionJob));
    // newGlueTableRule.addTarget(new eventsTargets.LambdaFunction(recordTableDefAndStarkKBIngestionJob));
    // This step function will invoke the glue crawler, wait until in completes, and then call the recordTableDefAndStarkKBIngestionJob function to load the table defs into the kb
    // Create Step Function tasks
    var startCrawler = new aws_cdk_lib_1.aws_stepfunctions_tasks.GlueStartCrawlerRun(scope, 'Start Crawler', {
        crawlerName: crawler.ref,
        integrationPattern: aws_cdk_lib_1.aws_stepfunctions.IntegrationPattern.REQUEST_RESPONSE
    });
    var checkCrawlerStatus = new aws_cdk_lib_1.aws_stepfunctions_tasks.CallAwsService(scope, 'Get Crawler Status', {
        service: 'glue',
        action: 'getCrawler',
        parameters: {
            Name: crawler.ref
        },
        iamResources: ["arn:aws:glue:".concat(rootStack.region, ":").concat(rootStack.account, ":crawler/").concat(crawler.ref)]
    });
    var waitX = new aws_cdk_lib_1.aws_stepfunctions.Wait(scope, 'Wait 10 Seconds', {
        time: aws_cdk_lib_1.aws_stepfunctions.WaitTime.duration(cdk.Duration.seconds(10)),
    });
    var invokeLambda = new aws_cdk_lib_1.aws_stepfunctions_tasks.LambdaInvoke(scope, 'Invoke Lambda', {
        lambdaFunction: recordTableDefAndStarkKBIngestionJob,
        outputPath: '$.Payload',
    });
    // Create a Choice state to check crawler status
    var isCrawlerComplete = new aws_cdk_lib_1.aws_stepfunctions.Choice(scope, 'Is Crawler Complete?')
        .when(aws_cdk_lib_1.aws_stepfunctions.Condition.stringEquals('$.Crawler.State', 'READY'), invokeLambda)
        .otherwise(waitX);
    // Create the state machine
    var definition = startCrawler
        .next(checkCrawlerStatus)
        .next(isCrawlerComplete);
    waitX.next(checkCrawlerStatus);
    var runCrawlerRecordTableDefintionStateMachine = new aws_cdk_lib_1.aws_stepfunctions.StateMachine(scope, 'CrawlerStateMachine', {
        definition: definition,
        timeout: cdk.Duration.minutes(30),
        tracingEnabled: true,
        logs: {
            destination: new aws_cdk_lib_1.aws_logs.LogGroup(scope, 'CrawlerStateMachineLogs', {
                logGroupName: "/aws/vendedlogs/states/".concat(rootStack.stackName, "-CrawlerStateMachineLogs-").concat(stackUUID),
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
            }),
            level: aws_cdk_lib_1.aws_stepfunctions.LogLevel.ALL,
        },
    });
    recordTableDefAndStarkKBIngestionJob.grantInvoke(runCrawlerRecordTableDefintionStateMachine);
    var invokeStepFunctionSDKCall = {
        service: 'StepFunctions',
        action: 'startExecution',
        parameters: {
            stateMachineArn: runCrawlerRecordTableDefintionStateMachine.stateMachineArn,
            input: JSON.stringify({
                action: 'create',
                s3DeploymentBucket: props.s3Deployment.deployedBucket.bucketName
            }),
        },
        physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.of('StepFunctionExecution'),
    };
    // Create a Custom Resource that invokes the Step Function
    var crawlerTriggerCustomResource = new aws_cdk_lib_1.custom_resources.AwsCustomResource(scope, "TriggerCrawler-".concat(props.s3Deployment.node.id), {
        onCreate: invokeStepFunctionSDKCall,
        policy: aws_cdk_lib_1.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
            resources: [runCrawlerRecordTableDefintionStateMachine.stateMachineArn],
        }),
    });
    //Make sure the bucket deployment finishs before 
    crawlerTriggerCustomResource.node.addDependency(props.s3Deployment.deployedBucket);
    // Create a Lambda function that will start the Step Function
    var triggerCrawlerSfnFunction = new aws_cdk_lib_1.aws_lambda.Function(scope, "TriggerCrawlerSfnFunction", {
        runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_LATEST,
        handler: 'index.handler',
        code: aws_cdk_lib_1.aws_lambda.Code.fromInline("\n            const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');\n\n            const stepfunctions = new SFNClient(); // Specify the region\n\n            exports.handler = async (event) => {\n                const params = {\n                    stateMachineArn: '".concat(runCrawlerRecordTableDefintionStateMachine.stateMachineArn, "',\n                    input: JSON.stringify(event)\n                };\n                \n                const command = new StartExecutionCommand(params);\n                await stepfunctions.send(command);\n            };\n            \n            ")),
    });
    runCrawlerRecordTableDefintionStateMachine.grantStartExecution(triggerCrawlerSfnFunction);
    wellFileDriveBucket.addEventNotification(aws_cdk_lib_1.aws_s3.EventType.OBJECT_CREATED, // Triggers on file upload
    new aws_cdk_lib_1.aws_s3_notifications.LambdaDestination(triggerCrawlerSfnFunction), {
        prefix: 'production-agent/structured-data-files/', // Only trigger for files in this prefix
    });
    return {
        convertPdfToYamlFunction: convertPdfToYamlFunction,
        triggerCrawlerSfnFunction: triggerCrawlerSfnFunction,
        pdfProcessingQueue: pdfProcessingQueue,
        wellFileDriveBucket: wellFileDriveBucket,
        defaultProdDatabaseName: defaultProdDatabaseName,
        hydrocarbonProductionDb: hydrocarbonProductionDb,
        sqlTableDefBedrockKnowledgeBase: sqlTableDefBedrockKnowledgeBase,
        petroleumEngineeringKnowledgeBase: petroleumEngineeringKnowledgeBase,
        athenaWorkgroup: athenaWorkgroup,
        // athenaPostgresCatalog: athenaPostgresCatalog
    };
}
