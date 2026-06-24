import { test, expect } from '@playwright/test';

test.describe('Chat Handler page — AG-UI over AppSync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chat-handler');
    // Auth gate should be gone — storageState from auth.setup.ts handles login
    await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible();
  });

  test('prompt input is visible and accepts text', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'message' });
    await expect(textarea).toBeVisible();
    await textarea.fill('Hello');
    await expect(textarea).toHaveValue('Hello');
  });

  test('empty state is shown before any messages', async ({ page }) => {
    await expect(page.getByText('AG-UI Handler Chat')).toBeVisible();
  });

  test('agent returns a response via AppSync subscription after sending a message', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'message' });
    await textarea.fill('Say exactly: hello');
    await textarea.press('Enter');

    // User bubble appears immediately
    await expect(page.locator('[data-testid="message-user"]').last()).toBeVisible();

    // Wait for at least one assistant message to appear (streamed via subscription)
    await expect(page.locator('[data-testid="message-assistant"]').last()).toBeVisible({
      timeout: 90_000,
    });

    // Submit button should return to idle state once streaming finishes
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 90_000 });
  });

  test('assistant message contains text after streaming completes', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'message' });
    await textarea.fill('Say exactly: hello');
    await textarea.press('Enter');

    const assistantMsg = page.locator('[data-testid="message-assistant"]').last();
    await expect(assistantMsg).toBeVisible({ timeout: 90_000 });

    // Wait for streaming to finish (submit button returns to idle)
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 90_000 });

    // The message should contain some text
    const text = await assistantMsg.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
