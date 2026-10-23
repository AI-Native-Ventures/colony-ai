import { expect, type Page } from "@playwright/test";

/** Opens the existing agent directory route without relying on shell placement. */
export async function openAgentsDirectoryView(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "/agents";
  });
  await expect(page).toHaveURL(/#\/agents(?:\?|$)/, { timeout: 10_000 });
  await expect(page.getByTestId("agents-page-content")).toBeVisible({
    timeout: 10_000,
  });
}

export async function openAgentTemplatesView(page: Page): Promise<void> {
  await openAgentsDirectoryView(page);
  await showAgentTemplates(page);
}

/**
 * Opens the Templates & snapshots view. The Agents directory no longer has a
 * Templates tab (agent templates are cut from the lean app), so the view is
 * reached by its address; its code and coverage stay until it is removed.
 */
export async function showAgentTemplates(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "/agents?view=templates";
  });
  await expect(page.getByTestId("agents-library-personas")).toBeVisible({
    timeout: 10_000,
  });
}
