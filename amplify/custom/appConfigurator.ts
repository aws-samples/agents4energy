import path from 'path';
import { fileURLToPath } from 'url';

// import { Construct } from "@aws-cdk/core";
import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctions_tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudformation from 'aws-cdk-lib/aws-cloudformation';
import { Construct } from 'constructs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface AppConfiguratorProps { }


export class AppConfigurator extends Construct {
  constructor(scope: Construct, id: string, props: AppConfiguratorProps) {
    super(scope, id);

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(__dirname, '..');

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    // Define the configurator Lambda
    // This function and custom resource will update the GraphQL schema to allow for @aws_iam access to all resources 
    const addIamDirectiveFunction = new NodejsFunction(scope, 'addIamDirective', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(rootDir, 'functions', 'addIamDirectiveToAllAssets.ts'),
      // bundling: {
      //     format: OutputFormat.CJS,
      //     loader: {
      //         '.node': 'file',
      //     },
      //     bundleAwsSDK: true,
      //     minify: true,
      //     sourceMap: true,
      // },
      timeout: cdk.Duration.seconds(30),
      environment: {
        // GRAPHQL_API_ID: backend.data.resources.graphqlApi.apiId,
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

    const waitForCfnStack = new stepfunctions_tasks.CallAwsService(this, 'WaitForCfnStack', {
      service: 'cloudformation',
      action: 'describeStacks',
      parameters: {
        StackName: rootStack.stackName,
      },
      iamResources: ['*'],
      resultPath: '$.StackStatus',
    });

    const checkStackStatus = new stepfunctions.Choice(this, 'Check Stack Status')
      .when(stepfunctions.Condition.or(
        stepfunctions.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'CREATE_COMPLETE'),
        stepfunctions.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'UPDATE_COMPLETE'),
        stepfunctions.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'UPDATE_ROLLBACK_COMPLETE'),
        stepfunctions.Condition.stringEquals('$.StackStatus.Stacks[0].StackStatus', 'ROLLBACK_COMPLETE')
      ),
        new stepfunctions_tasks.LambdaInvoke(this, 'InvokeLambda', {
          lambdaFunction: addIamDirectiveFunction,
        }))
      .otherwise(new stepfunctions.Wait(this, 'Wait', {
        time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(5)),
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
          input: JSON.stringify({ action: 'create'}),
        },
        physicalResourceId: cr.PhysicalResourceId.of('StepFunctionExecution'),
      },
      onUpdate: {
        service: 'StepFunctions',
        action: 'startExecution',
        parameters: {
          stateMachineArn: appConfiguratorStateMachine.stateMachineArn,
          input: JSON.stringify({ action: 'update'}),
        },
        physicalResourceId: cr.PhysicalResourceId.of('StepFunctionExecution'),
      },
      // onDelete: {
      //   service: 'AWS',
      //   action: 'doNothing',
      //   physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()), // This ensures the delete "succeeds" 
      // },
      // properties: {
      //   UpdateTrigger: Date.now().toString(),
      // },
      // // This is the key to make it run on every update
      // updateTrigger: Date.now().toString(),
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [appConfiguratorStateMachine.stateMachineArn],
      }),
    });



  }
}