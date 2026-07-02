import { test, expect } from '@playwright/test';

test.describe('Chat page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('chat');
    // Auth gate should be gone — storageState from auth.setup.ts handles login
    await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible();
  });

  test('prompt input is visible and accepts text', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'message' });
    await expect(textarea).toBeVisible();
    await textarea.fill('Hello');
    await expect(textarea).toHaveValue('Hello');
  });

  test('agent returns a response after sending a message', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'message' });
    await textarea.fill('Say exactly: hello');
    await textarea.press('Enter');

    // User bubble appears immediately
    await expect(page.locator('[data-testid="message-user"]').last()).toBeVisible();

    // Wait for at least one assistant message to appear (agent may take a while)
    await expect(page.locator('[data-testid="message-assistant"]').last()).toBeVisible({
      timeout: 60_000,
    });

    // Submit button should return to idle state once streaming finishes
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 60_000 });
  });

  test('agent response streams over the AG-UI binary event stream protocol', async ({ page }) => {
    const invokeResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/harnesses/invoke') && response.request().method() === 'POST',
    );

    const textarea = page.getByRole('textbox', { name: 'message' });
    await textarea.fill('Say exactly: hello');
    await textarea.press('Enter');

    // User bubble appears immediately, and the submit button flips to "Stop"
    // synchronously with the send — before any network round trip completes.
    await expect(page.locator('[data-testid="message-user"]').last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

    // The "Thinking…" shimmer is the loading state shown while waiting for the first token.
    await expect(page.getByText('Thinking…')).toBeVisible({ timeout: 10_000 });

    // Confirm the harness responded with the raw AWS binary event stream — not a
    // buffered JSON blob — which is what the custom ChatTransport decodes frame by frame.
    const invokeResponse = await invokeResponsePromise;
    expect(invokeResponse.headers()['content-type']).toContain('application/vnd.amazon.eventstream');

    // The assistant message appears as soon as the transport enqueues its first
    // chunk (right after the response headers land, before any text has streamed
    // in) — well before the submit button has a chance to return to idle.
    const assistantMessage = page.locator('[data-testid="message-assistant"]').last();
    await expect(assistantMessage).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

    // Once streaming completes: shimmer is gone and the submit button returns to idle.
    await expect(page.getByText('Thinking…')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 60_000 });
  });
});
