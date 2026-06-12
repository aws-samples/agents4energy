'use client';
// import { NextUIProvider } from '@nextui-org/react';
import { Authenticator } from '@aws-amplify/ui-react';
// import { UserAttributesProvider } from '@/components/UserAttributesProvider';
// import { DemoProvider } from '@/contexts/DemoContext';
// // Set up internationalization
// import { I18nProvider } from '@cloudscape-design/components/i18n';
// // Import all locales
// import messages from '@cloudscape-design/components/i18n/messages/all.all';
// Or only import specific locales
// import enMessages from '@cloudscape-design/components/i18n/messages/all.en';

/** @see https://nextui.org/docs/frameworks/nextjs#setup-provider */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Authenticator.Provider>
      {/* <UserAttributesProvider>
        <DemoProvider> */}
          {children}
        {/* </DemoProvider>
      </UserAttributesProvider> */}
    </Authenticator.Provider>
  )
}