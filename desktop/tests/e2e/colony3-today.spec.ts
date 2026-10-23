import { expect, test } from "@playwright/test";

import { COLONY3_NOW } from "../helpers/colony3Fixture";
import { colony3TodayMockOptions } from "../helpers/colony3HomeFixture";
import { installMockBridge } from "../helpers/bridge";

/**
 * Today on the design's Friday 23 October: eight open decisions, one overdue.
 * Layout against the board is judged by colony3-home-proof.spec.ts.
 */
test.describe("Colony 3.0 Today", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(COLONY3_NOW));
    await installMockBridge(page, {
      referenceWorkspace: true,
      colony3Sidebar: true,
      relayRequiresMembership: true,
      relayRole: "owner",
      ...colony3TodayMockOptions(),
    });
    await page.goto("/#/today");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  });

  test("names the day and counts the open decisions", async ({ page }) => {
    await expect(page.getByTestId("today-screen")).toContainText(
      "Friday, 23 October",
    );
    await expect(page.getByLabel("Needs me")).toContainText("8 open decisions");
    await expect(page.getByTestId("needs-me-overdue-toggle")).toHaveText(
      "1 overdue",
    );
    await expect(page.getByRole("status")).toContainText(
      "1 ask is overdue. It stays open until it’s answered, withdrawn or expires.",
    );
  });

  test("groups by deadline with the date on tomorrow's heading", async ({
    page,
  }) => {
    for (const heading of ["Overdue", "Today", "No deadline"]) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true, level: 3 }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("heading", { name: /^Tomorrow · Sat 24 Oct$/, level: 3 }),
    ).toBeVisible();
  });

  test("shows six decisions and the rest on request", async ({ page }) => {
    await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(6);
    await page.getByTestId("needs-me-show-more").click();
    await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(8);
  });

  test("the overdue pill narrows the list to the overdue ask", async ({
    page,
  }) => {
    await page.getByTestId("needs-me-overdue-toggle").click();
    await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(1);
    await page.getByTestId("needs-me-overdue-toggle").click();
    await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(6);
  });

  test("there is no Team updates switch", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Team updates" })).toHaveCount(
      0,
    );
    await expect(page.getByText("Team updates")).toHaveCount(0);
  });
});
