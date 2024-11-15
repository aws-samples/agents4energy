import { STSClient } from "@aws-sdk/client-sts";
import { z } from 'zod';

import { getDeployedResourceArn, getLambdaEnvironmentVariables } from "../utils";
import { wellTableToolBuilder, wellTableSchema } from '../../amplify/functions/productionAgentFunction/toolBox';
import { AmplifyClientWrapper } from '@/../amplify/functions/utils/amplifyUtils'
import outputs from '@/../amplify_outputs.json';

const stsClient = new STSClient();

const testArguments =
  {
    "wellApiNumber": "30-045-29202",
    "tableColumns": [
      {
        "columnDescription": "The type of operation performed on the well",
        "columnName": "Operation Type",
        "columnDefinition": {
          "type": "string",
          "enum": [
            "drill",
            "completion",
            "transportation",
            "cathodic protection"
          ]
        }
      },
      {
        "columnDescription": "Text describing the details of the operation",
        "columnName": "Operation Details",
        "columnDefinition": {
          "type": "string",
        }
      }
    ],
    "dataToExclude": "transportation corporation, cathotic protection"
    ,
    // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00114.pdf" // Change in Transporter
    // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/3003907715_24_wf_1.pdf" // Cathodic Protection
    // "s3Key": "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00112.pdf" //Drill Report
    // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00117.pdf" // Drill Report
    "s3Key": "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00131.pdf" // Drill Report
  } as z.infer<typeof wellTableSchema>

// const testArguments =
//   {
//     "wellApiNumber": "30-045-29202",
//     "tableColumns": [
//       {
//         "columnDescription": "The type of operation performed on the well",
//         "columnDefinition": {
//           "values": [
//             "Drilling",
//             "Completion",
//             "Workover",
//             "Other"
//           ],
//           "type": "enum"
//         },
//         "columnName": "Operation Type"
//       },
//       {
//         "columnDescription": "Text describing the operational details from the report",
//         "columnDefinition": {
//           "type": "string"
//         },
//         "columnName": "Operational Details"
//       },
//       {
//         "columnDescription": "The title of the document the operational details were extracted from",
//         "columnDefinition": {
//           "type": "string"
//         },
//         "columnName": "Document Title"
//       }
//     ],
//     "dataToExclude": "transportation corporation, cathotic protection"
//     ,
//     // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00114.pdf" // Change in Transporter
//     // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/3003907715_24_wf_1.pdf" // Cathodic Protection
//     // "s3Key": "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00112.pdf" //Drill Report
//     // s3Key: "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00117.pdf" // Drill Report
//     "s3Key": "production-agent/well-files/field=SanJuanEast/uwi=30-039-07715/30-039-07715_00131.pdf" // Drill Report
//   } as z.infer<typeof wellTableSchema>

async function main() {
  const rootStackName = outputs.custom.root_stack_name
  await getLambdaEnvironmentVariables(await getDeployedResourceArn(rootStackName, 'productionagentfunctionlambda'))
  process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT = outputs.data.url
  process.env.AWS_DEFAULT_REGION = outputs.auth.aws_region
  process.env.MODEL_ID = 'us.anthropic.claude-3-sonnet-20240229-v1:0'

  const credentials = await stsClient.config.credentials()
  process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId
  process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey
  process.env.AWS_SESSION_TOKEN = credentials.sessionToken

  const amplifyClientWrapper = new AmplifyClientWrapper({
    env: process.env
  })
  const wellTableTool = wellTableToolBuilder(amplifyClientWrapper)

  const tableDefinitions = await wellTableTool.invoke(testArguments);
  console.log('tableDefinitions:\n', tableDefinitions);
}

main()