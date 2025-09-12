'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';
import { redirect } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const { authStatus } = useAuthenticator(context => [context.authStatus]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      redirect('/login');
    } else if (authStatus === 'authenticated') {
      redirect('/landing');
    }
  }, [authStatus]);

  // Show loading while checking auth status
  if (authStatus === 'configuring') {
    return <div>Loading...</div>;
  }

  // This should not be reached due to redirects above, but just in case
  return null;
}