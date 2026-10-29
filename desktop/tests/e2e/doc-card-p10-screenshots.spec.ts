import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const CHANNEL = "general";
const SCREENSHOT_DIR = "test-results/doc-card-p10";

const HEADING = "# 5 signs your guesthouse needs social media";
const OPENING =
  "Your guesthouse has charm, clean rooms, and a great breakfast. But if the phone isn't ringing and the calendar has gaps, social media might be the missing piece. Here are five signs it's time to show up online.";

function sign(n: number) {
  const filler = Array.from(
    { length: 50 },
    (_, index) => `word${n}x${index + 1}`,
  ).join(" ");
  return `**${n}. Sign number ${n}.** ${filler}`;
}

/** The post of GATE-312 P10: a heading, an opening and five signs, ~300 words. */
const POST = [HEADING, OPENING, ...[1, 2, 3, 4, 5].map(sign)].join("\n\n");

/** What the person saw before: the unclosed fence cut to 48 words. */
const BEFORE = `\`\`\`doc\n${HEADING}\n${OPENING} **1. Want the rest?`;

/** What the relay now receives (chat_limits::repair_document): a closed card. */
const AFTER = `\`\`\`doc\n${POST}\n\`\`\``;

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];
const THEMES = [
  { name: "light", theme: "buzz" },
  { name: "dark", theme: "buzz-dark" },
];

async function emitMessage(page: Page, content: string) {
  const event = await page.evaluate(
    ({ channelName, content, pubkey }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is unavailable");
      return emit({ channelName, content, pubkey });
    },
    {
      channelName: CHANNEL,
      content,
      pubkey: TEST_IDENTITIES.alice.pubkey,
    },
  );
  if (!event) throw new Error("Mock message emitter returned no event");
  return event;
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`P10 post renders as a document card at ${viewport.name} ${theme.name}`, async ({
      page,
    }) => {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      // Open the channel at desktop width (the mobile layout hides the
      // sidebar), then narrow the window to the width under test.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.addInitScript((themeName) => {
        window.localStorage.setItem("buzz-theme", themeName);
        window.localStorage.setItem("buzz-follow-system", "false");
      }, theme.theme);
      await installMockBridge(page);
      await page.goto("/");
      await page.getByTestId(`channel-${CHANNEL}`).click();
      await expect(page.getByTestId("chat-title")).toHaveText(CHANNEL);
      await expect
        .poll(() =>
          page.evaluate(
            (channelName) =>
              window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
                channelName,
              }) ?? false,
            CHANNEL,
          ),
        )
        .toBe(true);

      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      const before = await emitMessage(page, BEFORE);
      const after = await emitMessage(page, AFTER);

      // Before: an open fence is a plain code block labelled "doc", no card.
      const beforeRow = page.locator(`[data-message-id="${before.id}"]`);
      await expect(beforeRow).toContainText("Want the rest?");
      await expect(beforeRow.locator("[data-document-card]")).toHaveCount(0);

      // After: a collapsed card with the title, word count, Show all and Copy.
      const afterRow = page.locator(`[data-message-id="${after.id}"]`);
      const card = afterRow.locator("[data-document-card]");
      await expect(card).toContainText("5 signs your guesthouse needs social");
      await expect(card).toContainText("words");
      await expect(
        card.getByRole("button", { name: "Show all" }),
      ).toBeVisible();
      await expect(card.getByRole("button", { name: "Copy" })).toBeVisible();
      await expect(afterRow).not.toContainText("Want the rest?");

      await beforeRow.scrollIntoViewIfNeeded();
      await waitForAnimations(page);
      await beforeRow.screenshot({
        path: `${SCREENSHOT_DIR}/p10-before-${viewport.name}-${theme.name}.png`,
      });
      await afterRow.scrollIntoViewIfNeeded();
      await waitForAnimations(page);
      await afterRow.screenshot({
        path: `${SCREENSHOT_DIR}/p10-after-${viewport.name}-${theme.name}.png`,
      });
    });
  }
}
