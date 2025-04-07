import { defineFunction } from '@aws-amplify/backend';

export const convertPdfToYaml = defineFunction({
  name: 'convertPdfToYaml',
  entry: './handler.ts'
});
