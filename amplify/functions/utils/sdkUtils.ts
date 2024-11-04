import {
    AthenaClient,
    StartQueryExecutionInput,
    StartQueryExecutionCommand,
    GetQueryExecutionCommand,
    GetQueryExecutionInput,
    GetQueryResultsCommand,
    GetQueryResultsOutput,
    ResultSet
} from "@aws-sdk/client-athena"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
const athenaClient = new AthenaClient();

export async function startQueryExecution(props:{query: string, workgroup: string, database: string, athenaCatalogaName: string}): Promise<string> {
    const params: StartQueryExecutionInput = {
        QueryString: props.query,
        WorkGroup: props.workgroup,
        QueryExecutionContext: {
            Catalog: props.athenaCatalogaName,
            Database: props.database
        },
    };

    const result = await athenaClient.send(new StartQueryExecutionCommand(params))

    // const result = await athenaClient.startQueryExecution(params).promise();
    return result.QueryExecutionId!;
}

export async function waitForQueryToComplete(queryExecutionId: string, workgroup: string): Promise<void> {
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

export async function getQueryResults(queryExecutionId: string): Promise<GetQueryResultsOutput> {
    return athenaClient.send(new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
    }));
}


export async function uploadStringToS3(props: {
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

export function transformResultSet(resultSet: ResultSet) {
    if (!resultSet.Rows || !resultSet.ResultSetMetadata?.ColumnInfo) {
        return {};
    }

    // Get column names from metadata
    const columnNames = resultSet.ResultSetMetadata.ColumnInfo.map(col => 
        col.Name || ''
    );

    // Initialize result object with empty arrays for each column
    const result: { [key: string]: (string | number)[] } = {};
    columnNames.forEach(name => {
        result[name] = [];
    });

    // Skip the header row (first row) and process data rows
    const dataRows = resultSet.Rows.slice(1);
    
    dataRows.forEach(row => {
        if (!row.Data) return;
        
        row.Data.forEach((cell, columnIndex) => {
            const columnName = columnNames[columnIndex];
            if (columnName) {
                result[columnName].push(cell.VarCharValue || "");
            }
        });
    });

    return result;
}