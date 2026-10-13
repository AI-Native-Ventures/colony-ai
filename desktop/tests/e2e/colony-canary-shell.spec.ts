import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("approved navigation replaces the old visible sections and keeps real routes", async ({
  page,
}) => {
  await page.goto("/#/today");

  const sidebar = page.getByTestId("app-sidebar");
  const navigation = sidebar.getByRole("navigation", {
    name: "Main navigation",
  });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('[data-sidebar="sidebar"]')).toHaveCSS(
    "background-image",
    /rgb\(148, 180, 250\)/,
  );
  await expect(navigation.getByRole("button")).toHaveCount(5);
  await expect(
    navigation.getByRole("button", { name: "Today" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByText("Workflows", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Factory", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Forums", { exact: true })).toHaveCount(0);
  await expect(sidebar).toHaveCSS("width", "216px");

  await sidebar.getByTestId("open-search").click();
  await expect(page.getByTestId("search-results")).toBeVisible();
  await expect(page.getByTestId("search-dialog-input")).toBeFocused();
  await page.keyboard.press("Escape");

  await navigation.getByRole("button", { name: "Team", exact: true }).click();
  await expect(page).toHaveURL(/#\/team$/);
  await expect(sidebar).toBeVisible();

  await navigation.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await expect(sidebar).toBeVisible();

  await sidebar.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByTestId("create-channel-dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "New conversation" }),
  ).toBeVisible();
});

test("conversation navigation opens an existing stream and offers a mobile menu", async ({
  page,
}) => {
  await page.goto("/#/today");
  const sidebar = page.getByTestId("app-sidebar");
  await sidebar
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Conversations" })
    .click();
  await expect(page).toHaveURL(/#\/channels\//);
  await expect(
    sidebar.locator(".colony-canary-conversation-list button").first(),
  ).toBeVisible();

  await page.setViewportSize({ width: 700, height: 800 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
});

test("a relay outage keeps a visible reconnect action in the canary sidebar", async ({
  page,
}) => {
  await page.goto("/#/today");
  await page.waitForFunction(
    () => window.__BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?.() === "connected",
  );
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("disconnected"),
  );
  const sidebar = page.getByTestId("app-sidebar");
  const card = sidebar.getByTestId("sidebar-relay-unreachable");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Can't reach the relay");
  await expect(sidebar.getByTestId("sidebar-reconnect")).toBeEnabled();
  await expect(sidebar.locator(".colony-canary-account")).toBeVisible();
  if (process.env.COLONY_CANARY_RECONNECT_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_RECONNECT_SHOT });
  }
  await sidebar.getByTestId("sidebar-reconnect").click();
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("connected"),
  );
  await expect(card).toContainText("Connected");
});

test("Settings uses one Colony sidebar and the approved section list", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("button")).toHaveCount(9);
  await expect(
    sections.getByRole("button", { name: "Business profile" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("settings-business-profile")).toBeVisible();
  await expect(page.getByTestId("settings-sidebar")).toBeHidden();
  expect(
    await page
      .locator(".w20-settings-shell")
      .evaluate((element) => element.getBoundingClientRect().x),
  ).toBe(216);
  if (process.env.COLONY_CANARY_SETTINGS_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_SETTINGS_SHOT });
  }
  await page.setViewportSize({ width: 700, height: 700 });
  await expect(sections).toBeVisible();
  expect(
    await page
      .locator(".w20-settings-shell")
      .evaluate((element) => element.getBoundingClientRect().x),
  ).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  if (process.env.COLONY_CANARY_SETTINGS_NARROW_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({
      path: process.env.COLONY_CANARY_SETTINGS_NARROW_SHOT,
    });
  }
  await sections.getByRole("button", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/section=notifications/);
  await expect(
    sections.getByRole("button", { name: "Notifications" }),
  ).toHaveAttribute("aria-current", "page");
});

test("Settings sections open the existing product controls", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  for (const entry of [
    {
      label: "How your team is powered",
      panel: "settings-global-agent-config",
      shot: "powered",
    },
    { label: "People", panel: "settings-community-members", shot: "people" },
    {
      label: "Notifications",
      panel: "settings-notifications",
      shot: "notifications",
    },
    { label: "Running", panel: "settings-app-preferences", shot: "running" },
    { label: "Account", panel: "settings-profile", shot: "account" },
    { label: "Help and updates", panel: "settings-updates", shot: "updates" },
  ]) {
    await sections.getByRole("button", { name: entry.label }).click();
    await expect(page.getByTestId(entry.panel)).toBeVisible();
    await expect(
      sections.getByRole("button", { name: entry.label }),
    ).toHaveAttribute("aria-current", "page");
    if (process.env.COLONY_CANARY_SETTINGS_SHOT_DIR) {
      await waitForAnimations(page);
      await page.screenshot({
        path: `${process.env.COLONY_CANARY_SETTINGS_SHOT_DIR}/${entry.shot}.png`,
      });
    }
  }
  await page
    .getByTestId("settings-updates")
    .getByRole("button", { name: "Send feedback" })
    .click();
  await expect(page.getByTestId("settings-feedback")).toBeVisible();
  await sections.getByRole("button", { name: "Credits and billing" }).click();
  await expect(page).toHaveURL(/#\/power\?.*section=history/);
  await expect(page.getByTestId("power-screen")).toBeVisible();
  await page.goto("/#/settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/settings\?.*section=connections/);
  await expect(page.getByTestId("settings-connections")).toBeVisible();
});

test("Settings uses the same layout in dark mode", async ({ page }) => {
  await page.goto("/#/settings");
  await page.evaluate(() => localStorage.setItem("buzz-theme", "buzz-dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.getByRole("navigation", { name: "Settings sections" }),
  ).toBeVisible();
  if (process.env.COLONY_CANARY_SETTINGS_DARK_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({
      path: process.env.COLONY_CANARY_SETTINGS_DARK_SHOT,
    });
  }
});
