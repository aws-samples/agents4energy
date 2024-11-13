import { handler } from "@/../amplify/functions/convertPdfToYaml/index"
import { EventBridgeEvent, Context } from 'aws-lambda';
import outputs from '@/../amplify_outputs.json';

import { getDeployedResourceArn, getLambdaEnvironmentVariables } from "../utils";

const rootStackName = outputs.custom.root_stack_name


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
  process.env.AWS_DEFAULT_REGION = outputs.auth.aws_region

  await getLambdaEnvironmentVariables(await getDeployedResourceArn(rootStackName, 'ConvertPdfToYamlFunction'))

  const testEvent = {
    "Records": [
      {
        "eventVersion": "2.1",
        "eventSource": "aws:s3",
        "awsRegion": "us-east-1",
        "eventTime": "2024-03-15T12:00:00.000Z",
        "eventName": "ObjectCreated:Put",
        "userIdentity": {
          "principalId": "EXAMPLE"
        },
        "requestParameters": {
          "sourceIPAddress": "127.0.0.1"
        },
        "responseElements": {
          "x-amz-request-id": "EXAMPLE123456789",
          "x-amz-id-2": "EXAMPLE123/5678abcdefghijklambdaisawesome/mnopqrstuvwxyzABCDEFGH"
        },
        "s3": {
          "s3SchemaVersion": "1.0",
          "configurationId": "testConfigRule",
          "bucket": {
            "name": outputs.storage.bucket_name,
            "ownerIdentity": {
              "principalId": "EXAMPLE"
            },
            "arn": `arn:aws:s3:::${outputs.storage.bucket_name}`
          },
          "object": {
            "key": "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00112.pdf",
            "size": 1024,
            "eTag": "0123456789abcdef0123456789abcdef",
            "sequencer": "0A1B2C3D4E5F678901"
          }
        }
      }
    ]
  };

  const response = await handler(testEvent, dummyContext, () => null)

  console.log('Handler response: ', response)
}

main()