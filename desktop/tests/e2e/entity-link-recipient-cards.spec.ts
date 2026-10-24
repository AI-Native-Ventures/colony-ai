import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/entity-link-recipient-cards";

// Regression coverage for deleted message links on the recipient side: a link
// to a deleted message identifies the deletion and falls back to its thread
// root or channel.

test("deleted reply links identify deletion and fall back to their thread root", async ({
  page,
}) => {
  const deletedReplyId = "c".repeat(64);
  const threadRootId = "b".repeat(64);
  const channelId = "9dae0116-799b-5071-a0a8-fdd30a91a35d";
  const link = `buzz://message?channel=${channelId}&id=${deletedReplyId}&thread=${threadRootId}`;
  await installMockBridge(page, { deletedEventIds: [deletedReplyId] });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function",
  );
  await page.evaluate(
    ({ id }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "Surviving thread root",
        id,
      });
    },
    { id: threadRootId },
  );
  await page.getByTestId("channel-general").click();
  await page.getByTestId("message-input").fill(`Deleted reply ${link}`);
  await page.getByTestId("send-message").click();

  const deletedLink = page
    .getByTestId("message-row")
    .filter({ hasText: "Deleted reply" })
    .last()
    .getByRole("button", {
      name: "Open thread in channel random; linked message was deleted",
    });
  await expect(deletedLink).toHaveAttribute(
    "data-message-link-state",
    "deleted",
  );
  await deletedLink.click();

  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await expect(page).toHaveURL(new RegExp(`thread=${threadRootId}`));
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
});

test("deleted top-level message links identify deletion and fall back to channel navigation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-theme", "buzz-dark");
    window.localStorage.setItem("buzz-accent-color", "#c0a2f1");
  });
  const missingMessageId = "d".repeat(64);
  const channelId = "9dae0116-799b-5071-a0a8-fdd30a91a35d";
  const link = `buzz://message?channel=${channelId}&id=${missingMessageId}`;
  await installMockBridge(page, { deletedEventIds: [missingMessageId] });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("channel-general").click();
  await page.getByTestId("message-input").fill(`Missing link ${link}`);
  await page.getByTestId("send-message").click();

  const linkMessage = page
    .getByTestId("message-row")
    .filter({ hasText: "Missing link" })
    .last();
  const deletedLink = linkMessage.getByRole("button", {
    name: "Open channel random; linked message was deleted",
  });
  await expect(deletedLink).toHaveText("random");
  await expect(deletedLink).toHaveAttribute(
    "data-message-link-state",
    "deleted",
  );
  await expect(deletedLink).toHaveClass(/buzz-link-deleted/);
  await expect(deletedLink).not.toHaveClass(/buzz-link-unavailable/);
  const unavailableColors = await linkMessage.evaluate((message) => {
    const probe = document.createElement("span");
    probe.className = "mention-chip buzz-link-unavailable";
    message.querySelector(".message-markdown")?.append(probe);
    const styles = getComputedStyle(probe);
    const colors = {
      backgroundColor: styles.backgroundColor,
      color: styles.color,
    };
    probe.remove();
    return colors;
  });
  await expect
    .poll(() =>
      deletedLink.evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          backgroundColor: styles.backgroundColor,
          color: styles.color,
        };
      }),
    )
    .toEqual(unavailableColors);
  await waitForAnimations(page);
  await linkMessage.screenshot({
    path: `${SHOTS}/deleted-message-link-after.png`,
  });
  await deletedLink.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Message deleted");

  await deletedLink.click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await expect(page).toHaveURL(new RegExp(`#/channels/${channelId}$`));
});
