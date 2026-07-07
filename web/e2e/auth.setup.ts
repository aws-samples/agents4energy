import { test as setup, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const root = resolve(__dirname, '../..');
const storageStatePath = resolve(__dirname, '../.auth/user.json');

// Prefer web/e2e-config.json (fetched from SSM via `pnpm fetch:e2e-config`) so
// tests can run against an already-deployed branch with no local build/deploy.
// Fall back to amplify_outputs.json for the traditional local-sandbox flow.
const e2eConfigPath = resolve(root, 'web/e2e-config.json');
let clientId: string;
let region: string;
let emailSsmPath: string | undefined;
let passwordSsmPath: string | undefined;
if (existsSync(e2eConfigPath)) {
  const e2eConfig = JSON.parse(readFileSync(e2eConfigPath, 'utf8'));
  clientId = e2eConfig.userPoolClientId;
  region = e2eConfig.region;
  emailSsmPath = e2eConfig.testUserEmailSsmPath;
  passwordSsmPath = e2eConfig.testUserPasswordSsmPath;
} else {
  const amplifyOutputs = JSON.parse(readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'));
  ({ user_pool_client_id: clientId, aws_region: region } = amplifyOutputs.auth);
  ({ e2e_test_user_email_ssm_path: emailSsmPath, e2e_test_user_password_ssm_path: passwordSsmPath } =
    amplifyOutputs.custom ?? {});
}

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

setup('authenticate', async ({ page }) => {
  if (!emailSsmPath || !passwordSsmPath) {
    throw new Error(
      'web/amplify_outputs.json is missing custom.e2e_test_user_email_ssm_path / ..._password_ssm_path — redeploy the backend to provision the e2e test user.',
    );
  }

  const cognito = new CognitoIdentityProviderClient({ region });
  const ssm = new SSMClient({ region });

  const [emailParam, passwordParam] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: emailSsmPath })),
    ssm.send(new GetParameterCommand({ Name: passwordSsmPath, WithDecryption: true })),
  ]);

  const email = emailParam.Parameter?.Value;
  const password = passwordParam.Parameter?.Value;
  if (!email || !password) {
    throw new Error(`SSM parameters ${emailSsmPath} / ${passwordSsmPath} are missing a value`);
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

  // Navigate to the app first so we know the real hostname (localhost for the
  // local dev server, or the CloudFront domain when running against a remote
  // deployment) to scope the injected cookies to.
  await page.goto('agents');
  const domain = new URL(page.url()).hostname;

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
    domain,
    path: '/',
    expires: Math.floor(expires.getTime() / 1000),
    httpOnly: false,
    secure: true,
    sameSite: 'Lax' as const,
  }));

  await page.context().addCookies(tokenCookies);

  // Reload so Amplify picks up the freshly injected cookies.
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Verify auth is working — the Sign in button should disappear.
  await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: storageStatePath });
});
