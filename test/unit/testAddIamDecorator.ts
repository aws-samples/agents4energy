import { handler } from "@/../amplify/functions/addIamDecoratorToAllAssets"
import { AppSyncResolverEvent, Context } from 'aws-lambda';
import { Schema } from '@/../amplify/data/resource';
import outputs from '@/../amplify_outputs.json';

process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT = outputs.data.url

const testArguments = {}

// const event: AppSyncResolverEvent = {
//   "arguments": testArguments,
//   source: null,
//   request: {
//     headers: {},
//     domainName: null,
//   },
//   info: {
//     fieldName: 'yourFieldName',
//     parentTypeName: 'Query',
//     selectionSetList: [],
//     selectionSetGraphQL: '',
//     variables: {}
//   },
//   prev: null,
//   stash: {},
// };

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
  const response = await handler({
      RequestType: "Create",
      ServiceToken: "",
      ResponseURL: "",
      StackId: "",
      RequestId: "",
      LogicalResourceId: "",
      ResourceType: "",
      ResourceProperties: {
        apiId: outputs.custom.api_id,
        ServiceToken: "Dummy Token",
        directivesToAdd: "aws_iam,aws_cognito_user_pools"
    }
  }, dummyContext, () => null)

  console.log('Handler response: ', response)
}

main()