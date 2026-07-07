import { test, expect } from '@playwright/test';

test.describe('Agents page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('agents');
    await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible({ timeout: 15_000 });
  });

  test('page loads with agent list and new agent button', async ({ page }) => {
    await expect(page.getByTestId('new-agent-button')).toBeVisible();
    // Either the list is visible, or the empty state is shown
    const list = page.getByTestId('agent-list');
    const emptyState = page.getByText('No agents yet');
    await expect(list.or(emptyState)).toBeVisible();
  });

  test('opens empty edit panel when clicking New agent', async ({ page }) => {
    await page.getByTestId('new-agent-button').click();
    await expect(page.getByTestId('edit-panel')).toBeVisible();
    await expect(page.getByTestId('input-name')).toBeVisible();
    await expect(page.getByTestId('textarea-system-prompt')).toBeVisible();
  });

  test('auto-fills slug from name on new agent', async ({ page }) => {
    await page.getByTestId('new-agent-button').click();
    await page.getByTestId('input-name').fill('My Test Agent');
    await expect(page.getByTestId('input-slug')).toHaveValue('my-test-agent');
  });

  test('clicking an agent row opens the edit panel', async ({ page }) => {
    const list = page.getByTestId('agent-list');
    const firstRow = list.locator('[data-testid^="agent-row-"]').first();

    // Only run this sub-test if there's at least one agent
    const count = await list.locator('[data-testid^="agent-row-"]').count();
    test.skip(count === 0, 'No agents to select');

    await firstRow.click();
    await expect(page.getByTestId('edit-panel')).toBeVisible();
    await expect(page.getByTestId('save-agent-button')).toBeVisible();
  });

  test('close button dismisses the edit panel', async ({ page }) => {
    await page.getByTestId('new-agent-button').click();
    await expect(page.getByTestId('edit-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(page.getByTestId('edit-panel')).not.toBeVisible();
  });
});
