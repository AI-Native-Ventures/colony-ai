import { expect, test } from "@playwright/test";
import UPNG from "upng-js";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

test("settings keep key export and import out of the account panels", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "profile");

  await expect(page.getByTestId("settings-account-profile-card")).toBeVisible();
  await expect(page.getByTestId("profile-private-key-row")).toHaveCount(0);
  await expect(page.getByTestId("profile-encrypted-backup-row")).toHaveCount(0);
  await expect(page.getByTestId("profile-backup-test-row")).toHaveCount(0);
  await expect(page.getByText(/private key|nsec|key backup/i)).toHaveCount(0);

  await selectSettingsSection(page, "security");
  await expect(page.getByTestId("settings-account-security")).toBeVisible();
  await expect(page.getByText(/private key|nsec|key backup/i)).toHaveCount(0);
});

test("avatar crop retries a failed profile update without losing the image", async ({
  page,
}) => {
  await installMockBridge(page, {
    profileUpdateErrors: ["Profile update failed."],
  });
  await page.goto("/");
  await openSettings(page, "profile");
  await page.getByTestId("profile-avatar-edit").click();

  const width = 32;
  const height = 32;
  const pixels = new Uint8Array(width * height * 4).fill(255);
  const image = Buffer.from(UPNG.encode([pixels.buffer], width, height, 0));
  await page.getByTestId("avatar-upload-open").click();
  await page.getByTestId("avatar-file-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.getByTestId("avatar-crop-preview")).toBeVisible();
  await page.getByTestId("avatar-save").click();

  await expect(page.getByTestId("avatar-save-error")).toBeVisible();
  await expect(page.getByAltText("Avatar crop preview")).toBeVisible();

  await page.getByTestId("avatar-retry").click();
  await expect(page.getByTestId("profile-avatar-dialog")).toBeHidden();
});
