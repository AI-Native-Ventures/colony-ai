import { expect, test } from "@playwright/test";

import { colony3TodayMockOptions } from "../helpers/colony3HomeFixture";
import {
  dumpTexts,
  openLerato,
  shot,
  waitForShell,
  writeCaptures,
} from "../helpers/colony3Proof";

/**
 * Colony 3.0 home, profile, settings and AI spend proof. Captures the app at
 * each board's size with the Lerato Social fixture, so
 * `scripts/colony3-proof-report.mjs` can lay every capture next to the design
 * reference. Not a regression gate: it writes PNGs and checks that each state
 * can be reached.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.afterAll(() => {
  writeCaptures();
});

test("Today board", async ({ page }) => {
  await openLerato(page, {
    route: "/#/today",
    mock: colony3TodayMockOptions(),
  });
  await waitForShell(page);
  await expect(page.getByTestId("needs-me-show-more")).toBeVisible({
    timeout: 20_000,
  });
  await dumpTexts(page, "Today", '[data-testid="today-screen"]');
  await shot(page, {
    name: "Today",
    board: "Today",
    title: "Today: Needs me and Moving forward",
  });
});

test("Activity board", async ({ page }) => {
  await openLerato(page, { route: "/#/" });
  await waitForShell(page);
  await shot(page, {
    name: "Activity",
    board: "Activity",
    title: "Activity inbox with a thread open",
  });
});

for (const [section, board, title] of [
  ["profile", "SettingsAccount", "Settings: Account"],
  ["appearance", "SettingsAppearance", "Settings: Appearance"],
  ["notifications", "SettingsPreferences", "Settings: Preferences"],
  ["business-profile", "SettingsBusiness", "Settings: Business"],
  ["agent-defaults", "SettingsAgents", "Settings: Agents"],
  ["app", "SettingsDevice", "Settings: App and devices"],
  ["mobile", "MobilePairing", "Settings: App and devices, Mobile"],
] as const) {
  test(`${board} board`, async ({ page }) => {
    await openLerato(page, { route: `/#/settings?section=${section}` });
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await dumpTexts(page, board, '[data-testid="settings-view"]');
    await shot(page, { name: board, board, title });
  });
}

test("Power board", async ({ page }) => {
  await openLerato(page, { route: "/#/power" });
  await waitForShell(page);
  await shot(page, {
    name: "Power",
    board: "Power",
    title: "AI spend and power: Overview",
  });
});

test("PowerUsage board", async ({ page }) => {
  await openLerato(page, { route: "/#/power?section=usage" });
  await waitForShell(page);
  await shot(page, {
    name: "PowerUsage",
    board: "PowerUsage",
    title: "AI spend and power: Usage",
  });
});

test("Main board", async ({ page }) => {
  await openLerato(page, { route: "/" });
  await page.getByTestId("channel-Welcome").click();
  await page.waitForTimeout(1500);
  await shot(page, {
    name: "Main",
    board: "Main",
    title: "#Welcome on day one",
  });
});

test("ProfilePopover board", async ({ page }) => {
  await openLerato(page, { route: "/#/today" });
  await waitForShell(page);
  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.waitForTimeout(500);
  await shot(page, {
    name: "ProfilePopover-menu",
    board: "ProfilePopover",
    title: "Account menu",
  });
});
