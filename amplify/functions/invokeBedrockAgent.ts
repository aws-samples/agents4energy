import type { Schema } from "../data/resource"
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const client = new BedrockAgentRuntimeClient();

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const handler: Schema["invokeBedrockAgent"]["functionHandler"] = async (event) => {
    const params = {
        agentId: event.arguments.agentId,
        agentAliasId: event.arguments.agentAliasId,
        sessionId: event.arguments.sessionId,
        inputText: event.arguments.prompt,
    };

    const command = new InvokeAgentCommand(params);

    const maxRetries = 3;
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            const response = await client.send(command);
            
            if (!response.completion) {
                throw new Error("No completion found in the response.");
            }

            console.log("Agent Response:", response.completion)

            let completion = '';
            for await (let chunkEvent of response.completion) {
                const chunk = chunkEvent.chunk;
                if (chunk) {
                    const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
                    completion += decodedResponse;
                }
            }

            console.log('Parsed event stream completion: ', completion);
            return completion;

        } catch (error: any) {
            console.error(`Attempt ${retries + 1} failed:`, error);

            if (error.name === 'ConflictException' || error.$metadata?.httpStatusCode === 409) {
                retries++;
                if (retries < maxRetries) {
                    const backoffTime = Math.pow(2, retries) * 100; // exponential backoff
                    console.log(`Retrying in ${backoffTime}ms...`);
                    await delay(backoffTime);
                } else {
                    throw new Error('Max retries reached. Unable to process the request.');
                }
            } else {
                // For other types of errors, throw immediately
                throw error;
            }
        }
    }

    throw new Error('Max retries reached. Unable to process the request.');
    // Send the command and wait for the response
    // const response = await client.send(command);
    // // Process the response
    // console.log("Agent Response:", response.completion);
    

    // // Use an async function to process the stream
    // const processStream = async () => {
    //     let completion = ''
    //     if (!response.completion) throw new Error("No completion found in the response.");
    //     for await (let chunkEvent of response.completion) {
    //         const chunk = chunkEvent.chunk;
    //         if (chunk) {
    //             const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
    //             completion += decodedResponse;
    //         }
    //     }
    //     return completion;
    // };

    // const bedrockAgentCompletion = await processStream()
    // let completion = "Start Response. ";
    // for await (let chunkEvent of response.completion) {
    //     const chunk = chunkEvent.chunk;
    //     // console.log(chunk);
    //     // if (!chunk) throw new Error("Chunk is undefined")
    //     if (chunk) {
    //         const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
    //         completion += decodedResponse;
    //     }
    // }

    // console.log('Parsed event stream completion: ', bedrockAgentCompletion)
    // return bedrockAgentCompletion;
};