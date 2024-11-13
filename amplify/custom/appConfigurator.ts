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
  cognitoUserPool: cdk.aws_cognito.IUserPool
  // sqlTableDefBedrockKnoledgeBase: bedrock.KnowledgeBase
}


export class AppConfigurator extends Construct {
  constructor(scope: Construct, id: string, props: AppConfiguratorProps) {
    super(scope, id);

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(__dirname, '..');

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    // // Grant the user pool the authorization to invoke the pre sign up lambda function
    // props.cognitoUserPool.grant(props.preSignUpFunction, 'lambda:InvokeFunction')

    props.preSignUpFunction.grantInvoke(new cdk.aws_iam.ServicePrincipal('cognito-idp.amazonaws.com'))

    // preSignUpFunction.addPermission('AllowCognitoInvoke', {
    //   principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
    //   sourceArn: userPool.userPoolArn,
    // });

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

    // Define a step to get the current user pool configuration
    const getUserPoolConfiguration = new sfn_tasks.CallAwsService(this, 'GetUserPoolConfiguration', {
      service: 'cognitoidentityprovider',
      action: 'describeUserPool',
      parameters: {
        UserPoolId: props.cognitoUserPool.userPoolId
      },
      iamResources: [props.cognitoUserPool.userPoolArn],
      resultPath: '$.UserPoolConfig'
    });

    // Define that configuration with the pre sign up lambda function
    const updateUserPoolTask = new sfn_tasks.CallAwsService(this, 'UpdateUserPool', {
      service: 'cognitoidentityprovider',
      action: 'updateUserPool',
      parameters: {
        UserPoolId: props.cognitoUserPool.userPoolId,
        AutoVerifiedAttributes: sfn.JsonPath.stringAt('$.UserPoolConfig.UserPool.AutoVerifiedAttributes'),
        EmailVerificationMessage: sfn.JsonPath.stringAt('$.UserPoolConfig.UserPool.EmailVerificationMessage'),
        EmailVerificationSubject: sfn.JsonPath.stringAt('$.UserPoolConfig.UserPool.EmailVerificationSubject'),
        Policies: sfn.JsonPath.objectAt('$.UserPoolConfig.UserPool.Policies'),
        VerificationMessageTemplate: sfn.JsonPath.objectAt('$.UserPoolConfig.UserPool.VerificationMessageTemplate'),
        LambdaConfig: {
          PreSignUp: props.preSignUpFunction.functionArn
        }
      },
      iamResources: [props.cognitoUserPool.userPoolArn]
    });

    // This step will add the iam directive to the graphql schema
    const invokeAddIamDirectiveFunction = new sfn_tasks.LambdaInvoke(this, 'InvokeLambda', {
      lambdaFunction: addIamDirectiveFunction,
    })

    const checkStackStatus = new sfn.Choice(this, 'Check Stack Status')
      .when(sfn.Condition.or(
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'CREATE_COMPLETE'),
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'UPDATE_COMPLETE'),
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'UPDATE_ROLLBACK_COMPLETE'),
        sfn.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'ROLLBACK_COMPLETE')
      ),
        invokeAddIamDirectiveFunction
          .next(getUserPoolConfiguration)
          .next(updateUserPoolTask)
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

    appConfiguratorStateMachine.role.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
      actions: [
        'cognito-idp:UpdateUserPool',
        'cognito-idp:describeUserPool'
      ],
      resources: [props.cognitoUserPool.userPoolArn]
    }))


    const invokeStepFunctionSDKCall: cr.AwsSdkCall = {
      service: 'StepFunctions',
      action: 'startExecution',
      parameters: {
        stateMachineArn: appConfiguratorStateMachine.stateMachineArn,
        input: JSON.stringify({ action: 'create' }),
      },
      physicalResourceId: cr.PhysicalResourceId.of('StepFunctionExecution'),
    }

    // Create a Custom Resource that invokes the Step Function on every stack update
    // new cr.AwsCustomResource(this, `TriggerStepFunction-${Date.now().toString().slice(-5)}`, {
      new cr.AwsCustomResource(this, `TriggerStepFunction`, {
      onCreate: invokeStepFunctionSDKCall,
      onUpdate: invokeStepFunctionSDKCall,
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