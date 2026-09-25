import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

async function openSignOutDialog(page: Parameters<typeof openSettings>[0]) {
  await openSettings(page, "security");
  await page.getByTestId("signout-open-dialog").click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
}

test("removing local data requires an explicit acknowledgement", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSignOutDialog(page);

  const dialog = page.getByRole("alertdialog");
  const removeButton = page.getByTestId("signout-confirm");
  const acknowledgement = page.getByRole("checkbox", {
    name: "I have saved anything I need from this device.",
  });

  await expect(dialog).toContainText("Sign out & remove local data?");
  await expect(dialog).toContainText(
    "Your business and conversations stored on the relay remain available.",
  );
  await expect(dialog).toContainText(
    "Local drafts, cached conversations, downloaded files and device settings will be removed.",
  );
  await expect(dialog.getByText(/private key|nsec|key backup/i)).toHaveCount(0);
  await expect(removeButton).toBeDisabled();
  await acknowledgement.check();
  await expect(removeButton).toBeEnabled();
  await expect(
    page.evaluate(
      () => window.__BUZZ_E2E_COMMANDS__?.includes("sign_out") ?? false,
    ),
  ).resolves.toBe(false);
});

test("staying signed in closes the dialog and restores the security panel", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSignOutDialog(page);
  await page.getByRole("checkbox", { name: /saved anything I need/ }).check();
  await page.getByRole("button", { name: "Stay signed in" }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("settings-account-security")).toBeVisible();
  await expect(page.getByTestId("signout-open-dialog")).toBeVisible();
  await selectSettingsSection(page, "profile");
  await expect(page.getByTestId("settings-profile")).toBeVisible();
});
