import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";
import {
  COMPOSER_IDS,
  composerExtras,
  composerSearchProfiles,
  composerTeamOptions,
  SELF_PUBKEY,
} from "../helpers/colony3ComposerFixture";
import { COLONY3_PEOPLE, colony3At } from "../helpers/colony3Conversations";
import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";

/**
 * Colony 3.0 composer proof (Composer states, New message, Search, Pins).
 * Captures each board state at the design's rectangle so
 * `scripts/colony3-compare.mjs` can lay it next to the reference. Not a
 * regression gate: it writes PNGs and checks each state can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-composer-proof";

type Rect = [x: number, y: number, width: number, height: number];
type Capture = { name: string; board: string; refRect?: Rect; title: string };
const captures: Capture[] = [];

test.describe.configure({ timeout: 120_000 });

async function openLerato(
  page: Page,
  route: string,
  options: {
    audio?: boolean;
    team?: Parameters<typeof composerTeamOptions>[0];
    uploads?: boolean;
  } = {},
) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  if (options.audio) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        async value() {
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.frequency.value = 220;
          oscillator.connect(destination);
          oscillator.start();
          return destination.stream;
        },
      });
    });
  }
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    colony3Extras: composerExtras(),
    searchProfiles: composerSearchProfiles(),
    ...(options.uploads
      ? {
          deferredComposerUploads: true,
          uploadDescriptors: [
            {
              url: `https://mock.relay/media/${"a".repeat(64)}.jpg`,
              sha256: "a".repeat(64),
              size: 12345,
              type: "image/jpeg",
              uploaded: Math.floor(Date.now() / 1000),
              filename: "spring-table.jpg",
            },
          ],
        }
      : {}),
    ...composerTeamOptions(options.team),
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
  target: Locator | { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  const path = `${OUT}/${capture.name}.png`;
  if ("screenshot" in target) {
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
  // One file per capture: a failed test restarts the worker and loses memory.
  writeFileSync(`${OUT}/${capture.name}.cap.json`, JSON.stringify(capture));
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

/** The board draws its states in a 351px column; so does the capture. */
async function narrowComposer(page: Page, width = 351) {
  await page.addStyleTag({
    content: `[data-testid="message-composer"] { width: ${width}px !important; max-width: ${width}px !important; }`,
  });
}

async function openOlive(
  page: Page,
  options: Parameters<typeof openLerato>[2] = {},
) {
  await openLerato(page, "/#/today", options);
  await page.getByTestId("channel-The Olive House").click();
  await expect(page.getByTestId("message-input")).toBeVisible();
}

const COMPOSER_STATE_RECTS: Record<string, Rect> = {
  formatting: [1065, 24, 351, 153],
  reply: [1065, 191, 351, 119],
  edit: [1065, 324, 351, 128],
  voice: [1065, 466, 351, 66],
  attachments: [1065, 546, 351, 182],
  timeout: [1065, 742, 351, 126],
};

async function captureState(
  page: Page,
  key: keyof typeof COMPOSER_STATE_RECTS,
  title: string,
) {
  await shot(
    page,
    {
      name: `ComposerStates-${key}`,
      board: "ComposerStates",
      refRect: COMPOSER_STATE_RECTS[key],
      title,
    },
    page.getByTestId("message-composer"),
  );
}

test("Composer: mention picker in a thread reply", async ({ page }) => {
  await openOlive(page);
  await page
    .getByTestId(`message-row`)
    .filter({ hasText: "Where are we" })
    .hover();
  await page.getByTestId(`reply-message-${COMPOSER_IDS.root}`).click();
  const thread = page.getByTestId("thread-composer-overlay");
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await thread.getByTestId("message-input").click();
  await page.keyboard.type("Thanks both. @");
  const popover = thread.getByTestId("mention-autocomplete-layer");
  await expect(popover).toBeVisible();
  await page.waitForTimeout(600);
  await narrowComposer(page, 704);
  await page.waitForTimeout(300);
  await shot(
    page,
    {
      name: "ComposerStates-mention-popover",
      board: "ComposerStates",
      refRect: [308, 455, 476, 364],
      title: "Mention picker",
    },
    popover.locator(".c3c-mention-card"),
  );
  await thread
    .getByTestId(`mention-always-address-${REFERENCE_AGENTS.mina.pubkey}`)
    .click();
  await page.waitForTimeout(400);
  await shot(
    page,
    {
      name: "ComposerStates-mention-composer",
      board: "ComposerStates",
      refRect: [308, 813, 704, 127],
      title: "Composer with Mina addressed",
    },
    thread.getByTestId("message-composer"),
  );
});

test("Composer: formatting row", async ({ page }) => {
  await openOlive(page);
  await narrowComposer(page);
  await page.getByRole("button", { name: "Toggle formatting" }).click();
  await page.getByTestId("message-input").click();
  await page.keyboard.type("Spring captions are ");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("ready");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" for review.");
  await captureState(page, "formatting", "Formatting row open");
});

test("Composer: editing a message", async ({ page }) => {
  await openOlive(page);
  await narrowComposer(page);
  const row = page.locator(`[data-message-id="${COMPOSER_IDS.leratoEdit}"]`);
  await row.hover();
  await page.getByTestId(`more-actions-${COMPOSER_IDS.leratoEdit}`).click();
  await page.getByTestId(`edit-message-${COMPOSER_IDS.leratoEdit}`).click();
  await expect(page.getByTestId("edit-target")).toBeVisible();
  await captureState(page, "edit", "Editing a message");
});

test("Composer: timed out", async ({ page }) => {
  await openOlive(page);
  await narrowComposer(page);
  await page.evaluate(
    (expiresAtMs) => {
      (
        window as Window & {
          __BUZZ_E2E_ACTIVATE_TIMEOUT__?: (ms: number) => void;
        }
      ).__BUZZ_E2E_ACTIVATE_TIMEOUT__?.(expiresAtMs);
    },
    new Date(COLONY3_NOW).getTime() + 52 * 60 * 1000,
  );
  await expect(page.getByTestId("composer-timeout-banner")).toBeVisible();
  await captureState(page, "timeout", "Timed out by moderators");
});

test("Composer: recording a voice note", async ({ page }) => {
  await openOlive(page, { audio: true });
  await narrowComposer(page);
  await page.getByRole("button", { name: "Record voice note" }).click();
  await expect(page.getByTestId("voice-note-recorder")).toBeVisible();
  await page.waitForTimeout(800);
  await captureState(page, "voice", "Recording a voice note");
});

test("Composer: replying in a thread", async ({ page }) => {
  await openOlive(page);
  await page
    .getByTestId("message-row")
    .filter({ hasText: "Where are we" })
    .hover();
  await page.getByTestId(`reply-message-${COMPOSER_IDS.root}`).click();
  const reply = page.locator(`[data-message-id="${COMPOSER_IDS.minaReply}"]`);
  await reply.hover();
  await page.getByTestId(`reply-message-${COMPOSER_IDS.minaReply}`).click();
  await expect(page.getByTestId("reply-target")).toBeVisible();
  await narrowComposer(page);
  await shot(
    page,
    {
      name: "ComposerStates-reply",
      board: "ComposerStates",
      refRect: COMPOSER_STATE_RECTS.reply,
      title: "Replying to Mina",
    },
    page.getByTestId("thread-composer-overlay").getByTestId("message-composer"),
  );
});

test("Composer: attachments", async ({ page }) => {
  await openOlive(page, { uploads: true });
  await narrowComposer(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Attach file" }).click(),
  ]);
  await chooser.setFiles([
    {
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        "base64",
      ),
      mimeType: "image/png",
      name: "spring-table.jpg",
    },
    {
      buffer: Buffer.from("caption notes"),
      mimeType: "application/pdf",
      name: "caption-notes.pdf",
    },
  ]);
  await page.waitForTimeout(800);
  await captureState(page, "attachments", "Attachments");
});

test("New message board", async ({ page }) => {
  await openLerato(page, "/#/messages/new");
  const search = page.getByTestId("new-dm-search");
  await search.fill("Aya");
  await page
    .getByTestId(`new-dm-result-${REFERENCE_AGENTS.aya.pubkey}`)
    .click();
  await search.fill("Zinhle");
  await page
    .getByTestId(`new-dm-result-${COLONY3_PEOPLE.zinhle.pubkey}`)
    .click();
  await search.fill("No");
  await expect(page.getByTestId("new-message-recipient-popover")).toBeVisible();
  await page.waitForTimeout(600);
  await shot(
    page,
    { name: "NewMessage", board: "NewMessage", title: "New message" },
    { x: 0, y: 0, width: 1440, height: 960 },
  );
});

test("Search board", async ({ page }) => {
  await openLerato(page, "/#/today");
  await page.getByTestId("open-search").click();
  const dialog = page.getByTestId("search-results");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(600);
  await shot(
    page,
    {
      name: "Search-empty",
      board: "Search",
      refRect: [146, 72, 560, 628],
      title: "Search, empty query",
    },
    dialog,
  );
  await page.getByTestId("search-dialog-input").fill("olive");
  await expect(page.getByTestId("search-results-list")).toBeVisible();
  await page.waitForTimeout(900);
  await shot(
    page,
    {
      name: "Search-query",
      board: "Search",
      refRect: [734, 72, 560, 597],
      title: "Search, with a query",
    },
    dialog,
  );
});

test("Pins board", async ({ page }) => {
  await openLerato(page, "/#/today", {
    team: { selfTitle: "Founder" },
  });
  await page.evaluate(
    async (input) => {
      const w = window as Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (i: object) => unknown;
        __BUZZ_E2E_EMIT_MOCK_PIN__?: (i: object) => unknown;
      };
      for (const message of input.messages) {
        await w.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.(message);
      }
      for (const pin of input.pins) {
        await w.__BUZZ_E2E_EMIT_MOCK_PIN__?.(pin);
      }
    },
    {
      messages: [
        {
          channelName: "The Olive House",
          content:
            "Let’s keep a slower spring focused on the courtyard and the new seasonal menu. Two posts a week, no more, and every caption goes past Nandi first.",
          createdAt: colony3At(9, 12, 20),
          id: COMPOSER_IDS.pinLerato,
          pubkey: SELF_PUBKEY,
        },
        {
          channelName: "The Olive House",
          content:
            "The Olive House’s next post is ready for review: five slides with captions drafted. Nandi approves the final caption before we schedule it for Tuesday morning.",
          createdAt: colony3At(14, 5, 17),
          id: COMPOSER_IDS.pinMina,
          pubkey: REFERENCE_AGENTS.mina.pubkey,
        },
        {
          channelName: "The Olive House",
          content:
            "Brand colours, logo files and the approved photo set are in the shared drive under Olive House / Brand.",
          createdAt: colony3At(11, 30, 25),
          id: COMPOSER_IDS.pinNoluthando,
          pubkey: COLONY3_PEOPLE.noluthando.pubkey,
        },
      ],
      pins: [
        {
          channelName: "The Olive House",
          createdAt: colony3At(10, 0, 20),
          pubkey: SELF_PUBKEY,
          targetId: COMPOSER_IDS.pinLerato,
        },
        {
          channelName: "The Olive House",
          createdAt: colony3At(10, 0, 17),
          pubkey: SELF_PUBKEY,
          targetId: COMPOSER_IDS.pinMina,
        },
        {
          channelName: "The Olive House",
          createdAt: colony3At(10, 0, 25),
          pubkey: COLONY3_PEOPLE.noluthando.pubkey,
          targetId: COMPOSER_IDS.pinNoluthando,
        },
        {
          channelName: "The Olive House",
          createdAt: colony3At(10, 0, 31),
          pubkey: COLONY3_PEOPLE.noluthando.pubkey,
          targetId: COMPOSER_IDS.pinGone,
        },
      ],
    },
  );
  await page.getByTestId("channel-The Olive House").click();
  await expect(page.getByTestId("message-input")).toBeVisible();
  const channelId = await page.evaluate(() => location.hash.split("/").pop());
  await page.goto(`/#/channels/pins/${channelId}`);
  await expect(page.getByTestId("channel-pins-screen")).toBeVisible();
  await expect(page.getByTestId("pinned-messages")).toBeVisible();
  await page.waitForTimeout(800);
  await shot(
    page,
    { name: "Pins", board: "Pins", title: "Pinned messages" },
    { x: 0, y: 0, width: 1440, height: 960 },
  );
});
