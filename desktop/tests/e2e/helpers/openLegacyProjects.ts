import { expect, type Page } from "@playwright/test";

export async function openLegacyProjectsView(page: Page) {
  const projectsSection = page.getByTestId("sidebar-projects-section-label");
  if (!(await projectsSection.isVisible())) {
    await page.getByTestId("open-factory-view").click();
  }
  await expect(projectsSection).toBeVisible();
  await projectsSection.hover();
  await page.getByTestId("sidebar-projects-settings").click();
  await page.getByRole("menuitem", { name: "Browse all projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}
