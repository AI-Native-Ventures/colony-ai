import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

test("settings use nine groups, inner search, remembered sections, and return navigation", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page);

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
