import type { Page } from "@playwright/test";

/**
 * Opens a sidebar destination group (Company or Business) if it is closed.
 * The Colony 3.0 sidebar starts both groups collapsed, and a group that holds
 * the open route opens itself, so only a closed group is clicked.
 */
export async function openSidebarGroup(
  page: Page,
  group: "company" | "business",
) {
  const toggle = page.getByTestId(`sidebar-nav-${group}-toggle`);
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}
