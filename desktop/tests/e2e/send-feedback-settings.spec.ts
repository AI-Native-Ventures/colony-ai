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
  await page.getByRole("radio", { name: "Something is broken" }).check();
  await message.fill("The channel list did not refresh after reconnecting.");
  await page.getByTestId("feedback-submit").click();

  const error = page.getByTestId("feedback-error");
  await expect(error).toContainText("Connection failed");
  await expect(error).toContainText("could not reach the relay");
  const copyDetails = page.getByTestId("feedback-copy-details");
  await expect(copyDetails).toBeVisible();
  await copyDetails.click();
  await expect(copyDetails).toHaveText("Copied");
  await expect
    .poll(() =>
      page.evaluate(() => {
        return (
          window as Window & {
            __BUZZ_E2E_COMMAND_LOG__?: Array<{
              command: string;
              payload: { text?: string };
            }>;
          }
        ).__BUZZ_E2E_COMMAND_LOG__?.findLast(
          ({ command }) => command === "copy_text_to_clipboard",
        )?.payload.text;
      }),
    )
    .toBe(
      "action=feedback\nstage=relay-publish\nclass=connection\nstatus=none\ncode=connection_unavailable",
    );
  await expect(message).toHaveValue(
    "The channel list did not refresh after reconnecting.",
  );
  await expect(
    page.getByRole("radio", { name: "Something is broken" }),
  ).toBeChecked();

  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-sent")).toBeVisible();
  // The designed confirmation: a title and one line, with a Close button.
  await expect(page.getByTestId("send-feedback-title")).toHaveText(
    "Thank you for the feedback",
  );
  await expect(page.getByText("Your feedback was sent")).toBeVisible();
  await page.getByTestId("feedback-done").click();
  await expect(dialog).not.toBeVisible();
});
