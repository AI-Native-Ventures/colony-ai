import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const OUTDIR = "/Users/mac/worktrees/.lanes/reskin/shots";

test.beforeEach(async ({ page }) => {
  mkdirSync(OUTDIR, { recursive: true });
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
    await expect(page.getByTestId("add-community-create")).toBeVisible();
    await expect(page.getByTestId("add-community-join")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUTDIR}/add-community-choices-${width}.png`,
    });

    await page.getByTestId("add-community-create").click();
    await expect(page.getByLabel("Community address")).toBeVisible();
    await expect(page.getByText(/Builderlab/i)).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUTDIR}/add-community-create-${width}.png`,
    });

    await page.getByTestId("add-community-back").click();
    await page.getByTestId("add-community-join").click();
    await expect(page.getByTestId("invite-redeem-input")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUTDIR}/add-community-join-${width}.png`,
    });
  });
}
