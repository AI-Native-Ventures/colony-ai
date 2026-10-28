import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const CHANNEL = "general";
const VIEWPORT = { width: 1440, height: 900 };
const SCREENSHOT_DIR = "test-results/doc-card-collapse";

test.use({ viewport: VIEWPORT });

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
) {
  await expect
    .poll(() =>
      page.evaluate(
        (channelName) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }) ??
          false,
        CHANNEL,
      ),
    )
    .toBe(true);
}

async function emitMessage(
  page: import("@playwright/test").Page,
  content: string,
  parentEventId?: string,
) {
  const event = await page.evaluate(
    ({ channelName, content, parentEventId, pubkey }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock message emitter is unavailable");
      return emit({
        channelName,
        content,
        parentEventId,
        pubkey,
      });
    },
    {
      channelName: CHANNEL,
      content,
      parentEventId,
      pubkey: TEST_IDENTITIES.alice.pubkey,
    },
  );
  if (!event) throw new Error("Mock message emitter returned no event");
  return event;
}

test("thread messages collapse long document and code fences", async ({
  page,
}) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize(VIEWPORT);
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId(`channel-${CHANNEL}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(CHANNEL);
  await waitForMockLiveSubscription(page);

  const root = await emitMessage(page, "Quick update for the team.");
  await expect(page.locator(`[data-message-id="${root.id}"]`)).toContainText(
    "Quick update for the team.",
  );

  const words = Array.from({ length: 899 }, (_, index) => `word${index + 1}`);
  const documentReply = await emitMessage(
    page,
    `\`\`\`doc\n# Plan\n\n${words.join(" ")}\n\`\`\``,
    root.id,
  );
  const code = Array.from(
    { length: 18 },
    (_, index) => `const line${index + 1} = ${index + 1};`,
  ).join("\n");
  const codeReply = await emitMessage(
    page,
    `\`\`\`ts\n${code}\n\`\`\``,
    root.id,
  );

  const summary = page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${root.id}"]`,
  );
  await expect(summary).toBeVisible();
  await summary.click();

  const thread = page.getByTestId("message-thread-panel");
  await expect(thread).toBeVisible();
  await expect(thread.getByTestId("message-thread-head")).toContainText(
    "Quick update for the team.",
  );

  const documentRow = thread.locator(`[data-message-id="${documentReply.id}"]`);
  const documentCard = documentRow.locator("[data-document-card]");
  const documentContent = documentCard.locator("[data-document-content]");
  const showAllDocument = documentCard.getByRole("button", {
    name: "Show all",
  });
  await expect(documentCard).toContainText("Plan");
  await expect(documentCard).toContainText("900 words");
  await expect(showAllDocument).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      documentContent.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);

  const threadBody = thread.getByTestId("message-thread-body");
  await threadBody.evaluate((element) => {
    element.scrollTop = 0;
  });
  await waitForAnimations(page);
  await thread.screenshot({
    path: `${SCREENSHOT_DIR}/document-collapsed.png`,
  });

  await showAllDocument.click();
  const showLessDocument = documentCard.getByRole("button", {
    name: "Show less",
  });
  await expect(showLessDocument).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      documentContent.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1,
      ),
    )
    .toBe(true);
  await showLessDocument.scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await thread.screenshot({
    path: `${SCREENSHOT_DIR}/document-expanded.png`,
  });

  const codeRow = thread.locator(`[data-message-id="${codeReply.id}"]`);
  await codeRow.scrollIntoViewIfNeeded();
  const codeBlock = codeRow.locator("[data-code-block]");
  const codePre = codeBlock.locator("pre");
  await expect(codeBlock).toHaveAttribute("data-code-collapsed", "");
  await expect(
    codeBlock.getByRole("button", { name: "Show all" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      codePre.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await expect(
    codeBlock.getByRole("button", { name: "Copy code block" }),
  ).toBeVisible();
  await waitForAnimations(page);
  await codeBlock.screenshot({ path: `${SCREENSHOT_DIR}/code-collapsed.png` });

  const shortReply = await emitMessage(
    page,
    "```doc\n# Note\nReady for review.\n```",
    root.id,
  );
  const shortCard = thread
    .locator(`[data-message-id="${shortReply.id}"]`)
    .locator("[data-document-card]");
  await expect(shortCard).toContainText("4 words");
  await expect(shortCard.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(shortCard.getByRole("button", { name: "Show all" })).toHaveCount(
    0,
  );
});
