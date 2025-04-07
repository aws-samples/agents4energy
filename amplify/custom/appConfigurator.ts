import { Construct } from 'constructs';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { aws_s3_deployment as s3deploy } from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { aws_ssm as ssm } from 'aws-cdk-lib';
import { aws_lambda as lambda } from 'aws-cdk-lib';
import { aws_glue as glue } from 'aws-cdk-lib';
import { aws_athena as athena } from 'aws-cdk-lib';
import { aws_rds as rds } from 'aws-cdk-lib';
import { aws_secretsmanager as secretsmanager } from 'aws-cdk-lib';
import { aws_stepfunctions as sfn } from 'aws-cdk-lib';
import { aws_stepfunctions_tasks as tasks } from 'aws-cdk-lib';
import { aws_logs as logs } from 'aws-cdk-lib';
import { aws_events as events } from 'aws-cdk-lib';
import { aws_events_targets as targets } from 'aws-cdk-lib';
import { aws_lambda_event_sources as eventsources } from 'aws-cdk-lib';
import { aws_dynamodb as dynamodb } from 'aws-cdk-lib';
import { aws_cloudwatch as cloudwatch } from 'aws-cdk-lib';
import { aws_cloudwatch_actions as cloudwatch_actions } from 'aws-cdk-lib';
import { aws_sns as sns } from 'aws-cdk-lib';
import { aws_sns_subscriptions as subscriptions } from 'aws-cdk-lib';
import { aws_sqs as sqs } from 'aws-cdk-lib';
import { aws_kms as kms } from 'aws-cdk-lib';
import { aws_cognito as cognito } from 'aws-cdk-lib';
import { aws_apigateway as apigateway } from 'aws-cdk-lib';
import { aws_appsync as appsync } from 'aws-cdk-lib';
import { aws_route53 as route53 } from 'aws-cdk-lib';
import { aws_route53_targets as route53_targets } from 'aws-cdk-lib';
import { aws_certificatemanager as acm } from 'aws-cdk-lib';
import { aws_cloudfront as cloudfront } from 'aws-cdk-lib';
import { aws_cloudfront_origins as origins } from 'aws-cdk-lib';
import { aws_wafv2 as wafv2 } from 'aws-cdk-lib';
import { aws_elasticloadbalancingv2 as elbv2 } from 'aws-cdk-lib';
import { aws_elasticloadbalancingv2_targets as elbv2_targets } from 'aws-cdk-lib';
import { aws_autoscaling as autoscaling } from 'aws-cdk-lib';
import { aws_ecs as ecs } from 'aws-cdk-lib';
import { aws_ecr as ecr } from 'aws-cdk-lib';
import { aws_ecr_assets as ecr_assets } from 'aws-cdk-lib';
import { aws_efs as efs } from 'aws-cdk-lib';
import { aws_eks as eks } from 'aws-cdk-lib';
import { aws_elasticache as elasticache } from 'aws-cdk-lib';
import { aws_elasticsearch as elasticsearch } from 'aws-cdk-lib';
import { aws_kinesis as kinesis } from 'aws-cdk-lib';
import { aws_kinesisfirehose as firehose } from 'aws-cdk-lib';
import { aws_kinesisanalytics as kinesisanalytics } from 'aws-cdk-lib';
import { aws_msk as msk } from 'aws-cdk-lib';
import { aws_neptune as neptune } from 'aws-cdk-lib';
import { aws_opensearchservice as opensearch } from 'aws-cdk-lib';
import { aws_redshift as redshift } from 'aws-cdk-lib';
import { aws_sagemaker as sagemaker } from 'aws-cdk-lib';
import { aws_servicediscovery as servicediscovery } from 'aws-cdk-lib';
import { aws_transfer as transfer } from 'aws-cdk-lib';
import { aws_waf as waf } from 'aws-cdk-lib';
import { aws_wafregional as wafregional } from 'aws-cdk-lib';
import { aws_workspaces as workspaces } from 'aws-cdk-lib';
import { aws_xray as xray } from 'aws-cdk-lib';
import { aws_amplify as amplify } from 'aws-cdk-lib';
import { aws_apigatewayv2 as apigatewayv2 } from 'aws-cdk-lib';
import { aws_apigatewayv2_integrations as apigatewayv2_integrations } from 'aws-cdk-lib';
import { aws_apprunner as apprunner } from 'aws-cdk-lib';
import { aws_appstream as appstream } from 'aws-cdk-lib';
import { aws_appsync as appsync } from 'aws-cdk-lib';
import { aws_batch as batch } from 'aws-cdk-lib';
import { aws_cassandra as cassandra } from 'aws-cdk-lib';
import { aws_codebuild as codebuild } from 'aws-cdk-lib';
import { aws_codecommit as codecommit } from 'aws-cdk-lib';
import { aws_codedeploy as codedeploy } from 'aws-cdk-lib';
import { aws_codepipeline as codepipeline } from 'aws-cdk-lib';
import { aws_codepipeline_actions as codepipeline_actions } from 'aws-cdk-lib';
import { aws_codestarconnections as codestarconnections } from 'aws-cdk-lib';
import { aws_codestarnotifications as codestarnotifications } from 'aws-cdk-lib';
import { aws_cognito as cognito } from 'aws-cdk-lib';
import { aws_docdb as docdb } from 'aws-cdk-lib';
import { aws_dynamodb_global as dynamodb_global } from '@aws-cdk/aws-dynamodb-global-alpha';
import { aws_gamelift as gamelift } from 'aws-cdk-lib';
import { aws_globalaccelerator as globalaccelerator } from 'aws-cdk-lib';
import { aws_globalaccelerator_endpoints as globalaccelerator_endpoints } from 'aws-cdk-lib';
import { aws_glue_alpha as glue_alpha } from '@aws-cdk/aws-glue-alpha';
import { aws_guardduty as guardduty } from 'aws-cdk-lib';
import { aws_iot as iot } from 'aws-cdk-lib';
import { aws_iot_actions as iot_actions } from 'aws-cdk-lib';
import { aws_iotevents as iotevents } from 'aws-cdk-lib';
import { aws_iotevents_actions as iotevents_actions } from 'aws-cdk-lib';
import { aws_iotsitewise as iotsitewise } from 'aws-cdk-lib';
import { aws_iotthingsgraph as iotthingsgraph } from 'aws-cdk-lib';
import { aws_ivs as ivs } from 'aws-cdk-lib';
import { aws_kendra as kendra } from 'aws-cdk-lib';
import { aws_lambda_destinations as lambda_destinations } from 'aws-cdk-lib';
import { aws_lambda_nodejs as lambda_nodejs } from 'aws-cdk-lib';
import { aws_lambda_python_alpha as lambda_python } from '@aws-cdk/aws-lambda-python-alpha';
import { aws_location as location } from 'aws-cdk-lib';
import { aws_logs_destinations as logs_destinations } from 'aws-cdk-lib';
import { aws_mediaconvert as mediaconvert } from 'aws-cdk-lib';
import { aws_mediastore as mediastore } from 'aws-cdk-lib';
import { aws_pinpoint as pinpoint } from 'aws-cdk-lib';
import { aws_pinpoint_email as pinpoint_email } from 'aws-cdk-lib';
import { aws_qldb as qldb } from 'aws-cdk-lib';
import { aws_ram as ram } from 'aws-cdk-lib';
import { aws_route53recoverycontrol as route53recoverycontrol } from 'aws-cdk-lib';
import { aws_route53recoveryreadiness as route53recoveryreadiness } from 'aws-cdk-lib';
import { aws_route53resolver as route53resolver } from 'aws-cdk-lib';
import { aws_s3objectlambda as s3objectlambda } from 'aws-cdk-lib';
import { aws_sam as sam } from 'aws-cdk-lib';
import { aws_scheduler as scheduler } from 'aws-cdk-lib';
import { aws_ses as ses } from 'aws-cdk-lib';
import { aws_ses_actions as ses_actions } from 'aws-cdk-lib';
import { aws_stepfunctions_tasks_alpha as tasks_alpha } from '@aws-cdk/aws-stepfunctions-tasks-alpha';
import { aws_timestream as timestream } from 'aws-cdk-lib';
import { aws_transfer as transfer_alpha } from '@aws-cdk/aws-transfer-alpha';
import { aws_wisdom as wisdom } from 'aws-cdk-lib';
import { aws_workspaces as workspaces_alpha } from '@aws-cdk/aws-workspaces-alpha';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';
import { bedrock as cdkLabsBedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { regulatoryAgentBuilder } from '../agents/regulatory/regulatoryAgent';
import { financeAgentBuilder } from '../agents/finance/financeAgent';
import { landAgentBuilder } from '../agents/land/landAgent';
import { safetyAgentBuilder } from '../agents/safety/safetyAgent';
import { drillingAgentBuilder } from '../agents/drilling/drillingAgent';
import { refiningAgentBuilder } from '../agents/refining/refiningAgent';
import { tradingAgentBuilder } from '../agents/trading/tradingAgent';
import { logisticsAgentBuilder } from '../agents/logistics/logisticsAgent';
import { decarbAgentBuilder } from '../agents/decarb/decarbAgent';

export function configureApp(scope: Construct) {
  // Create a VPC for the application
  const vpc = new ec2.Vpc(scope, 'AppVpc', {
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      {
        name: 'public',
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      },
      {
        name: 'private',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: 24,
      },
      {
        name: 'isolated',
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        cidrMask: 24,
      },
    ],
  });

  // Create an S3 bucket for the application
  const bucket = new s3.Bucket(scope, 'AppBucket', {
    versioned: true,
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: process.env.NODE_ENV === 'production' ? undefined : undefined,
  });

  // Deploy sample data to the S3 bucket
  const deployment = new s3deploy.BucketDeployment(scope, 'DeploySampleData', {
    sources: [s3deploy.Source.asset('./sampleData')],
    destinationBucket: bucket,
    retainOnDelete: false,
  });

  // Create agents
  const regulatoryAgent = regulatoryAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const financeAgent = financeAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const landAgent = landAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const safetyAgent = safetyAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const drillingAgent = drillingAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const refiningAgent = refiningAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const tradingAgent = tradingAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const logisticsAgent = logisticsAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  const decarbAgent = decarbAgentBuilder(scope, {
    vpc,
    s3Bucket: bucket,
    s3Deployment: deployment,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  });

  // Create a knowledge base for SQL table definitions
  const sqlTableDefBedrockKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, 'SqlTableDefKnowledgeBase', {
    embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
    instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to SQL table definitions.`,
    description: 'SQL Table Definition Knowledge Base',
  });

  // Add S3 data source for the SQL table definitions knowledge base
  const sqlTableDefS3DataSource = sqlTableDefBedrockKnowledgeBase.addS3DataSource({
    bucket: bucket,
    dataSourceName: "a4e-kb-ds-s3-sql-table-def",
    inclusionPrefixes: ['production-agent/table-definitions/'],
  });

  // Store the knowledge base ID in SSM parameter
  new ssm.StringParameter(scope, 'SqlTableDefKnowledgeBaseId', {
    parameterName: '/agents4energy/sqlTableDef/knowledgeBaseId',
    stringValue: sqlTableDefBedrockKnowledgeBase.knowledgeBaseId,
  });

  // Add outputs to the stack
  (scope as any).addOutput('sqlTableDefKnowledgeBaseId', {
    value: sqlTableDefBedrockKnowledgeBase.knowledgeBaseId,
  });

  // Return the resources
  return {
    vpc,
    bucket,
    deployment,
    regulatoryAgent,
    financeAgent,
    landAgent,
    safetyAgent,
    drillingAgent,
    refiningAgent,
    tradingAgent,
    logisticsAgent,
    decarbAgent,
    sqlTableDefBedrockKnowledgeBase,
  };
}

export interface AppConfiguratorProps {
  hydrocarbonProductionDb: cdk.aws_rds.ServerlessCluster | cdk.aws_rds.DatabaseCluster;
  defaultProdDatabaseName: string;
  athenaWorkgroup: cdk.aws_athena.CfnWorkGroup;
  // athenaPostgresCatalog: cdk.aws_athena.CfnDataCatalog
  s3Bucket: cdk.aws_s3.IBucket;
  preSignUpFunction: lambda.IFunction;
  cognitoUserPool: cdk.aws_cognito.IUserPool;
  appSyncApi: cdk.aws_appsync.IGraphqlApi;
  // sqlTableDefBedrockKnowledgeBase: bedrock.KnowledgeBase
}
}
