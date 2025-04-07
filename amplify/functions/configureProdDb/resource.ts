import { defineFunction } from '@aws-amplify/backend';

export const configureProdDb = defineFunction({
  name: 'configureProdDb',
  entry: './handler.ts'
});
