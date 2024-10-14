import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";

export const amplifyClient = generateClient<Schema>();

type BedrockAnthropicBodyType = {
    id: string;
    type: string;
    role: string;
    model: string;
    content: {
        type: string;
        text: string;
    }[];
    stop_reason: string;
    stop_sequence: null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
};

export const invokeBedrockModelParseBodyGetText = async (prompt: string) => {
    console.log('Prompt: ', prompt)
    const response = await amplifyClient.queries.invokeBedrock({ prompt: prompt })
    console.log('Bedrock Response: ', response.data)
    if (!(response.data && response.data.body)) {
        console.log('No response from bedrock after prompt: ', prompt)
        return
    }
    const bedrockResponseBody = JSON.parse(response.data.body) as BedrockAnthropicBodyType
    console.log('Bedrock Response Body: ', bedrockResponseBody)
    return bedrockResponseBody.content.map(item => item.text).join('\n')
}