'use client';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { redirect } from 'next/navigation';
import React, { useEffect } from 'react';
import { Hub } from 'aws-amplify/utils';
import '@aws-amplify/ui-react/styles.css';

function CustomAuthenticator() {
  const { user } = useAuthenticator((context) => [context.user]);

  useEffect(() => {
    if (user) {
      redirect('/');
    }
  }, [user]);
  
  return <Authenticator />;
}

// https://docs.amplify.aws/nextjs/build-a-backend/server-side-rendering/nextjs-app-router-server-components/#add-server-authentication-routes
export default function Login() {
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);
  
  useEffect(() => {
    // Redirect if already authenticated
    if (authStatus === 'authenticated') {
      redirect('/');
    }
    
    // Set up Hub listener for auth events
    const hubListenerCancel = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') {
        redirect('/');
      }
    });
    
    return hubListenerCancel;
  }, [authStatus]);
  
  return (
    <CustomAuthenticator />
  );
}
