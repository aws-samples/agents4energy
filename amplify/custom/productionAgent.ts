
import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';

import path from 'path';
import { fileURLToPath } from 'url';
import { CfnApplication } from 'aws-cdk-lib/aws-sam';

interface ProductionAgentProps {
    s3BucketName: string,
}

export function productionAgentBuilder(scope: Construct, props: ProductionAgentProps) {

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
                            `arn:aws:s3:::${props.s3BucketName}/*`
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
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
            'DATA_BUCKET_NAME': props.s3BucketName,
            // 'MODEL_ID': 'anthropic.claude-3-sonnet-20240229-v1:0',
            'MODEL_ID': 'anthropic.claude-3-haiku-20240307-v1:0',
        },
        layers: [imageMagickLayer, ghostScriptLayer]
    });

    const convertPdfToYAMLFunction = new NodejsFunction(scope, 'ConvertPdfToImageFunction', {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '..', 'functions', 'convertPdfToYAML', 'index.ts'),
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
            'DATA_BUCKET_NAME': props.s3BucketName,
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
                    Bucket: props.s3BucketName,
                    Prefix: sfn.JsonPath.stringAt('$.s3Prefix'),

                },
                iamAction: 's3:ListBucket',
                iamResources: [
                    `arn:aws:s3:::${props.s3BucketName}`,
                    `arn:aws:s3:::${props.s3BucketName}/*`
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

    return {
        queryImagesStateMachineArn: queryImagesStateMachine.stateMachineArn,
        imageMagickLayer: imageMagickLayer,
        ghostScriptLayer: ghostScriptLayer,
        getInfoFromPdfFunction: queryReportImageLambda,
        convertPdfToYAMLFunction: convertPdfToYAMLFunction
    };
}