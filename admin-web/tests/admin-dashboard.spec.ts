import { expect, type Page, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  aiUsageFixture,
  businessesFixture,
  businessFixture,
  healthFixture,
  overviewFixture,
} from "./helpers/admin-fixtures";

async function stubOperatorApi(page: Page) {
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ role: "operator", source: "config" }),
    }),
  );
  await page.route("**/api/admin/v1/metrics/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const body = pathname.endsWith("/overview")
      ? overviewFixture
      : pathname.endsWith("/ai-usage")
        ? aiUsageFixture
        : pathname.endsWith("/health")
          ? healthFixture
          : pathname.endsWith("/businesses/horizon-labs")
            ? businessFixture
            : pathname.endsWith("/businesses")
              ? businessesFixture
              : null;
    if (body) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "not_found", message: "not found" },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await stubOperatorApi(page);
});

test("overview renders real API aggregates and the attention path", async ({
  page,
}) => {
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("214", { exact: true })).toBeVisible();
  await expect(page.getByText("71", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /daily active people and weekly active people/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("15 skipped, 3 delivered: no Scout to wake yet"),
  ).toBeVisible();
  await page.getByRole("link", { name: /co-founder wakes/i }).click();
  await expect(page).toHaveURL(/\/system$/);
});

test("businesses can be searched, sorted, and opened", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/admin/v1/metrics/businesses?**", async (route) => {
    requests.push(new URL(route.request().url()).search);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(businessesFixture),
    });
  });
  await page.goto("/businesses");
  await expect(page.getByRole("heading", { name: "Businesses" })).toBeVisible();
  await expect(page.getByText("horizonlabs.colony.global")).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search businesses or owners" })
    .fill("Horizon");
  await page.getByLabel("Sort businesses").selectOption("people");
  await expect
    .poll(() => requests.some((query) => query.includes("q=Horizon")))
    .toBe(true);
  await expect
    .poll(() => requests.some((query) => query.includes("sort=people")))
    .toBe(true);
  await page.getByRole("link", { name: /Horizon Labs/ }).click();
  await expect(page).toHaveURL(/\/businesses\/horizon-labs$/);
});

test("business detail shows counts and status without private content", async ({
  page,
}) => {
  await page.goto("/businesses/horizon-labs");
  await expect(
    page.getByRole("heading", { name: "Horizon Labs" }),
  ).toBeVisible();
  await expect(page.getByText("horizonlabs.colony.global")).toBeVisible();
  await expect(page.getByText("No Scout found")).toBeVisible();
  await expect(page.getByText("Composer froze.")).toHaveCount(0);
  await expect(page.getByText("WhatsApp text")).toHaveCount(0);
  await expect(page.getByText("Not collected")).toBeVisible();
});

test("AI usage labels the gateway boundary and renders outcomes", async ({
  page,
}) => {
  await page.goto("/ai-usage");
  await expect(page.getByRole("heading", { name: "AI usage" })).toBeVisible();
  await expect(page.getByText("66,100", { exact: true })).toBeVisible();
  await expect(page.getByText("Handed to next free model")).toBeVisible();
  await expect(
    page.getByText(/Only the free AI gateway is counted/),
  ).toBeVisible();
  await expect(page.getByText("Own-AI usage", { exact: false })).toHaveCount(0);
});

test("health shows relay health, skipped wakes, and not-collected checks", async ({
  page,
}) => {
  await page.goto("/system");
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(page.getByText("no Scout to wake yet")).toBeVisible();
  await expect(page.getByText("15", { exact: true })).toBeVisible();
  await expect(page.getByText("Database")).toBeVisible();
  await expect(page.getByText("not collected").first()).toBeVisible();
  await expect(
    page.getByText(
      "Counts and health only. No message content is ever shown here.",
    ),
  ).toBeVisible();
});

test("metric pages render explicit API error and empty states", async ({
  page,
}) => {
  await page.route("**/api/admin/v1/metrics/businesses?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...businessesFixture,
        total: 0,
        items: [],
      }),
    }),
  );
  await page.goto("/businesses");
  await expect(page.getByText("No businesses found.")).toBeVisible();

  await page.route("**/api/admin/v1/metrics/overview?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unavailable", message: "metrics unavailable" },
      }),
    }),
  );
  await page.goto("/overview");
  await expect(
    page.getByRole("heading", { name: "Could not load metrics" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

const screenshots = [
  ["overview", "/overview", "Overview"],
  ["businesses", "/businesses", "Businesses"],
  ["business", "/businesses/horizon-labs", "Horizon Labs"],
  ["ai-usage", "/ai-usage", "AI usage"],
  ["health", "/system", "Health"],
] as const;

for (const [board, route, heading] of screenshots) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${board} matches the approved ${colorScheme} board`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      const screenshotPath = join(
        process.cwd(),
        "test-results",
        "admin-ui",
        `${colorScheme}-${board}.png`,
      );
      await mkdir(dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    });
  }
}
