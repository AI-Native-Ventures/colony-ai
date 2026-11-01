import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const API_KEY_CANARY = "sk_test_money_rails_secret_never_echo";

test("Money Rails: the connect dialog never echoes a pasted API key", async ({
  page,
}) => {
  test.setTimeout(20_000);
  await page.setViewportSize({ width: 1440, height: 1180 });
  await installMockBridge(page);
  await page.goto("/#/today");

  const addProvider = page.getByTestId("money-rail-add-provider");
  await expect(addProvider).toBeVisible({ timeout: 5_000 });
  await addProvider.click();

  const dialog = page.getByTestId("money-rail-connect-dialog");
  await expect(dialog).toBeVisible();
  const apiKey = page.getByTestId("money-rail-api-key");
  await apiKey.fill(API_KEY_CANARY);
  await expect(dialog).not.toContainText(API_KEY_CANARY);
});
