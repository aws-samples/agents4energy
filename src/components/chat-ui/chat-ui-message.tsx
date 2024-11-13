"use client"
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { Link } from '@mui/material';

import {
  Button,
  Container,
  Popover,
  Spinner,
  StatusIndicator
} from "@cloudscape-design/components";

import { stringify } from 'yaml'

import remarkGfm from "remark-gfm";
import ReactMarkdown from "react-markdown";

import { formatDate } from "@/utils/date-utils";
import { amplifyClient, invokeBedrockModelParseBodyGetText } from '@/utils/amplify-utils';

import styles from "@/styles/chat-ui.module.scss";
import React, { useState, useEffect } from "react";
import { Message, messageContentType, ToolMessageContentType } from "../../utils/types";

// import PlotComponent from '../PlotComponent'
import { Scatter } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale,
  // ChartData,
  // Point,
  ChartOptions
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-date-fns';
import { enUS } from 'date-fns/locale';

ChartJS.register(
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale,
  zoomPlugin
);

export interface ChatUIMessageProps {
  // message: Schema["ChatMessage"]["type"];
  message: Message;
  allMessages: Message[];
  showCopyButton?: boolean;
}

//https://json-schema.org/understanding-json-schema/reference/array
const getDataQualityCheckSchema = {
  title: "DataQualityCheck",
  description: "Identify any inaccurate data",
  type: "object",
  properties: {
    dataChecks: {
      type: 'array',
      items: {
        type: 'string'
      },
      minItems: 0,
      maxItems: 5,
      description: "Identified issues"
    }
  },
  required: ['dataChecks'],
};

function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

function zipLists<T, U>(list1: T[], list2: U[]): { x: T, y: U }[] {
  const minLength = Math.min(list1.length, list2.length);
  const result: { x: T, y: U }[] = [];

  for (let i = 0; i < minLength; i++) {
    result.push({ x: list1[i], y: list2[i] });
  }

  return result;
}

type TransformToDataRowsInputData = {
  [key: string]: (string | number)[]
};

type TransformToDataRowsOutputData = {
  id: string;
  [key: string]: string;
};

function transformDataToRows(input: TransformToDataRowsInputData): TransformToDataRowsOutputData[] {
  const keys = Object.keys(input);
  const firstArrayLength = input[keys[0]].length;

  // Check if all arrays have the same length
  if (!keys.every(key => input[key].length === firstArrayLength)) {
    throw new Error("All arrays must have the same length");
  }

  return Array.from({ length: firstArrayLength }, (_, i) =>
    keys.reduce((obj, key) => {
      obj["id"] = `${i}`
      obj[key] = `${input[key][i]}`;
      return obj;
    }, {} as TransformToDataRowsOutputData)
  );
}

function generateColor(index: number): string {
  const hue = (index * 137.508) % 360; // Use golden angle approximation
  return `hsl(${hue}, 70%, 60%)`;
}

function getMessageCatigory(message: Message): messageContentType {
  if (!message.tool_name) {
    //This is an AI message
    return 'ai'
  } else if (!isValidJSON(message.content)) {
    //This is a markdown tool message
    return 'tool_markdown'
  } else {
    return (JSON.parse(message.content) as ToolMessageContentType).messageContentType
  }
}

export default function ChatUIMessage(props: ChatUIMessageProps) {
  const [hideRows, setHideRows] = useState<boolean>(true)
  const [glossaryBlurbs, setGlossaryBlurbs] = useState<{ [key: string]: string }>({})
  const [dataQualityBlurb, setDataQualityBlurb] = useState("")
  const [messagePlot, setMessagePlot] = useState<React.FC>()
  const [messageTable, setMessageTable] = useState<React.FC>()
  if (!props.message.createdAt) throw new Error("Message createdAt missing");

  const messageContentCategory = getMessageCatigory(props.message);

  useEffect(() => {
    switch (messageContentCategory) {
      case 'tool_plot':
        //TODO - Make oil green, gas red, water blue, ...
        const { chartData, columnNameFromQueryForXAxis, chartTitle } = JSON.parse(props.message.content) as {
          chartData: { [key: string]: (string | number)[] },
          columnNameFromQueryForXAxis: string,
          chartTitle: string | undefined
        }

        const datasets = Object.keys(chartData)
          .filter(key => key !== columnNameFromQueryForXAxis)
          .map((columnName, index) => ({
            data: zipLists(chartData[columnNameFromQueryForXAxis], chartData[columnName]),
            mode: 'lines+markers',
            backgroundColor: generateColor(index),
            label: columnName,
          }
          ))

        const options: ChartOptions<'scatter'> = {
          scales: {
            x: {
              type: 'time' as const,
              time: {
                unit: 'day' as const,
                tooltipFormat: 'PP',
                displayFormats: {
                  day: 'MMM d',
                },
              },
              title: {
                display: true,
                text: columnNameFromQueryForXAxis,
              },
              adapters: {
                date: {
                  locale: enUS,
                },
              },
            },
            y: {
              type: 'logarithmic' as const,
              title: {
                display: true,
                text: 'Value (log scale)',
              },
            },
          },
          plugins: {
            title: {
              text: chartTitle,
              display: true
            },
            // title: {
            //   display: true,
            //   text: 'Custom Chart Title'
            // },
            zoom: {
              pan: {
                enabled: true,
                modifierKey: "alt"
              },
              zoom: {
                wheel: {
                  enabled: true,
                },
                drag: {
                  enabled: true,
                  modifierKey: "shift"
                },
              }
            }
          }
        };

        setMessagePlot(() => (
          <>
            {/* <pre
              style={{ //Wrap long lines
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {stringify(JSON.parse(props.message.content))}
            </pre> */}
            <Scatter
              data={{
                datasets: datasets,
              }}
              options={options}
            />
          </>

        ))
      case 'tool_table':
        // https://mui.com/x/react-data-grid/
        const queryResponseData: { [key: string]: (string | number)[] } = JSON.parse(props.message.content as string).queryResponseData

        if (!queryResponseData) {
          console.log('no query response data')
          return
        }

        console.log('Query Response Data: ', queryResponseData)

        const columnNames = Object.keys(queryResponseData)

        const columns: GridColDef<TransformToDataRowsOutputData>[] = columnNames
          .filter((columnName) => columnName !== 's3Key')
          .map((name) => ({
            field: `${name}`,
            headerName: `${name}`,
            flex: 1,
            minWidth: 150,
            renderCell: (params) => (
              <div style={{
                whiteSpace: 'normal',
                wordWrap: 'break-word',
                lineHeight: 'normal',
                width: '100%'
              }}>
                {params.value}
              </div>
            ),
          }));

        if (columnNames.includes('s3Key')) {
          columns.push({
            field: 's3Key',
            headerName: 's3Key',
            flex: 1,
            minWidth: 150,
            renderCell: (params) => (
              <Link href={`/files/${params.value}`} target="_blank" rel="noopener">
                {params.value}
              </Link>
            ),

          })
        }

        const rowData = transformDataToRows(queryResponseData)

        console.log('Row Data: ', rowData)

        setMessageTable(() => (
          <>
            {/* <pre
              style={{ //Wrap long lines
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {stringify(JSON.parse(props.message.content))}
            </pre> */}

            <DataGrid
              rows={rowData}
              columns={columns}
              initialState={{
                pagination: {
                  paginationModel: {
                    pageSize: 5,
                  },
                },
              }}
              pageSizeOptions={[5]}
              checkboxSelection
              disableRowSelectionOnClick

              getRowHeight={() => 'auto'}

              sx={{
                '& .MuiDataGrid-cell': {
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                },
                '& .MuiDataGrid-row': {
                  maxHeight: 'none !important',
                },
                '& .MuiDataGrid-renderingZone': {
                  maxHeight: 'none !important',
                },
                '& .MuiDataGrid-virtualScroller': {
                  // Disable virtual scrolling
                  overflowY: 'visible !important',
                },
              }}
            />
          </>

        ))


      // const rows: {id: string}[] = data.date.map((date, index) => ({
      //   id: index,
      //   date: date,
      //   value: data.value[index],
      // }));

      // const columns: GridColDef<(typeof rows)[number]>[] = []



    }
  }, [props.message, messageContentCategory])

  // async function getGlossary(message: Schema["ChatMessage"]["type"]) {
  async function getGlossary(message: Message) {

    if (!message.chatSessionId) throw new Error(`No chat session id in message: ${message}`)

    if (message.chatSessionId in glossaryBlurbs) return

    const getGlossaryPrompt = `
    Return a glossary for terms found in the text blurb below:

    ${message.content}
    `
    const newBlurb = await invokeBedrockModelParseBodyGetText(getGlossaryPrompt)
    if (!newBlurb) throw new Error("No glossary blurb returned")
    setGlossaryBlurbs((prevGlossaryBlurbs) => ({ ...prevGlossaryBlurbs, [message.chatSessionId || "ShouldNeverHappen"]: newBlurb })) //TODO fix this
  }

  // async function getDataQualityCheck(message: Schema["ChatMessage"]["type"]) {
  async function getDataQualityCheck(message: Message) {
    setDataQualityBlurb("")

    if (!message.chatSessionId) throw new Error(`No chat session id in message: ${message}`)

    const dataQualityCheckResponse = await amplifyClient.queries.invokeBedrockWithStructuredOutput({
      chatSessionId: message.chatSessionId,
      lastMessageText: "What data quality issues can you identify in the messages above?",
      outputStructure: JSON.stringify(getDataQualityCheckSchema)
    })
    console.log("Data Quality Check Response: ", dataQualityCheckResponse)
    if (dataQualityCheckResponse.data) {
      const newDataQualityChecks = JSON.parse(dataQualityCheckResponse.data).dataChecks as string[]
      if (newDataQualityChecks.length) {
        setDataQualityBlurb(() => newDataQualityChecks.join('\n\n'))
      } else {
        setDataQualityBlurb(() => "No data quality issues identified")
      }


    } else console.log('No suggested prompts found in response: ', dataQualityCheckResponse)


  }

  return (
    <div>
      {props.message?.role != 'human' && (
        <Container>
          <div className={styles.btn_chabot_message_copy}>
            <Popover
              size="medium"
              position="top"
              triggerType="custom"
              dismissButton={false}
              content={
                <StatusIndicator type="success">
                  Copied to clipboard
                </StatusIndicator>
              }
            >
              <Button
                variant="inline-icon"
                iconName="copy"
                onClick={() => {
                  navigator.clipboard.writeText(props.message.content);
                }}
              />
            </Popover>
          </div>

          {props.message.chatSessionId ? (
            <>
              <div className={styles.btn_chabot_message_copy}>
                <Popover
                  size="medium"
                  position="top"
                  triggerType="custom"
                  dismissButton={false}
                  content={
                    <p>
                      {dataQualityBlurb ? dataQualityBlurb : <Spinner />}
                    </p>
                  }
                >
                  <Button
                    onClick={() => getDataQualityCheck(props.message)}
                  >
                    Data Quality Check
                  </Button>
                </Popover>
              </div>

              <div className={styles.btn_chabot_message_copy}>
                <Popover
                  size="medium"
                  position="top"
                  triggerType="custom"
                  dismissButton={false}
                  content={
                    <p>
                      {glossaryBlurbs[props.message.chatSessionId] ? glossaryBlurbs[props.message.chatSessionId] : <Spinner />}
                    </p>
                  }
                >
                  <Button
                    onClick={() => getGlossary(props.message)}
                  >
                    Show Glossary
                  </Button>
                </Popover>
              </div>
            </>
          ) : null
          }

          {props.message.trace ? (
            <div className={styles.btn_chabot_message_copy}>
              <Popover
                size="medium"
                position="top"
                triggerType="custom"
                dismissButton={false}
                content={
                  <p>{props.message.trace}</p>
                }
              >
                <Button>
                  Chain Of Thought
                </Button>
              </Popover>
            </div>
          ) : null
          }

          {/* If the tool returns a table, add the show / hide rows button */}
          {messageContentCategory === 'tool_table' ? (
            <div className={styles.btn_chabot_message_copy}>
              <Popover
                size="medium"
                position="top"
                triggerType="custom"
                dismissButton={false}
                content={
                  <StatusIndicator type="success" />
                }
              >
                <Button
                  onClick={() => {
                    setHideRows(prevState => !prevState);
                  }}
                >
                  {hideRows ? 'Show All Rows' : 'Hide Low Relevance Rows'}
                </Button>
              </Popover>
            </div>
          ) : null}

          <strong>{formatDate(props.message.createdAt)}</strong>
          {/* Show the tool call id if it exists */}
          {props.message.tool_call_id ? (
            <div>
              <p>Tool Name: {props.message.tool_name}</p>
            </div>
          ) : null
          }

          {/* Here's where the body of the message renders */}
          {/* This will render a table */}
          {/* {props.message.tool_name && !isValidJSON(props.message.content) && !isValidYAML(props.message.content) ? ( */}
          {/* First lets decide if the message comes from a tool or not */}
          {(() => {
            switch (messageContentCategory) {
              case 'tool_plot':
                return <>
                  {/* <pre
                    style={{ //Wrap long lines
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {JSON.stringify(datasets, null, 2)}
                  </pre> */}

                  {messagePlot ? messagePlot : null}
                </>
              case 'tool_table':
                return <>
                  {messageTable ? messageTable : null}
                </>
              case 'tool_json':
                return <pre
                  style={{ //Wrap long lines
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                  }}
                >
                  {
                    isValidJSON(props.message.content) ?
                      stringify(JSON.parse(props.message.content)) :
                      props.message.content
                  }
                </pre>/* Render as YAML */;
              // case 'tool_table':
              //   return <ReactMarkdown
              //     remarkPlugins={[remarkGfm]}
              //     components={{
              //       table: ({ ...props }) => (
              //         <table className={styles.markdownTable} {...props} />
              //       ),
              //       tr: ({ ...props }) => {

              //         //Get the value of the relevance score in each table row
              //         const children = React.Children.toArray(props.children);

              //         const relevanceScoreTd = children[children.length - 2]; // should be second from the last

              //         if (!(React.isValidElement(relevanceScoreTd))) throw new Error("Invalid second from last <td> element");

              //         const relevanceScoreTdValue = relevanceScoreTd?.props?.children || '10'; // Here you can impliment conditional hiding of rows

              //         // console.log("relevanceScore <td> value:", relevanceScoreTdValue); // This will log the value

              //         //Hide rows with a low relevanceScore
              //         if (hideRows && parseInt(relevanceScoreTdValue) < 4) return <tr className={styles.hiddenRow} {...props} />

              //         // Add a 📄 to the second from the last child in props
              //         // children.splice(children.length - 2, 0, ' ���');
              //         // children[children.length - 2].props?.children = 'hello'

              //         else return <tr {...props} />
              //       },
              //     }}
              //   >
              //     {props.message.content}
              //   </ReactMarkdown>;
              default: //Default will be to render markdown
                return <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                >
                  {props.message.content}
                </ReactMarkdown>;
            }
          })()}

          {/* Show tool call ids and tool calls if they exist */}
          {props.message.tool_call_id ? (
            <div>
              <p>Tool Call Id: {props.message.tool_call_id}</p>
            </div>
          ) : null
          }
          {props.message.tool_calls && typeof props.message.tool_calls === 'string' && JSON.parse(props.message.tool_calls).length > 0 ? (
            <div>
              <strong>Tool Calls:</strong>
              <pre>{stringify(JSON.parse(props.message.tool_calls), null, 2)}</pre>
            </div>
          ) : null
          }
        </Container>
      )
      }
      {
        props.message?.role === 'human' && (
          <>
            <strong>{formatDate(props.message.createdAt)}</strong>
            <ReactMarkdown>
              {props.message.content}
            </ReactMarkdown>
          </>
        )
      }
    </div >
  );
}
