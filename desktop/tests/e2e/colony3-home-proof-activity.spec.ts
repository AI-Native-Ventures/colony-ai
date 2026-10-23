import { expect, test } from "@playwright/test";

import {
  COLONY3_ACTIVITY_ITEMS,
  colony3ActivityMockOptions,
} from "../helpers/colony3ActivityFixture";
import {
  dumpTexts,
  openLerato,
  shot,
  waitForShell,
  writeCaptures,
} from "../helpers/colony3Proof";

/**
 * Colony 3.0 Activity proof: the inbox at the board's size with Mina's
 * approval thread open. Captures the app next to `Activity.dc.html` for
 * `scripts/colony3-proof-report.mjs`. Not a regression gate: it writes a PNG
 * and checks that the board's parts can be reached.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.afterAll(() => {
  writeCaptures();
});

test("Activity board", async ({ page }) => {
  await openLerato(page, { route: "/#/", mock: colony3ActivityMockOptions() });
  await waitForShell(page);
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  // The design shows Scout, Zinhle and Noor as read: open them first, so
  // Mina's thread is the one left open.
  for (const id of [
    COLONY3_ACTIVITY_ITEMS.noor,
    COLONY3_ACTIVITY_ITEMS.zinhle,
    COLONY3_ACTIVITY_ITEMS.scout,
    COLONY3_ACTIVITY_ITEMS.mina,
  ]) {
    await page.getByTestId(`home-inbox-item-${id}`).click();
    await expect(page.getByTestId("home-inbox-detail")).toBeVisible();
  }
  await expect(page.getByTestId("home-inbox-context-title")).toHaveText(
    "Thread in #The Olive House",
  );
  await expect(page.getByTestId("home-inbox-decision-open")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("work-area-file-card")).toBeVisible();
  await page.waitForTimeout(500);
  await dumpTexts(page, "Activity", '[data-testid="home-inbox"]');
  await shot(page, {
    name: "Activity",
    board: "Activity",
    title: "Activity inbox with a thread open",
  });
});
