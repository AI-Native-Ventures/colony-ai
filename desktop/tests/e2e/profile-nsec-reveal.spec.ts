import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

test("account settings no longer expose private-key reveal controls", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "profile");

  const settings = page.getByTestId("settings-view");
  await expect(page.getByTestId("settings-account-profile-card")).toBeVisible();
  await expect(settings.getByText(/private key|nsec|key backup/i)).toHaveCount(
    0,
  );
  await expect(page.getByTestId("profile-private-key-toggle")).toHaveCount(0);

  await selectSettingsSection(page, "security");
  await expect(page.getByTestId("settings-account-security")).toBeVisible();
  await expect(settings.getByText(/private key|nsec|key backup/i)).toHaveCount(
    0,
  );
});
