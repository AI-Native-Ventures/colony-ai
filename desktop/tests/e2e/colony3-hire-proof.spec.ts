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

test("HireRoles board: the built-in roles with the no-harness notice", async ({
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
    title: "Hire: role catalog (built-in roles), with the no-harness notice",
  });
});

test("HireRoles: a role opens the simple Configure screen", async ({
  page,
}) => {
  await openBoard(page, "roles", HIRE_ROUTES.roles, "hire-roles");
  await expect(page.getByTestId("hire-custom-role")).toBeVisible();
  const catalog = page.locator('[aria-label="Role catalog"]');
  await expect(
    catalog.getByRole("heading", { name: "Chief of Staff" }),
  ).toHaveCount(0);
  await page.getByTestId(`hire-configure-${HIRE_IDS.bookkeeper}`).click();
  await expect(page.getByTestId("hire-configure")).toBeVisible();
  await expect(page.getByTestId("hire-employee-name")).toBeVisible();
  await expect(page.getByTestId("hire-title")).toHaveValue("Bookkeeper");
  await shot(page, {
    name: "HireConfigure-from-role",
    board: "HireConfigureSimple",
    title: "Hire: configure a selected role",
  });
});

test("HireRoles: a business with no role personas is offered the built-ins", async ({
  page,
}) => {
  await openBoard(page, "roles-empty", HIRE_ROUTES.roles, "hire-roles");
  const catalog = page.locator('[aria-label="Role catalog"]');
  for (const id of [
    HIRE_IDS.builtInHospitality,
    HIRE_IDS.builtInSocial,
    HIRE_IDS.builtInBookkeeper,
  ]) {
    await expect(catalog.getByTestId(`hire-role-${id}`)).toBeVisible();
  }
  await expect(
    catalog.getByRole("heading", {
      name: "Chief of Staff",
    }),
  ).toHaveCount(0);
  await expect(page.getByTestId("hire-custom-role")).toHaveAttribute(
    "aria-label",
    "Ask Scout to draft",
  );
  await expect(page.getByTestId("hire-create-role")).toBeVisible();
  await expect(page.getByTestId("hire-create-role-entry")).toBeVisible();
  await shot(page, {
    name: "HireRoles-built-in",
    board: "HireRoles",
    title: "Hire: role catalog for a business with no role personas",
  });
});

test("HireConfigure board", async ({ page }) => {
  await openBoard(page, "configure", HIRE_ROUTES.configure, "hire-configure");
  await expect(page.getByTestId("hire-employee-name")).toHaveValue("Birch");
  await expect(page.getByTestId("hire-title")).toHaveValue(
    "Hospitality Researcher",
  );
  await expect(page.getByTestId("hire-configure-form")).toBeVisible();
  await shot(page, {
    name: "HireConfigure",
    board: "HireConfigureSimple",
    title: "Hire: configure employee",
  });
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

test("C3-HIRE-FIX captures the direct role path at desktop and phone widths", async ({
  browser,
}) => {
  const theme = process.env.COLONY3_PROOF_THEME;
  test.skip(
    theme !== "light" && theme !== "dark",
    "run with COLONY3_PROOF_THEME=light or dark for proof delivery",
  );
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });

  for (const viewport of [
    { name: "1440", width: 1440, height: 960 },
    { name: "390", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      colorScheme: theme === "dark" ? "dark" : "light",
      viewport: { width: viewport.width, height: viewport.height },
    });
    try {
      const page = await context.newPage();
      await installHireFixture(page, "roles-empty");
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto(HIRE_ROUTES.roles);
      await expect(page.getByTestId("hire-create-role-entry")).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: `${OUT}/C3-HIRE-FIX-HireRoles-${viewport.name}-${theme}.png`,
      });
      captures.push({
        name: `C3-HIRE-FIX-HireRoles-${viewport.name}-${theme}`,
        board: "HireRoles",
        title: `Hire: role catalog with direct role creation (${viewport.name}px, ${theme})`,
      });

      await page.getByTestId("hire-create-role").click();
      await expect(page.getByTestId("hire-role-pack-editor")).toBeVisible();
      await page.getByTestId("role-pack-title").fill("Revenue analyst");
      await page
        .getByTestId("role-pack-job")
        .fill("Turns approved sales data into a clear weekly revenue view.");
      await page
        .getByTestId("role-pack-skills")
        .fill("Analysis\nReconciliation");
      await page
        .getByTestId("role-pack-tools")
        .fill("Sales records | medium\nWeb search | low");
      const worker = page.getByTestId("role-pack-worker-buzz-agent");
      if (!(await worker.isChecked())) await worker.check();
      await page.getByTestId("role-pack-allowance").fill("35");
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForAnimations(page);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: `${OUT}/C3-HIRE-FIX-RolePackEditor-${viewport.name}-${theme}.png`,
      });
      captures.push({
        name: `C3-HIRE-FIX-RolePackEditor-${viewport.name}-${theme}`,
        board: "RolePackEditor",
        title: `Hire: direct role pack editor (${viewport.name}px, ${theme})`,
      });

      await page.getByTestId("save-role-pack").click();
      await expect(page.getByTestId("hire-roles")).toBeVisible();
      const role = page
        .getByRole("region", { name: "Role packs" })
        .locator('[data-testid^="hire-role-"]', {
          hasText: "Revenue analyst",
        });
      await expect(role).toBeVisible();
      await role.getByRole("button", { name: "Configure this role" }).click();
      await expect(page.getByTestId("hire-configure-form")).toBeVisible();
      await expect(page.getByTestId("hire-weekly-allowance")).toHaveValue("35");
      await page.getByTestId("hire-employee-name").fill("Riven");
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForAnimations(page);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: `${OUT}/C3-HIRE-FIX-HireConfigure-${viewport.name}-${theme}.png`,
      });
      captures.push({
        name: `C3-HIRE-FIX-HireConfigure-${viewport.name}-${theme}`,
        board: "HireConfigure",
        title: `Hire: Configure opens after direct role creation (${viewport.name}px, ${theme})`,
      });
    } finally {
      await context.close();
    }
  }
});
