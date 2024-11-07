import path from 'path';
import { fileURLToPath } from 'url';

import {
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as sfn_tasks,
  aws_lambda as lambda,
  custom_resources as cr,
  aws_logs as logs,
} from 'aws-cdk-lib'

// import { Construct } from "@aws-cdk/core";
import * as cdk from 'aws-cdk-lib';
// import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
// import * as stepfunctions_tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
// import * as lambda from 'aws-cdk-lib/aws-lambda';
// import * as cloudformation from 'aws-cdk-lib/aws-cloudformation';
import { Construct } from 'constructs';
// import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
// import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
// import * as cr from 'aws-cdk-lib/custom-resources';
// import * as logs from 'aws-cdk-lib/aws-logs';
// import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
// import { bedrock } from '@cdklabs/generative-ai-cdk-constructs'

export interface AppConfiguratorProps {
  hydrocarbonProductionDb: cdk.aws_rds.ServerlessCluster | cdk.aws_rds.DatabaseCluster,
  defaultProdDatabaseName: string,
  athenaWorkgroup: cdk.aws_athena.CfnWorkGroup,
  athenaPostgresCatalog: cdk.aws_athena.CfnDataCatalog
  s3Bucket: cdk.aws_s3.IBucket
  preSignUpFunction: lambda.IFunction
  // sqlTableDefBedrockKnoledgeBase: bedrock.KnowledgeBase
}


export class AppConfigurator extends Construct {
  constructor(scope: Construct, id: string, props: AppConfiguratorProps) {
    super(scope, id);

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(__dirname, '..');

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    // This function and custom resource will update the GraphQL schema to allow for @aws_iam access to all resources 
    const addIamDirectiveFunction = new NodejsFunction(scope, 'addIamDirective', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(rootDir, 'functions', 'addIamDirectiveToAllAssets.ts'),
      timeout: cdk.Duration.seconds(60),
      environment: {
        ROOT_STACK_NAME: rootStack.stackName
      },
    });


    addIamDirectiveFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: [
        'appsync:ListGraphqlApis',
        'appsync:ListTagsForResource',
        'appsync:GetIntrospectionSchema',
        'appsync:StartSchemaCreation',
        'appsync:GetSchemaCreationStatus',
      ],
      resources: [`arn:aws:appsync:${rootStack.region}:${rootStack.account}:*`],
    }))

    // Define a step function which waits for the cloudformation stackk to complete before executing a configureation update
    const waitForCfnStack = new sfn_tasks.CallAwsService(this, 'WaitForCfnStack', {
      service: 'cloudformation',
      action: 'describeStacks',
      parameters: {
        StackName: rootStack.stackName,
      },
      iamResources: ['*'],
      resultPath: '$.StackStatus',
    });



    // This step will add the iam directive to the graphql schema
    const invokeAddIamDirectiveFunction = new sfn_tasks.LambdaInvoke(this, 'InvokeLambda', {
      lambdaFunction: addIamDirectiveFunction,
    })

    // // These steps will set up the pre-sign-up lambda trigger
    // // Step 1: List Cognito User Pools
    // const listUserPools = new sfn_tasks.CallAwsService(this, 'ListUserPools', {
    //   service: 'cognitoidentityserviceprovider',
    //   action: 'listUserPools',
    //   parameters: {
    //     MaxResults: 60,
    //   },
    //   iamResources: ['*'],
    // });

    // // Step 2: Find User Pool with tag
    // const findUserPool = new sfn.Map(this, 'FindUserPool', {
    //   maxConcurrency: 1,
    //   itemsPath: sfn.JsonPath.stringAt('$.UserPools'),
    // }).itemProcessor(new sfn.Choice(this, 'CheckUserPoolTag')
    //   .when(sfn.Condition.stringEquals('$.Tags[?(@.Key=="rootStackName")].Value[0]', rootStack.stackName),
    //     new sfn.Succeed(this, 'FoundUserPool'))
    //   .otherwise(new sfn.Fail(this, 'UserPoolNotFound'))
    // );

    // // Step 3: Update User Pool with pre-sign-up trigger
    // const updateUserPool = new sfn_tasks.CallAwsService(this, 'UpdateUserPool', {
    //   service: 'cognitoidentityserviceprovider',
    //   action: 'updateUserPool',
    //   parameters: {
    //     UserPoolId: sfn.JsonPath.stringAt('$.Id'),
    //     LambdaConfig: {
    //       PreSignUp: props.preSignUpFunction.functionArn,
    //     },
    //   },
    //   iamResources: ['*'],
    // });

    const checkStackStatus = new sfn.Choice(this, 'Check Stack Status')
      .when(sfn.Condition.or(
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'CREATE_COMPLETE'),
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'UPDATE_COMPLETE'),
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'UPDATE_ROLLBACK_COMPLETE'),
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'ROLLBACK_COMPLETE')
      ),
        invokeAddIamDirectiveFunction
          // .next(listUserPools)
          // .next(findUserPool)
          // .next(updateUserPool)
      )
      .otherwise(new sfn.Wait(this, 'Wait', {
        time: sfn.WaitTime.duration(cdk.Duration.seconds(5)),
      }).next(waitForCfnStack));

    const definition = waitForCfnStack
      .next(checkStackStatus);

    const appConfiguratorStateMachine = new sfn.StateMachine(this, 'AppConfiguratorStepFunction', {
      definition,
      timeout: cdk.Duration.minutes(60),
      stateMachineType: sfn.StateMachineType.STANDARD,
      logs: {
        destination: new logs.LogGroup(scope, 'StateMachineLogGroup', {
          logGroupName: `/aws/vendedlogs/states/${rootStack.stackName}/AppConfigurator`,
          removalPolicy: cdk.RemovalPolicy.DESTROY
        }),
        level: sfn.LogLevel.ALL,
        includeExecutionData: true
      },
      tracingEnabled: true,
    });

    // Create a Custom Resource that invokes the Step Function on every stack update
    new cr.AwsCustomResource(this, `TriggerStepFunction-${Date.now().toString().slice(-5)}`, {
      onCreate: {
        service: 'StepFunctions',
        action: 'startExecution',
        parameters: {
          stateMachineArn: appConfiguratorStateMachine.stateMachineArn,
          input: JSON.stringify({ action: 'create' }),
        },
        physicalResourceId: cr.PhysicalResourceId.of('StepFunctionExecution'),
      },
      onUpdate: {
        service: 'StepFunctions',
        action: 'startExecution',
        parameters: {
          stateMachineArn: appConfiguratorStateMachine.stateMachineArn,
          input: JSON.stringify({ action: 'update' }),
        },
        physicalResourceId: cr.PhysicalResourceId.of('StepFunctionExecution'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [appConfiguratorStateMachine.stateMachineArn],
      }),
    });

    // // Create a Custom Resource that invokes only if the dependencies change
    // new cr.AwsCustomResource(this, `TriggerOnDepChange`, {
    //   onCreate: {
    //     service: 'Lambda',
    //     action: 'invoke',
    //     parameters: {
    //       FunctionName: configureProdDbFunction.functionName,
    //       Payload: JSON.stringify({}), // No need to pass SQL here
    //     },
    //     physicalResourceId: cr.PhysicalResourceId.of('SqlExecutionResource'),
    //   },
    //   onUpdate: {
    //     service: 'Lambda',
    //     action: 'invoke',
    //     parameters: {
    //       FunctionName: configureProdDbFunction.functionName,
    //       Payload: JSON.stringify({}), // No need to pass SQL here
    //     },
    //     physicalResourceId: cr.PhysicalResourceId.of('SqlExecutionResource'),
    //   },
    //   policy: cr.AwsCustomResourcePolicy.fromStatements([
    //     new iam.PolicyStatement({
    //       actions: ['lambda:InvokeFunction'],
    //       resources: [configureProdDbFunction.functionArn],
    //     }),
    //   ]),
    // });
  }
}