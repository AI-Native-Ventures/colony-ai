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

  const navigationOrder = await sidebar
    .locator(
      "[data-testid='sidebar-nav-conversations'], section[data-testid='sidebar-nav-company'], section[data-testid='sidebar-nav-business'], section[data-testid='sidebar-software-factory-group'], section[data-testid='sidebar-nav-library']",
    )
    .evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("data-testid")),
    );
  expect(navigationOrder).toEqual([
    "sidebar-nav-conversations",
    "sidebar-nav-company",
    "sidebar-nav-business",
    "sidebar-software-factory-group",
    "sidebar-nav-library",
  ]);

  const conversations = page.getByTestId("sidebar-nav-conversations");
  await expect(conversations.getByTestId("channel-general")).toBeVisible();
  await expect(conversations.getByTestId("forum-list")).toBeVisible();
  await expect(conversations.getByTestId("dm-list")).toBeVisible();
  for (const [section, list] of [
    ["channels", "stream-list"],
    ["forums", "forum-list"],
    ["dms", "dm-list"],
  ]) {
    await expect(page.getByTestId(`section-actions-${section}`)).toBeVisible();
    await expect(page.getByTestId(`${list}-section-label`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  }
  await expect(
    page.getByTestId("section-actions-channels-quick-create"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("section-actions-dms-quick-create"),
  ).toHaveCount(0);
  await expect(page.getByTestId("open-workflows-view")).toBeVisible();
  await expect(page.getByTestId("sidebar-company-goals")).toBeVisible();
  await expect(page.getByTestId("sidebar-company-work")).toBeVisible();
  await expect(page.getByTestId("open-factory-view")).toBeVisible();
  await expect(page.getByTestId("sidebar-software-factory-toggle")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("sidebar-ai-spend-power")).toBeVisible();
  await expect(page.getByTestId("sidebar-settings")).toBeVisible();
  await expect(page.getByTestId("sidebar-profile-name")).toBeVisible();

  for (const label of [
    "Team",
    "Discovery",
    "Clients",
    "Social media",
    "Website",
    "Money",
    "Files & assets",
    "Knowledge",
  ]) {
    await expect(
      sidebar.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  }
});

test("Company Goals opens the existing goals route", async ({ page }) => {
  await page.goto("/");

  const goals = page.getByTestId("sidebar-company-goals");
  await expect(goals).toBeVisible();
  await goals.click();

  await expect(page).toHaveURL(/#\/goals$/);
  await expect(page.getByTestId("sidebar-nav-company-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(goals).toHaveAttribute("data-active", "true");
  await expect(
    page.getByText("Company / Goals", { exact: true }),
  ).toBeVisible();
});

test("Company Work and Business destinations open existing routes", async ({
  page,
}) => {
  await page.goto("/");

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
  const library = page.getByTestId("sidebar-nav-library-toggle");

  await expect(company).toHaveAttribute("aria-expanded", "true");
  await expect(business).toHaveAttribute("aria-expanded", "false");
  await expect(library).toHaveAttribute("aria-expanded", "false");

  await company.focus();
  await page.keyboard.press("Enter");
  await expect(company).toHaveAttribute("aria-expanded", "false");

  await business.focus();
  await page.keyboard.press("Space");
  await expect(business).toHaveAttribute("aria-expanded", "true");
  await expect(company).toHaveAttribute("aria-expanded", "false");
  await expect(library).toHaveAttribute("aria-expanded", "false");
});

test("conversation groups collapse independently with the keyboard", async ({
  page,
}) => {
  await page.goto("/");

  const channels = page.getByTestId("stream-list-section-label");
  const forums = page.getByTestId("forum-list-section-label");
  const directMessages = page.getByTestId("dm-list-section-label");
  await expect(channels).toHaveAttribute("aria-expanded", "true");
  await expect(forums).toHaveAttribute("aria-expanded", "true");
  await expect(directMessages).toHaveAttribute("aria-expanded", "true");

  await channels.focus();
  await page.keyboard.press("Enter");
  await expect(channels).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("stream-list")).toBeHidden();
  await expect(page.getByTestId("forum-list")).toBeVisible();

  await forums.focus();
  await page.keyboard.press("Space");
  await expect(forums).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("forum-list")).toBeHidden();
  await expect(page.getByTestId("dm-list")).toBeVisible();

  await directMessages.focus();
  await page.keyboard.press("Enter");
  await expect(directMessages).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("dm-list")).toBeHidden();
  await expect(page.getByTestId("stream-list")).toBeHidden();
});

test("Saved for later remains under Activity and keeps the reminder filter", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("sidebar-activity-toggle").click();
  const savedForLater = page.getByTestId("sidebar-saved-for-later");
  await expect(savedForLater).toBeVisible();
  await savedForLater.click();

  await expect(page).toHaveURL(/filter=reminders/);
  const reminders = page.getByTestId("home-inbox-reminders");
  await expect(reminders).toBeVisible();
  await expect(reminders).toContainText("No reminders");
  await expect(savedForLater).toHaveAttribute("data-active", "true");
});

test("Software Factory exposes its designed Projects destination only", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("sidebar-projects-section")).toHaveCount(0);
  await page.getByTestId("open-factory-view").click();
  await expect(page).toHaveURL(/#\/factory$/);
  await expect(page.getByTestId("sidebar-projects-section")).toBeVisible();
  await expect(page.getByTestId("sidebar-shared-compute")).toHaveCount(0);
});

test("Blocks and templates stays in Library and opens its existing settings panel", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("sidebar-nav-library-toggle").click();

  const blocksAndTemplates = page.getByTestId("sidebar-blocks-templates");
  await expect(blocksAndTemplates).toBeVisible();
  await expect(blocksAndTemplates).toHaveCount(1);
  await blocksAndTemplates.click();

  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(
    page.getByTestId("settings-panel-channel-templates"),
  ).toBeVisible();
  await expect(page.getByTestId("settings-nav-channel-templates")).toHaveCount(
    0,
  );
});
