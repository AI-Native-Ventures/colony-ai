import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test("feedback keeps its message after a relay rejection and accepts a retry", async ({
  page,
}) => {
  await installMockBridge(page, {
    feedbackPublishErrors: ["Relay connection unavailable.", null],
  });
  await page.goto("/");

  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.getByTestId("profile-popover-send-feedback").click();

  const dialog = page.getByTestId("send-feedback-dialog");
  const message = page.getByTestId("feedback-message");
  await expect(dialog).toBeVisible();
  await page.getByTestId("feedback-type").selectOption("bug");
  await message.fill("The channel list did not refresh after reconnecting.");
  await page.getByTestId("feedback-submit").click();

  await expect(page.getByTestId("feedback-error")).toContainText(
    "Your feedback wasn’t sent",
  );
  await expect(message).toHaveValue(
    "The channel list did not refresh after reconnecting.",
  );
  await expect(page.getByTestId("feedback-type")).toHaveValue("bug");

  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-sent")).toBeVisible();
  await page.getByTestId("feedback-done").click();
  await expect(dialog).not.toBeVisible();
});
