import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

test("settings omit owner-dropped hosted and deployment pages", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page);

  await expect(page.locator('[data-testid^="settings-group-"]')).toHaveCount(9);
  await expect(
    page.getByText("Hosted communities", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Deployment console", { exact: true }),
  ).toHaveCount(0);

  const search = page.getByTestId("settings-search");
  await search.fill("Hosted communities");
  await expect(page.getByText("No settings found.")).toBeVisible();
  await search.fill("Deployment console");
  await expect(page.getByText("No settings found.")).toBeVisible();
});
