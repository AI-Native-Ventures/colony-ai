import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import {
  captureReskinAtWidth,
  seedReskinTheme,
} from "../helpers/reskinScreenshots";

test.beforeEach(async ({ page }) => {
  await seedReskinTheme(page);
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: "example.test",
        public: true,
        max_per_owner: 3,
      },
    }),
  );
  await page.route("**/api/communities/availability?**", (route) => {
    const slug = new URL(route.request().url()).searchParams.get("name") ?? "";
    return route.fulfill({
      json: {
        name: slug,
        normalized_host: `${slug}.example.test`,
        available: true,
      },
    });
  });
  await installMockBridge(page, {});
  await page.goto("/");
  await page.getByTestId("sidebar-business-switcher").click();
  await page
    .getByTestId("workspace-switcher-menu")
    .getByTestId("workspace-create-action")
    .click();
});

for (const width of [1440, 900]) {
  test(`capture workspace creation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("workspace-create-form")).toBeVisible();
    const dialog = page.getByTestId("workspace-action-dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create a workspace" }),
    ).toHaveCount(1);
    await expect(page.getByLabel("Workspace name")).toBeVisible();
    await expect(page.getByLabel("Website (optional)")).toBeVisible();
    await expect(page.getByLabel("Workspace address")).toBeVisible();
    await expect(page.getByTestId("workspace-create-join")).toBeVisible();
    await expect(page.getByText(/Builderlab/i)).toHaveCount(0);
    await captureReskinAtWidth(page, "workspace-create", width);
  });
}
