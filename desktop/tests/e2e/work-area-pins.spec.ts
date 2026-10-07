import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

// Pinned messages, bound through the real App: Pin and Unpin in the message
// menu, the pins in the Knowledge tab, the Pins screen, and the states around
// them. A pin is a kind 40004 event with an h tag and one bare e tag; the mock
// relay stores it, serves it back, deletes it and delivers it live like the
// real one, so what these specs see is what the production reader parsed.

const OUT = process.env.COLONY_PINS_SHOTS ?? "test-results/work-area-pins";
const RAW_TEXT = /pin read exploded|\b500\b|relay returned|query failed/i;
const PLAIN_FAILURE = "Colony could not reach this community. Try again.";
const READ_ERROR =
  "relay returned 500 Internal Server Error: pin read exploded";
const MESSAGE = "Ship the launch brief on Friday.";
const OTHER_MESSAGE = "Book the venue before the 12th.";
const GONE_ID = "0123456789abcdef".repeat(4);

const ALICE = TEST_IDENTITIES.alice.pubkey;
const BOB = TEST_IDENTITIES.bob.pubkey;

const dock = (page: Page) => page.getByTestId("work-area-panel");
const pinned = (page: Page) => page.getByTestId("pinned-messages");
const pinnedState = (page: Page) => page.getByTestId("pinned-messages-state");
const headerKnowledge = (page: Page) =>
  page.getByTestId("channel-view-tab-knowledge");

async function boot(
  page: Page,
  options: {
    publishErrors?: string[];
    readErrors?: string[];
    readDelaysMs?: number[];
    viewport?: { width: number; height: number };
  } = {},
) {
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 900 });
  await installMockBridge(page, {
    pinPublishErrors: options.publishErrors,
    pinReadErrors: options.readErrors,
    pinReadDelaysMs: options.readDelaysMs,
    searchProfiles: [
      { pubkey: ALICE, displayName: "Alice", isAgent: false },
      { pubkey: BOB, displayName: "Bob", isAgent: false },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "general",
          }) ?? false,
      ),
    )
    .toBe(true);
}

async function emitMessage(
  page: Page,
  content: string,
  pubkey: string,
  channelName = "general",
) {
  const event = await page.evaluate(
    (input) => window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.(input),
    { channelName, content, pubkey, kind: 40002 },
  );
  if (!event) throw new Error("Mock message emitter is unavailable");
  return event;
}

async function emitPin(
  page: Page,
  targetId: string,
  pubkey?: string,
  channelName = "general",
) {
  const event = await page.evaluate(
    (input) => window.__BUZZ_E2E_EMIT_MOCK_PIN__?.(input),
    { channelName, targetId, pubkey },
  );
  if (!event) throw new Error("Mock pin emitter is unavailable");
  return event;
}

async function openMessageMenu(page: Page, messageId: string, content: string) {
  const row = page.getByTestId("message-row").filter({ hasText: content });
  await expect(row).toBeVisible();
  await row.hover();
  await page.getByTestId(`more-actions-${messageId}`).click();
  const item = page.getByTestId(`pin-message-${messageId}`);
  await expect(item).toBeVisible();
  return item;
}

async function openKnowledge(page: Page) {
  await headerKnowledge(page).click();
  await expect(dock(page)).toBeVisible();
  await expect(
    dock(page).getByRole("tab", { name: "Knowledge", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

test.describe("pinned messages", () => {
  test("Pin in the message menu, with the keyboard, shows in Knowledge and on the Pins screen", async ({
    page,
  }) => {
    await boot(page);
    const message = await emitMessage(page, MESSAGE, ALICE);

    const pinItem = await openMessageMenu(page, message.id, MESSAGE);
    await expect(pinItem).toHaveText("Pin to channel");
    await expect(pinItem).not.toHaveAttribute("data-disabled");
    await pinItem.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Pinned to the channel")).toBeVisible();

    // The same message now offers Unpin.
    const unpinItem = await openMessageMenu(page, message.id, MESSAGE);
    await expect(unpinItem).toHaveText("Unpin from channel");
    await page.keyboard.press("Escape");

    await openKnowledge(page);
    const row = dock(page).getByTestId(`pinned-messages-row-${message.id}`);
    await expect(row).toContainText(MESSAGE);
    await expect(row).toContainText(/alice/i);
    await expect(row).toContainText("Pinned by");
    await expect(
      dock(page).getByRole("list", { name: "Pinned messages" }),
    ).toBeVisible();

    // The Pins screen reads the same source.
    await page.getByTestId("channel-pins-trigger").click();
    const screen = page.getByTestId("channel-pins-screen");
    await expect(screen).toBeVisible();
    await expect(
      screen.getByTestId(`pinned-messages-row-${message.id}`),
    ).toContainText(MESSAGE);
    // A pin opens its message in the channel, the same way a message link does.
    await screen.getByTestId(`pinned-messages-open-${message.id}`).click();
    await expect(screen).toHaveCount(0);
    await expect(page.getByTestId("message-thread-panel")).toContainText(
      MESSAGE,
    );
  });

  test("Unpin from the Knowledge tab, with the keyboard, and the menu offers Pin again", async ({
    page,
  }) => {
    await boot(page);
    const message = await emitMessage(page, MESSAGE, ALICE);
    const pinItem = await openMessageMenu(page, message.id, MESSAGE);
    await pinItem.click();
    await openKnowledge(page);

    const unpin = dock(page).getByTestId(`pinned-messages-unpin-${message.id}`);
    await expect(unpin).toHaveAccessibleName(/^Unpin the message from alice/i);
    await unpin.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Unpinned", { exact: true })).toBeVisible();
    await expect(
      dock(page).getByTestId(`pinned-messages-row-${message.id}`),
    ).toHaveCount(0);
    await expect(pinnedState(page)).toHaveAttribute("data-state", "empty");

    const again = await openMessageMenu(page, message.id, MESSAGE);
    await expect(again).toHaveText("Pin to channel");
  });

  test("a pin the relay refuses is rolled back, says so in plain words, and leaves nothing behind", async ({
    page,
  }) => {
    await boot(page, {
      publishErrors: ["invalid: pinning is not allowed here"],
    });
    const message = await emitMessage(page, MESSAGE, ALICE);
    const pinItem = await openMessageMenu(page, message.id, MESSAGE);
    await pinItem.click();
    await expect(
      page.getByText("Couldn't pin the message. Try again."),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/not allowed here/);

    await openKnowledge(page);
    await expect(pinnedState(page)).toHaveAttribute("data-state", "empty");
    await expect(
      dock(page).getByTestId(`pinned-messages-row-${message.id}`),
    ).toHaveCount(0);
    // And a retry goes through: the failure did not wedge the menu.
    await dock(page).getByRole("button", { name: "Close work area" }).click();
    const again = await openMessageMenu(page, message.id, MESSAGE);
    await expect(again).toHaveText("Pin to channel");
    await again.click();
    await expect(page.getByText("Pinned to the channel")).toBeVisible();
  });

  test("a pin made by someone else shows, but only its pinner can unpin it", async ({
    page,
  }) => {
    await boot(page);
    const message = await emitMessage(page, MESSAGE, BOB);
    await emitPin(page, message.id, ALICE);

    await openKnowledge(page);
    const row = dock(page).getByTestId(`pinned-messages-row-${message.id}`);
    await expect(row).toContainText(MESSAGE);
    await expect(row).toContainText(/Pinned by alice/i);
    await expect(
      dock(page).getByTestId(`pinned-messages-unpin-${message.id}`),
    ).toHaveCount(0);

    const item = await openMessageMenu(page, message.id, MESSAGE);
    await expect(item).toContainText(/Pinned by alice/i);
    await expect(item).toHaveAttribute("data-disabled", "");
  });

  test("a pin made elsewhere appears live, without a reload", async ({
    page,
  }) => {
    await boot(page);
    const message = await emitMessage(page, MESSAGE, BOB);
    await openKnowledge(page);
    await expect(pinnedState(page)).toHaveAttribute("data-state", "empty");
    await emitPin(page, message.id, ALICE);
    await expect(
      dock(page).getByTestId(`pinned-messages-row-${message.id}`),
    ).toContainText(MESSAGE);
    await expect(pinnedState(page)).toHaveCount(0);
  });

  test("a pin whose message is gone is an honest row, and a pin into another channel shows nothing of it", async ({
    page,
  }) => {
    await boot(page);
    const elsewhere = await emitMessage(
      page,
      "Only ever said in random",
      BOB,
      "random",
    );
    // Both pins are the viewer's own (the mock's default author).
    await emitPin(page, GONE_ID);
    await emitPin(page, elsewhere.id);

    await openKnowledge(page);
    const gone = dock(page).getByTestId(
      `pinned-messages-unavailable-${GONE_ID}`,
    );
    await expect(gone).toContainText("This message is no longer available");
    await expect(dock(page)).not.toContainText("Only ever said in random");
    // Both are unavailable here, and neither leaks the other channel's text.
    await expect(
      dock(page).getByTestId(`pinned-messages-unavailable-${elsewhere.id}`),
    ).toBeVisible();

    // Your own pin on an unavailable message can still be removed.
    const unpin = dock(page).getByTestId(`pinned-messages-unpin-${GONE_ID}`);
    await unpin.click();
    await expect(gone).toHaveCount(0);
  });

  test("a failed read says so in plain words, hides the relay text, and Retry recovers", async ({
    page,
  }) => {
    await boot(page, { readErrors: [READ_ERROR, READ_ERROR] });
    await openKnowledge(page);

    await expect(pinnedState(page)).toHaveAttribute("data-state", "failed", {
      timeout: 20_000,
    });
    await expect(pinnedState(page)).toHaveRole("alert");
    await expect(pinnedState(page)).toContainText(
      "Pinned messages could not be loaded.",
    );
    await expect(pinnedState(page)).toContainText(PLAIN_FAILURE);
    await expect(dock(page)).not.toContainText(RAW_TEXT);

    const retry = page.getByTestId("pinned-messages-state-retry");
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(pinnedState(page)).toHaveAttribute("data-state", "empty");
  });

  test("the first read shows a loading state", async ({ page }) => {
    await boot(page, { readDelaysMs: [2_500] });
    await openKnowledge(page);
    await expect(pinnedState(page)).toHaveAttribute("data-state", "loading");
    await expect(pinnedState(page)).toHaveRole("status");
    await expect(pinnedState(page)).toContainText("Loading pinned messages");
    await expect(pinnedState(page)).toHaveAttribute("data-state", "empty", {
      timeout: 15_000,
    });
  });

  test("the Pins screen keeps its own empty scene when nothing is pinned", async ({
    page,
  }) => {
    await boot(page);
    await page.getByTestId("channel-pins-trigger").click();
    const screen = page.getByTestId("channel-pins-screen");
    await expect(
      screen.getByRole("heading", { name: "No pinned messages" }),
    ).toBeVisible();
    await expect(
      screen.getByText("Pin a message from its menu so the team can find it."),
    ).toBeVisible();
    await expect(
      screen.getByRole("list", { name: "Pinned messages" }),
    ).toHaveCount(0);
  });
});

// Review screenshots at the two reference viewports. The frozen r15 channel has
// no pin list (its pinned note is a one-line strip), so the rows borrow the Work
// and Knowledge row language; the Pins screen keeps its frozen empty scene.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
]) {
  test(`pinned messages screenshots at ${viewport.width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page, {
      viewport,
      readDelaysMs: [3_000],
      readErrors: [READ_ERROR, READ_ERROR],
    });
    const first = await emitMessage(page, MESSAGE, ALICE);
    const second = await emitMessage(page, OTHER_MESSAGE, BOB);

    const shot = async (name: string) => {
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/pins-${name}-${viewport.width}.png`,
      });
    };

    await openKnowledge(page);
    await expect(pinnedState(page)).toHaveAttribute("data-state", "loading");
    await shot("loading");
    await expect(pinnedState(page)).toHaveAttribute("data-state", "failed", {
      timeout: 25_000,
    });
    await shot("failed");
    await page.getByTestId("pinned-messages-state-retry").click();
    await expect(pinnedState(page)).toHaveAttribute("data-state", "empty");
    await shot("empty");

    // The menu, open on a message that can be pinned.
    const item = await openMessageMenu(page, first.id, MESSAGE);
    await expect(item).toHaveText("Pin to channel");
    await shot("menu");
    await item.click();
    await emitPin(page, second.id, ALICE);
    await emitPin(page, GONE_ID);
    await expect(
      dock(page).getByTestId(`pinned-messages-row-${second.id}`),
    ).toBeVisible();
    await expect(
      dock(page).getByTestId(`pinned-messages-unavailable-${GONE_ID}`),
    ).toBeVisible();
    await shot("knowledge");

    await page.getByTestId("channel-pins-trigger").click();
    await expect(page.getByTestId("channel-pins-screen")).toBeVisible();
    await expect(
      page
        .getByTestId("channel-pins-screen")
        .getByTestId(`pinned-messages-row-${first.id}`),
    ).toBeVisible();
    await shot("pins-screen");
  });
}
