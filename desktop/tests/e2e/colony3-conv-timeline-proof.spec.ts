import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";

/**
 * Colony 3.0 conversations proof. Captures the app at each conversation
 * board's size with the Lerato Social fixture so
 * `scripts/colony3-proof-report.mjs` can lay every capture next to the design
 * reference. Not a regression gate: it writes PNGs and checks that each state
 * can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-conversations-proof";

type Capture = {
  name: string;
  board: string;
  refRect?: [number, number, number, number];
  title: string;
};
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

async function openLerato(page: Page, route: string) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
  });
  await page.goto(route);
  await seedColony3Activity(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.waitForTimeout(1200);
  await waitForAnimations(page);
}

async function shot(
  page: Page,
  capture: Capture,
  target?: Locator | { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  const path = `${OUT}/${capture.name}.png`;
  if (target && "screenshot" in target) {
    const box = await target.boundingBox();
    if (!box) throw new Error(`No box to capture for ${capture.name}`);
    await page.screenshot({
      animations: "disabled",
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      path,
    });
  } else {
    await page.screenshot({ animations: "disabled", clip: target, path });
  }
  captures.push(capture);
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

test("Channel board", async ({ page }) => {
  await openLerato(page, "/#/today");
  await page.getByTestId("channel-The Olive House").click();
  await page.waitForTimeout(1500);
  await shot(
    page,
    { name: "Channel", board: "Channel", title: "Client channel" },
    { x: 0, y: 0, width: 1440, height: 960 },
  );
});
