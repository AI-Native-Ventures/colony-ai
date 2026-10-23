import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { ASK_PEOPLE, openAsksBoard } from "../helpers/colony3-asks-fixture";
import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";

/**
 * Colony 3.0 Raise-an-ask proof: AskNew, AskCompose, AskEmpty, AskHire and
 * AskMoney captured at the board size (1440x960) with the Lerato Social
 * fixture, so `scripts/colony3-compare.mjs` can lay each one next to its
 * design reference. Not a regression gate; it writes PNGs and checks that each
 * state can be reached. COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-asks-compose-proof";

test.use({ timezoneId: "Africa/Johannesburg", locale: "en-ZA" });
test.describe.configure({ mode: "serial", timeout: 120_000 });

type Rect = [x: number, y: number, width: number, height: number];
const captures: Array<{
  name: string;
  board: string;
  refRect?: Rect;
  title: string;
}> = [];

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

async function shot(
  page: Page,
  capture: { name: string; board: string; refRect?: Rect; title: string },
  target?: Locator | { x: number; y: number; width: number; height: number },
) {
  mkdirSync(OUT, { recursive: true });
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
    await page.screenshot({
      animations: "disabled",
      clip: target ?? { x: 0, y: 0, width: 1440, height: 960 },
      path,
    });
  }
  captures.push(capture);
}

async function settle(page: Page) {
  await page.waitForTimeout(900);
  await waitForAnimations(page);
}

test("AskNew: where should the conversation happen", async ({ page }) => {
  await openAsksBoard(page, {
    route: `/#/asks/new?channelId=${REFERENCE_CHANNEL_IDS.oliveHouse}`,
  });
  await expect(
    page.getByRole("heading", { name: "Where should the conversation happen?" }),
  ).toBeVisible();
  await expect(page.getByTestId(/ask-thread-option-/)).toHaveCount(3, {
    timeout: 15_000,
  });
  await settle(page);
  await shot(page, {
    name: "AskNew",
    board: "AskNew",
    title: "Raise an ask: destination",
  });
});

test("AskCompose: checklist ask", async ({ page }) => {
  const ids = await openAsksBoard(page, {
    route: "/#/asks/new",
  });
  await page.goto(
    `/#/asks/new?channelId=${REFERENCE_CHANNEL_IDS.oliveHouse}&threadRootEventId=${ids.october}`,
  );
  await expect(
    page.getByRole("heading", { name: "Raise an ask" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Checklist/ }).click();
  await page
    .getByLabel("What needs a response?")
    .fill("Confirm the client brief is ready");
  await page
    .getByLabel("Context")
    .fill(
      "Mina starts on the October posts once the brief is confirmed. The draft brief is pinned in this thread.",
    );
  await page
    .getByLabel("Items to confirm, one per line")
    .fill("Tone matches the client brief\nDates are confirmed\nOwner is assigned");
  await page
    .getByLabel("Response from")
    .selectOption(ASK_PEOPLE.noluthando.pubkey);
  await page.getByLabel("Decide by").fill("2026-10-26T12:00");
  await settle(page);
  await shot(page, {
    name: "AskCompose",
    board: "AskCompose",
    title: "Raise an ask: compose (checklist)",
  });
});
