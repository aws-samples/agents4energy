'use client';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import outputs from '@/amplify_outputs.json';

if (outputs) {
  Amplify.configure(outputs, { ssr: true });

  // Eagerly populate the SDK's internal credential cache so that the burst
  // of concurrent fetchAuthSession() calls from Authenticator.Provider,
  // UserAttributesProvider, PreWarmContext, ChatBox, FileTree, etc. all
  // resolve from cache instead of each hitting Cognito Identity separately.
  if (typeof window !== 'undefined') {
    fetchAuthSession().catch(() => {
      // Silently ignore — user may not be signed in yet.
      // The Authenticator UI will handle that flow.
    });
  }
} else {
  console.warn('Skipping Amplify configuration - outputs file not found');
}

const Page = () => null

export default Page;