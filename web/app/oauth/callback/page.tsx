'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * OAuth2 PKCE callback page.
 *
 * This page is the redirect target for the MCP server auth popup. It:
 *   1. Reads `code` and `state` from the query string.
 *   2. Posts them back to the opener window.
 *   3. Closes itself.
 *
 * The opener is the agents page, which listens for the message and
 * completes the token exchange.
 */
export default function OAuthCallbackPage() {
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

    // Give the opener time to receive the message before closing.
    setTimeout(() => window.close(), 200);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Completing authentication…</p>
    </div>
  );
}
