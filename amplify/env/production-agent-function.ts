// Environment variables for the production agent function
export const env = {
  PETROLEUM_ENG_KNOWLEDGE_BASE_ID: process.env.PETROLEUM_ENG_KNOWLEDGE_BASE_ID || 'petroleum-kb-id-placeholder',
  AWS_KNOWLEDGE_BASE_ID: process.env.AWS_KNOWLEDGE_BASE_ID || 'aws-kb-id-placeholder',
  ATHENA_WORKGROUP_NAME: process.env.ATHENA_WORKGROUP_NAME || 'primary',
  DATABASE_NAME: process.env.DATABASE_NAME || 'default',
  DATA_BUCKET_NAME: process.env.DATA_BUCKET_NAME || 'default-bucket'
};
