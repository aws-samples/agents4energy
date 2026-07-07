import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// If web/e2e-config.json exists (fetched via `pnpm fetch:e2e-config` from SSM),
// tests run against the already-deployed CloudFront + S3 app for the current
// branch instead of spinning up a local `pnpm dev` server. This lets a fresh
// checkout run the full e2e suite without ever building or deploying locally.
const e2eConfigPath = resolve(__dirname, 'e2e-config.json');
const remoteConfig = existsSync(e2eConfigPath)
  ? (JSON.parse(readFileSync(e2eConfigPath, 'utf8')) as { appUrl: string })
  : null;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',

  use: {
    baseURL: remoteConfig?.appUrl ?? 'https://localhost:3000',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Skip the local dev server entirely when pointed at a remote deployment.
  ...(remoteConfig
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'https://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          ignoreHTTPSErrors: true,
        },
      }),
});
