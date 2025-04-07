import { defineFunction } from '@aws-amplify/backend';
import { PlanAndExecuteAgentEnvVars } from './types';

export const planAndExecuteAgent = defineFunction({
  name: 'planAndExecuteAgent',
  entry: './handler.ts',
  environment: {
    // Using placeholder values that will be replaced during deployment
    PETROLEUM_ENG_KNOWLEDGE_BASE_ID: process.env.PETROLEUM_ENG_KNOWLEDGE_BASE_ID || 'petroleum-kb-id-placeholder',
    AWS_KNOWLEDGE_BASE_ID: process.env.AWS_KNOWLEDGE_BASE_ID || 'aws-kb-id-placeholder',
    ATHENA_WORKGROUP_NAME: process.env.ATHENA_WORKGROUP_NAME || 'primary',
    DATABASE_NAME: process.env.DATABASE_NAME || 'default',
    DATA_BUCKET_NAME: process.env.DATA_BUCKET_NAME || 'default-bucket'
  } as Partial<PlanAndExecuteAgentEnvVars>
});
