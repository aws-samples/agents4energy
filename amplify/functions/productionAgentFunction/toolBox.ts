import { stringify } from 'yaml'
import { z } from "zod";

import { LambdaClient, InvokeCommand, InvokeCommandInput } from "@aws-sdk/client-lambda";
import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { SFNClient, StartSyncExecutionCommand } from "@aws-sdk/client-sfn";

import { tool } from "@langchain/core/tools";
import { env } from '$amplify/env/production-agent-function';

import { startQueryExecution, waitForQueryToComplete, getQueryResults, transformResultSet } from '../utils/sdkUtils'

import * as Plotly from 'plotly.js';

import { ToolMessageContentType } from '../../../src/utils/types'

// type ToolMessageWithContentType = {
//     messageContentType: string;
//     [key: string]: any;
// };


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
    tableFeatures: z.string().describe("Which features of the user's question should be looked for when picking which tables to query?"),
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
        console.log("Text2Sql KB response:\n", relevantTables)


        const tableDefinitions = relevantTables.map((result) =>
        ({
            ...JSON.parse(result?.content?.text || ""),
            score: result?.score
        }))

        console.log('Table Definitions:\n', tableDefinitions)

        // console.log(relevantTables.map((result) => stringify(JSON.parse(result?.content?.text || ""))).join('\n\n'))

        // return outputBlurb
        return {
            messageContentType: 'tool_json',
            tableDefinitions: tableDefinitions
        } as ToolMessageContentType
    },
    {
        name: "getTableDefinitionsTool",
        description: "Can retrieve database table definitons which can help answer a user's question.",
        schema: getTableDefinitionsSchema,
    }
);

///////////////////////////////////////////////////
///// Execute SQL Statement Return Plot Tool //////
///////////////////////////////////////////////////

const executeSQLQueryReturnPlotSchema = z.object({
    query: z.string().describe(`
        The Trino SQL query to be executed. 
        Use the DATE_ADD(unit, value, timestamp) function any time you're adding an interval value to a timestamp.
        The result from executing this query will be plotted. One of the columns will be chosen for the X axis, and the others will be plotted on the Y axis.
        `),
    database: z.string().describe("The database in which the query will be executed."),
    columnNameFromQueryForXAxis: z.string().describe("The column name of the SQL query result to be plotted on the X axis"),
    chartTitle: z.string().describe("The title of the plot."),
});

export const executeSQLQueryTool = tool(
    async ({ query, database, columnNameFromQueryForXAxis, chartTitle }) => {
        console.log('Executing SQL Query:\n', query, '\nUsing workgroup: ', env.ATHENA_WORKGROUP_NAME)
        try {
            const queryExecutionId = await startQueryExecution({
                query: query,
                workgroup: env.ATHENA_WORKGROUP_NAME,
                database: database,
                athenaCatalogaName: env.ATHENA_CATALOG_NAME
            });
            await waitForQueryToComplete(queryExecutionId, env.ATHENA_WORKGROUP_NAME);
            const results = await getQueryResults(queryExecutionId);
            console.log('Athena Query Result:\n', results);

            if (!results.ResultSet?.Rows) throw new Error("No results returned from Athena")

            const queryResponseData = transformResultSet(results.ResultSet)

            if (!(columnNameFromQueryForXAxis in queryResponseData)) {
                return {
                    messageContentType: 'tool_json',
                    error: `
                    Column name "${columnNameFromQueryForXAxis}" is not present in the result of the SQL query column names: ${queryResponseData.keys}
                    Be sure to select a column from the sql query for the x axis.
                    `
                } as ToolMessageContentType
            }

            // queryResponseData.filter((columnName) => )
            const plotData: Plotly.Data[] = Object.keys(queryResponseData)
                .filter(key => key !== columnNameFromQueryForXAxis)
                .map((columnName) => (
                    {
                        x: queryResponseData[columnNameFromQueryForXAxis],
                        y: queryResponseData[columnName],
                        // type: 'scatter',
                        mode: 'lines+markers',
                        // marker: { color: 'blue' },
                        name: columnName
                    }

                ))

            // const plotData: Plotly.Data[] = [{
            //     x: [1, 2, 3, 4, 5],
            //     y: [1, 4, 9, 16, 25],
            //     type: 'scatter',
            //     mode: 'lines+markers',
            //     marker: { color: 'blue' },
            //     name: 'Square Function'
            // }];

            // Define the layout for the plot
            const plotLayout: Partial<Plotly.Layout> = {
                title: chartTitle,
                xaxis: { title: columnNameFromQueryForXAxis },
                yaxis: {
                    title: 'Y Axis (Log Scale)',
                    type: 'log'  // This sets the y-axis to log scale
                },
                showlegend: true
            };

            // Configuration options
            const plotConfig: Partial<Plotly.Config> = {
                responsive: true
            };

            return {
                messageContentType: 'tool_plot',
                queryResponse: queryResponseData,
                plotData: plotData,
                plotLayout: plotLayout,
                plotConfig: plotConfig
            } as ToolMessageContentType

            // return stringify(queryResponseData)
        } catch (error) {
            console.error('Error executing sql query:', error);
            return {
                messageContentType: 'tool_json',
                error: error instanceof Error ? error.message : `An unknown error occurred.\n${JSON.stringify(error)}`
            } as ToolMessageContentType
        }
    },
    {
        name: "executeSQLQueryReturnPlot",
        description: "Can execute a Trino SQL query and returns a plot of the results.",
        schema: executeSQLQueryReturnPlotSchema,
    }
);

//////////////////////////////////////////
/////////// PDF to JSON Tool /////////////
//////////////////////////////////////////

const convertPdfToJsonSchema = z.object({
    s3Key: z.string().describe("The S3 key of the PDF file to convert."),
});

export const convertPdfToJsonTool = tool(
    async ({ s3Key }) => {
        const lambdaClient = new LambdaClient();
        const params: InvokeCommandInput = {
            FunctionName: env.CONVERT_PDF_TO_JSON_LAMBDA_ARN,
            Payload: JSON.stringify({ arguments: { s3Key: s3Key } }),
        };
        const response = await lambdaClient.send(new InvokeCommand(params));
        if (!response.Payload) throw new Error("No payload returned from Lambda")

        const jsonContent = JSON.parse(Buffer.from(response.Payload).toString())
        console.log('Json Content: ', jsonContent)

        // console.log(`Converting s3 key ${s3Key} into content blocks`)

        // const pdfImageBuffers = await convertPdfToB64Strings({s3BucketName: env.DATA_BUCKET_NAME, s3Key: s3Key})

        return {
            messageContentType: 'tool_json',
            content: jsonContent,
        } as ToolMessageContentType
    },
    {
        name: "convertPdfToJson",
        description: "Can convert a pdf stored in s3 into a JSON object. Use it to get details about a specific file.",
        schema: convertPdfToJsonSchema,
    }
);

//////////////////////////////////////////
//////// PDF Reports to Table Tool ///////
//////////////////////////////////////////

const wellTableSchema = z.object({
    dataToExclude: z.string().optional().describe("List of criteria to exclude data from the table"),
    dataToInclude: z.string().optional().describe("List of criteria to include data in the table"),
    tableColumns: z.array(z.object({
        columnName: z.string().describe('The name of a column'),
        columnDescription: z.string().describe('A description of the information which this column contains.'),
    })).describe("The column name and description for each column of the table."),
    wellApiNumber: z.string().describe('The API number of the well to find information about')
});

export const wellTableTool = tool(
    async ({ dataToInclude, tableColumns, wellApiNumber, dataToExclude }) => {
        const sfnClient = new SFNClient({
            region: process.env.AWS_REGION,
            maxAttempts: 3,
        });
        //If tableColumns contains a column with columnName date, remove it. The user may ask for one, and one will automatically be added later.
        tableColumns = tableColumns.filter(column => column.columnName.toLowerCase() !== 'date')
        // Here add in the default table columns date and excludeRow
        tableColumns.unshift({
            columnName: 'date', columnDescription: `The date of the event in YYYY-MM-DD format.`
        })

        // tableColumns.push({
        //     columnName: 'excludeRow', columnDescription: `
        //     Does this file contain any of the criteria below? 
        //     ${dataToExclude}
        //     `
        // })

        console.log('Table Columns: ', JSON.stringify(tableColumns))

        let columnNames = tableColumns.map(column => column.columnName)

        const s3Prefix = `production-agent/well-files/field=SanJuanEast/uwi=${wellApiNumber}/`;

        const command = new StartSyncExecutionCommand({
            stateMachineArn: env.STEP_FUNCTION_ARN,
            input: JSON.stringify({
                tableColumns: tableColumns,
                dataToInclude: dataToInclude || "[anything]",
                dataToExclude: dataToExclude || "[]",
                s3Prefix: s3Prefix,
            })
        });

        console.log('Calling Step Function with command: ', command)

        const sfnResponse = await sfnClient.send(command);
        console.log('Step Function Response: ', sfnResponse)

        if (!sfnResponse.output) {
            throw new Error(`No output from step function. Step function response:\n${JSON.stringify(sfnResponse, null, 2)}`);
        }

        // console.log('sfnResponse.output: ', sfnResponse.output)

        //Add in the source and relevanceScore columns
        columnNames.push('includeScore')
        columnNames.push('s3Key')

        // const numColumns = columnNames.length
        const tableRows = []
        let dataRows: string[][] = []
        const tableHeader = columnNames.join(' | ')
        tableRows.push(tableHeader)

        const tableDivider = columnNames.map(columnName => Array(columnName.length + 3).join('-')).join('|')
        tableRows.push(tableDivider)

        // const dummyData = Array(numColumns).fill('dummy').join('|')

        const rowData = JSON.parse(sfnResponse.output)

        console.log('rowData: ', rowData)

        rowData.forEach((s3ObjectResult: any) => {
            // console.log('s3ObjectResult: ', s3ObjectResult)
            if (s3ObjectResult.content) {
                s3ObjectResult.content.forEach((content: any) => { //TODO give content a type based on the column names
                    // console.log('content: ', content)

                    const newRow: string[] = []

                    columnNames.forEach((key) => {
                        if (key === 's3Key') {
                            //Add the link the the s3 source
                            newRow.push(`[${s3ObjectResult.document_source_s3_key}](/files/${s3ObjectResult.document_source_s3_key})`)
                        }
                        else {
                            // If the key exists in content, remove all non-printable characters and add the data to the new row
                            const cellValue = `${content[key]}`.replace(/[\r\n\t]/g, '')
                            if (cellValue) {
                                // const cleanedStr = cellValue.replace(/[\r\n\t]/g, '');
                                newRow.push(cellValue)
                            } else {
                                newRow.push(" ")
                            }
                        }

                    })

                    dataRows.push(newRow)

                });
            }
        });

        // console.log('dataRows: ', dataRows)
        //Sort the data rows by date (first column)
        dataRows.sort((a, b) => a[0].localeCompare(b[0]));
        tableRows.push(...dataRows.map(row => row.join(' | ')))

        const outputTable = tableRows.map(val => '|' + val + '|').join('\n')

        return {
            messageContentType: 'tool_table',
            outputTableDef: outputTable
        } as ToolMessageContentType
        // return [tableHeader, tableDivider, dummyData, dummyData].map(val => '|' + val + '|').join('\n')
    },
    {
        name: "wellTableTool",
        description: "This tool produces tabular information about a well.",
        schema: wellTableSchema,
    }
);

