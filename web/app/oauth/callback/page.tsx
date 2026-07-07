'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function OAuthCallbackInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'mcp-oauth-callback',
          code: code ?? undefined,
          state: state ?? undefined,
          error: error ?? undefined,
          errorDescription: errorDescription ?? undefined,
        },
        window.location.origin,
      );
    }

    setTimeout(() => window.close(), 200);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export default function OAuthCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Completing authentication…</p>
      <Suspense>
        <OAuthCallbackInner />
      </Suspense>
    </div>
  );
}
