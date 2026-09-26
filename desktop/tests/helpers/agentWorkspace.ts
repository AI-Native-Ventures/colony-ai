import { expect, type Page } from "@playwright/test";

export async function openAgentTemplatesView(page: Page): Promise<void> {
  const agentsNavigation = page.getByTestId("open-agents-view");
  await expect(agentsNavigation).toBeVisible({ timeout: 10_000 });
  await agentsNavigation.click();

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
