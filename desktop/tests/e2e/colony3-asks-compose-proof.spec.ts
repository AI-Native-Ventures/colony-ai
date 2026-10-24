import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  ASK_PEOPLE,
  ASK_ROLE_PACKS,
  moneyBoardMock,
  openAsksBoard,
} from "../helpers/colony3-asks-fixture";
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

/** Back to the top of the screen with nothing focused, as the boards are drawn. */
async function settle(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const screen = document.querySelector('[data-testid="ask-create-screen"]');
    if (screen) screen.scrollTop = 0;
  });
  await page.waitForTimeout(900);
  await waitForAnimations(page);
}

test("AskNew: where should the conversation happen", async ({ page }) => {
  await openAsksBoard(page, {
    route: `/#/asks/new?channelId=${REFERENCE_CHANNEL_IDS.northline}`,
  });
  await expect(
    page.getByRole("heading", {
      name: "Where should the conversation happen?",
    }),
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
    `/#/asks/new?channelId=${REFERENCE_CHANNEL_IDS.northline}&threadRootEventId=${ids.october}`,
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
    .fill(
      "Tone matches the client brief\nDates are confirmed\nOwner is assigned",
    );
  const responseFrom = page.getByLabel("Response from");
  await expect(responseFrom.locator("option")).not.toHaveCount(1, {
    timeout: 10_000,
  });
  await responseFrom.selectOption(ASK_PEOPLE.noluthando.pubkey);
  await page.getByLabel("Decide by").fill("2026-10-26T12:00");
  await settle(page);
  await shot(page, {
    name: "AskCompose",
    board: "AskCompose",
    title: "Raise an ask: compose (checklist)",
  });
});

test("AskEmpty: no threads yet", async ({ page }) => {
  await openAsksBoard(page, {
    route: `/#/asks/new?channelId=${REFERENCE_CHANNEL_IDS.northline}`,
    threads: false,
  });
  const empty = page.getByRole("status").filter({
    hasText: "No threads in this channel yet",
  });
  await expect(empty).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, {
    name: "AskEmpty-no-threads",
    board: "AskEmpty",
    title: "No threads yet: the destination step with the empty state",
  });
  await shot(
    page,
    {
      name: "AskEmpty-no-threads-card",
      board: "AskEmpty",
      refRect: [334, 375, 274, 415],
      title: "No threads yet: the empty card",
    },
    empty,
  );
});

test("AskEmpty: only member and invite dialog", async ({ page }) => {
  const ids = await openAsksBoard(page, {
    route: "/#/asks/new",
    people: false,
    extraThreads: [
      {
        key: "kickoff",
        channelName: "Northline Interiors",
        title: "Kick-off call notes",
      },
    ],
    threads: false,
  });
  await page.goto(
    `/#/asks/new?channelId=${REFERENCE_CHANNEL_IDS.northline}&threadRootEventId=${ids.kickoff}`,
  );
  await page
    .getByLabel("What needs a response?")
    .fill("Approve the Northline onboarding checklist");
  const alone = page.getByRole("status").filter({
    hasText: "You’re the only member here",
  });
  await expect(alone).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, {
    name: "AskEmpty-only-member",
    board: "AskEmpty",
    title: "Only member: compose with no recipient",
  });
  await page.getByRole("button", { name: "Invite someone" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Search people").fill("Nolu");
  await dialog
    .getByTestId(`channel-user-search-result-${ASK_PEOPLE.noluthando.pubkey}`)
    .click();
  await dialog.getByLabel("Search people").fill("Sam");
  await expect(
    dialog.getByTestId(`channel-user-search-result-${ASK_PEOPLE.sam.pubkey}`),
  ).toBeVisible();
  await settle(page);
  await shot(
    page,
    {
      name: "AskEmpty-invite",
      board: "AskEmpty",
      refRect: [1006, 255, 384, 577],
      title: "Invite someone dialog",
    },
    dialog,
  );
});

test("AskHire: propose a hire", async ({ page }) => {
  const ids = await openAsksBoard(page, {
    route: "/#/asks/new",
    threads: false,
    extraThreads: [
      {
        key: "capacity",
        channelName: "Operations",
        title: "Team capacity",
      },
    ],
    mock: { personas: ASK_ROLE_PACKS },
  });
  await page.goto(
    `/#/asks/new?channelId=${REFERENCE_CHANNEL_IDS.operations}&threadRootEventId=${ids.capacity}`,
  );
  await page.getByRole("button", { name: /Hire proposal/ }).click();
  await expect(
    page.getByRole("heading", { name: "Propose a hire" }),
  ).toBeVisible();
  const recipient = page.getByLabel("Recipient");
  await expect(recipient.locator("option")).not.toHaveCount(1, {
    timeout: 10_000,
  });
  await recipient.selectOption(ASK_PEOPLE.noluthando.pubkey);
  await page.getByLabel("Role pack").selectOption(ASK_ROLE_PACKS[0].id);
  await page.getByLabel("Proposed name").fill("Compass");
  await page.getByLabel("Job title").fill("Hospitality Researcher");
  await page
    .getByLabel("Reason", { exact: true })
    .fill(
      "Aya’s outreach list keeps growing. A researcher would qualify hospitality leads before they reach Sales, so Aya can focus on conversations.",
    );
  await page.getByLabel("Allowance period").selectOption("week");
  await settle(page);
  await shot(page, {
    name: "AskHire",
    board: "AskHire",
    title: "Propose a hire",
  });
});

test("AskMoney: adjust an allowance", async ({ page }) => {
  const money = moneyBoardMock();
  await openAsksBoard(page, {
    route: "/#/asks/new?type=money",
    threads: false,
    extraThreads: [
      {
        key: "budgets",
        channelName: "Operations",
        title: "October budgets",
      },
    ],
    mock: money.mock,
  });
  await expect(
    page.getByRole("heading", {
      name: "Request an allowance or cost approval",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Adjust an allowance/ }).click();
  await page
    .getByLabel("Channel", { exact: true })
    .selectOption(REFERENCE_CHANNEL_IDS.operations);
  const thread = page.getByLabel("Thread", { exact: true });
  await expect(thread.locator("option")).toHaveCount(3, { timeout: 10_000 });
  await thread.selectOption({ label: "October budgets" });
  const recipient = page.getByLabel("Recipient", { exact: true });
  await expect(recipient.locator("option")).not.toHaveCount(1, {
    timeout: 10_000,
  });
  await recipient.selectOption(ASK_PEOPLE.noluthando.pubkey);
  await page
    .getByLabel("Employee or budget", { exact: true })
    .selectOption(money.employeePubkey);
  await page.getByLabel("Temporary, with an end date").check();
  await page.getByLabel("Temporary end date, if applicable").fill("2026-10-31");
  await page.getByLabel("Requested amount, USD").fill("120");
  await page
    .getByLabel("Reason", { exact: true })
    .fill(
      "Olive Studio has two extra campaigns in October. The current allowance runs out before the month ends, so drafts and revisions would stop.",
    );
  await settle(page);
  await shot(page, {
    name: "AskMoney-form",
    board: "AskMoney",
    title: "Adjust an allowance: form with the live summary",
  });
  await page.getByRole("button", { name: "Review request" }).click();
  await expect(
    page.getByRole("button", { name: "Submit request" }),
  ).toBeVisible();
  await settle(page);
  await shot(page, {
    name: "AskMoney",
    board: "AskMoney",
    title: "Adjust an allowance: review step",
  });
});
