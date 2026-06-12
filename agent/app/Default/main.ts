import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { streamText, createUIMessageStream, UIMessage, convertToModelMessages, stepCountIs } from 'ai';
import { loadModel } from './model/load.js';

const SYSTEM_PROMPT = `You are a helpful assistant.`;

type Payload = { prompt: string };

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload, _context) {
      console.log('[invocation] payload:', JSON.stringify(payload, null, 2));
      const { prompt } = payload as Payload;
      const model = await loadModel();

      const existingMessages: UIMessage[] = [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: prompt }],
        },
      ];

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
