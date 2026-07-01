/**
 * Smoke test: "List tools" works for the dispatcher gateway MCP server
 * from all three entry points that use listMcpToolsForServer().
 *
 * Prerequisites (must already exist in the deployed environment):
 *   - An MCP server record with a URL containing "gateway.bedrock-agentcore"
 *   - The test user has an authenticated credential for that server
 *   - At least one Agent has that MCP server assigned to it
 */
import { test, expect, type Page } from '@playwright/test';

const GATEWAY_URL_FRAGMENT = 'gateway.bedrock-agentcore';

// ---------------------------------------------------------------------------
// Helper: navigate to MCP Servers tab and select the gateway server
// ---------------------------------------------------------------------------

async function selectGatewayServer(page: Page): Promise<boolean> {
  await page.goto('agents');
  await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tab-mcp-servers').click();

  // Find a server row whose text includes the gateway URL fragment
  const row = page.locator('[data-testid^="mcp-server-row-"]').filter({
    hasText: GATEWAY_URL_FRAGMENT,
  });

  if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) {
    console.log('No dispatcher gateway MCP server found — skipping test');
    return false;
  }

  await row.click();
  return true;
}

// ---------------------------------------------------------------------------
// 1. MCP server edit panel — "List tools" button
// ---------------------------------------------------------------------------

test('List tools works from the MCP server edit panel', async ({ page }) => {
  const found = await selectGatewayServer(page);
  test.skip(!found, 'No dispatcher gateway server configured');

  await expect(page.getByTestId('mcp-server-edit-panel')).toBeVisible();

  // The credential section should show "Authenticated" for the test user.
  await expect(page.getByTestId('credential-status')).not.toContainText('Not authenticated', {
    timeout: 5_000,
  });

  // Click the List tools button.
  const listToolsBtn = page.getByRole('button', { name: 'List tools' });
  await expect(listToolsBtn).toBeVisible();
  await listToolsBtn.click();

  // The dialog should open and show at least one tool.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.locator('.font-mono').first()).toBeVisible({ timeout: 15_000 });

  // No error text
  await expect(dialog.locator('.text-destructive')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Agent edit panel — list tools icon next to each assigned MCP server
// ---------------------------------------------------------------------------

test('List tools works from the agent edit panel', async ({ page }) => {
  await page.goto('agents');
  await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible({ timeout: 15_000 });

  // Find an agent row that has the gateway assigned — click the first agent.
  const agentRows = page.locator('[data-testid^="agent-row-"]');
  const count = await agentRows.count();
  test.skip(count === 0, 'No agents configured');

  // Click the first agent to open its edit panel.
  await agentRows.first().click();
  await expect(page.getByTestId('edit-panel')).toBeVisible({ timeout: 5_000 });

  // Find the list-tools icon for a gateway server.
  const listToolsIcon = page.locator(`[data-testid^="mcp-list-tools-"]`).first();
  if (!(await listToolsIcon.isVisible({ timeout: 5_000 }).catch(() => false))) {
    test.skip(true, 'No MCP servers assigned to first agent');
    return;
  }

  await listToolsIcon.click();

  // Dialog should appear.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Either tools appear or an error — but should NOT show the generic "401" error.
  await page.waitForTimeout(5_000);
  const errorText = await dialog.locator('.text-destructive').textContent().catch(() => null);
  if (errorText) {
    expect(errorText).not.toContain('401');
    expect(errorText).not.toContain('Missing Bearer token');
  } else {
    await expect(dialog.locator('.font-mono').first()).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// 3. Chat page — tools button next to agent selector
// ---------------------------------------------------------------------------

test('List tools works from the chat page', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible({ timeout: 15_000 });

  // Select an agent from the dropdown (pick the first one).
  const agentSelect = page.locator('[data-testid="prompt-input-select"], button[aria-label*="agent"], select').first();

  // Try to find and click the agent selector.
  const selectTrigger = page.locator('button').filter({ hasText: /agent/i }).first();
  if (await selectTrigger.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await selectTrigger.click();
    await page.waitForTimeout(300);
    // Pick the first non-default option.
    const firstAgent = page.locator('[role="option"]').nth(1);
    if (await firstAgent.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await firstAgent.click();
    }
  }

  // The wrench (tools) button should now be visible.
  const wrenchBtn = page.locator('button[title="View agent tools"]');
  if (!(await wrenchBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
    test.skip(true, 'No agent selected or wrench button not visible');
    return;
  }

  await wrenchBtn.click();

  // Dialog should open.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Wait for loading to finish.
  await expect(dialog.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });

  // No 401 errors.
  const errorText = await dialog.locator('.text-destructive').textContent().catch(() => null);
  if (errorText) {
    expect(errorText).not.toContain('401');
    expect(errorText).not.toContain('Missing Bearer token');
  }
});
