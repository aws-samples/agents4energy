import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'fileDrive',
  access: (allow) => ({
    'production-agent/*': [
      allow.authenticated.to(['read','write', 'delete']),
    ],
  })
});