import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { fetchUserAttributes, FetchUserAttributesOutput } from 'aws-amplify/auth';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { Hub } from 'aws-amplify/utils';

// Define the type for your context value
interface UserContextType {
  userAttributes: FetchUserAttributesOutput | null;
}

// Create the context with the correct type
const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserAttributesProvider({ children }: { children: ReactNode }) {
  const [userAttributes, setUserAttributes] = useState<FetchUserAttributesOutput | null>(null);

  const { authStatus } = useAuthenticator(context => [context.authStatus]);

  //If the user starts out unauthenticated, make sure the userAttributes are null
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      setUserAttributes(null)
    } else if (authStatus === 'authenticated') {
      const fetchAttributes = async () => {
        const userAttributesResponse = await fetchUserAttributes();
        if (userAttributesResponse) setUserAttributes(userAttributesResponse);
      }
      fetchAttributes();
    }
  }, [authStatus]);

  Hub.listen('auth', async ({ payload }) => {
    switch (payload.event) {
      case 'signedIn':
        console.log('user have been signedIn successfully.');
        const userAttributesResponse = await fetchUserAttributes();
        if (userAttributesResponse) setUserAttributes(userAttributesResponse);
        break;
      case 'signedOut':
        console.log('user have been signedOut successfully.');
        setUserAttributes(null);
        break;
    }
  });

  // Pass the object as the value
  return (
    <UserContext.Provider value={{ userAttributes }}>
      {children}
    </UserContext.Provider>
  );
}

// Custom hook to use the context
export function useUserAttributes() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUserAttributes must be used within a UserProvider');
  }
  return context;
}