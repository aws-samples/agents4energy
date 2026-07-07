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
});
