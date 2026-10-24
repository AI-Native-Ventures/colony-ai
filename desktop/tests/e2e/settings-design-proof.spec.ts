import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import fixture from "../visual/fixtures/g1-r17.json" with { type: "json" };
import type { VisualFixtureSeed } from "../../src/testing/e2eBridge";

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`approved Settings screen evidence ${viewport.width}x${viewport.height}`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    test.skip(
      !process.env.COLONY_SETTINGS_REFERENCE_URL,
      "Frozen reference server is required for comparison evidence.",
    );
    const output =
      process.env.COLONY_SETTINGS_PROOF_DIR ??
      "test-results/settings-design-proof";
    await mkdir(output, { recursive: true });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("buzz-theme", "buzz");
      localStorage.setItem("buzz-follow-system", "true");
      localStorage.setItem("buzz-accent-color", "#895AF6");
    });
    await installMockBridge(page, {
      visualFixture: fixture as VisualFixtureSeed,
    });
    await page.goto("/#/settings?section=appearance");
    await expect(page.getByTestId("settings-appearance")).toBeVisible();
    const reference = await context.newPage();
    await reference.setViewportSize(viewport);
    const capture = async (name: string, revision: string, route: string) => {
      await reference.goto(
        `${process.env.COLONY_SETTINGS_REFERENCE_URL}/${revision}/app/workspace/?embedded=1#${route}`,
      );
      await reference.evaluate(() => document.fonts.ready);
      await reference.mouse.move(0, 0);
      await waitForAnimations(reference);
      await reference.screenshot({
        path: `${output}/${name}-${viewport.width}-reference.png`,
      });
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await waitForAnimations(page);
      await page.screenshot({
        path: `${output}/${name}-${viewport.width}-app.png`,
      });
    };
    await capture("appearance", "20260925-r17", "settings/appearance");
    await page.goto("/#/settings?section=accessibility");
    await expect(page.getByTestId("settings-accessibility")).toBeVisible();
    await capture("accessibility", "20260925-r17", "account/accessibility");
    for (const [section, route] of [
      ["profile", "account"],
      ["updates", "settings/updates"],
      ["archived-records", "account/archive"],
      ["people", "settings/people"],
    ]) {
      await page.goto(`/#/settings?section=${section}`);
      await expect(page.getByTestId(`settings-panel-${section}`)).toBeVisible();
      await page.waitForLoadState("networkidle");
      if (section === "updates")
        await expect(
          page.getByTestId(`settings-panel-${section}`),
        ).not.toContainText(/\bBuzz\b/);
      await capture(`review-${section}`, "20260925-r17", route);
    }
    await reference.close();
  });
}

test("audit the remaining Settings groups against frozen routes", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.COLONY_SETTINGS_REFERENCE_URL,
    "Frozen reference server is required for comparison evidence.",
  );
  test.setTimeout(120_000);
  const output =
    process.env.COLONY_SETTINGS_PROOF_DIR ??
    "test-results/settings-design-proof";
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await installMockBridge(page, {
    visualFixture: fixture as VisualFixtureSeed,
  });
  const reference = await context.newPage();
  await reference.setViewportSize({ width: 1440, height: 900 });
  const routes = [
    ["profile", "account"],
    ["security", "account/security"],
    ["accessibility", "account/accessibility"],
    ["notifications", "account/notifications"],
    ["shortcuts", "settings/shortcuts"],
    ["business-profile", "settings"],
    ["people", "settings/people"],
    ["agent-defaults", "agent-settings/defaults"],
    ["harnesses", "agent-settings/harnesses"],
    ["custom-emoji", "settings/emoji"],
    ["app", "settings/device"],
    ["mobile", "settings/mobile"],
    ["updates", "settings/updates"],
    ["experimental", "settings/experiments"],
    ["archived-records", "account/archive"],
    ["recovery", "account/recovery"],
  ];
  for (const [section, route] of routes) {
    await page.goto(`/#/settings?section=${section}`);
    await expect(page.getByTestId(`settings-panel-${section}`)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await reference.goto(
      `${process.env.COLONY_SETTINGS_REFERENCE_URL}/20260925-r17/app/workspace/?embedded=1#${route}`,
    );
    await reference.evaluate(() => document.fonts.ready);
    await waitForAnimations(reference);
    await waitForAnimations(page);
    await reference.screenshot({
      path: `${output}/audit-${section}-1440-reference.png`,
    });
    await page.screenshot({ path: `${output}/audit-${section}-1440-app.png` });
  }
  for (const [section, route] of [
    ["privacy", "b2/settings/privacy/controls"],
  ]) {
    await page.goto(`/#/settings?section=${section}`);
    await expect(page.getByTestId(`settings-panel-${section}`)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await reference.goto(
      `${process.env.COLONY_SETTINGS_REFERENCE_URL}/20260930-company-v9/company-feature-review/screen.html#${route}`,
    );
    await reference.evaluate(() => document.fonts.ready);
    await waitForAnimations(reference);
    await waitForAnimations(page);
    await reference.screenshot({
      path: `${output}/audit-${section}-1440-reference.png`,
    });
    await page.screenshot({ path: `${output}/audit-${section}-1440-app.png` });
  }
  await reference.close();
});
