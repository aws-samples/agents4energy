import { handler } from "@/../amplify/functions/getInfoFromPdf/index"
import { AppSyncResolverEvent, Context } from 'aws-lambda';
import { Schema } from '@/../amplify/data/resource';
import outputs from '@/../amplify_outputs.json';

process.env.AWS_DEFAULT_REGION = outputs.auth.aws_region
// process.env.MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0'
process.env.MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0'
process.env.DATA_BUCKET_NAME = outputs.storage.bucket_name

const testArguments = {
  "wellApiNumber": "30-039-07715",
  "tableColumns": [
    {
      "columnDescription": "The type of operation performed on the well",
      "columnName": "Operation Type"
    },
    {
      "columnDescription": "Text describing the details of the operation",
      "columnName": "Operation Details"
    }
  ],
  "dataToExclude": "transportation corporation, cathotic protection"
  ,
  // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00114.pdf" // Change in Transporter
  // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/3003907715_24_wf_1.pdf" // Cathodic Protection
  // "s3Key": "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00112.pdf" //Drill Report
  // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00117.pdf" // Drill Report
  "s3Key": "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00131.pdf" // Drill Report
}

const event: AppSyncResolverEvent<Schema['getInfoFromPdf']['args']> = {
  "arguments": testArguments,
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