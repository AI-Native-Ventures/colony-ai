import { expect, type Page } from "@playwright/test";

export async function openLegacyProjectsView(page: Page) {
  await page.getByTestId("sidebar-projects-section-label").hover();
  await page.getByTestId("sidebar-projects-settings").click();
  await page.getByRole("menuitem", { name: "Browse all projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}
