import { RDSDataClient, ExecuteStatementCommand, ExecuteStatementCommandInput } from "@aws-sdk/client-rds-data";
import {
  AthenaClient,
  StartQueryExecutionInput,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryExecutionInput,
  GetQueryResultsCommand,
  GetQueryResultsOutput
} from "@aws-sdk/client-athena"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import { Athena, Bedrock } from 'aws-sdk';
// const athena = new Athena();
// const rds = new RDS();
// const bedrock = new Bedrock();

import sqlStatements from './sqlStatements'

const rdsDataClient = new RDSDataClient();
const athenaClient = new AthenaClient();

export const handler = async (event: any, context: any, callback: any): Promise<{ statusCode: number; body: string }> => {

  if (!process.env.CLUSTER_ARN) throw new Error('CLUSTER_ARN is not defined')
  if (!process.env.ATHENA_WORKGROUP_NAME) throw new Error('ATHENA_WORKGROUP_NAME is not defined')
  if (!process.env.DATABASE_NAME) throw new Error('DATABASE_NAME is not defined')
  if (!process.env.ATHENA_CATALOG_NAME) throw new Error('ATHENA_CATALOG_NAME is not defined')
  if (!process.env.S3_BUCKET_NAME) throw new Error('S3_BUCKET_NAME is not defined')

  // if (!process.env.TABLE_DEF_KB_ID) throw new Error('TABLE_DEF_KB_ID is not defined')

  const workgroup = process.env.ATHENA_WORKGROUP_NAME
  // const knowledgeBaseId = process.env.TABLE_DEF_KB_ID || 'default'

  for (const sql of sqlStatements) {
    console.log('Executing SQL:', sql)


    const params: ExecuteStatementCommandInput = {
      resourceArn: process.env.CLUSTER_ARN,
      secretArn: process.env.SECRET_ARN,
      database: process.env.DATABASE_NAME,
      sql: sql.trim(),
    };

    const command = new ExecuteStatementCommand(params);

    try {
      const result = await rdsDataClient.send(command);
      console.log('SQL execution successful:', result);
    } catch (error) {
      console.error('Error executing SQL:', error);
      throw error;
    }
  }

  console.log('All SQL statements executed successfully')

  const tablesToExportDefinitionsOf: {tableName: string, database: string}[] = [
    {
      tableName: 'daily',
      database: 'production'
    },
    {
      tableName: 'businessunits',
      database: 'public'
    },
    {
      tableName: 'locations',
      database: 'public'
    },
  ]

  // Query to get all table definitions
  const queryBuilder = (tableName: string) => (
    /* sql */`
    DESCRIBE ${tableName}
  `);

  await Promise.all(
    tablesToExportDefinitionsOf.map(async ({tableName, database}) => {
      const query = queryBuilder(tableName);
      const queryExecutionId = await startQueryExecution(query, workgroup, database);
      await waitForQueryToComplete(queryExecutionId, workgroup);
      const results = await getQueryResults(queryExecutionId);
      console.log('Athena Query Result:\n', results);

      const describeTableResult = results.ResultSet?.Rows?.map((row) => {
        if (row.Data && row.Data[0] && row.Data[0].VarCharValue !== undefined) return row.Data[0].VarCharValue
      }
      ).join('\n')

      console.log('Athena Query Result Outputs:\n', describeTableResult);

      if (!describeTableResult) throw new Error(`No table definition found for table: ${tableName}`)
      //Upload the describeTableResult to S3
      await uploadStringToS3({
        key: `production-agent/table-definitions/database=${database}/table-name=${tableName}.txt`,
        content: describeTableResult,
        contentType: 'text/plain'
      })

      return describeTableResult; // Return the results if you need them
    })
  );

  return { statusCode: 200, body: 'All SQL statements executed successfully' };
};

async function startQueryExecution(query: string, workgroup: string, database: string): Promise<string> {
  const params: StartQueryExecutionInput = {
    QueryString: query,
    WorkGroup: workgroup,
    QueryExecutionContext: {
      Catalog: process.env.ATHENA_CATALOG_NAME,
      Database: database
    },
  };

  const result = await athenaClient.send(new StartQueryExecutionCommand(params))

  // const result = await athenaClient.startQueryExecution(params).promise();
  return result.QueryExecutionId!;
}

async function waitForQueryToComplete(queryExecutionId: string, workgroup: string): Promise<void> {
  while (true) {

    const result = await athenaClient.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
    const state = result.QueryExecution!.Status!.State;
    if (state === 'SUCCEEDED') return;
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(`Query execution failed: ${JSON.stringify(result.QueryExecution!.Status)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function getQueryResults(queryExecutionId: string): Promise<GetQueryResultsOutput> {
  return athenaClient.send(new GetQueryResultsCommand({
    QueryExecutionId: queryExecutionId,
  }));
}


async function uploadStringToS3(props: {
  key: string,
  content: string,
  contentType?: string
}
): Promise<void> {
  const s3Client = new S3Client();

  try {
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: props.key,
      Body: props.content,
      ContentType: props.contentType || "text/plain",
    });

    await s3Client.send(command);
    console.log(`Successfully uploaded string to ${process.env.S3_BUCKET_NAME}/${props.key}`);
  } catch (error) {
    console.error("Error uploading string to S3:", error);
    throw error;
  }
}