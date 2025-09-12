'use client'

import React, { useEffect } from 'react';
import { Hub } from 'aws-amplify/utils';
import TopNavBar from '@/components/TopNavBar';
// import Box from "@cloudscape-design/components/box";


export default function ClientLayout({ children }: { children: React.ReactNode }) {
  
  useEffect(() => {
    const hubListener = Hub.listen('auth', async ({ payload }) => {
      switch (payload.event) {
        case 'signedOut':
          console.log('User signed out, redirecting to login...');
          window.location.href = '/login';
          break;
      }
    });

    return () => hubListener();
  }, []);
  return (
    <div>
      <TopNavBar />
      <div>{children}</div>
    </div>
  );
}