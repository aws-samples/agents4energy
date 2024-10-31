import { handler } from "@/../amplify/functions/configureProdDb/index"
import { Context } from 'aws-lambda';
import outputs from '@/../amplify_outputs.json';

// import { CloudFormation } from 'aws-sdk';
import {
  CloudFormationClient,
  DescribeStackResourceCommand,
  // DescribeStackResourceCommandInput,
  ListStackResourcesCommand,
  // ListStackResourcesInput
} from "@aws-sdk/client-cloudformation"
import { LambdaClient, GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";


async function getDeployedResourceArn(
  rootStackName: string,
  targetLogicalIdPrefix: string
): Promise<string> {
  const cloudformation = new CloudFormationClient();

  async function searchStack(stackName: string): Promise<string | undefined> {
    try {
      const resources = await cloudformation.send(new ListStackResourcesCommand({
        StackName: stackName,
      }))

      if (!resources || !resources.StackResourceSummaries) throw new Error(`No resources found in stack ${stackName}`);

      for (const resource of resources.StackResourceSummaries || []) {
        if (resource && resource.LogicalResourceId && 
          (
            resource.LogicalResourceId.slice(0,-8) === targetLogicalIdPrefix ||
            resource.LogicalResourceId === targetLogicalIdPrefix
          )
        ) {
          return resource.PhysicalResourceId;
        }

        if (resource.ResourceType === 'AWS::CloudFormation::Stack') {
          const nestedStackArn = resource.PhysicalResourceId;
          if (nestedStackArn) {
            const result = await searchStack(nestedStackArn);
            if (result) return result;
          }
        }
      }

      // If we've gone through all resources and haven't returned, check if there's a next token
      if (resources.NextToken) {
        const nextResources = await cloudformation.send(new ListStackResourcesCommand({
          StackName: stackName,
        }))
        resources.StackResourceSummaries?.push(...(nextResources.StackResourceSummaries || []));
      }

    } catch (error) {
      console.error(`Error searching stack ${stackName}:`, error);
    }

    return undefined;
  }

  const resourceId = await searchStack(rootStackName)
  if (!resourceId) throw new Error(`Could not find resource with logical ID: ${targetLogicalIdPrefix}`);
  
  console.log(`For logical id ${targetLogicalIdPrefix}, found PhysicalResourceId ${resourceId}`)
  return resourceId;
}


async function getLambdaEnvironmentVariables(functionName: string): Promise<void> {
  try {
      // Initialize the Lambda client
      const client = new LambdaClient();
      
      // Create the command to get function configuration
      const command = new GetFunctionConfigurationCommand({
          FunctionName: functionName
      });

      // Get the function configuration
      const response = await client.send(command);
      
      // Check if environment variables exist
      if (response.Environment && response.Environment.Variables) {
          const envVars = response.Environment.Variables;
          
          // Set each environment variable locally
          for (const [key, value] of Object.entries(envVars)) {
              if (value) {
                  process.env[key] = value;
                  console.log(`Set ${key} environment variable`);
              }
          }
      } else {
          console.log('No environment variables found for the specified Lambda function');
      }
      
  } catch (error) {
      console.error('Error retrieving Lambda environment variables:', error);
      throw error;
  }
}

// process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT = outputs.data.url
// TODO: Get these values form the cloudformation template
const rootStackName = outputs.custom.root_stack_name


const testArguments = {}

const dummyContext: Context = {
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'test-function',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
  memoryLimitInMB: '128',
  awsRequestId: '52fdfc07-2182-154f-163f-5f0f9a621d72',
  logGroupName: '/aws/lambda/test-function',
  logStreamName: '2020/09/22/[$LATEST]abcdefghijklmnopqrstuvwxyz',
  // identity: null,
  // clientContext: null,
  getRemainingTimeInMillis: () => 3000,
  done: () => { },
  fail: () => { },
  succeed: () => { },
};

const main = async () => {
  process.env.ROOT_STACK_NAME = rootStackName

  await getLambdaEnvironmentVariables(await getDeployedResourceArn(rootStackName, 'configureProdDbFunction'))
  // process.env.CLUSTER_ARN = await getDeployedResourceArn(rootStackName, 'HydrocarbonProdDb')
  // console.log('CLUSTER_ARN: ', process.env.CLUSTER_ARN)
  // process.env.ATHENA_WORKGROUP_NAME = await getDeployedResourceArn(rootStackName, 'FedQueryWorkgroup')
  // process.env.SECRET_ARN = await getDeployedResourceArn(rootStackName, `${rootStackName}HydrocarbonProdDbSecret`)
  // process.env.DATABASE_NAME = 'proddb'
  // process.env.ATHENA_CATALOG_NAME = await getDeployedResourceArn(rootStackName, 'PostgresAthenaDataSource')
  // process.env.S3_BUCKET_NAME = outputs.storage.bucket_name

  const response = await handler({}, dummyContext, () => null)

  console.log('Handler response: ', response)
}

main()