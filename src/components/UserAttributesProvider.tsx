'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchUserAttributes } from 'aws-amplify/auth';

// Create context
const UserAttributesContext = createContext<Record<string, string> | null>(null);

// Create provider component
export function UserAttributesProvider({ children }: { children: React.ReactNode }) {
  const [userAttributes, setUserAttributes] = useState<Record<string, string> | null>(null);
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);

  useEffect(() => {
    async function getUserAttributes() {
      if (authStatus === 'authenticated') {
        try {
          const attributes = await fetchUserAttributes();
          // Convert attributes to Record<string, string> format
          const attributesRecord: Record<string, string> = {};
          Object.entries(attributes).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              attributesRecord[key] = String(value);
            }
          });
          setUserAttributes(attributesRecord);
        } catch (error) {
          console.error('Error fetching user attributes:', error);
        }
      } else {
        setUserAttributes(null);
      }
    }

    getUserAttributes();
  }, [authStatus]);

  return (
    <UserAttributesContext.Provider value={userAttributes}>
      {children}
    </UserAttributesContext.Provider>
  );
}

// Create hook for using the context
export function useUserAttributes() {
  const context = useContext(UserAttributesContext);
  return context;
}
