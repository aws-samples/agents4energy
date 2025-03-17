import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'fileDrive',
  access: (allow) => ({
    'production-agent/*': [
      allow.authenticated.to(['read', 'delete']),
    ],
    'maintenance-agent/*': [
      allow.authenticated.to(['read', 'delete']),
    ],
    'petrophysics-agent/*': [
      allow.authenticated.to(['read', 'delete']),
    ],
    'regulatory-agent/*': [
      allow.authenticated.to(['read', 'delete']),
    ],
  })
});