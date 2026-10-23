import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("full app sidebar follows the approved navigation hierarchy", async ({
  page,
}) => {
  await page.goto("/");

  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveAttribute("data-colony-full-app-shell", "true");
  await expect(page.getByTestId("app-top-chrome")).toBeVisible();
  await expect(sidebar.locator('[data-sidebar="trigger"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="app-top-chrome"] [data-sidebar="trigger"]'),
  ).toBeHidden();
  await expect(page.getByTestId("sidebar-business-switcher")).toBeVisible();
  await expect(page.getByTestId("open-search")).toContainText("Find anything");
  await expect(page.getByTestId("sidebar-activity-button")).toContainText(
    "Activity",
  );

  // Colony 3.0 order: the destinations first, the conversations below them.
  const navigationOrder = await sidebar
    .locator(
      "[data-testid='sidebar-nav-conversations'], [data-testid='sidebar-nav-company'], [data-testid='sidebar-nav-business']",
    )
    .evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("data-testid")),
    );
  expect(navigationOrder).toEqual([
    "sidebar-nav-company",
    "sidebar-nav-business",
    "sidebar-nav-conversations",
  ]);

  const conversations = page.getByTestId("sidebar-nav-conversations");
  await expect(conversations.getByTestId("channel-general")).toBeVisible();
  await expect(conversations.getByTestId("dm-list")).toBeVisible();
  for (const [section, list] of [
    ["channels", "stream-list"],
    ["dms", "dm-list"],
  ]) {
    await expect(page.getByTestId(`section-actions-${section}`)).toBeVisible();
    await expect(page.getByTestId(`${list}-section-label`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  }
  // Every conversation section has its designed "+" quick action.
  await expect(
    page.getByTestId("section-actions-channels-quick-create"),
  ).toBeVisible();
  await expect(
    page.getByTestId("section-actions-dms-quick-create"),
  ).toBeVisible();
  // Company starts collapsed; opening it shows every company destination.
  const company = page.getByTestId("sidebar-nav-company-toggle");
  await expect(company).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("sidebar-company-team")).toBeHidden();
  await company.click();
  await expect(company).toHaveAttribute("aria-expanded", "true");
  for (const id of [
    "sidebar-company-work",
    "sidebar-company-team",
    "sidebar-company-agents",
  ])
    await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("sidebar-ai-spend-power")).toBeVisible();
  await expect(page.getByTestId("sidebar-settings")).toBeVisible();
  await expect(page.getByTestId("sidebar-profile-name")).toBeVisible();

  // Company and Business open and close.
  for (const group of ["company", "business"])
    await expect(
      sidebar.getByTestId(`sidebar-nav-${group}-toggle`),
    ).toBeVisible();

  await expect(sidebar.getByTestId("sidebar-company-team")).toBeVisible();
  await sidebar.getByTestId("sidebar-company-team").click();
  await expect(page).toHaveURL(/#\/team$/);
  await expect(sidebar.getByTestId("sidebar-company-team")).toHaveAttribute(
    "data-active",
    "true",
  );

  for (const label of [
    "Discovery",
    "Clients",
    "Social media",
    "Website",
    "Files & assets",
    "Knowledge",
  ]) {
    await expect(
      sidebar.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  }
});

test("Company Work and Business destinations open existing routes", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("sidebar-nav-company-toggle").click();
  await page.getByTestId("sidebar-company-work").click();
  await expect(page).toHaveURL(/#\/work$/);
  await expect(
    page.getByRole("heading", { name: "Work", exact: true }),
  ).toBeVisible();

  await page.getByTestId("sidebar-activity-button").click();
  await page.getByTestId("sidebar-nav-business-toggle").click();
  const discovery = page.getByTestId("sidebar-business-discovery");
  await expect(discovery).toBeVisible();
  await discovery.click();
  await expect(page).toHaveURL(/#\/discovery$/);
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav-business-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  const clients = page.getByTestId("sidebar-business-clients");
  await expect(clients).toBeVisible();
  await clients.click();
  await expect(page).toHaveURL(/#\/clients$/);
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();

  const money = page.getByTestId("sidebar-business-money");
  await expect(money).toBeVisible();
  await money.click();
  await expect(page).toHaveURL(/#\/money$/);
  await expect(page.getByTestId("money-overview")).toBeVisible();
  await expect(money).toHaveAttribute("data-active", "true");

  await page.goto("/#/clients");
  await expect(page.getByTestId("sidebar-nav-business-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByTestId("sidebar-business-clients")).toBeVisible();
});

test("navigation groups collapse independently with the keyboard", async ({
  page,
}) => {
  await page.goto("/");

  const company = page.getByTestId("sidebar-nav-company-toggle");
  const business = page.getByTestId("sidebar-nav-business-toggle");

  // Both start collapsed, as designed.
  await expect(company).toHaveAttribute("aria-expanded", "false");
  await expect(business).toHaveAttribute("aria-expanded", "false");

  await company.focus();
  await page.keyboard.press("Enter");
  await expect(company).toHaveAttribute("aria-expanded", "true");
  await expect(business).toHaveAttribute("aria-expanded", "false");

  await business.focus();
  await page.keyboard.press("Space");
  await expect(business).toHaveAttribute("aria-expanded", "true");
  await expect(company).toHaveAttribute("aria-expanded", "true");

  await company.focus();
  await page.keyboard.press("Enter");
  await expect(company).toHaveAttribute("aria-expanded", "false");
  await expect(business).toHaveAttribute("aria-expanded", "true");
});

test("conversation groups collapse independently with the keyboard", async ({
  page,
}) => {
  await page.goto("/");

  const channels = page.getByTestId("stream-list-section-label");
  const directMessages = page.getByTestId("dm-list-section-label");
  await expect(channels).toHaveAttribute("aria-expanded", "true");
  await expect(directMessages).toHaveAttribute("aria-expanded", "true");

  await channels.focus();
  await page.keyboard.press("Enter");
  await expect(channels).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("stream-list")).toBeHidden();
  await expect(page.getByTestId("dm-list")).toBeVisible();

  await directMessages.focus();
  await page.keyboard.press("Enter");
  await expect(directMessages).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("dm-list")).toBeHidden();
  await expect(page.getByTestId("stream-list")).toBeHidden();
});
