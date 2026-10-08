import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import {
  channelWorkHeadEvent,
  MOCK_CHANNEL_IDS,
  type SeedChannelWork,
} from "../helpers/companyWork";

// The channel's Work tab in the work area dock, bound through the real App:
// the header Work control, the dock tab, this channel's real Company Work
// heads (signature and scope checked by the production reader), and the four
// states with no list: loading, empty, denied and failed with Retry.

const OUT = process.env.COLONY_WORK_TAB_SHOTS ?? "test-results/work-area-work";
const RAW_RELAY_TEXT = /relay returned|upstream exploded|\b500\b|query failed/i;
const PLAIN_FAILURE = "Colony could not reach this community. Try again.";
const SERVER_ERROR =
  "relay returned 500 Internal Server Error: upstream exploded";

const dock = (page: Page) => page.getByTestId("work-area-panel");
const workState = (page: Page) => page.getByTestId("work-area-work-state");
const headerWork = (page: Page) => page.getByTestId("channel-view-tab-work");

const ALICE = TEST_IDENTITIES.alice.pubkey;
const BOB = TEST_IDENTITIES.bob.pubkey;

function item(
  workItemId: string,
  title: string,
  overrides: Partial<SeedChannelWork> = {},
): SeedChannelWork {
  return {
    channelId: MOCK_CHANNEL_IDS.general,
    workItemId,
    title,
    ownerPubkey: ALICE,
    ...overrides,
  };
}

const ITEM_ACTIVE = "11111111-1111-4111-8111-111111111111";
const ITEM_BLOCKED = "22222222-2222-4222-8222-222222222222";
const ITEM_DONE = "33333333-3333-4333-8333-333333333333";
const ITEM_ELSEWHERE = "44444444-4444-4444-8444-444444444444";
const ITEM_OVERDUE = "55555555-5555-4555-8555-555555555555";

const GENERAL_WORK: SeedChannelWork[] = [
  item(ITEM_DONE, "Send the spring invoices", {
    ownerPubkey: BOB,
    status: "done_verified",
  }),
  item(ITEM_BLOCKED, "Confirm the venue", { status: "blocked" }),
  item(ITEM_ACTIVE, "Draft the launch brief"),
  item(ITEM_OVERDUE, "Reply to the press list", {
    dueAt: "2026-01-01T09:00:00.000Z",
  }),
  item(ITEM_ELSEWHERE, "Belongs to random", {
    channelId: MOCK_CHANNEL_IDS.random,
  }),
];

async function boot(
  page: Page,
  options: {
    work?: SeedChannelWork[];
    readErrors?: string[];
    readDelaysMs?: number[];
    viewport?: { width: number; height: number };
  } = {},
) {
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 900 });
  const relaySecret = generateSecretKey();
  await installMockBridge(page, {
    companyWorkEvents: (options.work ?? GENERAL_WORK).map((work) =>
      channelWorkHeadEvent(relaySecret, work),
    ),
    companyWorkReadErrors: options.readErrors,
    companyWorkReadDelaysMs: options.readDelaysMs,
    companyWorkRelayPrivateKey: bytesToHex(relaySecret),
    relaySelf: getPublicKey(relaySecret),
    searchProfiles: [
      { pubkey: ALICE, displayName: "Alice", isAgent: false },
      { pubkey: BOB, displayName: "Bob", isAgent: false },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
}

async function openChannel(page: Page, name: string) {
  await page.getByTestId(`channel-${name}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(name);
  await expect(headerWork(page)).toBeVisible();
}

/** Opens "design" from the channel browser: an open channel this person has not joined. */
async function openUnjoinedChannel(page: Page) {
  await page.getByTestId("section-actions-channels").click();
  await page.getByRole("menuitem", { name: /^Browse channels/ }).click();
  await expect(page.getByTestId("channel-browser-dialog")).toBeVisible();
  await page.getByTestId("browse-channel-design").click();
  await expect(page.getByTestId("chat-title")).toHaveText("design");
  await expect(headerWork(page)).toBeVisible();
}

async function openWorkTab(page: Page) {
  await headerWork(page).click();
  await expect(dock(page)).toBeVisible();
  await expect(
    dock(page).getByRole("tab", { name: "Work", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

test.describe("work area Work tab", () => {
  test("the channel's Work control opens a tab listing only this channel's real work", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");
    // The header label is a real control, not a label.
    await expect(headerWork(page)).toHaveRole("button");
    await openWorkTab(page);

    const rows = dock(page).getByRole("list", { name: "Work in this channel" });
    await expect(rows.getByRole("listitem")).toHaveCount(4);
    // Open work first, finished work last; another channel's work never leaks in.
    await expect(rows.getByRole("button")).toHaveText([
      /Draft the launch brief/,
      /Reply to the press list/,
      /Confirm the venue/,
      /Send the spring invoices/,
    ]);
    await expect(dock(page).getByText("Belongs to random")).toHaveCount(0);
    await expect(dock(page).getByTestId("work-area-work-count")).toHaveText(
      "4 commitments",
    );
    // Owner and status come from the signed record and the profile lookup.
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_BLOCKED}`),
    ).toContainText("Alice");
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_BLOCKED}`),
    ).toContainText("blocked");
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_DONE}`),
    ).toContainText("Bob");
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_DONE}`),
    ).toContainText("done verified");
    // A past due date on unfinished work is flagged; finished work never is.
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_OVERDUE}`),
    ).toContainText("Overdue");
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_DONE}`),
    ).not.toContainText("Overdue");
    await expect(workState(page)).toHaveCount(0);
  });

  test("keyboard and pointer reach the same places: open the tab, open a work item, come back", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");

    // Keyboard: Enter on the header control opens the tab; focus moves into it.
    await headerWork(page).focus();
    await page.keyboard.press("Enter");
    await expect(
      dock(page).getByRole("tab", { name: "Work", exact: true }),
    ).toBeFocused();
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_ACTIVE}`),
    ).toBeVisible();

    // Keyboard: Space on a row opens the work item.
    const row = dock(page).getByTestId(`work-area-work-row-${ITEM_ACTIVE}`);
    await row.focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("company-work-detail")).toBeVisible();
    await expect(page.getByTestId("company-work-detail")).toContainText(
      "Draft the launch brief",
    );

    // Back to the channel: the dock still holds the Work tab for it.
    await page.goBack();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(
      dock(page).getByRole("tab", { name: "Work", exact: true }),
    ).toHaveAttribute("aria-selected", "true");

    // Pointer: the same row opens the same work item.
    await dock(page).getByTestId(`work-area-work-row-${ITEM_BLOCKED}`).click();
    await expect(page.getByTestId("company-work-detail")).toContainText(
      "Confirm the venue",
    );

    // Pointer and keyboard both reach the full Work screen.
    await page.goBack();
    await dock(page).getByTestId("work-area-work-open-all").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("company-work-list")).toBeVisible();
  });

  test("a channel with no work shows an honest empty state and no invented rows", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "engineering");
    await openWorkTab(page);

    await expect(workState(page)).toHaveAttribute("data-state", "empty");
    await expect(workState(page)).toContainText("No work in this channel yet");
    await expect(
      dock(page).getByRole("list", { name: "Work in this channel" }),
    ).toHaveCount(0);
    await expect(dock(page).getByTestId("work-area-work-count")).toHaveCount(0);
    // Nothing to retry in an empty channel.
    await expect(page.getByTestId("work-area-work-state-retry")).toHaveCount(0);
  });

  test("a failed read says so in plain words, hides the relay text, and Retry recovers", async ({
    page,
  }) => {
    // One read plus the query's own single retry.
    await boot(page, { readErrors: [SERVER_ERROR, SERVER_ERROR] });
    await openChannel(page, "general");
    await openWorkTab(page);

    await expect(workState(page)).toHaveAttribute("data-state", "failed", {
      timeout: 15_000,
    });
    await expect(workState(page)).toHaveRole("alert");
    await expect(workState(page)).toContainText("Work could not be loaded");
    await expect(workState(page)).toContainText(PLAIN_FAILURE);
    await expect(dock(page)).not.toContainText(RAW_RELAY_TEXT);

    // Keyboard: Retry is reachable and activates with Enter.
    const retry = page.getByTestId("work-area-work-state-retry");
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_ACTIVE}`),
    ).toBeVisible();
    await expect(workState(page)).toHaveCount(0);
  });

  test("a channel you have not joined is denied with a way to retry, not an empty list", async ({
    page,
  }) => {
    await boot(page, {
      work: [
        item(ITEM_ACTIVE, "Not yours to see", {
          channelId: MOCK_CHANNEL_IDS.design,
        }),
      ],
    });
    await openUnjoinedChannel(page);
    await openWorkTab(page);

    await expect(workState(page)).toHaveAttribute("data-state", "denied");
    await expect(workState(page)).toContainText("You are not in this channel");
    await expect(dock(page).getByText("Not yours to see")).toHaveCount(0);
    await expect(page.getByTestId("work-area-work-state-retry")).toBeVisible();
  });

  test("the first read shows a loading state before any rows", async ({
    page,
  }) => {
    await boot(page, { readDelaysMs: [2_500] });
    await openChannel(page, "general");
    await openWorkTab(page);

    await expect(workState(page)).toHaveAttribute("data-state", "loading");
    await expect(workState(page)).toHaveRole("status");
    await expect(workState(page)).toContainText("Loading work");
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_ACTIVE}`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(workState(page)).toHaveCount(0);
  });

  test("the Work tab is part of the dock: addable from the menu, one at most, kept per channel", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");
    await page.getByTestId("channel-work-area-trigger").click();
    await page.getByTestId("work-area-open-work").click();
    await expect(
      dock(page).getByRole("tab", { name: "Work", exact: true }),
    ).toHaveCount(1);
    // A second Work tab is not offered: its id is its kind.
    await dock(page).getByRole("button", { name: "Add work area tab" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Work", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Another channel does not inherit it.
    await openChannel(page, "engineering");
    await expect(
      dock(page).getByRole("tab", { name: "Work", exact: true }),
    ).toHaveCount(0);
  });
});

// Review screenshots at the two reference viewports. They are PR artifacts
// (compared with the frozen r15 channel Work body) and also prove each state
// renders beside a real conversation.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
]) {
  test(`work tab screenshots at ${viewport.width}`, async ({ page }) => {
    await boot(page, {
      viewport,
      readDelaysMs: [3_000],
      readErrors: [SERVER_ERROR, SERVER_ERROR],
    });
    await openChannel(page, "general");
    await openWorkTab(page);

    const shot = async (name: string) => {
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/work-${name}-${viewport.width}.png`,
      });
    };

    await expect(workState(page)).toHaveAttribute("data-state", "loading");
    await shot("loading");

    await expect(workState(page)).toHaveAttribute("data-state", "failed", {
      timeout: 20_000,
    });
    await shot("failed");

    await page.getByTestId("work-area-work-state-retry").click();
    await expect(
      dock(page).getByTestId(`work-area-work-row-${ITEM_ACTIVE}`),
    ).toBeVisible();
    await shot("ready");

    await openChannel(page, "engineering");
    await openWorkTab(page);
    await expect(workState(page)).toHaveAttribute("data-state", "empty");
    await shot("empty");

    await openUnjoinedChannel(page);
    await openWorkTab(page);
    await expect(workState(page)).toHaveAttribute("data-state", "denied");
    await shot("denied");
  });
}
