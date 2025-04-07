import { defineFunction } from '@aws-amplify/backend';
import { ProductionAgentEnvVars } from './types';

export const productionAgentFunction = defineFunction({
  name: 'productionAgentFunction',
  entry: './handler.ts',
  environment: {
    // Using placeholder values that will be replaced during deployment
    // These values will be populated from CloudFormation outputs
    PETROLEUM_ENG_KNOWLEDGE_BASE_ID: process.env.PETROLEUM_ENG_KNOWLEDGE_BASE_ID || 'petroleum-kb-id-placeholder',
    AWS_KNOWLEDGE_BASE_ID: process.env.AWS_KNOWLEDGE_BASE_ID || 'aws-kb-id-placeholder',
    ATHENA_WORKGROUP_NAME: process.env.ATHENA_WORKGROUP_NAME || 'primary',
    DATABASE_NAME: process.env.DATABASE_NAME || 'default',
    DATA_BUCKET_NAME: process.env.DATA_BUCKET_NAME || 'default-bucket'
  } as Partial<ProductionAgentEnvVars>
});
