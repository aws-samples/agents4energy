"use client"
import React from 'react';
import { Authenticator, useAuthenticator, TextField, PasswordField } from '@aws-amplify/ui-react';
import { signInWithRedirect } from 'aws-amplify/auth';

interface WithAuthProps {
  children: React.ReactNode;
}

const auth0Enabled = process.env.NEXT_PUBLIC_AUTH0_ENABLED === 'true';

// Custom sign-up form that omits the confirm password field.
// The Authenticator state machine still needs a `confirm_password` value,
// so we mirror the password input into a hidden field on change.
function SignUpFormFields() {
  const { validationErrors } = useAuthenticator();

  return (
    <>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        hasError={!!validationErrors?.email}
        errorMessage={validationErrors?.email as string}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        required
        hasError={!!validationErrors?.password}
        errorMessage={validationErrors?.password as string}
        onChange={(e) => {
          // Keep confirm_password in sync so the machine's required check passes
          const hidden = document.querySelector<HTMLInputElement>('input[name="confirm_password"]');
          if (hidden) hidden.value = e.target.value;
        }}
      />
      <input type="hidden" name="confirm_password" />
    </>
  );
}

const AuthGate: React.FC<WithAuthProps> = ({ children }) => {
  const { authStatus } = useAuthenticator(context => [context.authStatus]);

  if (authStatus === 'authenticated') {
    return <>{children}</>;
  }

  return (
    <Authenticator
      services={{
        validateFormPassword: async () => ({}),
      }}
      components={{
        SignUp: {
          FormFields: SignUpFormFields,
        },
        ...(auth0Enabled && {
          SignIn: {
            Footer() {
              return (
                <div style={{ padding: '0 2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6b7280', fontSize: '0.875rem' }}>
                    <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #e5e7eb' }} />
                    <span>or</span>
                    <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #e5e7eb' }} />
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); signInWithRedirect({ provider: { custom: 'Auth0' } }); }}
                    style={{
                      width: '100%',
                      padding: '0.625rem 1rem',
                      border: '1px solid #d1d5db',
                      borderRadius: '0.375rem',
                      background: '#fff',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: '#111827',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    Sign in with Auth0
                  </button>
                </div>
              );
            },
          },
        }),
      }}
    >
      {children}
    </Authenticator>
  );
};

const WithAuth: React.FC<WithAuthProps> = ({ children }) => {
  return <AuthGate>{children}</AuthGate>;
};

export default WithAuth;