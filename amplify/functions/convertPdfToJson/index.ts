import { Schema } from '../../data/resource';
import { convertPdfToB64Strings } from '../utils/pdfUtils'
import { getLangChainMessageTextContent } from '../utils/amplifyUtils'
import { HumanMessage, AIMessage, ToolMessage, BaseMessage, MessageContentText } from "@langchain/core/messages";
import { ChatBedrockConverse } from "@langchain/aws";

function isValidJSON(str: string): boolean {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}

function trimToJsonContent(input: string): string {
    const startIndex = input.indexOf('{');
    const endIndex = input.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
        throw new Error('Invalid JSON-like string: missing opening or closing braces');
    }

    return input.slice(startIndex, endIndex + 1);
}



export const handler: Schema["convertPdfToJson"]["functionHandler"] = async (event, context) => {

    // throw new Error("This function is not implemented yet");
    // console.log('event: ', event)
    // console.log('context: ', context)
    // console.log('Amplify env: ', env)

    if (!process.env.DATA_BUCKET_NAME) throw new Error("DATA_BUCKET_NAME does not exist in env vars");

    const pdfImageBuffers = await convertPdfToB64Strings({ s3BucketName: process.env.DATA_BUCKET_NAME, s3Key: event.arguments.s3Key })
    const imageMessaggeContentBlocks = pdfImageBuffers.map((imageB64String) => ({
        type: "image_url",
        image_url: {
            url: `data:image/png;base64,${imageB64String}`,
        }
    })
    )

    const model = new ChatBedrockConverse({
        model: process.env.MODEL_ID,
        temperature: 0
    })

    const documentContent = [];
    for (let i = 0; i < imageMessaggeContentBlocks.length; i += 20) {
        const contentMessagesBatch = imageMessaggeContentBlocks.slice(i, i + 20);
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

        let response = await model.invoke(messages)
        console.log('model response: ', response)

        const responseText = getLangChainMessageTextContent(response)
        if (!responseText) throw new Error("No response text found in response: " + response)

        let trimmedResponseText = trimToJsonContent(responseText)

        for (let attempt = 0; attempt < 3; attempt++) {
            const validationReslut = isValidJSON(trimmedResponseText);
            console.log(`Data validation result (${attempt}): `, validationReslut);
            if (validationReslut) break

            console.log('Model response which caused error: \n', response);
            messages.push(
                new AIMessage({ content: trimmedResponseText }),
                new HumanMessage({ content: `The returned text above is not valid JSON. Please correct it to be valid JSON. Only respond with the JSON object` })
            );
            response = await model.invoke(messages)
            const responseText = getLangChainMessageTextContent(response)
            if (!responseText) throw new Error("No response text found in response: " + response)
            trimmedResponseText = trimToJsonContent(responseText)
        }

        documentContent.push(JSON.parse(trimmedResponseText));
    }
    return {
        documentContent: documentContent
    }

};