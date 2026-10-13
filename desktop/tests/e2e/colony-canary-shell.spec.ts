import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

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
