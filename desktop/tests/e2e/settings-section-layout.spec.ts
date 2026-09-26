import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

test("settings use nine groups, inner search, remembered sections, and return navigation", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page);
  await expect(page.getByTestId("settings-history-back")).toBeEnabled();
  await expect(page.getByTestId("settings-history-forward")).toBeDisabled();

  for (const group of [
    "account",
    "appearance-group",
    "preferences",
    "business",
    "agents-group",
    "blocks-templates",
    "administration",
    "app-devices",
    "storage-group",
  ]) {
    await expect(page.getByTestId(`settings-group-${group}`)).toBeVisible();
  }
  await expect(page.locator('[data-testid^="settings-group-"]')).toHaveCount(9);
  await expect(page.getByRole("tablist")).toHaveCount(1);

  await page.getByTestId("settings-search").fill("Channel templates");
  const result = page.getByRole("option", {
    name: "Channel templates, Blocks & templates",
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByTestId("settings-channel-templates")).toBeVisible();
  await expect(
    page.getByTestId("settings-group-blocks-templates"),
  ).toHaveAttribute("aria-pressed", "true");

  await selectSettingsSection(page, "harnesses");
  await expect(page.getByTestId("settings-harnesses")).toBeVisible();
  await page.getByTestId("settings-group-appearance-group").click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  await page.getByTestId("settings-group-agents-group").click();
  await expect(page.getByTestId("settings-harnesses")).toBeVisible();

  await page.getByTestId("settings-group-business").click();
  await expect(page.getByTestId("settings-inner-work")).toHaveCount(0);
  await expect(page.getByTestId("settings-inner-connections")).toHaveCount(0);
  await page.getByTestId("settings-group-agents-group").click();
  await expect(page.getByTestId("settings-inner-ai-connections")).toHaveCount(
    0,
  );
  await page.getByTestId("settings-group-blocks-templates").click();
  await expect(page.getByTestId("settings-inner-blocks")).toHaveCount(0);
  await page.getByTestId("settings-group-app-devices").click();
  await expect(page.getByTestId("settings-inner-compute")).toHaveCount(0);

  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("routes without a data-backed design fall back to Account profile", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/#/settings?section=compute");

  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("settings-panel-profile")).toBeVisible();
  await expect(page.getByTestId("settings-panel-compute")).toHaveCount(0);
  await expect(page.getByTestId("settings-history-back")).toBeDisabled();
  await expect(page.getByTestId("settings-history-forward")).toBeDisabled();
});

test("account profile follows the r19 grid and type scale at desktop widths", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("buzz-sidebar-width", "238");
  });
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "profile");

  const profileTitle = page
    .getByTestId("settings-profile")
    .getByRole("heading", { name: "Your account", exact: true });
  await expect(profileTitle).toBeVisible();
  const titleFontSize = await profileTitle.evaluate(
    (element) => getComputedStyle(element).fontSize,
  );
  const breadcrumbLineHeights = await page
    .locator(".w20-topbar-title > span")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).lineHeight),
    );
  const profileAvatarSize = await page
    .getByTestId("settings-profile-avatar")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

  expect(titleFontSize).toBe("27.2px");
  expect(breadcrumbLineHeights).toEqual(["18px", "18px"]);
  expect(profileAvatarSize).toEqual({ width: 23, height: 23 });

  for (const expected of [
    {
      viewport: { width: 1440, height: 900 },
      title: { x: 314, y: 172, width: 161.3125, height: 33.1875 },
      profileCard: { x: 314, y: 267.1875, width: 631.96875 },
      businessCard: { x: 973.96875, y: 267.1875, width: 383.03125 },
      nameField: { x: 339, y: 331.1875, width: 581.96875, height: 72.71875 },
      nameInput: { x: 339, y: 363.90625, width: 581.96875, height: 40 },
    },
    {
      viewport: { width: 1728, height: 1117 },
      title: { x: 322, y: 176, width: 161.3125, height: 33.1875 },
      profileCard: { x: 322, y: 275.1875, width: 801.328125 },
      businessCard: { x: 1151.328125, y: 275.1875, width: 485.65625 },
      nameField: { x: 347, y: 339.1875, width: 751.328125, height: 72.71875 },
      nameInput: { x: 347, y: 371.90625, width: 751.328125, height: 40 },
    },
  ]) {
    await page.setViewportSize(expected.viewport);
    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        if (!rect) throw new Error(`Missing settings geometry for ${selector}`);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      };
      const firstProfileField = document.querySelector(
        '[data-testid="settings-profile"] .w20-account-field',
      );
      const firstProfileFieldRect = firstProfileField?.getBoundingClientRect();
      if (!firstProfileFieldRect) {
        throw new Error("Missing first account profile field");
      }
      return {
        title: bounds('[data-testid="settings-profile"] h1'),
        profileCard: bounds('[data-testid="settings-account-profile-card"]'),
        businessCard: bounds('[data-testid="settings-account-business-card"]'),
        nameField: {
          x: firstProfileFieldRect.x,
          y: firstProfileFieldRect.y,
          width: firstProfileFieldRect.width,
          height: firstProfileFieldRect.height,
        },
        nameInput: bounds('[data-testid="account-profile-name"]'),
      };
    });
    const expectCoordinate = (actual: number, expectedValue: number) => {
      expect(Math.abs(actual - expectedValue)).toBeLessThan(1);
    };
    expectCoordinate(geometry.title.x, expected.title.x);
    expectCoordinate(geometry.title.y, expected.title.y);
    expectCoordinate(geometry.title.width, expected.title.width);
    expectCoordinate(geometry.title.height, expected.title.height);
    expectCoordinate(geometry.profileCard.x, expected.profileCard.x);
    expectCoordinate(geometry.profileCard.y, expected.profileCard.y);
    expectCoordinate(geometry.profileCard.width, expected.profileCard.width);
    expectCoordinate(geometry.businessCard.x, expected.businessCard.x);
    expectCoordinate(geometry.businessCard.y, expected.businessCard.y);
    expectCoordinate(geometry.businessCard.width, expected.businessCard.width);
    expectCoordinate(geometry.nameField.x, expected.nameField.x);
    expectCoordinate(geometry.nameField.y, expected.nameField.y);
    expectCoordinate(geometry.nameField.width, expected.nameField.width);
    expectCoordinate(geometry.nameField.height, expected.nameField.height);
    expectCoordinate(geometry.nameInput.x, expected.nameInput.x);
    expectCoordinate(geometry.nameInput.y, expected.nameInput.y);
    expectCoordinate(geometry.nameInput.width, expected.nameInput.width);
    expectCoordinate(geometry.nameInput.height, expected.nameInput.height);
  }
});

test("appearance controls save a complete scoped snapshot and retain density", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "appearance");

  await expect(page.getByTestId("appearance-density")).toBeVisible();
  await page.getByTestId("appearance-mode-dark").click();
  await expect(page.getByTestId("appearance-mode-dark")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter(
            (key) =>
              key.startsWith("colony.appearance.v1:") &&
              !key.endsWith(":last-business"),
          ).length,
      ),
    )
    .toBe(1);
  const businessSnapshot = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (candidate) =>
        candidate.startsWith("colony.appearance.v1:") &&
        !candidate.endsWith(":last-business") &&
        !candidate.endsWith(":global-conversations"),
    );
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  });
  expect(businessSnapshot).toMatchObject({
    followSystem: false,
    glassBackground: false,
    prominentActiveTab: false,
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);
});
