import { expect, test } from "@playwright/test";

import { colony3PowerMockOptions } from "../helpers/colony3Power";
import {
  dumpTexts,
  openLerato,
  shot,
  waitForShell,
  writeCaptures,
} from "../helpers/colony3Proof";

/**
 * Colony 3.0 AI spend proof: Power (Overview) and PowerUsage, captured at the
 * boards' size with the Lerato Social spend fixture. Not a regression gate.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.afterAll(() => {
  writeCaptures();
});

test("Power board", async ({ page }) => {
  await openLerato(page, {
    route: "/#/power",
    mock: colony3PowerMockOptions(),
  });
  await waitForShell(page);
  await expect(page.getByTestId("ai-spend-overview")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: /^Noor, Bookkeeper/ }),
  ).toBeVisible({ timeout: 20_000 });
  await dumpTexts(page, "Power", '[data-testid="power-screen"]');
  await shot(page, {
    name: "Power",
    board: "Power",
    title: "AI spend & power: Overview",
  });
});

test("PowerUsage board", async ({ page }) => {
  await openLerato(page, {
    route: "/#/power?section=usage",
    mock: colony3PowerMockOptions(),
  });
  await waitForShell(page);
  await expect(page.getByTestId("power-usage")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Revise Cedar captions")).toBeVisible({
    timeout: 20_000,
  });
  await dumpTexts(page, "PowerUsage", '[data-testid="power-screen"]');
  await shot(page, {
    name: "PowerUsage",
    board: "PowerUsage",
    title: "AI spend & power: Usage",
  });
});

test("Connections tab and the employee panel can be reached", async ({
  page,
}) => {
  await openLerato(page, {
    route: "/#/power?section=connections",
    mock: colony3PowerMockOptions(),
  });
  await waitForShell(page);
  await expect(page.getByTestId("power-connections")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("power-connections")).toContainText(
    "Colony credits",
  );
});
