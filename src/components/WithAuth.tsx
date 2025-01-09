import React from 'react';
import { Authenticator } from '@aws-amplify/ui-react';

export function withAuth<P extends object>(Component: React.ComponentType<P>) {
  
  return function AuthProtected(props: P) {
    return (<Authenticator><Component {...props} /></Authenticator>)

  };
}
