import {
  BedrockAgentCoreClient,
  ListEventsCommand,
  ListMemoryRecordsCommand,
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
  // Session summary produced asynchronously by AgentCore's SUMMARIZATION strategy.
  // Null when no summary has been generated yet (new or short sessions).
  summary?: string | null;
  // ISO timestamp of when the summary was created. Use this to filter events to
  // only those that occurred after the last compaction.
  summaryTimestamp?: string | null;
  // The AgentCore MemoryRecord ID for the summary record — needed to update it.
  summaryRecordId?: string | null;
}

async function fetchSessionSummary(
  sessionId: string,
  actorId: string,
): Promise<{ summary: string; summaryTimestamp: string; summaryRecordId: string } | null> {
  // AgentCore stores managed summaries under /summaries/{actorId}/{sessionId}.
  const namespace = `/summaries/${actorId}/${sessionId}`;
  try {
    const output = await client.send(
      new ListMemoryRecordsCommand({
        memoryId: MEMORY_ID,
        namespace,
        maxResults: 1,
      }),
    );
    const record = output.memoryRecordSummaries?.[0];
    if (!record?.content?.text) return null;
    return {
      summary: record.content.text,
      summaryTimestamp: record.createdAt?.toISOString() ?? '',
      summaryRecordId: record.memoryRecordId ?? '',
    };
  } catch {
    // No summary yet — not an error.
    return null;
  }
}

export const handler = async (
  event: { arguments: ListSessionMessagesArgs },
): Promise<ListSessionMessagesResult> => {
  const { sessionId, actorId, nextToken } = event.arguments;

  // Fetch summary and raw events in parallel.
  const [summaryResult, eventsOutput] = await Promise.all([
    fetchSessionSummary(sessionId, actorId),
    client.send(
      new ListEventsCommand({
        memoryId: MEMORY_ID,
        sessionId,
        actorId,
        includePayloads: true,
        ...(nextToken ? { nextToken } : {}),
      }),
    ),
  ]);

  const summaryTs = summaryResult?.summaryTimestamp
    ? new Date(summaryResult.summaryTimestamp)
    : null;

  const events: ConversationalEvent[] = [];

  for (const e of eventsOutput.events ?? []) {
    // Skip events that predate the last summary — they're already captured in it.
    if (summaryTs && e.eventTimestamp && e.eventTimestamp <= summaryTs) continue;

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

  return {
    events,
    nextToken: eventsOutput.nextToken ?? null,
    summary: summaryResult?.summary ?? null,
    summaryTimestamp: summaryResult?.summaryTimestamp ?? null,
    summaryRecordId: summaryResult?.summaryRecordId ?? null,
  };
};
