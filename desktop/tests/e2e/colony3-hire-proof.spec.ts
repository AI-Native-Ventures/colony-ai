import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  HIRE_IDS,
  HIRE_ROUTES,
  type HireFixtureState,
  installHireFixture,
} from "../helpers/colony3-hire-fixture";

/**
 * Colony 3.0 Hire boards proof (HireRoles, HireConfigure, HireReview,
 * HireSuccess). Captures the app at each board's size (1440x960) with the
 * Lerato Social hiring fixture, and checks the live parts of the flow: the
 * header preview follows the typed name, a role card selects, Review gates on
 * the founder checkbox. `scripts/colony3-compare.mjs` lays each capture next to
 * the reference PNG.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT = process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-hire-proof";

type Capture = { name: string; board: string; title: string };
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

async function openBoard(
  page: Page,
  state: HireFixtureState,
  route: string,
  ready: string,
) {
  mkdirSync(OUT, { recursive: true });
  await installHireFixture(page, state);
  await page.goto(route);
  await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await waitForAnimations(page);
}

async function shot(page: Page, capture: Capture) {
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    clip: { x: 0, y: 0, width: 1440, height: 960 },
    path: `${OUT}/${capture.name}.png`,
  });
  captures.push(capture);
}

test("HireRoles board: the built-in roles with the no-runtime notice", async ({
  page,
}) => {
  await openBoard(page, "roles-no-runtime", HIRE_ROUTES.roles, "hire-roles");
  await expect(
    page.getByTestId(`hire-role-${HIRE_IDS.builtInHospitality}`),
  ).toBeVisible();
  await expect(page.getByText("No runtime is available")).toBeVisible();
  await shot(page, {
    name: "HireRoles",
    board: "HireRoles",
    title: "Hire: role catalog (built-in roles), with the no-runtime notice",
  });
});

test("HireRoles: a role card selects and the preview follows", async ({
  page,
}) => {
  await openBoard(page, "roles", HIRE_ROUTES.roles, "hire-roles");
  const preview = page.getByRole("complementary", {
    name: "Role pack preview",
  });
  await expect(
    preview.getByRole("heading", { name: "Hospitality researcher" }),
  ).toBeVisible();
  await page
    .getByTestId(`hire-role-${HIRE_IDS.bookkeeper}`)
    .getByRole("button", { name: "Bookkeeper" })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Bookkeeper" }),
  ).toBeVisible();
  await expect(preview.getByText("Invoices and reconciliation")).toBeVisible();
  await expect(page.getByText("No runtime is available")).toHaveCount(0);
  await page
    .getByTestId(`hire-role-${HIRE_IDS.hospitality}`)
    .getByRole("button", { name: "Hospitality researcher" })
    .click();
  await shot(page, {
    name: "HireRoles-runtime",
    board: "HireRoles",
    title: "Hire: role catalog with a runtime on this Mac",
  });
  // "Propose a hire" starts a hire proposal ask instead of configuring.
  await page.getByTestId("hire-propose").click();
  await expect(page).toHaveURL(/#\/asks\/new\?.*type=hire/);
});

test("HireRoles: a business with no role personas is offered the built-ins", async ({
  page,
}) => {
  await openBoard(page, "roles-empty", HIRE_ROUTES.roles, "hire-roles");
  for (const name of [
    "Hospitality researcher",
    "Social media manager",
    "Bookkeeper",
    "Chief of Staff",
    "Business development",
    "Writer",
  ]) {
    await expect(
      page
        .getByRole("region", { name: "Role packs" })
        .getByRole("heading", { name }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "Your role catalog starts here" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create role pack" }),
  ).toHaveCount(0);
  await shot(page, {
    name: "HireRoles-built-in",
    board: "HireRoles",
    title: "Hire: role catalog for a business with no role personas",
  });
});

test("HireConfigure board", async ({ page }) => {
  await openBoard(page, "configure", HIRE_ROUTES.configure, "hire-configure");
  await expect(page.getByTestId("hire-employee-name")).toHaveValue("Birch");
  await expect(page.getByTestId("hire-preview-name")).toHaveText("Birch");
  await shot(page, {
    name: "HireConfigure",
    board: "HireConfigure",
    title: "Hire: configure employee",
  });
  // The header preview follows the typed name.
  await page.getByTestId("hire-employee-name").fill("Birchwood");
  await expect(page.getByTestId("hire-preview-name")).toHaveText("Birchwood");
});

test("HireReview board", async ({ page }) => {
  await openBoard(page, "review", HIRE_ROUTES.review, "hire-review");
  await expect(page.getByText("Birch · Hospitality Researcher")).toBeVisible();
  const approve = page.getByTestId("hire-approve");
  await expect(approve).toBeDisabled();
  await shot(page, {
    name: "HireReview",
    board: "HireReview",
    title: "Hire: review",
  });
  await page.getByTestId("hire-founder-confirm").check();
  await expect(approve).toBeEnabled();
});

test("HireSuccess board", async ({ page }) => {
  await openBoard(page, "success", HIRE_ROUTES.success, "hire-success");
  await expect(page.getByText("Birch joined the team.")).toBeVisible();
  await shot(page, {
    name: "HireSuccess",
    board: "HireSuccess",
    title: "Hire: joined the team",
  });
});
