import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { streamText, createUIMessageStream, convertToModelMessages, stepCountIs } from 'ai';
import { loadModel } from './model/load.js';
import type { AgentPayload } from '@agentcore/shared-types';

const SYSTEM_PROMPT = `You are a helpful assistant.`;

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload, _context) {
      console.log('[invocation] payload:', JSON.stringify(payload, null, 2));
      const { messages: existingMessages } = payload as AgentPayload;
      const model = await loadModel();

      // Invoke the LLM with a streaming response
      const stream = createUIMessageStream({
        async execute({ writer }) {
          const result = streamText({
            model,
            system: SYSTEM_PROMPT,
            messages: await convertToModelMessages(existingMessages),
            stopWhen: stepCountIs(20)
          });
          writer.merge(result.toUIMessageStream());
        },
        originalMessages: existingMessages,
      });

      // Send the stream to the front end
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield { data: value };
        }
      } finally {
        reader.releaseLock();
      }
    },
  },
});

app.run({ port: parseInt(process.env.PORT ?? '8080') });
