import {
  BedrockAgentCoreClient,
  ListEventsCommand,
} from '@aws-sdk/client-bedrock-agentcore';

const MEMORY_ID = process.env.AGENTCORE_MEMORY_ID!;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const client = new BedrockAgentCoreClient({ region: REGION });

interface ListSessionMessagesArgs {
  sessionId: string;
  actorId: string;
  nextToken?: string | null;
}

interface ConversationalEvent {
  eventId: string;
  role: string;
  text: string;
  timestamp: string;
}

interface ListSessionMessagesResult {
  events: ConversationalEvent[];
  nextToken?: string | null;
}

export const handler = async (
  event: { arguments: ListSessionMessagesArgs },
): Promise<ListSessionMessagesResult> => {
  const { sessionId, actorId, nextToken } = event.arguments;

  const output = await client.send(
    new ListEventsCommand({
      memoryId: MEMORY_ID,
      sessionId,
      actorId,
      includePayloads: true,
      ...(nextToken ? { nextToken } : {}),
    }),
  );

  const events: ConversationalEvent[] = [];

  for (const e of output.events ?? []) {
    for (const payload of e.payload ?? []) {
      if (!payload.conversational) continue;
      const { role, content } = payload.conversational;
      if (!role) continue;

      // The harness SDK stores the full message as a JSON string in the text field.
      // Try to parse it and extract the actual message text; fall back to raw text.
      let text = content?.text ?? '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          const msg = parsed?.message ?? parsed;
          const contentArr: { text?: string }[] = msg?.content ?? [];
          const extracted = contentArr.map((c) => c.text ?? '').filter(Boolean).join(' ');
          if (extracted) text = extracted;
        } catch {
          // not JSON — use raw text as-is
        }
      }

      if (!text) continue;
      events.push({
        eventId: e.eventId!,
        role: role.toLowerCase(),
        text,
        timestamp: e.eventTimestamp?.toISOString() ?? '',
      });
    }
  }

  return { events, nextToken: output.nextToken ?? null };
};
