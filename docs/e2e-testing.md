# E2E Testing with Playwright

Tests live in [web/e2e/](../web/e2e/) and run against the Next.js dev server at `http://localhost:3000`.

## Quick start

```bash
cd web

# Run all tests (headless)
pnpm test:e2e

# Interactive UI mode — live browser, time-travel debugging
pnpm test:e2e:ui

# Run a single test file
pnpm test:e2e e2e/chat.spec.ts

# Run with headed browser (visible window)
pnpm test:e2e --headed
```

The dev server starts automatically. If it's already running, Playwright reuses it.

## Authentication

Authentication runs once as a setup project before any tests execute.
The setup lives in [web/e2e/auth.setup.ts](../web/e2e/auth.setup.ts) and produces `.auth/user.json` (gitignored).

**If `scripts/.env.local` exists**, it reads `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` and signs in.

**If `scripts/.env.local` does not exist**, the setup creates a new Cognito user, writes the file, then signs in. This means a fresh checkout can bootstrap itself end-to-end with no manual steps — it requires AWS credentials in the environment that have `cognito-idp:AdminCreateUser` and `cognito-idp:AdminSetUserPassword` permission on the user pool.

After a successful login the session is cached in `web/.auth/user.json`. All subsequent test projects load this file via `storageState` and never re-authenticate unless the file is deleted or the session expires.

To force a fresh login, delete `.auth/user.json` and re-run.

## Config overview

[web/playwright.config.ts](../web/playwright.config.ts) defines two projects:

| Project | Purpose |
|---|---|
| `setup` | Runs `auth.setup.ts` once; creates `.auth/user.json` |
| `chromium` | Runs all `*.spec.ts` files; depends on `setup` |

`workers` is set to `1` — tests run serially. The chat agent has shared session state (session ID from `localStorage`), so parallel workers would create race conditions between tests that read/write the same chat history.

## Writing tests

### File structure

```
web/e2e/
  auth.setup.ts   ← do not rename; matched by playwright.config.ts
  chat.spec.ts    ← one file per feature area
  <feature>.spec.ts
```

Group related assertions with `test.describe`. One page = one file is a good default.

### Selectors

Prefer stable selectors in this order:

1. `data-testid` — add these to components when no semantic selector works
2. ARIA role + accessible name: `page.getByRole('button', { name: 'Submit' })`
3. Label text: `page.getByLabel('Email')`
4. Placeholder: `page.getByPlaceholder('Type a message…')`

Avoid CSS class selectors — they change with refactors. The `is-user` / `is-assistant` classes on `Message` are internal layout classes; use `[data-testid="message-user"]` and `[data-testid="message-assistant"]` instead.

### Timeouts

The agent response can take up to ~60 seconds on a cold start. Use an explicit `timeout` on any assertion that waits for an assistant reply:

```ts
await expect(page.locator('[data-testid="message-assistant"]').last()).toBeVisible({
  timeout: 60_000,
});
```

The global default timeout (5 s) is intentionally kept short for fast failures on non-agent assertions.

### Example: chat round-trip

```ts
import { test, expect } from '@playwright/test';

test('agent responds to a greeting', async ({ page }) => {
  await page.goto('/chat');

  const textarea = page.getByRole('textbox', { name: 'message' });
  await textarea.fill('Say exactly: hello');
  await textarea.press('Enter');

  await expect(page.locator('[data-testid="message-assistant"]').last()).toBeVisible({
    timeout: 60_000,
  });
});
```

### Example: asserting specific response content

```ts
test('agent echoes the user message', async ({ page }) => {
  await page.goto('/chat');

  await page.getByRole('textbox', { name: 'message' }).fill('What is 2 + 2?');
  await page.getByRole('button', { name: 'Submit' }).click();

  // Wait for streaming to finish
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 60_000 });

  const lastReply = page.locator('[data-testid="message-assistant"]').last();
  await expect(lastReply).toContainText('4');
});
```

## CI

On CI set `CI=true`. This enables:
- 1 retry per failed test (flake tolerance)
- `forbidOnly` — `test.only` left in source causes a hard failure

The `webServer` block in `playwright.config.ts` spins up `pnpm dev` and waits up to 2 minutes for `http://localhost:3000` to be ready. AWS credentials must be available for the auth setup to create or authenticate a Cognito user.

## Debugging

```bash
# Run with Playwright inspector (pauses at each action)
PWDEBUG=1 pnpm test:e2e

# Save a trace and open it
pnpm test:e2e --trace on
npx playwright show-trace test-results/<run>/trace.zip
```

HTML report is written to `playwright-report/` after every run. Open with:

```bash
npx playwright show-report
```
