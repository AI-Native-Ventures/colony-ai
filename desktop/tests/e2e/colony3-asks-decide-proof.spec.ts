import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  openDecisionWorkspace,
  seedDecisionAsks,
} from "../helpers/colony3-asks-decide-fixture";

/**
 * Colony 3.0 proof captures for the decision boards: Decision (AskDetail),
 * Funding decision (AskMoneyDetail) and Decision outcomes (AskOutcomes). Each
 * is captured at the board's size with the Lerato Social fixture so
 * `scripts/colony3-compare.mjs` can lay it next to the design reference.
 * Not a regression gate: it writes PNGs and checks each state can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-asks-decide-proof";

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ timezoneId: "Africa/Johannesburg" });

const captures: Array<{ name: string; board: string; title: string }> = [];

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

async function capture(
  page: import("@playwright/test").Page,
  name: string,
  board: string,
  title: string,
) {
  mkdirSync(OUT, { recursive: true });
  await page.mouse.move(1000, 10);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    clip: { x: 0, y: 0, width: 1440, height: 960 },
    path: `${OUT}/${name}.png`,
  });
  captures.push({ name, board, title });
}

test("Decision and Funding decision boards", async ({ page }) => {
  await openDecisionWorkspace(page);
  const { decision, funding } = await seedDecisionAsks(page);

  await page.goto(`/#/asks/${decision.channelId}/${decision.askId}`);
  await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
  await expect(page.getByTestId("ask-thread-root")).toBeVisible();
  await expect(page.getByTestId("ask-card")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open work" })).toBeVisible();
  await page.waitForTimeout(1200);
  await capture(page, "AskDetail", "AskDetail", "Decision (general approval)");

  await page.goto(`/#/asks/${funding.channelId}/${funding.askId}`);
  await expect(page.getByTestId("ask-thread-title")).toHaveText(
    "Increase Olive Studio’s October allowance by USD 120",
  );
  await expect(page.getByTestId("ask-card")).toBeVisible();
  await expect(page.getByTestId("ask-money-allowance-proposal")).toBeVisible();
  await page.waitForTimeout(1200);
  await capture(
    page,
    "AskMoneyDetail",
    "AskMoneyDetail",
    "Funding decision (allowance ask)",
  );
});

test("Decision outcomes board", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date("2026-10-23T09:55:00+02:00"));
  await installMockBridge(page, {});
  await page.addInitScript(() => {
    const config = (window as unknown as { __BUZZ_E2E__?: object })
      .__BUZZ_E2E__;
    (window as unknown as { __BUZZ_E2E__: object }).__BUZZ_E2E__ = {
      ...config,
      showcase: "colony3-ask-outcomes",
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("colony3-ask-outcomes")).toBeVisible();
  await expect(page.getByTestId("ask-card")).toHaveCount(11);
  await page.waitForTimeout(800);
  await capture(page, "AskOutcomes", "AskOutcomes", "Decision outcomes sheet");
});
