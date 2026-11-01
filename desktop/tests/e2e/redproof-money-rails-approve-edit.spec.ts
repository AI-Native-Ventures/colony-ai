import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const PAYMENT_LINK_ID = "7f3c2a91-4b1d-4a2f-8e63-2d90a74ce112";

test("Money Rails: editing a card disables Approve until the edit is saved", async ({
  page,
}) => {
  test.setTimeout(20_000);
  await page.setViewportSize({ width: 1440, height: 1180 });
  await installMockBridge(page);
  await page.goto("/#/today/needs-you");

  const editButton = page.getByTestId(`money-rail-edit-${PAYMENT_LINK_ID}`);
  await expect(editButton).toBeVisible({ timeout: 5_000 });
  await editButton.click();
  await page.getByRole("textbox", { name: "Payment amount" }).fill("3900");
  await expect(
    page.getByTestId(`money-rail-approve-${PAYMENT_LINK_ID}`),
  ).toBeDisabled();
});
