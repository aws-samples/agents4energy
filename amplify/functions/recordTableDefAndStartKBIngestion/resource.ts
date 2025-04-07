import { defineFunction } from '@aws-amplify/backend';

export const recordTableDefAndStartKBIngestion = defineFunction({
  name: 'recordTableDefAndStartKBIngestion',
  entry: './handler.ts'
});
