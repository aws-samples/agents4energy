// v2 — AppSync message persistence
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { streamText, createUIMessageStream, convertToModelMessages, stepCountIs } from 'ai';
import { loadModel } from './model/load.js';
import type { AgentPayload } from '@agentcore/shared-types';
import type { UIMessage } from 'ai';

const SYSTEM_PROMPT = `You are a helpful assistant.`;

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT ?? '';

async function saveChatMessage(
  chatSessionId: string,
  message: UIMessage,
  authToken: string,
): Promise<void> {
  if (!APPSYNC_ENDPOINT) return;

  const mutation = `
    mutation CreateChatMessage($input: CreateChatMessageInput!) {
      createChatMessage(input: $input) { id }
    }
  `;

  const input = {
    chatSessionId,
    role: message.role,
    parts: message.parts,
    createdAt: new Date().toISOString(),
  };

  const res = await fetch(APPSYNC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authToken,
    },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    console.error('[saveChatMessage] error', res.status, JSON.stringify(json.errors ?? json));
  } else {
    console.log('[saveChatMessage] saved', message.role, json.data?.createChatMessage?.id);
  }
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload, context) {
      console.log('[invocation] payload:', JSON.stringify(payload, null, 2));
      const { messages: existingMessages, chatSessionId } = payload as AgentPayload;
      const rawAuth: string = context.headers['authorization'] ?? '';
      const authToken = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7) : rawAuth;

      const model = await loadModel();

      let finalMessages: UIMessage[] = [];

      const stream = createUIMessageStream({
        async execute({ writer }) {
          const result = streamText({
            model,
            system: SYSTEM_PROMPT,
            messages: await convertToModelMessages(existingMessages),
            stopWhen: stepCountIs(20),
          });
          writer.merge(result.toUIMessageStream());
        },
        originalMessages: existingMessages,
        onFinish({ messages }) {
          finalMessages = messages as UIMessage[];
        },
      });

      // Buffer all chunks so onFinish runs before we yield anything back.
      // This ensures saves complete before the runtime closes the connection.
      const chunks: unknown[] = [];
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      if (chatSessionId && authToken) {
        const userMessage = existingMessages.at(-1);
        const assistantMessage = finalMessages.at(-1);
        if (userMessage?.role === 'user') {
          await saveChatMessage(chatSessionId, userMessage, authToken);
        }
        if (assistantMessage) {
          await saveChatMessage(chatSessionId, assistantMessage, authToken);
        }
      }

      for (const chunk of chunks) {
        yield { data: chunk };
      }
    },
  },
});

app.run({ port: parseInt(process.env.PORT ?? '8080') });
