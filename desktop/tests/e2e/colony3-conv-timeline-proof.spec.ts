import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";
import type { Colony3Extras } from "../../src/testing/e2eBridge";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  COLONY3_PEOPLE,
  colony3Extras,
  colony3PositionOptions,
} from "../helpers/colony3Conversations";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";
import {
  colony3WorkAreaBridgeOptions,
  createColony3WorkAreaWorkspace,
} from "../helpers/colony3WorkAreaFixture";
import { installWorkspaceFileHost } from "./helpers/workspaceFileHost";
import {
  actionsBoardMessages,
  AYA_DM_CHANNEL,
  ayaDirectMessages,
  marketingMessages,
  oliveChannelBoardMessages,
  routeColony3Tiles,
  springThreadMessages,
  WINTER_MENU_CHANNEL,
  winterMenuMessages,
} from "../helpers/colony3TimelineFixture";

/**
 * Colony 3.0 conversation timeline proof: Channel, Direct message, Thread,
 * Message actions, Channel join and Channel states. Captures the app at each
 * board's size with the Lerato Social fixture so
 * `scripts/colony3-proof-report.mjs` can lay every capture next to the design
 * reference. Not a regression gate: it writes PNGs and checks each state can
 * be reached.
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

test.describe.configure({ timeout: 120_000 });

const mina = "b1b1".repeat(16);
const theo = "c7c7".repeat(16);
const aya = "a4a4".repeat(16);

/** The agents the boards show are managed by Lerato where the board says so. */
const OWNED_AGENT_PROFILES: NonNullable<Colony3Extras["profiles"]> = [
  mina,
  theo,
  aya,
].map((pubkey, index) => ({
  pubkey,
  displayName: ["Mina", "Theo", "Aya"][index],
  isAgent: true,
  ownerPubkey: "self",
  presence: "online" as const,
}));

/** Agents managed on this device, so no "other setup" marker shows by a name. */
const MANAGED_AGENTS = [
  { pubkey: mina, name: "Mina" },
  { pubkey: theo, name: "Theo" },
  { pubkey: aya, name: "Aya" },
].map((agent) => ({
  ...agent,
  status: "running" as const,
  channelNames: ["The Olive House", "Marketing", "Sales"],
}));

/** Channels the boards read to the end, so no New divider shows by default. */
const READ_CHANNELS = [
  REFERENCE_CHANNEL_IDS.oliveHouse,
  REFERENCE_CHANNEL_IDS.ayaDm,
  REFERENCE_CHANNEL_IDS.marketing,
  REFERENCE_CHANNEL_IDS.operations,
];

async function openLerato(
  page: Page,
  extras: Partial<Colony3Extras>,
  options: {
    owned?: boolean;
    threadMode?: "focus" | "split";
    /** Bridge options that replace the plain ones (the work area fixture). */
    bridge?: Record<string, unknown>;
  } = {},
) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await page.addInitScript((mode) => {
    window.localStorage.setItem("buzz.channels.threadViewMode", mode);
  }, options.threadMode ?? "split");
  await routeColony3Tiles(page);
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    ...colony3PositionOptions(),
    managedAgents: MANAGED_AGENTS,
    // The moderation items show to an owner.
    relayMembers: [{ pubkey: "deadbeef".repeat(8), role: "owner" as const }],
    ...options.bridge,
    colony3Extras: colony3Extras({
      readChannelIds: READ_CHANNELS,
      ...extras,
      profiles: [
        ...(options.owned ? OWNED_AGENT_PROFILES : []),
        ...(extras.profiles ?? []),
      ],
    }),
  });
  await page.goto("/#/today");
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
    await page.screenshot({
      animations: "disabled",
      clip: target ?? { x: 0, y: 0, width: 1440, height: 960 },
      path,
    });
  }
  captures.push(capture);
}

/** The design shows the top of a long conversation; the app opens at the latest. */
async function scrollTimelineTo(page: Page, selector: string, offset = 0) {
  await page.evaluate(
    ({ selector: target, extra }) => {
      const anchor = document.querySelector<HTMLElement>(target);
      let node: HTMLElement | null = anchor;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight
        ) {
          const top = anchor
            ? anchor.getBoundingClientRect().top -
              node.getBoundingClientRect().top
            : 0;
          node.scrollTop += top - extra;
          return;
        }
        node = node.parentElement;
      }
    },
    { selector, extra: offset },
  );
  await page.waitForTimeout(500);
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

const oliveDescription = {
  id: REFERENCE_CHANNEL_IDS.oliveHouse,
  description: "Client channel · spring content campaign",
};

test("Channel board", async ({ page }) => {
  // Mina's file is a real workspace file, so the message shows its card, and
  // two open commitments give the Work tab its count.
  const workspace = await createColony3WorkAreaWorkspace();
  await installWorkspaceFileHost(page, workspace);
  const { colony3Extras: _unused, ...workAreaBridge } =
    colony3WorkAreaBridgeOptions();
  await openLerato(
    page,
    {
      patchChannels: [oliveDescription],
      clearMessagesIn: [REFERENCE_CHANNEL_IDS.oliveHouse],
      messages: oliveChannelBoardMessages(),
    },
    {
      owned: true,
      bridge: { ...workAreaBridge, managedAgents: MANAGED_AGENTS },
    },
  );
  await page.getByTestId("channel-The Olive House").click();
  await expect(page.getByTestId("chat-title")).toHaveText("The Olive House");
  await page.waitForTimeout(1500);
  await scrollTimelineTo(
    page,
    '[data-testid="message-timeline-day-divider"]',
    24,
  );
  await shot(page, {
    name: "Channel",
    board: "Channel",
    title: "Client channel",
  });
});

test("Direct message board", async ({ page }) => {
  await openLerato(
    page,
    {
      channels: [AYA_DM_CHANNEL],
      messages: ayaDirectMessages(),
    },
    { owned: true },
  );
  await page.getByTestId("channel-Aya").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Aya");
  await page.waitForTimeout(1500);
  await scrollTimelineTo(page, '[data-testid="message-dm-intro"]', 32);
  await shot(page, {
    name: "DirectMessage",
    board: "DirectMessage",
    title: "Direct message with Aya",
  });
});

test("Thread focus board", async ({ page }) => {
  await openLerato(
    page,
    {
      patchChannels: [oliveDescription],
      clearMessagesIn: [REFERENCE_CHANNEL_IDS.oliveHouse],
      messages: springThreadMessages(),
    },
    { threadMode: "focus" },
  );
  await page.getByTestId("channel-The Olive House").click();
  await expect(page.getByTestId("chat-title")).toHaveText("The Olive House");
  await page.getByTestId("message-thread-summary").first().click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, {
    name: "ThreadFocus",
    board: "ThreadFocus",
    title: "Thread, focus view",
  });
});

test("Message actions board", async ({ page }) => {
  await openLerato(page, {
    patchChannels: [oliveDescription],
    clearMessagesIn: [REFERENCE_CHANNEL_IDS.oliveHouse],
    messages: actionsBoardMessages(),
  });
  await page.getByTestId("channel-The Olive House").click();
  await expect(page.getByTestId("chat-title")).toHaveText("The Olive House");
  await page.getByTestId("message-thread-summary").first().click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await page.waitForTimeout(1000);
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "Lovely. Could the caption" })
    .first();
  await row.hover();
  await page.getByTestId("more-actions-c3-actions-nandi").click();
  await page.getByRole("menuitem", { name: "Time out author" }).hover();
  await page.waitForTimeout(600);
  await shot(page, {
    name: "MessageActions",
    board: "MessageActions",
    title: "Message actions menu",
  });
});

test("Channel join board", async ({ page }) => {
  await openLerato(page, {
    patchChannels: [
      {
        id: REFERENCE_CHANNEL_IDS.marketing,
        description:
          "Campaign planning, newsletters and launch notes for the studio. Anyone in the community can read along.",
      },
    ],
    members: [
      {
        channelId: REFERENCE_CHANNEL_IDS.marketing,
        pubkey: COLONY3_PEOPLE.sam.pubkey,
      },
      { channelId: REFERENCE_CHANNEL_IDS.marketing, pubkey: aya },
    ],
    leaveChannelIds: [REFERENCE_CHANNEL_IDS.marketing],
    messages: marketingMessages(),
  });
  // The person has not joined, so the channel is not in the sidebar.
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.marketing}`);
  await expect(page.getByTestId("chat-title")).toHaveText("Marketing");
  await page.waitForTimeout(1500);
  await scrollTimelineTo(page, '[data-testid="message-channel-intro"]', 28);
  await shot(page, {
    name: "ChannelJoin",
    board: "ChannelJoin",
    title: "Channel, not a member yet",
  });
});

test("Channel states board", async ({ page }) => {
  await openLerato(page, {
    channels: [WINTER_MENU_CHANNEL],
    messages: winterMenuMessages(),
    clearMessagesIn: [REFERENCE_CHANNEL_IDS.operations],
  });
  await page.getByTestId("channel-Operations").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Operations");
  await expect(page.getByTestId("message-empty")).toBeVisible();
  await shot(
    page,
    {
      name: "ChannelStates-empty",
      board: "ChannelStates",
      refRect: [304, 24, 358, 444],
      title: "Empty channel",
    },
    { x: 280, y: 0, width: 1160, height: 960 },
  );
  await page.goto("/#/today");
  await page.getByTestId("channel-Sales").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Sales");
  await page.waitForTimeout(1500);
  await shot(
    page,
    {
      name: "ChannelStates-new",
      board: "ChannelStates",
      refRect: [1059, 488, 358, 444],
      title: "New messages",
    },
    { x: 280, y: 0, width: 1160, height: 960 },
  );
});

test("Archived channel board", async ({ page }) => {
  await openLerato(page, {
    channels: [WINTER_MENU_CHANNEL],
    messages: winterMenuMessages(),
  });
  await page.goto(`/#/channels/${WINTER_MENU_CHANNEL.id}`);
  await expect(page.getByTestId("chat-title")).toHaveText("Winter menu launch");
  await page.waitForTimeout(1500);
  await shot(
    page,
    {
      name: "ChannelStates-archived",
      board: "ChannelStates",
      refRect: [304, 488, 358, 444],
      title: "Archived channel",
    },
    { x: 280, y: 0, width: 1160, height: 960 },
  );
});
