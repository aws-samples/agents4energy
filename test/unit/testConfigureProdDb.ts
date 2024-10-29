import { handler } from "@/../amplify/functions/configureProdDb/index"
import { Context } from 'aws-lambda';
import outputs from '@/../amplify_outputs.json';

// process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT = outputs.data.url
// TODO: Get these values form the cloudformation template
process.env.ROOT_STACK_NAME = outputs.custom.root_stack_name
process.env.CLUSTER_ARN = 'arn:aws:rds:us-east-1:REPLACED:cluster:amplify-agentsforenergy-t-hydrocarbonproddbfded9aa-sb8ek7d1qpe0' //TODO - Delete me
process.env.ATHENA_WORKGROUP_NAME = 'plify-agentsforenergy-t2s-sandbox-63a6cdf992-fed_query_workgroup'
process.env.SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:REPLACED:secret:amplify-agentsforenergy-t2s-sandbox-63a6cdf992-proddb-credentials-LEJXEp'
process.env.DATABASE_NAME = 'proddb'
process.env.ATHENA_CATALOG_NAME = 'amplify-agentsforenergy-t2s-sandbox-63a6cdf992-postgres'
process.env.S3_BUCKET_NAME = outputs.storage.bucket_name

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
  const response = await handler({}, dummyContext, () => null)

  console.log('Handler response: ', response)
}

main()