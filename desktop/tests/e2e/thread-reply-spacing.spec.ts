import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import type { Colony3Extras } from "../../src/testing/e2eBridge";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  COLONY3_SELF,
  colony3At,
  colony3Extras,
  colony3PositionOptions,
} from "../helpers/colony3Conversations";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";
import { AYA_DM_CHANNEL, eid } from "../helpers/colony3TimelineFixture";

type MockMessage = NonNullable<Colony3Extras["messages"]>[number];
type PanelMode = "focus" | "split";
type Theme = "dark" | "light";

const MINA_PUBKEY = REFERENCE_AGENTS.mina.pubkey;
const OLIVE_CHANNEL_ID = REFERENCE_CHANNEL_IDS.oliveHouse;
const PROOF_DIR = process.env.THREAD_SPACING_PROOF_DIR;
const PROOF_PREFIX = process.env.THREAD_SPACING_PROOF_PREFIX ?? "proof";

test.use({
  launchOptions: {
    args: ["--use-mock-keychain", "--password-store=basic"],
  },
});
test.describe.configure({ timeout: 120_000 });

function createSpacingThread(channelId: string, label: string) {
  const rootId = eid(`${label}-root`);
  const replyIds = [1, 2, 3, 4, 5, 6, 7].map((number) =>
    eid(`${label}-reply-${number}`),
  );
  const tagsFor = (parentId = rootId) => [
    ["e", rootId, "", "root"],
    ["e", parentId, "", "reply"],
  ];
  const reply = (
    number: number,
    pubkey: string,
    parentId: string,
    content: string,
  ): MockMessage => ({
    channelId,
    id: replyIds[number - 1],
    pubkey,
    createdAt: colony3At(18, 28 + number),
    tags: tagsFor(parentId),
    content,
  });

  const messages: MockMessage[] = [
    {
      channelId,
      id: rootId,
      pubkey: COLONY3_SELF,
      createdAt: colony3At(18, 20),
      content: "A thread for planning the week with Mina.",
    },
    reply(
      1,
      MINA_PUBKEY,
      rootId,
      "Short version: I keep the work moving.\n\n1. Plan: turn goals into tasks and track who does what.\n2. Find customers: research and track leads from Discovery.\n3. Create content: draft posts for your approval.",
    ),
    reply(
      2,
      COLONY3_SELF,
      rootId,
      "Keep the plan and customer notes together.",
    ),
    reply(
      3,
      MINA_PUBKEY,
      replyIds[1],
      "1. Plan: put the owner and next step beside each goal.\n2. Find customers: keep the source with every lead.",
    ),
    reply(4, COLONY3_SELF, replyIds[2], "That makes the handoff clear."),
    reply(5, MINA_PUBKEY, replyIds[3], "I will update the shared plan now."),
    reply(6, COLONY3_SELF, rootId, "Please keep the review in this thread."),
    reply(7, MINA_PUBKEY, rootId, "Done. The plan is ready for review."),
  ];

  return { messages, replyIds, rootId };
}

async function openSpacingThread(
  page: Page,
  options: {
    channelId: string;
    channelName: string;
    isDm?: boolean;
    label: string;
    mode: PanelMode;
    theme: Theme;
  },
) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await page.emulateMedia({
    colorScheme: options.theme === "dark" ? "dark" : "light",
  });
  await page.addInitScript(
    ({ mode, theme, relayUrl }) => {
      const themeName = theme === "dark" ? "buzz-dark" : "buzz";
      localStorage.setItem("buzz.channels.threadViewMode", mode);
      localStorage.setItem("buzz-theme", themeName);
      localStorage.setItem("buzz-follow-system", "false");
      localStorage.setItem("buzz-accent-color", "#5B45BE");
      localStorage.setItem(
        `buzz-community-theme.v1:${"deadbeef".repeat(8)}:${encodeURIComponent(relayUrl)}`,
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    {
      mode: options.mode,
      theme: options.theme,
      relayUrl: "ws://localhost:3000",
    },
  );

  const fixture = createSpacingThread(options.channelId, options.label);
  const managedAgents = [
    {
      pubkey: MINA_PUBKEY,
      name: "Mina",
      channelNames: ["The Olive House", "Aya"],
      status: "running" as const,
    },
  ];
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    relayRole: "owner",
    managedAgents,
    ...colony3PositionOptions(),
    colony3Extras: colony3Extras({
      channels: options.isDm ? [AYA_DM_CHANNEL] : [],
      patchChannels: options.isDm
        ? []
        : [
            {
              id: OLIVE_CHANNEL_ID,
              description: "Client channel · spring content campaign",
            },
          ],
      clearMessagesIn: [options.channelId],
      readChannelIds: [options.channelId],
      messages: fixture.messages,
      profiles: [
        {
          pubkey: MINA_PUBKEY,
          displayName: "Mina",
          isAgent: true,
          ownerPubkey: COLONY3_SELF,
          presence: "online" as const,
        },
      ],
    }),
  });

  await page.goto("/#/today");
  await seedColony3Activity(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId(`channel-${options.channelName}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(options.channelName);

  const summary = page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${fixture.rootId}"]`,
  );
  await expect(summary).toBeVisible();
  await summary.click();

  const panel = page.getByTestId("message-thread-panel");
  await expect(panel).toBeVisible();
  const [secondReply, thirdReply, fourthReply] = fixture.replyIds.slice(1, 4);
  for (const [parentReply, childReply] of [
    [secondReply, thirdReply],
    [thirdReply, fourthReply],
    [fourthReply, fixture.replyIds[4]],
  ]) {
    const nestedSummary = panel.locator(
      `[data-testid="message-thread-summary"][data-thread-head-id="${parentReply}"]`,
    );
    await expect(nestedSummary).toBeVisible();
    await nestedSummary.click();
    await expect(
      panel.locator(`[data-thread-reply-id="${childReply}"]`),
    ).toBeVisible();
    if (childReply === thirdReply) {
      const [nestedSummaryGap] = await measureReplyGaps(panel, [
        parentReply,
        childReply,
      ]);
      expect(
        nestedSummaryGap.authorGap,
        "a collapsed depth-two branch keeps its design spacing",
      ).toBeGreaterThanOrEqual(15.5);
    }
  }

  for (const replyId of fixture.replyIds) {
    await expect(
      panel.locator(`[data-thread-reply-id="${replyId}"]`),
    ).toBeVisible();
  }
  await expect(
    panel
      .locator(`[data-thread-reply-id="${fixture.replyIds[0]}"]`)
      .locator("ol"),
  ).toBeVisible();

  const body = page.getByTestId("message-thread-body");
  await body.evaluate((element) => {
    element.scrollTop = 0;
  });
  await waitForAnimations(page);

  return { panel, replyIds: fixture.replyIds };
}

async function captureProof(page: Page, name: string) {
  if (!PROOF_DIR) return;
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.mouse.move(300, 700);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(PROOF_DIR, `${PROOF_PREFIX}-${name}.png`),
  });
}

async function measureReplyGaps(panel: Locator, replyIds: string[]) {
  return panel.evaluate((element, ids) => {
    return ids.slice(1).map((replyId, index) => {
      const previous = element.querySelector<HTMLElement>(
        `[data-thread-reply-id="${ids[index]}"]`,
      );
      const current = element.querySelector<HTMLElement>(
        `[data-thread-reply-id="${replyId}"]`,
      );
      const currentHeader = current?.querySelector<HTMLElement>(
        '[data-testid="message-header"]',
      );
      if (!previous || !current || !currentHeader) {
        throw new Error(`Thread reply row is missing for ${replyId}`);
      }
      return {
        messageId: replyId,
        rowGap:
          current.getBoundingClientRect().top -
          previous.getBoundingClientRect().bottom,
        authorGap:
          currentHeader.getBoundingClientRect().top -
          previous.getBoundingClientRect().bottom,
      };
    });
  }, replyIds);
}

async function expectThreadReplySpacing(panel: Locator, replyIds: string[]) {
  const gaps = await measureReplyGaps(panel, replyIds);
  // r2 follows a direct reply (6px), then r3/r4/r5 are depth 2/3/4
  // (16px/14px/24px), followed by two more direct replies (6px each).
  const expectedGaps = [6, 16, 14, 24, 6, 6];
  expect(gaps).toHaveLength(expectedGaps.length);
  for (const [index, expected] of expectedGaps.entries()) {
    const measured =
      expected === 6 ? gaps[index].rowGap : gaps[index].authorGap;
    expect(
      measured,
      `gap before ${gaps[index].messageId} should be at least ${expected}px; received ${measured.toFixed(1)}px`,
    ).toBeGreaterThanOrEqual(expected - 0.5);
  }
}

const captures: Array<{ mode: PanelMode; theme: Theme; name: string }> = [
  { mode: "split", theme: "light", name: "side-light" },
  { mode: "split", theme: "dark", name: "side-dark" },
  { mode: "focus", theme: "light", name: "focus-light" },
  { mode: "focus", theme: "dark", name: "focus-dark" },
];

for (const capture of captures) {
  test(`thread replies have design spacing in ${capture.name}`, async ({
    page,
  }) => {
    const { panel, replyIds } = await openSpacingThread(page, {
      channelId: OLIVE_CHANNEL_ID,
      channelName: "The Olive House",
      label: "thread-spacing-channel",
      mode: capture.mode,
      theme: capture.theme,
    });

    await captureProof(page, capture.name);
    await expectThreadReplySpacing(panel, replyIds);
  });
}

test("DM threads use the same reply spacing", async ({ page }) => {
  const { panel, replyIds } = await openSpacingThread(page, {
    channelId: AYA_DM_CHANNEL.id,
    channelName: "Aya",
    isDm: true,
    label: "thread-spacing-dm",
    mode: "split",
    theme: "light",
  });

  await expectThreadReplySpacing(panel, replyIds);
});
