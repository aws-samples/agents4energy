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

// async function getDeployedResourceArn(
//   stackName: string,
//   logicalId: string
// ): Promise<string> {
//   const cloudformation = new CloudFormationClient();

//   try {
    // const response = await cloudformation.send(new DescribeStackResourceCommand({
    //   StackName: stackName,
    //   LogicalResourceId: logicalId,
    // }))
//     if (!response.StackResourceDetail?.PhysicalResourceId) {
//       throw new Error(`Unable to get ARN for ${logicalId}`)
//     }
//     return response.StackResourceDetail?.PhysicalResourceId;
//   } catch (error) {
//     console.error('Error fetching resource ARN:', error);
//     throw new Error(`Error fetching resource ARN: ${JSON.stringify(error, null, 2)}`);
//   }
// }

// async function getDeployedResourceArn(
//   rootStackName: string,
//   logicalId: string,
//   nestedStackLogicalId?: string
// ): Promise<string> {
//   const cloudformation = new CloudFormationClient();

//   try {
//     let stackName = rootStackName;
    
//     // If it's a nested stack, we need to get the physical ID of the nested stack first
//     if (nestedStackLogicalId) {
//       const nestedStackResource = await cloudformation.send(new DescribeStackResourceCommand({
//         StackName: stackName,
//         LogicalResourceId: logicalId,
//       }))
      
//       if (!nestedStackResource.StackResourceDetail?.PhysicalResourceId) {
//         throw new Error(`Unable to get ARN for ${logicalId}`)
//       }

//       stackName = nestedStackResource.StackResourceDetail?.PhysicalResourceId;
      
//       if (!stackName) {
//         throw new Error(`Could not find nested stack with logical ID: ${nestedStackLogicalId}`);
//       }
//     }

//     const response = await cloudformation.send(new DescribeStackResourceCommand({
//       StackName: stackName,
//       LogicalResourceId: logicalId,
//     }))
    
//     if (!response.StackResourceDetail?.PhysicalResourceId) {
//       throw new Error(`Unable to get ARN for ${logicalId}`)
//     }

//     return response.StackResourceDetail?.PhysicalResourceId;
//   } catch (error) {
//     console.error('Error fetching resource ARN:', error);
//     throw new Error(`Error fetching resource ARN: ${JSON.stringify(error, null, 2)}`);
//   }
// }

// async function getDeployedResourceArn(
//   rootStackName: string,
//   targetLogicalId: string
// ): Promise<string> {
//   const cloudformation = new CloudFormationClient();

//   async function searchStack(stackName: string): Promise<string | undefined> {
//     try {
//       // Try to find the resource in the current stack
//       const resourceResponse = await cloudformation.send(new DescribeStackResourceCommand({
//         StackName: stackName,
//         LogicalResourceId: targetLogicalId,
//       }))

//       if (resourceResponse.StackResourceDetail?.PhysicalResourceId) {
//         return resourceResponse.StackResourceDetail.PhysicalResourceId;
//       }
//     } catch (error) {
//       // Resource not found in this stack, continue to search nested stacks
//     }

//     // If not found, list all resources in the stack
//     const resources = await cloudformation.send(new ListStackResourcesCommand({
//       StackName: stackName,
//     }))

//     // Search through nested stacks
//     for (const resource of resources.StackResourceSummaries || []) {
//       if (resource.ResourceType === 'AWS::CloudFormation::Stack') {
//         const nestedStackArn = resource.PhysicalResourceId;
//         if (nestedStackArn) {
//           const result = await searchStack(nestedStackArn);
//           if (result) return result;
//         }
//       }
//     }

//     return undefined;
//   }


//   const resourceId = await searchStack(rootStackName)
//   if (!resourceId) throw new Error(`Could not find resource with logical ID: ${targetLogicalId}`);
  
//   return resourceId;
// }


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
  process.env.CLUSTER_ARN = await getDeployedResourceArn(rootStackName, 'HydrocarbonProdDb')
  // console.log('CLUSTER_ARN: ', process.env.CLUSTER_ARN)
  process.env.ATHENA_WORKGROUP_NAME = await getDeployedResourceArn(rootStackName, 'FedQueryWorkgroup')
  process.env.SECRET_ARN = await getDeployedResourceArn(rootStackName, 'a4eHydrocarbonProdDbSecret')
  process.env.DATABASE_NAME = 'proddb'
  process.env.ATHENA_CATALOG_NAME = await getDeployedResourceArn(rootStackName, 'PostgresAthenaDataSource')
  process.env.S3_BUCKET_NAME = outputs.storage.bucket_name

  const response = await handler({}, dummyContext, () => null)

  console.log('Handler response: ', response)
}

main()