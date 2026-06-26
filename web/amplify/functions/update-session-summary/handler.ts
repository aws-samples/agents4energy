import {
  BedrockAgentCoreClient,
  BatchUpdateMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';

const MEMORY_ID = process.env.AGENTCORE_MEMORY_ID!;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const client = new BedrockAgentCoreClient({ region: REGION });

interface UpdateSessionSummaryArgs {
  memoryRecordId: string;
  text: string;
}

export const handler = async (
  event: { arguments: UpdateSessionSummaryArgs },
): Promise<boolean> => {
  const { memoryRecordId, text } = event.arguments;

  await client.send(
    new BatchUpdateMemoryRecordsCommand({
      memoryId: MEMORY_ID,
      records: [{ memoryRecordId, timestamp: new Date(), content: { text } }],
    }),
  );

  return true;
};
