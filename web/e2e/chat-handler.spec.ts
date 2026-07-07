import { test, expect } from '@playwright/test';

test.describe('Chat Handler page — AG-UI over AppSync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('chat-handler');
    // Auth gate should be gone — storageState from auth.setup.ts handles login
    await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible();
    // Wait for the session to be bootstrapped (URL gains ?sessionId= param)
    await page.waitForURL(/sessionId=/, { timeout: 15_000 });
  });

  test('summarisation banner appears when memory contains a session summary', async ({ page }) => {
    // Intercept the AppSync POST and inject a fake summary + two history messages
    // so we can verify the banner without needing dozens of real turns.
    await page.route('**/graphql', async (route) => {
      let req: { query?: string } | null = null;
      try { req = route.request().postDataJSON() as { query?: string }; } catch { /* ignore */ }
      if (req?.query?.includes('listSessionMessages')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              listSessionMessages: {
                events: [
                  {
                    eventId: 'evt-1',
                    role: 'user',
                    text: 'Earlier message (pre-summary)',
                    timestamp: new Date(Date.now() - 60_000).toISOString(),
                  },
                  {
                    eventId: 'evt-2',
                    role: 'assistant',
                    text: 'Earlier reply (pre-summary)',
                    timestamp: new Date(Date.now() - 55_000).toISOString(),
                  },
                ],
                nextToken: null,
                summary: 'The user asked about earlier topics and the agent responded.',
                summaryTimestamp: new Date(Date.now() - 50_000).toISOString(),
              },
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Navigate to a fixed session so the intercepted listSessionMessages is called.
    await page.goto('chat-handler?sessionId=summary-test-session');
    await page.waitForURL(/sessionId=summary-test-session/);

    // The banner should appear once messages are seeded from the injected summary.
    await expect(
      page.getByText('Earlier messages summarised'),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('summary dialog shows edit button and allows editing the text', async ({ page }) => {
    // Inject a fake summary (with a record ID) so the scroll-text button appears.
    await page.route('**/graphql', async (route) => {
      let req: { query?: string } | null = null;
      try { req = route.request().postDataJSON() as { query?: string }; } catch { /* ignore */ }
      if (req?.query?.includes('listSessionMessages')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              listSessionMessages: {
                events: [
                  { eventId: 'e1', role: 'user', text: 'Hi', timestamp: new Date(Date.now() - 60_000).toISOString() },
                  { eventId: 'e2', role: 'assistant', text: 'Hello!', timestamp: new Date(Date.now() - 55_000).toISOString() },
                ],
                nextToken: null,
                summary: 'The user greeted the agent.',
                summaryTimestamp: new Date(Date.now() - 50_000).toISOString(),
                summaryRecordId: 'fake-record-id-123',
              },
            },
          }),
        });
      } else if (req?.query?.includes('updateSessionSummary')) {
        // Simulate a successful update
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { updateSessionSummary: true } }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('chat-handler?sessionId=edit-summary-test-session');
    await page.waitForURL(/sessionId=edit-summary-test-session/);

    // Open the summary dialog
    const summaryButton = page.getByTestId('summary-button');
    await expect(summaryButton).toBeVisible({ timeout: 20_000 });
    await summaryButton.click();

    // Initial view: summary text visible, Edit button present
    await expect(page.getByText('The user greeted the agent.')).toBeVisible();
    const editButton = page.getByTestId('summary-edit-button');
    await expect(editButton).toBeVisible();

    // Click Edit — textarea should appear
    await editButton.click();
    const textarea = page.getByTestId('summary-edit-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('The user greeted the agent.');

    // Edit the text
    await textarea.fill('Edited summary text.');

    // Click Save
    const saveButton = page.getByTestId('summary-save-button');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // After save the view should return to read mode with updated text
    await expect(page.getByTestId('summary-edit-textarea')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Edited summary text.')).toBeVisible();
  });

  test('prompt input is visible and accepts text', async ({ page }) => {
    const textarea = page.getByPlaceholder('Type a message…');
    await expect(textarea).toBeVisible();
    await textarea.fill('Hello');
    await expect(textarea).toHaveValue('Hello');
  });

  test('empty state is shown before any messages', async ({ page }) => {
    await expect(page.getByText('AG-UI Handler Chat')).toBeVisible();
  });

  test('agent returns a response via AppSync subscription after sending a message', async ({ page }) => {
    const textarea = page.getByPlaceholder('Type a message…');
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
    const textarea = page.getByPlaceholder('Type a message…');
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

  test('messages persist after reloading the session', async ({ page }) => {
    // Send a message and wait for the full round-trip to complete.
    const textarea = page.getByPlaceholder('Type a message…');
    await textarea.fill('Say exactly: memory test');
    await textarea.press('Enter');

    await expect(page.locator('[data-testid="message-user"]').last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 90_000 });

    // Capture the user message text and session URL before reloading.
    const userText = await page.locator('[data-testid="message-user"]').last().textContent();
    const sessionUrl = page.url();

    // Give the memory service a moment to index the events before reloading.
    await page.waitForTimeout(3_000);
    expect(sessionUrl).toMatch(/sessionId=/);

    // Reload the exact same session URL.
    await page.goto(sessionUrl);
    await page.waitForURL(/sessionId=/, { timeout: 10_000 });

    // Wait for the loading shimmer to disappear (initial messages fetched).
    await expect(page.locator('[data-testid="message-user"]').first()).toBeVisible({
      timeout: 30_000,
    });

    // Both the user message and at least one assistant reply should be visible.
    const userMessages = page.locator('[data-testid="message-user"]');
    const assistantMessages = page.locator('[data-testid="message-assistant"]');
    await expect(userMessages.first()).toBeVisible();
    await expect(assistantMessages.first()).toBeVisible();

    // The original user message text should still be present.
    await expect(userMessages.first()).toContainText(userText?.trim() ?? 'memory test');
  });

  test('a second window joining mid-stream renders the in-flight message and backfills it', async ({ page, browser }) => {
    const textarea = page.getByPlaceholder('Type a message…');
    await textarea.fill('Count from 1 to 20, one number per line.');
    await textarea.press('Enter');

    // Wait until the first window is actively streaming an assistant reply.
    await expect(page.locator('[data-testid="message-assistant"]').last()).toBeVisible({
      timeout: 90_000,
    });

    const sessionUrl = page.url();

    // Open the same session from a second, independent browser context — this
    // simulates loading the session from another site while the agent is still
    // replying. It subscribes fresh, so it never saw text_message_start.
    const ctx = await browser.newContext({ storageState: '.auth/user.json' });
    const joiner = await ctx.newPage();
    await joiner.goto(sessionUrl);

    // The joiner should render the in-flight assistant message (even without
    // its beginning) rather than waiting for the run to finish.
    const joinerAssistant = joiner.locator('[data-testid="message-assistant"]').last();
    await expect(joinerAssistant).toBeVisible({ timeout: 30_000 });

    // Once the run completes, the joiner's message should be backfilled with
    // the authoritative full text from memory (non-empty, no leading "…").
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 90_000 });
    await expect(async () => {
      const text = await joinerAssistant.textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
      expect(text?.trim().startsWith('…')).toBe(false);
    }).toPass({ timeout: 30_000 });

    await ctx.close();
  });
});
