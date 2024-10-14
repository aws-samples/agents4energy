import type { Schema } from "../data/resource"
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const client = new BedrockAgentRuntimeClient();

export const handler: Schema["invokeBedrockAgent"]["functionHandler"] = async (event) => {
    const params = {
        agentId: event.arguments.agentId,
        agentAliasId: event.arguments.agentAliasId,
        sessionId: event.arguments.sessionId,
        inputText: event.arguments.prompt,
    };

    const command = new InvokeAgentCommand(params);

    // Send the command and wait for the response
    const response = await client.send(command);
    // Process the response
    console.log("Agent Response:", response.completion);
    

    // Use an async function to process the stream
    const processStream = async () => {
        let completion = ''
        if (!response.completion) throw new Error("No completion found in the response.");
        for await (let chunkEvent of response.completion) {
            const chunk = chunkEvent.chunk;
            if (chunk) {
                const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
                completion += decodedResponse;
            }
        }
        return completion;
    };

    const bedrockAgentCompletion = await processStream()
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

    console.log('Parsed event stream completion: ', bedrockAgentCompletion)
    return bedrockAgentCompletion;
};