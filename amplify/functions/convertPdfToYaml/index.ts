import { stringify } from 'yaml';
import { S3Event, S3Handler, SQSEvent, SQSHandler } from 'aws-lambda';

import { HumanMessage, AIMessage, ToolMessage, BaseMessage, MessageContentText } from "@langchain/core/messages";
import { ChatBedrockConverse } from "@langchain/aws";

import { convertPdfToB64Strings } from '../utils/pdfUtils'
import { correctStructuredOutputResponse } from '../utils/amplifyUtils'
import { uploadStringToS3 } from '../utils/sdkUtils'

const imageBatchSize = 2 //Claude.ai can handle 5 images in a single request https://docs.anthropic.com/en/docs/build-with-claude/vision

export const handler: SQSHandler = async (event: SQSEvent) => {
    console.log('event:\n', JSON.stringify(event, null, 2))
    try {
        // Process each record in the event
        for (const sqsRecord of event.Records) {
            const sqsRecordContent = JSON.parse(sqsRecord.body) as S3Event

            for (const s3Record of sqsRecordContent.Records) {

                // Get bucket and key from the event
                const bucket = s3Record.s3.bucket.name;
                const key = decodeURIComponent(s3Record.s3.object.key.replace(/\+/g, ' '));

                console.log(`Processing file: ${key} from bucket: ${bucket}`);

                const pdfImageBuffers = await convertPdfToB64Strings({ s3BucketName: bucket, s3Key: key })
                const imageMessaggeContentBlocks = pdfImageBuffers.map((imageB64String) => ({
                    type: "image_url",
                    image_url: {
                        url: `data:image/png;base64,${imageB64String}`,
                    }
                }))

                const outputStructure = {
                    title: "FileContentsJSON",
                    description: "All of the information in the file extracted into JSON form",
                    type: "object",
                    additionalProperties: true
                };

                const chatModelWithStructuredOutput = new ChatBedrockConverse({
                    model: process.env.MODEL_ID,
                    temperature: 0
                }).withStructuredOutput(
                    outputStructure,
                    { includeRaw: true, }
                )

                const documentContent = [];
                for (let i = 0; i < imageMessaggeContentBlocks.length; i += imageBatchSize) {
                    const contentMessagesBatch = imageMessaggeContentBlocks.slice(i, i + imageBatchSize);
                    const messages = [
                        new HumanMessage({
                            content: [
                                ...contentMessagesBatch,
                                {
                                    type: "text",
                                    text: `
                                The user is asking you to extract information from an image of a PDF document. 
                                Respond with a JSON object which contains all of the information from the document.
                                `
                                },
                            ]
                        }
                        )
                    ]

                    // console.log('Invoking FM with messages:\n', messages)

                    let structuredOutputResponse = await chatModelWithStructuredOutput.invoke(messages)
                    console.log('structuredOutputResponse response: ', structuredOutputResponse)

                    //If the parsing fails, retry the request
                    structuredOutputResponse = await correctStructuredOutputResponse(
                        chatModelWithStructuredOutput,
                        structuredOutputResponse,
                        outputStructure,
                        messages
                    )

                    documentContent.push(structuredOutputResponse.parsed);
                }

                await uploadStringToS3({
                    bucket: bucket,
                    key: key + '.yaml',
                    content: stringify(documentContent)
                })

                console.log(`Successfully processed file: ${key}. Content:\n`, documentContent);
            }
        }

    } catch (error) {
        console.error('Error processing file:', error);
        throw error;
    }
};