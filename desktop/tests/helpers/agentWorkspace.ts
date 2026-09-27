import { expect, type Page } from "@playwright/test";

export async function openAgentTemplatesView(page: Page): Promise<void> {
  const agentsNavigation = page.getByTestId("open-agents-view");
  await expect(agentsNavigation).toBeVisible({ timeout: 10_000 });
  await agentsNavigation.click();
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
