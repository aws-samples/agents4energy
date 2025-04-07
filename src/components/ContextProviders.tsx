'use client';
import { Authenticator } from '@aws-amplify/ui-react';
import { UserAttributesProvider } from '@/components/UserAttributesProvider';
import ConfigureAmplify from './ConfigureAmplify';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConfigureAmplify />
      <Authenticator.Provider>
        <UserAttributesProvider>
          {children}
        </UserAttributesProvider>
      </Authenticator.Provider>
    </>
  )
}
