import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const E2E_IDENTITY_OVERRIDE_STORAGE_KEY =
  "buzz:e2e-identity-override.v1";

export async function seedActiveIdentity(
  page: Page,
  identity: { privateKey: string; pubkey: string; username: string },
) {
  await page.addInitScript(
    ({ identity: nextIdentity, storageKey }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(nextIdentity));
    },
    { identity, storageKey: E2E_IDENTITY_OVERRIDE_STORAGE_KEY },
  );
}

/** Enter the legacy identity setup behind the account screen's advanced link. */
export async function openAdvancedIdentityPath(page: Page) {
  await expect(page.getByTestId("account-auth-screen-choice")).toBeVisible();
  await page.getByTestId("account-auth-advanced").click();
  await expect(
    page.getByRole("button", { name: "Create a new identity key" }),
  ).toBeVisible();
}

/** Continue past the created-key page without opening optional backup options. */
export async function passThroughBackupStep(page: Page) {
  await expect(page.getByTestId("onboarding-page-backup")).toBeVisible();
  await page.getByTestId("onboarding-next").click();
}
