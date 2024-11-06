
import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib'
import {
    aws_bedrock as bedrock,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_stepfunctions as sfn,
    aws_stepfunctions_tasks as sfnTasks,
    aws_logs as logs,
    aws_athena as athena,
    aws_rds as rds,
    aws_ec2 as ec2,
    aws_s3 as s3,
    custom_resources as cr
} from 'aws-cdk-lib';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';


import { AuroraBedrockKnoledgeBase } from "../constructs/bedrockKnoledgeBase";

import { bedrock as cdkLabsBedrock } from "@cdklabs/generative-ai-cdk-constructs";

import path from 'path';
import { fileURLToPath } from 'url';
import { CfnApplication } from 'aws-cdk-lib/aws-sam';

const defaultProdDatabaseName = 'proddb'

interface ProductionAgentProps {
    vpc: ec2.Vpc,
    s3Bucket: s3.IBucket,
    
}

export function productionAgentBuilder(scope: Construct, props: ProductionAgentProps) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // const rootDir = path.resolve(__dirname, '..');

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')


    // Lambda function to apply a promp to a pdf file
    const queryReportsLambdaRole = new iam.Role(scope, 'LambdaExecutionRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
        inlinePolicies: {
            'BedrockInvocationPolicy': new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        actions: ["bedrock:InvokeModel"],
                        resources: [
                            `arn:aws:bedrock:${rootStack.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
                            `arn:aws:bedrock:${rootStack.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`
                        ],
                    }),
                    new iam.PolicyStatement({
                        actions: ["s3:GetObject"],
                        resources: [
                            `arn:aws:s3:::${props.s3Bucket.bucketName}/*`
                        ],
                    }),
                    new iam.PolicyStatement({
                        actions: ["s3:ListBucket"],
                        resources: [
                            `arn:aws:s3:::${props.s3Bucket.bucketName}`
                        ],
                    }),
                ]
            })
        }
    });

    // Import the ImageMagick Lambda Layer from the AWS SAM Application
    const imageMagickLayerStack = new CfnApplication(scope, 'ImageMagickLayer', {
        location: {
            applicationId: 'arn:aws:serverlessrepo:us-east-1:145266761615:applications/image-magick-lambda-layer',
            semanticVersion: '1.0.0',
        },
    });
    //Get outputs from the imageMagickLayer
    const imageMagickLayerArn = imageMagickLayerStack.getAtt('Outputs.LayerVersion').toString()

    // Convert the layer arn into an cdk.aws_lambda.ILayerVersion
    const imageMagickLayer = lambda.LayerVersion.fromLayerVersionArn(scope, 'ImageMagickLayerVersion', imageMagickLayerArn)

    const ghostScriptLayerStack = new CfnApplication(scope, 'GhostScriptLambdaLayer', {
        location: {
            applicationId: 'arn:aws:serverlessrepo:us-east-1:154387959412:applications/ghostscript-lambda-layer',
            semanticVersion: '9.27.0',
        },
    });
    const ghostScriptLayerArn = ghostScriptLayerStack.getAtt('Outputs.LayerVersion').toString()
    const ghostScriptLayer = lambda.LayerVersion.fromLayerVersionArn(scope, 'GhostScriptLayerVersion', ghostScriptLayerArn)

    // How AWS Amplify creates lambda functions: https://github.com/aws-amplify/amplify-backend/blob/d8692b0c96584fb699e892183ae68fe302740680/packages/backend-function/src/factory.ts#L368
    const queryReportImageLambda = new NodejsFunction(scope, 'QueryReportImagesTs', {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '..', 'functions', 'getInfoFromPdf', 'index.ts'),
        bundling: {
            format: OutputFormat.CJS,
            loader: {
                '.node': 'file',
            },
            bundleAwsSDK: true,
            minify: true,
            sourceMap: true,
        },
        timeout: cdk.Duration.minutes(15),
        memorySize: 3000,
        role: queryReportsLambdaRole,
        environment: {
            'DATA_BUCKET_NAME': props.s3Bucket.bucketName,
            // 'MODEL_ID': 'anthropic.claude-3-sonnet-20240229-v1:0',
            'MODEL_ID': 'anthropic.claude-3-haiku-20240307-v1:0',
        },
        layers: [imageMagickLayer, ghostScriptLayer]
    });

    const convertPdfToJsonFunction = new NodejsFunction(scope, 'ConvertPdfToJsonFunction', {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '..', 'functions', 'convertPdfToJson', 'index.ts'),
        bundling: {
            format: OutputFormat.CJS,
            loader: {
                '.node': 'file',
            },
            bundleAwsSDK: true,
            minify: true,
            sourceMap: true,
        },
        timeout: cdk.Duration.minutes(15),
        memorySize: 3000,
        role: queryReportsLambdaRole,
        environment: {
            'DATA_BUCKET_NAME': props.s3Bucket.bucketName,
        },
        layers: [imageMagickLayer, ghostScriptLayer]
    });

    // Create a Step Functions state machine
    const queryImagesStateMachine = new sfn.StateMachine(scope, 'QueryReportImagesStateMachine', {
        timeout: cdk.Duration.minutes(15),
        stateMachineType: sfn.StateMachineType.EXPRESS,
        logs: {
            destination: new logs.LogGroup(scope, 'StateMachineLogGroup', {
                logGroupName: `/aws/vendedlogs/states/${rootStack.stackName}/QueryReportImagesStateMachine`,
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }),
            level: sfn.LogLevel.ALL,
            includeExecutionData: true
        },
        tracingEnabled: true,
        definitionBody: sfn.DefinitionBody.fromChainable(
            new sfnTasks.CallAwsService(scope, 'List S3 Objects', {
                service: 's3',
                action: 'listObjectsV2',
                parameters: {
                    Bucket: props.s3Bucket.bucketName,
                    Prefix: sfn.JsonPath.stringAt('$.s3Prefix'),

                },
                iamAction: 's3:ListBucket',
                iamResources: [
                    `arn:aws:s3:::${props.s3Bucket.bucketName}`,
                    `arn:aws:s3:::${props.s3Bucket.bucketName}/*`
                ],
                resultPath: '$.s3Result',

            })
                .next(
                    new sfn.Map(scope, 'Map lambda to s3 keys', {
                        inputPath: '$.s3Result.Contents',
                        itemsPath: '$',
                        maxConcurrency: 200,
                        itemSelector: {
                            "arguments": {
                                "tableColumns.$": "$$.Execution.Input.tableColumns",
                                "dataToExclude.$": "$$.Execution.Input.dataToExclude",
                                "dataToInclude.$": "$$.Execution.Input.dataToInclude",
                                "s3Key.$": "$$.Map.Item.Value.Key",
                            }
                        },
                    })
                        .itemProcessor(new sfnTasks.LambdaInvoke(
                            scope, 'ProcessS3Object', {
                            lambdaFunction: queryReportImageLambda,
                            payloadResponseOnly: true,
                        }).addRetry({
                            maxAttempts: 10,
                            interval: cdk.Duration.seconds(1),
                            maxDelay: cdk.Duration.seconds(5),
                            errors: [
                                'ThrottlingException',
                                // 'ValidationException' //This one is rare, but can be triggered by a claude model returning: Output blocked by content filtering policy
                            ],
                            jitterStrategy: sfn.JitterType.FULL,
                        })
                        )
                )
                .next(new sfn.Succeed(scope, 'Succeed'))
        ),
    });

    //This serverless aurora cluster will store hydrocarbon production pressures and volume
    const hydrocarbonProductionDb = new rds.ServerlessCluster(scope, 'A4E-HydrocarbonProdDb', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_13_9,
        }),
        scaling: {
            autoPause: cdk.Duration.minutes(300), // default is to pause after 5 minutes
            minCapacity: rds.AuroraCapacityUnit.ACU_2, // minimum of 2 Aurora capacity units
            maxCapacity: rds.AuroraCapacityUnit.ACU_16, // maximum of 16 Aurora capacity units
        },
        enableDataApi: true,
        defaultDatabaseName: defaultProdDatabaseName, // optional: create a database named "mydb"
        // credentials: rds.Credentials.fromGeneratedSecret('clusteradmin', { // TODO: make a prefix for all a4e secrets
        //     secretName: `a4e-proddb-credentials`
        // }),
        vpc: props.vpc,
        vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // //Create an inbound rule for the db's security group which allows inbound traffic from the vpc
    // hydrocarbonProductionDb.connections.securityGroups[0].addIngressRule(
    //     ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
    //     ec2.Port.tcp(5432),
    //     'Allow inbound traffic from VPC'
    // );

    //Allow inbound traffic from the default SG in the VPC
    hydrocarbonProductionDb.connections.securityGroups[0].addIngressRule(
        ec2.Peer.securityGroupId(props.vpc.vpcDefaultSecurityGroup),
        ec2.Port.tcp(5432),
        'Allow inbound traffic from default SG'
    );

    const athenaWorkgroup = new athena.CfnWorkGroup(scope, 'FedQueryWorkgroup', {
        name: `${rootStack.stackName}-fed_query_workgroup`.slice(-64),
        description: 'Workgroup for querying federated data sources',
        recursiveDeleteOption: true,
        workGroupConfiguration: {
            resultConfiguration: {
                outputLocation: `s3://${props.s3Bucket.bucketName}/athena_query_results/`,
            },
        },
    });

    // Create the Postgres JDBC connector for Amazon Athena Federated Queries
    const jdbcConnectionString = `postgres://jdbc:postgresql://${hydrocarbonProductionDb.clusterEndpoint.socketAddress}/${defaultProdDatabaseName}?MetadataRetrievalMethod=ProxyAPI&\${${hydrocarbonProductionDb.secret?.secretName}}`
    const postgressConnectorLambdaFunctionName = `${rootStack.stackName}-query-postgres`.slice(-64)
    const prodDbPostgresConnector = new CfnApplication(scope, 'ProdDbPostgresConnector', {
        location: {
            applicationId: `arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaPostgreSQLConnector`,
            semanticVersion: `2024.39.1`
        },
        parameters: {
            DefaultConnectionString: jdbcConnectionString,
            LambdaFunctionName: postgressConnectorLambdaFunctionName,
            SecretNamePrefix: `A4E`,
            SpillBucket: props.s3Bucket.bucketName,
            SpillPrefix: `athena-spill/${rootStack.stackName}`,
            SecurityGroupIds: props.vpc.vpcDefaultSecurityGroup,
            SubnetIds: props.vpc.privateSubnets.map(subnet => subnet.subnetId).join(',')
        }
    });

    // // Get the Lambda function role
    // const functionRole = iam.Role.fromRoleName(scope, 'ConnectorRole', postgressConnectorLambdaFunctionName + '-role');


    //Create an athena datasource for postgres databases
    const athenaPostgresCatalog = new athena.CfnDataCatalog(scope, 'PostgresAthenaDataSource', {
        name: `postgres_sample_${rootStack.stackName.slice(-3)}`,
        type: 'LAMBDA',
        description: 'Athena data source for postgres',
        parameters: {
            'function': `arn:aws:lambda:${rootStack.region}:${rootStack.account}:function:${postgressConnectorLambdaFunctionName}`
        },
    });

    const sqlTableDefBedrockKnoledgeBase = new AuroraBedrockKnoledgeBase(scope, "SqlTableDefBedrockKnoledgeBase", {
        vpc: props.vpc,
        bucket: props.s3Bucket
    })

    const productionAgentTableDefDataSource = new bedrock.CfnDataSource(scope, 'sqlTableDefinitions', {
        name: "sqlTableDefinitions",
        dataSourceConfiguration: {
            type: 'S3',
            s3Configuration: {
                bucketArn: props.s3Bucket.bucketArn,
                inclusionPrefixes: ['production-agent/table-definitions/']
            }
        },
        knowledgeBaseId: sqlTableDefBedrockKnoledgeBase.knowledgeBase.attrKnowledgeBaseId
    })

    //////////////////////////////
    //// Configuration Assets ////
    //////////////////////////////

    //TODO - Maker sure this correctly loads the table deffs in s3
    const configureProdDbFunction = new NodejsFunction(scope, 'configureProdDbFunction', {
        runtime: lambda.Runtime.NODEJS_LATEST,
        entry: path.join(__dirname, '..', 'functions', 'configureProdDb', 'index.ts'),
        timeout: cdk.Duration.seconds(300),
        environment: {
            CLUSTER_ARN: hydrocarbonProductionDb.clusterArn,
            SECRET_ARN: hydrocarbonProductionDb.secret!.secretArn,
            DATABASE_NAME: defaultProdDatabaseName,
            ATHENA_WORKGROUP_NAME: athenaWorkgroup.name,
            ATHENA_CATALOG_NAME: athenaPostgresCatalog.name,
            S3_BUCKET_NAME: props.s3Bucket.bucketName,
            ATHENA_SAMPLE_DATA_SOURCE_NAME: athenaPostgresCatalog.name
        },
    });

    configureProdDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'rds-data:ExecuteStatement',
        ],
        resources: [`arn:aws:rds:${rootStack.region}:${rootStack.account}:*`],
        conditions: { //This only allows the configurator function to modify resources which are part of the app being deployed.
            'StringEquals': {
                'aws:ResourceTag/rootStackName': rootStack.stackName
            }
        }
    }))

    configureProdDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'secretsmanager:GetSecretValue',
        ],
        resources: [`arn:aws:secretsmanager:${rootStack.region}:${rootStack.account}:secret:*`],
        conditions: { //This only allows the configurator function to modify resources which are part of the app being deployed.
            'StringEquals': {
                'aws:ResourceTag/rootStackName': rootStack.stackName
            }
        }
    }))

    configureProdDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'athena:StartQueryExecution',
            'athena:GetQueryExecution',
            'athena:GetQueryResults',
            'athena:GetDataCatalog'
        ],
        resources: [`arn:aws:athena:${rootStack.region}:${rootStack.account}:*`],
        conditions: { //This only allows the configurator function to modify resources which are part of the app being deployed.
            'StringEquals': {
                'aws:ResourceTag/rootStackName': rootStack.stackName
            }
        }
    }))

    //Executing athena queries requires the caller have these permissions
    configureProdDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:ListMultipartUploadParts",
            "s3:AbortMultipartUpload",
            "s3:PutObject",
        ],
        resources: [
            props.s3Bucket.bucketArn,
            props.s3Bucket.arnForObjects("*")
        ],
    }))

    

    // Create a Custom Resource that invokes only if the dependencies change
    const invokeConfigureProdDbFunctionServiceCall: cr.AwsSdkCall = {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
            FunctionName: configureProdDbFunction.functionName,
            Payload: JSON.stringify({}), // No need to pass an event
            InvocationType: 'Event', // Call the lambda funciton asynchronously
        },
        physicalResourceId: cr.PhysicalResourceId.of('SqlExecutionResource'),
    }

    const prodDbConfigurator = new cr.AwsCustomResource(scope, `configureProdDbAndExportTableDefs`, {
        onCreate: invokeConfigureProdDbFunctionServiceCall,
        onUpdate: invokeConfigureProdDbFunctionServiceCall,
        policy: cr.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({
                actions: ['lambda:InvokeFunction'],
                resources: [configureProdDbFunction.functionArn],
            }),
        ]),
    });

    // Start the knowledge base ingestion job
    //// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/BedrockAgent.html#startIngestionJob-property
    const startIngestionJobResourceCall: cr.AwsSdkCall = {
        service: '@aws-sdk/client-bedrock-agent',
        action: 'startIngestionJob',
        parameters: {
            dataSourceId: productionAgentTableDefDataSource.attrDataSourceId,
            knowledgeBaseId: sqlTableDefBedrockKnoledgeBase.knowledgeBase.attrKnowledgeBaseId,
        },
        physicalResourceId: cr.PhysicalResourceId.of('startKbIngestion'),
    }

    const prodTableKbIngestionJobTrigger = new cr.AwsCustomResource(scope, `startKbIngestion`, {
        onCreate: startIngestionJobResourceCall,
        onUpdate: startIngestionJobResourceCall,
        policy: cr.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({
                actions: ['bedrock:startIngestionJob'],
                resources: [sqlTableDefBedrockKnoledgeBase.knowledgeBase.attrKnowledgeBaseArn],
            }),
        ]),
    });
    prodTableKbIngestionJobTrigger.node.addDependency(productionAgentTableDefDataSource)


    return {
        queryImagesStateMachineArn: queryImagesStateMachine.stateMachineArn,
        imageMagickLayer: imageMagickLayer,
        ghostScriptLayer: ghostScriptLayer,
        getInfoFromPdfFunction: queryReportImageLambda,
        convertPdfToJsonFunction: convertPdfToJsonFunction,
        defaultProdDatabaseName: defaultProdDatabaseName,
        hydrocarbonProductionDb: hydrocarbonProductionDb,
        sqlTableDefBedrockKnoledgeBase: sqlTableDefBedrockKnoledgeBase,
        athenaWorkgroup: athenaWorkgroup,
        athenaPostgresCatalog: athenaPostgresCatalog
    };
}