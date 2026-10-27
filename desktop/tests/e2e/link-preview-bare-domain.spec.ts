import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// GATE-306B: on Colony 3.0.6 a message with a bare-origin link, such as
// "open https://example.com in the browser", failed to send with
// "relay returned 400 Bad Request: invalid link-preview canonical URL" and the
// draft stayed in the composer. The preview identity is `new URL(link).href`,
// `https://example.com/`, which is not text in the message. The mock bridge
// enforces the relay's rule that a snapshot's canonical URL is text in the
// message as sent.

async function lastSentLinkPreviewTags(page: Page) {
  return page.evaluate(() => {
    const call = [...(window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [])]
      .reverse()
      .find((entry) => entry.command === "send_channel_message");
    return (
      call?.payload as { linkPreviewTags?: string[][] | null } | undefined
    )?.linkPreviewTags;
  });
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    linkPreviewMetadata: {
      title: "Example Domain",
      siteName: "example.com",
      description: "This domain is for use in documentation examples.",
      imageDataUrl: null,
      imageDomain: null,
    },
  });
});

test("a message with a bare-domain link and a preview sends", async ({
  page,
}) => {
  const message = "see https://example.com";
  await page.goto("/");
  await page.getByTestId("channel-general").click();

  const input = page.getByTestId("message-input");
  await input.fill(message);
  await expect(page.locator("[data-composer-link-previews]")).toHaveAttribute(
    "data-ready-snapshot-count",
    "1",
  );
  await page.getByTestId("send-message").click();

  // The send was accepted: the composer cleared and the message is in the
  // timeline with its preview card, not stuck as a failed draft.
  const row = page.getByTestId("message-row").last();
  await expect(row).toContainText(message);
  await expect(row.locator("[data-link-preview]")).toBeVisible();
  await expect(input).toHaveText("");

  // The snapshot URL rides along as text that is in the message.
  const linkPreviewTags = await lastSentLinkPreviewTags(page);
  expect(linkPreviewTags?.map((tag) => tag[3])).toEqual([
    "https://example.com",
  ]);
  expect(message).toContain(linkPreviewTags?.[0]?.[3] ?? "\0");
});

test("a preview that cannot be tied to message text never blocks the send", async ({
  page,
}) => {
  // A schemeless GitHub link gets a preview whose https:// URL is not text in
  // the message; there is nothing the relay would accept, so it sends without
  // the preview.
  const message = "review github.com/block/buzz/pull/3246";
  await page.goto("/");
  await page.getByTestId("channel-general").click();

  const input = page.getByTestId("message-input");
  await input.fill(message);
  await expect(page.locator("[data-composer-link-previews]")).toHaveAttribute(
    "data-ready-snapshot-count",
    "1",
  );
  await page.getByTestId("send-message").click();

  await expect(page.getByTestId("message-row").last()).toContainText(message);
  await expect(input).toHaveText("");
  expect((await lastSentLinkPreviewTags(page)) ?? []).toEqual([]);
});
