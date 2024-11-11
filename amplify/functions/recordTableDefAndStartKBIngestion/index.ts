import { EventBridgeEvent, Context } from 'aws-lambda';

import { BedrockAgentClient, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";
import { executeAthenaQueryGetResult, transformColumnOfAthenaQueryToList, uploadStringToS3 } from '../utils/sdkUtils'

const bedrockAgentClient = new BedrockAgentClient();

export interface AthenaDataCatalogDetail {
  eventVersion: string;
  userIdentity: {
    type: string;
    principalId: string;
    arn: string;
    accountId: string;
    userName?: string;
  };
  eventTime: string;
  eventSource: string;
  eventName: string;
  awsRegion: string;
  sourceIPAddress: string;
  userAgent: string;
  requestParameters: {
    name: string;
    type: string;
    description?: string;
    parameters?: Record<string, string>;
    tags: {
      AgentsForEnergy: string;
      [key: string]: string;
    };
  };
  responseElements: {
    dataCatalog: {
      name: string;
      type: string;
      description?: string;
      parameters?: Record<string, string>;
      tags: Record<string, string>;
    };
  };
  requestID: string;
  eventID: string;
  readOnly: boolean;
  eventType: string;
  managementEvent: boolean;
  recipientAccountId: string;
  eventCategory: string;
}

export const handler = async (event: EventBridgeEvent<'AWS API Call via CloudTrail', AthenaDataCatalogDetail>, context: Context): Promise<{ statusCode: number; body: string }> => {

  if (!process.env.ATHENA_WORKGROUP_NAME) throw new Error('ATHENA_WORKGROUP_NAME is not defined')
  if (!process.env.S3_BUCKET_NAME) throw new Error('S3_BUCKET_NAME is not defined')
  if (!process.env.TABLE_DEF_KB_ID) throw new Error('TABLE_DEF_KB_ID is not defined')
  if (!process.env.TABLE_DEF_KB_DS_ID) throw new Error('TABLE_DEF_KB_DS_ID is not defined')
  
  const { detail } = event;
  const {
    eventName,
    requestParameters,
    responseElements
  } = detail;

  // Extract relevant information
  const dataCatalogName = requestParameters.name;
  const dataCatalogType = requestParameters.type;
  const tags = requestParameters.tags;

  console.log(`Processing ${eventName} event for data catalog: ${dataCatalogName}`);
  console.log('Data Catalog Type:', dataCatalogType);
  console.log('Tags:', tags);

  const dataCatalogPrefix = dataCatalogName.split("_").slice(0)[0]

  switch (dataCatalogPrefix) {
    case 'postgres':
      const dbSchemasResults = await executeAthenaQueryGetResult({
        query: /* sql */`
        SELECT schema_name 
        FROM ${dataCatalogName}.information_schema.schemata;
        `,
        workgroup: process.env.ATHENA_WORKGROUP_NAME,
      });

      const dbSchemas = transformColumnOfAthenaQueryToList({queryResult: dbSchemasResults})

      console.log("DB Schemas: ", dbSchemas)

      if (!dbSchemas) throw new Error('No DB Schemas found')

      for (const schema of dbSchemas) {
        // Don't present the these shemas for query.
        if (['pg_catalog','information_schema'].includes(schema!)) continue

        const listTablesReult = await executeAthenaQueryGetResult({
          query: /* sql */`
          SELECT table_name
          FROM ${dataCatalogName}.information_schema.tables
          WHERE table_schema = '${schema}'
          ORDER BY table_name;
          `,
          workgroup: process.env.ATHENA_WORKGROUP_NAME!,
        });

        const dbSchemaTables = transformColumnOfAthenaQueryToList({queryResult: listTablesReult})
        
        for (const tableName of dbSchemaTables) {
          const describeTableResult = await executeAthenaQueryGetResult({
            query: /* sql */`
            DESCRIBE ${dataCatalogName}.information_schema.columns
            `,
            workgroup: process.env.ATHENA_WORKGROUP_NAME!,
          });

          const tableDefinition = transformColumnOfAthenaQueryToList({queryResult: describeTableResult}).join('\n')
          
          const tableDefinitionString = JSON.stringify({
            dataSource: dataCatalogName,
            database: schema,
            tableName: tableName,
            tableDefinition: tableDefinition
          }, null, 2)

          console.log('Table Definition:\n', tableDefinitionString);

          //Upload the describeTableResult to S3
          await uploadStringToS3({
            key: `production-agent/table-definitions/dataSource=${dataCatalogName}/database=${schema}/table-name=${tableName}.json`,
            content: tableDefinitionString,
            contentType: 'text/json'
          })
        }
      }

    default:
      break;
  }

  //Now start the knowledge base sync
  await bedrockAgentClient.send(new StartIngestionJobCommand({
    dataSourceId: process.env.TABLE_DEF_KB_DS_ID,
    knowledgeBaseId: process.env.TABLE_DEF_KB_ID,
  }))

  return { statusCode: 200, body: 'All SQL statements executed and table definitions exported successfully.' };
};