import { Schema } from '../../data/resource';
import { convertPdfToB64Strings } from '../utils/pdfUtils'

export const handler: Schema["convertPdfToImages"]["functionHandler"] = async (event, context) => {

    // throw new Error("This function is not implemented yet");
    // console.log('event: ', event)
    // console.log('context: ', context)
    // console.log('Amplify env: ', env)

    if (!process.env.DATA_BUCKET_NAME) throw new Error("DATA_BUCKET_NAME does not exist in env vars");

    const pdfImageBuffers = await convertPdfToB64Strings({s3BucketName: process.env.DATA_BUCKET_NAME, s3Key: event.arguments.s3Key})
    const imageMessaggeContentBlocks = pdfImageBuffers.map((imageB64String) => ({
            type: "image_url",
            image_url: {
                url: `data:image/png;base64,${imageB64String}`,
            }
        })
    )

    return {
        imageMessaggeContentBlocks: imageMessaggeContentBlocks
    }

};