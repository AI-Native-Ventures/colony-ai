import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";
import {
  COLONY3_PEOPLE,
  colony3PositionOptions,
} from "../helpers/colony3Conversations";
import {
  COLONY3_PERSONA_IDS,
  colony3BrowseExtras,
  colony3MembersBridgeOptions,
  colony3OliveBackdropMessages,
} from "../helpers/colony3DialogsFixture";

/**
 * Colony 3.0 conversation dialogs proof: MessageDialogs, CreateChannel,
 * BrowseChannels, EditChannel, ChannelSettings and ChannelMembers, captured
 * with the Lerato Social fixture next to the design reference. Not a
 * regression gate: it writes PNGs (and `captures.json`, read by
 * `scripts/colony3-proof-report.mjs`) and checks each state can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-conv-dialogs-proof";

type Rect = [x: number, y: number, width: number, height: number];
type Capture = {
  name: string;
  board: string;
  refRect?: Rect;
  title: string;
};
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

async function openLerato(
  page: Page,
  options: {
    channel?: string;
    extras?: ReturnType<typeof colony3BrowseExtras>;
    bridge?: Record<string, unknown>;
  } = {},
) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    colony3Extras: options.extras ?? colony3BrowseExtras(),
    searchProfiles: Object.values(COLONY3_PEOPLE).map((person) => ({
      pubkey: person.pubkey,
      displayName: person.name,
    })),
    ...colony3PositionOptions(),
    ...(options.bridge ?? {}),
  });
  await page.goto("/#/today");
  await seedColony3Activity(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.waitForTimeout(800);
  if (options.channel) {
    await page.getByTestId(`channel-${options.channel}`).click();
    await expect(page.getByTestId("message-input")).toBeVisible();
    await page.waitForTimeout(1200);
  }
  await waitForAnimations(page);
}

async function shot(
  page: Page,
  capture: Capture,
  target?: Locator | { x: number; y: number; width: number; height: number },
) {
  await page.waitForTimeout(400);
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

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

/** Dispatches Shift+Cmd+<key> (Shift+Ctrl on other platforms) like the shell shortcuts. */
async function pressShellShortcut(page: Page, key: string) {
  await page.evaluate((shortcutKey) => {
    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: !isMac,
        key: shortcutKey,
        metaKey: isMac,
        shiftKey: true,
      }),
    );
  }, key);
}

async function openChannelSettings(page: Page) {
  const trigger = page.getByTestId("channel-management-trigger");
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.getByTestId("channel-actions-menu-trigger").click();
  }
  await trigger.click();
  await expect(page.getByTestId("channel-management-sheet")).toBeVisible();
}

test("Browse channels board", async ({ page }) => {
  await openLerato(page, { channel: "Marketing" });
  await pressShellShortcut(page, "O");
  const dialog = page.getByTestId("channel-browser-dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  // Marketing is the highlighted row on the board (hover or arrow selection).
  await page.getByTestId("browse-channel-Marketing").hover();
  await shot(
    page,
    {
      name: "BrowseChannels",
      board: "BrowseChannels",
      refRect: [400, 91, 640, 779],
      title: "Browse channels",
    },
    dialog,
  );
});

test("Create channel board", async ({ page }) => {
  await openLerato(page, { channel: "The Olive House" });
  await pressShellShortcut(page, "N");
  const dialog = page.getByTestId("create-channel-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("create-channel-name").fill("spring-campaign");
  await page
    .getByTestId("create-channel-channel-type-option-temporary")
    .click();
  await page.getByTestId("create-channel-permissions-option-private").click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await shot(
    page,
    {
      name: "CreateChannel",
      board: "CreateChannel",
      refRect: [440, 121, 560, 718],
      title: "Create a channel",
    },
    dialog,
  );
});

test("Channel settings board", async ({ page }) => {
  await openLerato(page, {
    channel: "The Olive House",
    bridge: colony3MembersBridgeOptions(),
  });
  await openChannelSettings(page);
  await expect(page.getByTestId("channel-pins-trigger")).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await shot(page, {
    name: "ChannelSettings",
    board: "ChannelSettings",
    title: "Channel settings",
  });
});

test("Edit, leave and delete channel board", async ({ page }) => {
  await openLerato(page, {
    channel: "The Olive House",
    bridge: colony3MembersBridgeOptions(),
  });
  await openChannelSettings(page);
  await page.getByTestId("channel-management-edit").click();
  const edit = page.getByRole("dialog").last();
  await expect(edit).toBeVisible();
  await page
    .getByTestId("channel-management-channel-type-option-temporary")
    .click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await shot(
    page,
    {
      name: "EditChannel-edit",
      board: "EditChannel",
      refRect: [248, 175, 520, 611],
      title: "Edit private channel",
    },
    edit,
  );
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();
  await page.getByTestId("channel-management-leave").click();
  const leave = page.getByRole("alertdialog");
  await expect(leave).toBeVisible();
  await shot(
    page,
    {
      name: "EditChannel-leave",
      board: "EditChannel",
      refRect: [792, 202, 400, 266],
      title: "Leave channel confirmation",
    },
    leave,
  );
  await page.keyboard.press("Escape");
  await expect(leave).toBeHidden();
  await page.getByTestId("channel-management-delete").click();
  const remove = page.getByRole("alertdialog");
  await expect(remove).toBeVisible();
  await shot(
    page,
    {
      name: "EditChannel-delete",
      board: "EditChannel",
      refRect: [792, 492, 400, 266],
      title: "Delete channel confirmation",
    },
    remove,
  );
});

test("Channel members board", async ({ page }) => {
  await openLerato(page, {
    channel: "The Olive House",
    bridge: colony3MembersBridgeOptions(),
  });
  await page.getByTestId("channel-members-trigger").click();
  const members = page.getByTestId("members-sidebar");
  await expect(members).toBeVisible();
  await expect(members).toContainText("Members · 6");
  await expect(
    members.getByTestId(
      `sidebar-managed-agent-status-${REFERENCE_AGENTS.mina.pubkey}`,
    ),
  ).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await shot(
    page,
    {
      name: "ChannelMembers-members",
      board: "ChannelMembers",
      refRect: [196, 163, 520, 634],
      title: "Channel members",
    },
    members,
  );
  await members.getByTestId("members-sidebar-agent-actions").click();
  await page.getByTestId("members-sidebar-add-agents").click();
  const add = page.getByTestId("add-channel-bot-dialog");
  await expect(add).toBeVisible();
  await add
    .getByTestId(`add-channel-agent-${COLONY3_PERSONA_IDS.scout}`)
    .click();
  await add.getByTestId(`add-channel-agent-${COLONY3_PERSONA_IDS.aya}`).click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await shot(
    page,
    {
      name: "ChannelMembers-add-agents",
      board: "ChannelMembers",
      refRect: [744, 185, 500, 591],
      title: "Add agents",
    },
    add,
  );
});

test("Message dialogs board", async ({ page }) => {
  await openLerato(page, {
    channel: "The Olive House",
    extras: {
      ...colony3BrowseExtras(),
      messages: colony3OliveBackdropMessages(),
    },
  });
  const other = page
    .getByTestId("message-row")
    .filter({ hasText: "Saturday market" });
  await other.hover();
  await other.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Report message" }).click();
  const report = page.getByRole("dialog");
  await expect(report).toBeVisible();
  await report.getByRole("button", { name: "Spam" }).click();
  await shot(
    page,
    {
      name: "MessageDialogs-report",
      board: "MessageDialogs",
      refRect: [288, 109, 440, 742],
      title: "Report message",
    },
    report,
  );
  await page.keyboard.press("Escape");
  await expect(report).toBeHidden();

  const own = page
    .getByTestId("message-row")
    .filter({ hasText: "slower spring" });
  await own.hover();
  await own.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete message" }).click();
  const remove = page.getByRole("alertdialog");
  await expect(remove).toBeVisible();
  await shot(
    page,
    {
      name: "MessageDialogs-delete",
      board: "MessageDialogs",
      refRect: [752, 148, 400, 271],
      title: "Delete message",
    },
    remove,
  );
  await page.keyboard.press("Escape");
  await expect(remove).toBeHidden();

  const input = page.getByTestId("message-input");
  await input.click();
  await input.pressSequentially("@Zinhle");
  await page
    .getByTestId(`mention-suggestion-${COLONY3_PEOPLE.zinhle.pubkey}`)
    .getByRole("button", { name: /Mention Zinhle/ })
    .click();
  await input.pressSequentially("can you take a look?");
  await page.getByTestId("send-message").click();
  const outsiders = page.getByRole("alertdialog");
  await expect(outsiders).toBeVisible();
  await shot(
    page,
    {
      name: "MessageDialogs-outsiders",
      board: "MessageDialogs",
      refRect: [752, 442, 400, 370],
      title: "Mention people outside this channel",
    },
    outsiders,
  );
});
