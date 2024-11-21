// import { stringify } from 'yaml'
import { z } from "zod";

import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { S3Client, GetObjectCommand, ListObjectsV2Command, ListObjectsV2CommandInput } from "@aws-sdk/client-s3";

import { tool } from "@langchain/core/tools";
import { env } from '$amplify/env/production-agent-function';

import { AmplifyClientWrapper, FieldDefinition } from '../utils/amplifyUtils'
import { processWithConcurrency, startQueryExecution, waitForQueryToComplete, getQueryResults, transformResultSet } from '../utils/sdkUtils'

import { ToolMessageContentType } from '../../../src/utils/types'
import { onFetchObjects } from '../../../src/utils/amplify-utils'

import { invokeBedrockWithStructuredOutput } from '../graphql/queries'

const s3Client = new S3Client();

//////////////////////////////////////////
//////////// Calculator Tool /////////////
//////////////////////////////////////////

const calculatorSchema = z.object({
    operation: z
        .enum(["add", "subtract", "multiply", "divide", "squareRoot"])
        .describe("The type of operation to execute."),
    number1: z.number().describe("The first number to operate on."),
    number2: z.number().describe("The second number to operate on."),
});

export const calculatorTool = tool(
    async ({ operation, number1, number2 }) => {
        // Functions must return strings
        if (operation === "add") {
            return `${number1 + number2}`;
        } else if (operation === "subtract") {
            return `${number1 - number2}`;
        } else if (operation === "multiply") {
            return `${number1 * number2}`;
        } else if (operation === "divide") {
            return `${number1 / number2}`;
        } else {
            throw new Error("Invalid operation.");
        }
    },
    {
        name: "calculator",
        description: "Can perform mathematical operations.",
        schema: calculatorSchema,
    }
);



//////////////////////////////////////////
////// Get table definiton tool //////////
//////////////////////////////////////////
const getTableDefinitionsSchema = z.object({
    tableFeatures: z.string().describe(`
        Which features of the user's question should be looked for when picking which tables to query? 
        Include key words and likely SQL query column names.
        `),
});

async function queryKnowledgeBase(props: { knowledgeBaseId: string, query: string }) {
    const bedrockRuntimeClient = new BedrockAgentRuntimeClient();

    const command = new RetrieveCommand({
        knowledgeBaseId: props.knowledgeBaseId,
        retrievalQuery: { text: props.query },
        retrievalConfiguration: {
            vectorSearchConfiguration: {
                numberOfResults: 5 // Adjust based on your needs
            }
        }
    });

    try {
        const response = await bedrockRuntimeClient.send(command);
        return response.retrievalResults;
    } catch (error) {
        console.error('Error querying knowledge base:', error);
        throw error;
    }
}

//https://js.langchain.com/docs/integrations/retrievers/bedrock-knowledge-bases/
export const getTableDefinitionsTool = tool(
    async ({ tableFeatures }) => {
        console.log('Getting relevant tables for table features:\n', tableFeatures)

        const relevantTables = await queryKnowledgeBase({
            knowledgeBaseId: env.AWS_KNOWLEDGE_BASE_ID,
            query: tableFeatures
        }
        )

        if (!relevantTables) throw new Error("No relevant tables found")
        console.log("Text2Sql KB response:\n", JSON.stringify(relevantTables, null, 2))


        const tableDefinitions = relevantTables.map((result) =>
        ({
            ...JSON.parse(result?.content?.text || ""),
            score: result?.score
        }))

        console.log('Table Definitions:\n', tableDefinitions)

        return {
            messageContentType: 'tool_json',
            tableDefinitions: tableDefinitions
        } as ToolMessageContentType
    },
    {
        name: "getTableDefinitionsTool",
        description: "Always call this tool before executing a SQL query. Can retrieve database table definitons available for SQL queries.",
        schema: getTableDefinitionsSchema,
    }
);

///////////////////////////////////////////////////
///// Execute SQL Statement Tool //////////////////
///////////////////////////////////////////////////

const executeSQLQuerySchema = z.object({
    query: z.string().describe(`
        The Trino SQL query to be executed.
        Include the dataSource, database, and tableName in the FROM element (ex: FROM <dataSourceName>.production.daily)
        Use "" arond all column names.
        To use date functions on a column with varchar type, cast the column to a date first.
        The DATE_SUB function is not available. Use the DATE_ADD(unit, value, timestamp) function any time you're adding an interval value to a timestamp. Never use DATE_SUB.
        Here's an example of how to use the DATE_TRUNC function: DATE_TRUNC('month', CAST("date" AS DATE))
        In the WHERE or GROUP BY causes, do not use column aliases defined in the SELECT clause.
        Column aliases defined in the SELECT clause cannot be referenced in the WHERE or GROUP BY clauses because they are evaluated before the SELECT clause during query processing.
        The first column in the returned result will be used as the x axis column. If the query contains a date, set it as the first column.
        
        Here's an example sql query for total daily oil, gas and water production
        <exampleSqlQuery>
        SELECT
            DATE_TRUNC('day', CAST("date" AS DATE)) AS day,
            SUM("oil(bbls)") AS total_oil_production,
            SUM("gas(mcf)") AS total_gas_production,
            SUM("water(bbls)") AS total_water_production
        FROM "AwsDataCatalog"."production_db_xxx"."crawler_production"
        WHERE "well api" = '30-045-29202'
            AND CAST("date" AS DATE) >= CAST('1900-01-01' AS DATE)
        GROUP BY DATE_TRUNC('day', CAST("date" AS DATE))
        ORDER BY day
        </exampleSqlQuery>
        `.replace(/^\s+/gm, '')),
});

function doesFromLineContainOneDot(sqlQuery: string): boolean {
    // Split the query into lines
    const lines = sqlQuery.split('\n');

    // Find the line that starts with "FROM" (case-insensitive)
    const fromLine = lines.find(line => line.trim().toUpperCase().startsWith('FROM'));

    // If there's no FROM line, return false
    if (!fromLine) {
        return false;
    }

    // Extract the part after "FROM"
    const afterFrom = fromLine.trim().substring(4).trim();

    // Count the number of dots
    const dotCount = (afterFrom.match(/\./g) || []).length;

    // Return true if there's exactly one dot
    return dotCount === 1;
}

export const executeSQLQueryTool = tool(
    async ({ query }) => {
        console.log('Executing SQL Query:\n', query, '\nUsing workgroup: ', env.ATHENA_WORKGROUP_NAME)
        try {

            // See if the string date_sub is in the query sting
            if (query.toLowerCase().includes("date_sub")) {
                return {
                    messageContentType: 'tool_json',
                    error: `
                    DATE_SUB is not allowed in the SQL query. 
                    Re-write the query and use the DATE_ADD(unit, value, timestamp) function any time you're adding an interval value to a timestamp. Ex: DATE_ADD('year', -5, CURRENT_DATE)
                    `.replace(/^\s+/gm, '')
                } as ToolMessageContentType
            }

            //Check if the datasource is included in the query
            if (doesFromLineContainOneDot(query)) {
                return {
                    messageContentType: 'tool_json',
                    error: `
                    The FROM line in the SQL query does not the data source.
                    Include the dataSource, database, and tableName in the FROM element (ex: FROM <dataSource>.production.daily)
                    `.replace(/^\s+/gm, '')
                } as ToolMessageContentType
            }

            const queryExecutionId = await startQueryExecution({
                query: query,
                workgroup: env.ATHENA_WORKGROUP_NAME,
            });
            await waitForQueryToComplete(queryExecutionId, env.ATHENA_WORKGROUP_NAME);
            const results = await getQueryResults(queryExecutionId);
            console.log('Athena Query Result:\n', results);

            if (!results.ResultSet?.Rows) throw new Error("No results returned from Athena")

            const queryResponseData = transformResultSet(results.ResultSet)

            return {
                messageContentType: 'tool_table',
                queryResponseData: queryResponseData,
            } as ToolMessageContentType

        } catch (error) {
            console.error('Error executing sql query:', error);
            return {
                messageContentType: 'tool_json',
                error: error instanceof Error ? error.message : `Error:\n ${JSON.stringify(error)}`
            } as ToolMessageContentType
        }
    },
    {
        name: "executeSQLQuery",
        description: "Always call the getTableDefinitionsTool before calling this tool. This tool can execute a Trino SQL query and returns the results as a table.",
        schema: executeSQLQuerySchema,
    }
);

///////////////////////////////////////////////////
////////// Plot Table Tool ////////////////////////
///////////////////////////////////////////////////

const plotTableFromToolResponseSchema = z.object({
    // toolCallId: z.string().describe("The tool call ID which produced the table to plot. Ex: tooluse_xxxxxxx"),
    // columnNameFromQueryForXAxis: z.string().describe("The column name of the SQL query result to be plotted on the X axis"),
    chartTitle: z.string().describe("The title of the plot."),
    numberOfPreviousTablesToInclude: z.number().int().optional().describe("The number of previous tables to include in the plot. Default is 1."),
});


export const plotTableFromToolResponseTool = tool(
    async ({ chartTitle, numberOfPreviousTablesToInclude = 1 }) => {

        return {
            messageContentType: 'tool_plot',
            // columnNameFromQueryForXAxis: columnNameFromQueryForXAxis,
            chartTitle: chartTitle,
            numberOfPreviousTablesToInclude: numberOfPreviousTablesToInclude
            // chartData: queryResponseData
        } as ToolMessageContentType

    },
    {
        name: "plotTableFromToolResponseToolBuilder",
        description: "Plots tabular data returned from previous tool messages",
        schema: plotTableFromToolResponseSchema,
    }
);


//////////////////////////////////////////
//////// PDF Reports to Table Tool ///////
//////////////////////////////////////////

export const wellTableSchema = z.object({
    dataToExclude: z.string().optional().describe("List of criteria to exclude data from the table"),
    dataToInclude: z.string().optional().describe("List of criteria to include data in the table"),
    tableColumns: z.array(z.object({
        columnName: z.string().describe('The name of a column'),
        columnDescription: z.string().describe('A description of the information which this column contains.'),
        columnDefinition: z.object({
            type: z.enum(['string', 'integer', 'date', 'number', 'boolean']).describe('The data type of the column.'),
            format: z.string().describe('The format of the column.').optional(),
            enum: z.array(z.string()).optional(),
            pattern: z.string().describe('The regex pattern for the column.').optional(),
            minimum: z.number().optional(),
            maximum: z.number().optional(),
        })//.optional()
    })).describe("The column name and description for each column of the table. Choose the column best suited for a chart label as the first element."),
    wellApiNumber: z.string().describe('The API number of the well to find information about')
});

// function pivotLists<T>(lists: T[][]): T[][] {
//     if (lists.length === 0) return [];

//     return lists[0].map((_, colIndex) =>
//         lists.map(row => row[colIndex])
//     );
// }

async function listFilesUnderPrefix(
    props: {
        bucketName: string,
        prefix: string,
        suffix?: string
    }
): Promise<string[]> {
    const { bucketName, prefix, suffix } = props
    // Create S3 client
    const files: string[] = [];

    // Prepare the initial command input
    const input: ListObjectsV2CommandInput = {
        Bucket: bucketName,
        Prefix: prefix,
    };

    try {
        let isTruncated = true;

        while (isTruncated) {
            const command = new ListObjectsV2Command(input);
            const response = await s3Client.send(command);

            // Add only the files that match the suffix to our array
            response.Contents?.forEach((item) => {
                if (item.Key && item.Key.endsWith(suffix || "")) {
                    files.push(item.Key);
                }
            });

            // Check if there are more files to fetch
            isTruncated = response.IsTruncated || false;

            // If there are more files, set the continuation token
            if (isTruncated && response.NextContinuationToken) {
                input.ContinuationToken = response.NextContinuationToken;
            }
        }

        return files;
    } catch (error) {
        console.error('Error listing files:', error);
        throw error;
    }
}

function removeSpaceAndLowerCase(str: string): string {
    //return a string that matches regex pattern '^[a-zA-Z0-9_-]{1,64}$'
    let transformed = str.replaceAll(" ", "").toLowerCase()
    transformed = transformed.replaceAll(/[^a-zA-Z0-9_-]/g, '');
    transformed = transformed.slice(0, 64);

    return transformed;
}

async function listS3Folders(
    props: {
        bucketName: string, 
        prefix: string
    },
  ): Promise<string[]> {
    const {bucketName, prefix} = props

    const s3Client = new S3Client({});
    
    // Add trailing slash if not present
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    
    const input: ListObjectsV2CommandInput = {
      Bucket: bucketName,
      Delimiter: '/',
      Prefix: normalizedPrefix,
    };
  
    try {
      const command = new ListObjectsV2Command(input);
      const response = await s3Client.send(command);

    //   console.log('list folders s3 response:\n',response)
  
      // Get common prefixes (folders)
      const folders = response.CommonPrefixes?.map(prefix => prefix.Prefix!.slice(normalizedPrefix.length)) || [];

    //   console.log('folders: ', folders)
      
      // Filter out the current prefix itself and just get the part of the prefix after the normalizedPrefix
      return folders
        .filter(folder => folder !== normalizedPrefix)
  
    } catch (error) {
      console.error('Error listing S3 folders:', error);
      throw error;
    }
  }

export const wellTableToolBuilder = (amplifyClientWrapper: AmplifyClientWrapper) => tool(
    async ({ dataToInclude, tableColumns, wellApiNumber, dataToExclude }) => {
        if (!process.env.DATA_BUCKET_NAME) throw new Error("DATA_BUCKET_NAME environment variable is not set")
        // const sfnClient = new SFNClient({
        //     region: process.env.AWS_REGION,
        //     maxAttempts: 3,
        // });
        //If tableColumns contains a column with columnName date, remove it. The user may ask for one, and one will automatically be added later.
        tableColumns = tableColumns.filter(column => column.columnName.toLowerCase() !== 'date')
        // Here add in the default table columns date and excludeRow

        tableColumns.unshift({
            columnName: 'date',
            columnDescription: `The date of the event in YYYY-MM-DD format.`,
            columnDefinition: {
                type: 'string',
                format: 'date',
                pattern: "^(?:\\d{4})-(?:(0[1-9]|1[0-2]))-(?:(0[1-9]|[12]\\d|3[01]))$"
            }
        })

        tableColumns.unshift({
            columnName: 'includeScore',
            columnDescription: `
            If the JSON object contains information related to [${dataToExclude}], give a score of 1.
            If not, give a score of 10 if JSON object contains information related to [${dataToInclude}].
            Most scores should be around 5. Reserve 10 for exceptional cases.
            `,
            columnDefinition: {
                type: 'integer',
                minimum: 0,
                maximum: 10
            }
        })

        tableColumns.unshift({
            columnName: 'includeScoreExplanation',
            columnDescription: `Why did you choose that score?`,
            columnDefinition: {
                type: 'string',
            }
        })

        tableColumns.unshift({
            columnName: 'relevantPartOfJsonObject',
            columnDescription: `Which part of the object caused you to give that score?`,
            columnDefinition: {
                type: 'string',
            }
        })

        console.log('Input Table Columns: ', tableColumns)

        // const correctedColumnNameMap = tableColumns.map(column => [removeSpaceAndLowerCase(column.columnName), column.columnName])
        const correctedColumnNameMap = Object.fromEntries(
            tableColumns
                .filter(column => column.columnName !== removeSpaceAndLowerCase(column.columnName))
                .map(column => [removeSpaceAndLowerCase(column.columnName), column.columnName])
        );

        const fieldDefinitions: Record<string, FieldDefinition> = {};
        for (const column of tableColumns) {
            const correctedColumnName = removeSpaceAndLowerCase(column.columnName)

            fieldDefinitions[correctedColumnName] = {
                ...(column.columnDefinition ? column.columnDefinition : { type: 'string' }),
                description: column.columnDescription
            };
        }
        const jsonSchema = {
            title: "getKeyInformationFromImages",
            description: "Fill out these arguments based on the image data",
            type: "object",
            properties: fieldDefinitions,
            required: Object.keys(fieldDefinitions),
        };

        console.log('target json schema for row:\n', JSON.stringify(jsonSchema, null, 2))

        let columnNames = tableColumns.map(column => column.columnName)
        //Add in the source and relevanceScore columns
        columnNames.push('s3Key')

        const s3Prefix = `production-agent/well-files/field=SanJuanEast/api=${wellApiNumber}/`;
        const wellFiles = await listFilesUnderPrefix({
            bucketName: process.env.DATA_BUCKET_NAME,
            prefix: s3Prefix,
            suffix: '.yaml'
        })
        console.log('Well Files: ', wellFiles)

        if (wellFiles.length === 0) {
            const oneLevelUpS3Prefix = s3Prefix.split('/').slice(0,-2).join('/')
            
            console.log('one level up s3 prefix: ', oneLevelUpS3Prefix)
            const s3Folders = await listS3Folders({
                bucketName: process.env.DATA_BUCKET_NAME,
                prefix: oneLevelUpS3Prefix
            })//await onFetchObjects(oneLevelUpS3Prefix)
            // const s3Folders = s3ObjectsOneLevelHigher.filter(s3Asset => s3Asset.IsFolder).map(s3Asset => s3Asset.Key)

            return {
                messageContentType: 'tool_json',
                error: `
                No files found for well API number: ${wellApiNumber}
                Available well APIs:\n${s3Folders.join('\n')}
                `
            } as ToolMessageContentType
        }

        const dataRows = await processWithConcurrency({
            items: wellFiles,
            concurrency: 20,
            fn: async (s3Key) => {
                try {

                    const getObjectResponse = await s3Client.send(new GetObjectCommand({
                        Bucket: process.env.DATA_BUCKET_NAME,
                        Key: s3Key
                    }))

                    const objectContent = await getObjectResponse.Body?.transformToString()
                    if (!objectContent) throw new Error(`No object content for s3 key: ${s3Key}`)

                    const messageText = `ß
                    The user is asking you to extract information from a YAML object.
                    The YAML object contains information about a well.
                    <YamlObject>
                    ${objectContent}
                    </YamlObject>
                    `

                    const fileDataResponse = await amplifyClientWrapper.amplifyClient.graphql({ //To stream partial responces to the client
                        query: invokeBedrockWithStructuredOutput,
                        variables: {
                            chatSessionId: 'dummy',
                            lastMessageText: messageText,
                            outputStructure: JSON.stringify(jsonSchema)
                        }
                    })

                    // If the GQL query returns an error, return the error to the agent
                    if (fileDataResponse.errors) {
                        return {
                            messageContentType: 'tool_json',
                            error: fileDataResponse.errors.map((error) => error.message).join('\n\n')
                        } as ToolMessageContentType
                    }

                    const fileData = JSON.parse(fileDataResponse.data.invokeBedrockWithStructuredOutput || "")

                    //Replace the keys in file Data with those from correctedColumnNameMap
                    Object.keys(fileData).forEach(key => {
                        if (key in correctedColumnNameMap) {
                            const correctedKey = correctedColumnNameMap[key]
                            fileData[correctedKey] = fileData[key]
                            delete fileData[key]
                        }
                    })

                    return {
                        ...fileData,
                        s3Key: s3Key
                    }
                } catch (error) {
                    console.error('Error:', error);
                }
            }
        })


        // console.log('data Rows: ', dataRows)

        //Sort the data rows by date (first column)
        dataRows.sort((a, b) => a?.date.localeCompare(b?.date));

        console.log('data Rows: ', dataRows)

        return {
            messageContentType: 'tool_table',
            queryResponseData: dataRows
        } as ToolMessageContentType
    },
    {
        name: "wellTableTool",
        description: "This tool searches the well files to extract specified information about a well. Use this tool when asked to search the well files.",
        schema: wellTableSchema,
    }
);

