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

/** Switches an open Agents workspace from its directory to the Templates tab. */
export async function showAgentTemplates(page: Page): Promise<void> {
  const templatesTab = page.getByRole("button", {
    name: "Templates",
    exact: true,
  });
  await expect(templatesTab).toBeVisible({ timeout: 10_000 });
  await templatesTab.click();
  await expect(page.getByTestId("agents-library-personas")).toBeVisible({
    timeout: 10_000,
  });
}
