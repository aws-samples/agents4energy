import { handler } from "@/../amplify/functions/productionAgentFunction/index"
import { AppSyncResolverEvent, Context, AppSyncIdentity } from 'aws-lambda';
import { Schema } from '@/../amplify/data/resource';
import outputs from '@/../amplify_outputs.json';

process.env.AWS_DEFAULT_REGION = outputs.auth.aws_region
process.env.MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0'
// process.env.MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0'

const testArguments = {
  "chatSessionId": "testChatSession",
  "input": "What is 5*67?"
}

const event: AppSyncResolverEvent<Schema['invokeProductionAgent']['args']> = {
  "arguments": testArguments,
  identity: {sub: "testIdentity"} as AppSyncIdentity,
  source: null,
  request: {
    headers: {},
    domainName: null,
  },
  info: {
    fieldName: 'yourFieldName',
    parentTypeName: 'Query',
    selectionSetList: [],
    selectionSetGraphQL: '',
    variables: {}
  },
  prev: null,
  stash: {},
};

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
  const response = await handler(event, dummyContext, () => null)

  console.log('Handler response: ', response)
}

main()