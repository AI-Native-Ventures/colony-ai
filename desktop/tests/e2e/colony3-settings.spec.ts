import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

/**
 * Colony 3.0 Settings: one long page per group, the lean set of pages, and the
 * controls the new pages added (typeface, time zone, per-event sounds, invite
 * form). Layout against the design is judged by the proof captures in
 * colony3-home-proof.spec.ts, not here.
 */
const OWNER = {
  relayRequiresMembership: true,
  relayRole: "owner" as const,
};

test.describe("Colony 3.0 Settings", () => {
  test("shows the lean pages and nothing for the cut ones", async ({
    page,
  }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/");
    await openSettings(page);

    for (const group of [
      "account",
      "appearance-group",
      "preferences",
      "business",
      "agents-group",
      "blocks-templates",
      "app-devices",
    ]) {
      await expect(page.getByTestId(`settings-group-${group}`)).toBeVisible();
    }
    await expect(page.locator('[data-testid^="settings-group-"]')).toHaveCount(
      7,
    );
    for (const cut of ["administration", "storage-group"]) {
      await expect(page.getByTestId(`settings-group-${cut}`)).toHaveCount(0);
    }

    for (const query of ["Storage", "Moderation", "Channel templates"]) {
      await page.getByTestId("settings-search").fill(query);
      await expect(page.getByText("No settings found.")).toBeVisible();
    }
  });

  test("a cut page address lands on Account", async ({ page }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/#/settings?section=storage");
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await expect(page.getByTestId("settings-panel-profile")).toBeVisible();
  });

  test("tabs jump between the sections of one page", async ({ page }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-group-preferences").click();

    for (const section of ["notifications", "voice", "shortcuts"]) {
      await expect(page.getByTestId(`settings-panel-${section}`)).toHaveCount(
        1,
      );
    }
    await page.getByTestId("settings-inner-shortcuts").click();
    await expect(page.getByTestId("settings-inner-shortcuts")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("settings-shortcuts")).toBeInViewport();
    await expect(page).toHaveURL(/section=shortcuts/);
  });

  test("Appearance offers six accents and a typeface, and no theme catalog", async ({
    page,
  }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/#/settings?section=appearance");
    await expect(page.getByTestId("settings-appearance")).toBeVisible();

    await expect(
      page.locator('[data-testid^="appearance-accent-"]'),
    ).toHaveCount(6);
    await expect(page.getByTestId("appearance-open-themes")).toHaveCount(0);

    await page.getByTestId("appearance-typeface").selectOption("inter");
    await expect(page.locator("html")).toHaveAttribute(
      "data-typeface",
      "inter",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-typeface",
      "inter",
    );
    await page.getByTestId("appearance-typeface").selectOption("manrope");
    await expect(page.locator("html")).not.toHaveAttribute("data-typeface");
  });

  test("Account saves a time zone and opens the status dialog", async ({
    page,
  }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/#/settings?section=profile");

    const zone = page.getByTestId("account-profile-timezone");
    await zone.selectOption("Europe/London");
    await page.getByTestId("account-profile-save").click();
    await page.reload();
    await expect(page.getByTestId("account-profile-timezone")).toHaveValue(
      "Europe/London",
    );

    await page.getByTestId("account-profile-status").click();
    await expect(page.getByTestId("set-status-dialog")).toBeVisible();
  });

  test("Preferences picks a sound per kind of message, or none", async ({
    page,
  }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/#/settings?section=notifications");

    const dm = page.getByTestId("notifications-sound-select-dm");
    await dm.selectOption("none");
    await expect(dm).toHaveValue("none");
    await expect(
      page.getByTestId("notifications-sound-play-dm"),
    ).toBeDisabled();
    await dm.selectOption("ping");
    await expect(dm).toHaveValue("ping");
    await expect(page.getByTestId("notifications-sound-play-dm")).toBeEnabled();
  });

  test("Business invite form asks for a valid email", async ({ page }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/#/settings?section=people");

    await page.getByTestId("community-invite-input").fill("not an email");
    await page.getByTestId("community-invite-send").click();
    await expect(page.getByRole("alert")).toContainText(
      "Enter a valid email address.",
    );
  });

  test("Experiments leaves out the features that are not in this app", async ({
    page,
  }) => {
    await installMockBridge(page, OWNER);
    await page.goto("/#/settings?section=experimental");

    await expect(
      page.getByTestId("feature-toggle-agentManagedProfiles"),
    ).toBeVisible();
    for (const cut of ["workflows", "projects", "pulse", "forum"]) {
      await expect(page.getByTestId(`feature-toggle-${cut}`)).toHaveCount(0);
    }
  });
});
