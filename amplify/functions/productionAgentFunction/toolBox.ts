import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SFNClient, StartSyncExecutionCommand } from "@aws-sdk/client-sfn";
import { env } from '$amplify/env/production-agent-function'; // replace with your function name

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

const wellTableSchema = z.object({
    // tablePurpose: z.string().describe("The purpose for which the user is making this table"),
    dataToExclude: z.string().describe("List of criteria to exclude data from the table"),
    dataToInclude: z.string().describe("List of criteria to include data in the table"),
    tableColumns: z.array(z.object({
        columnName: z.string().describe('The name of a column'),
        columnDescription: z.string().describe('A description of the information which this column contains. Be sure never to use the " character'),
    })).describe("Information about the desired columns of the table"),
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

        const s3Prefix = `well-files/field=SanJuanEast/uwi=${wellApiNumber}/`;

        const command = new StartSyncExecutionCommand({
            stateMachineArn: env.STEP_FUNCTION_ARN,
            input: JSON.stringify({
                tableColumns: tableColumns,
                dataToInclude: dataToInclude,
                dataToExclude: dataToExclude,
                s3Prefix: s3Prefix,
            })
        });

        console.log('Calling Step Function with command: ', command)

        const sfnResponse = await sfnClient.send(command);
        console.log('Step Function Response: ', sfnResponse)

        if (!sfnResponse.output) {
            throw new Error(`No output from step function. Step function response:\n${JSON.stringify(sfnResponse, null,2)}`);
        }

        // console.log('sfnResponse.output: ', sfnResponse.output)

        //Add in the source and relevanceScore columns
        columnNames.push('includeScore')
        columnNames.push('source')

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
                        if (key === 'source') {
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

        return tableRows.map(val => '|' + val + '|').join('\n')
        // return [tableHeader, tableDivider, dummyData, dummyData].map(val => '|' + val + '|').join('\n')
    },
    {
        name: "wellTableTool",
        description: "Can extract tabular information about a well",
        schema: wellTableSchema,
    }
);