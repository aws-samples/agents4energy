import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'wellFileDrive',
  access: (allow) => ({
    'well-files/*': [
      allow.authenticated.to(['read','write', 'delete']),
    ],
  })
});