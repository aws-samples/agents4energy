import { test as setup, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { nanoid } from 'nanoid';

const root = resolve(__dirname, '../..');
const envPath = resolve(root, 'scripts/.env.local');
const storageStatePath = resolve(__dirname, '../.auth/user.json');
const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
const { user_pool_id: userPoolId, user_pool_client_id: clientId, aws_region: region } = amplifyOutputs.auth;

// Key format used by Amplify v6 CookieStorage / DefaultTokenStore.
// With ssr: true, tokens go into cookies. With ssr: false they go into localStorage.
// Either way, the key format is the same.
const AUTH_KEY_PREFIX = 'CognitoIdentityServiceProvider';

function tokenKeys(username: string) {
  const base = `${AUTH_KEY_PREFIX}.${clientId}.${username}`;
  return {
    lastAuthUser: `${AUTH_KEY_PREFIX}.${clientId}.LastAuthUser`,
    accessToken: `${base}.accessToken`,
    idToken: `${base}.idToken`,
    refreshToken: `${base}.refreshToken`,
    clockDrift: `${base}.clockDrift`,
    signInDetails: `${base}.signInDetails`,
  };
}

function parseEnv(content: string): Record<string, string> {
  return Object.fromEntries(
    content
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const idx = l.indexOf('=');
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      }),
  );
}

setup('authenticate', async ({ page }) => {
  const cognito = new CognitoIdentityProviderClient({ region });
  let email: string;
  let password: string;

  if (!existsSync(envPath)) {
    // Create a fresh test user and write .env.local
    email = `test-${nanoid(16)}@agentcore.dev`;
    password = `Ac1!${nanoid(24)}`;

    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS',
      }),
    );
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    );

    writeFileSync(envPath, `TEST_USER_EMAIL=${email}\nTEST_USER_PASSWORD=${password}\n`);
    console.log(`Created test user: ${email}`);
  } else {
    const env = parseEnv(readFileSync(envPath, 'utf8'));
    email = env.TEST_USER_EMAIL;
    password = env.TEST_USER_PASSWORD;
    if (!email || !password) throw new Error('scripts/.env.local is missing TEST_USER_EMAIL or TEST_USER_PASSWORD');
  }

  // Get Cognito tokens via the SDK directly — avoids the browser sign-in page
  // and gives us tokens we can inject reliably into any test context.
  const authResult = await cognito.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  );

  const authResp = authResult.AuthenticationResult;
  if (!authResp?.AccessToken || !authResp?.IdToken || !authResp?.RefreshToken) {
    throw new Error('Cognito InitiateAuth did not return tokens');
  }

  const username = email;
  const keys = tokenKeys(username);
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  // Build a storageState with the Amplify token cookies injected.
  // Amplify v6 with ssr:true uses CookieStorage (js-cookie) with these key names.
  const tokenCookies = [
    { name: keys.lastAuthUser, value: username },
    { name: keys.accessToken, value: authResp.AccessToken },
    { name: keys.idToken, value: authResp.IdToken },
    { name: keys.refreshToken, value: authResp.RefreshToken },
    { name: keys.clockDrift, value: '0' },
    {
      name: keys.signInDetails,
      value: JSON.stringify({ loginId: email, authFlowType: 'USER_PASSWORD_AUTH' }),
    },
  ].map((c) => ({
    ...c,
    domain: 'localhost',
    path: '/',
    expires: Math.floor(expires.getTime() / 1000),
    httpOnly: false,
    secure: true,
    sameSite: 'Lax' as const,
  }));

  // Navigate to the app to get a valid page state, then inject cookies.
  await page.goto('/agents');
  await page.context().addCookies(tokenCookies);

  // Reload so Amplify picks up the freshly injected cookies.
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Verify auth is working — the Sign in button should disappear.
  await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: storageStatePath });
});
