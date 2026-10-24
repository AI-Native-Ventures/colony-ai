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
  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.getByTestId("community-switcher").click();
  await page.getByRole("menuitem", { name: "Add a community" }).click();
});

for (const width of [1440, 900]) {
  test(`capture Colony community creation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // Create and join sit side by side on one card.
    await expect(page.getByTestId("self-serve-community-create")).toBeVisible();
    await expect(page.getByTestId("add-community-join")).toBeVisible();
    const dialog = page.getByTestId("add-community-dialog");
    await expect(
      dialog.getByRole("heading", { name: "Add a community" }),
    ).toHaveCount(1);
    await expect(page.getByLabel("Community address")).toBeVisible();
    await expect(page.getByTestId("invite-redeem-input")).toBeVisible();
    await expect(page.getByText(/Builderlab/i)).toHaveCount(0);
    await captureReskinAtWidth(page, "add-community-choices", width);
  });
}
