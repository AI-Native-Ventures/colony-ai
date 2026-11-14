import { expect, test, type Page } from "@playwright/test";

import {
  CORNER_COTTAGE_WA_ID,
  OUTREACH_CHANNEL_ID,
  installWhatsAppMockBridge,
  gotoWhatsAppScreen,
} from "../helpers/whatsappOutreach";
import { REFERENCE_PROSPECT_IDS } from "../../src/testing/e2eReferenceWorkspace";

type MockMessageEvent = { id: string };

type WhatsAppEventWindow = Window & {
  __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
    channelName: string;
  }) => boolean;
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    pubkey: string;
    kind: number;
    parentEventId?: string;
    extraTags?: string[][];
    createdAt?: number;
  }) => MockMessageEvent;
};

async function emitWhatsAppEvent(
  page: Page,
  input: {
    channelName: string;
    content: string;
    tags: string[][];
    parentEventId?: string;
    pubkey?: string;
    /** Event time in seconds. Defaults to now. */
    createdAt?: number;
  },
) {
  await expect
    .poll(() =>
      page.evaluate(
        (channelName) =>
          (
            window as WhatsAppEventWindow
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }) ?? false,
        input.channelName,
      ),
    )
    .toBe(true);
  const event = await page.evaluate(
    ({ channelName, content, tags, parentEventId, pubkey, createdAt }) =>
      (window as WhatsAppEventWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content,
        kind: 9,
        pubkey: pubkey ?? "deadbeef".repeat(8),
        parentEventId,
        extraTags: tags,
        createdAt: createdAt ?? Math.floor(Date.now() / 1000),
      }),
    input,
  );
  if (!event) throw new Error("Mock WhatsApp channel event was not emitted");
  return event;
}

test.describe("WhatsApp work area dock", () => {
  test("Outreach remains a channel and renders connected, batch, and reply cards", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);
    await page.getByTestId("channel-view-tab-discussion").click();

    await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
    await expect(page.getByTestId("message-composer")).toBeVisible();

    // Same-second events are ordered by their random mock ids, so give the five events
    // strictly increasing times, one second apart, ending now. The app groups updates by
    // Johannesburg day (UTC+2, no DST); if the range would cross midnight there, end it at
    // 23:59:59 of the previous day instead, so the events stay in the past and on one day.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsIntoJohannesburgDay = (nowSeconds + 2 * 3600) % 86_400;
    const lastEventAt =
      secondsIntoJohannesburgDay < 4
        ? nowSeconds - secondsIntoJohannesburgDay - 1
        : nowSeconds;
    const eventAt = (index: number) => lastEventAt - 4 + index;

    await emitWhatsAppEvent(page, {
      channelName: "Outreach",
      content: "WhatsApp number connected.",
      tags: [["wa-notice", "connected"]],
      createdAt: eventAt(0),
    });
    await emitWhatsAppEvent(page, {
      channelName: "Outreach",
      content:
        "Batch e2ewhats is waiting for approval: 3 message(s), template hl_vb. Nothing is sent until the owner or an admin approves it.",
      tags: [["wa-notice", "batch_pending"]],
      createdAt: eventAt(1),
    });
    await emitWhatsAppEvent(page, {
      channelName: "Outreach",
      content: "Batch sent. 18 guesthouses messaged, 18 delivered, 11 read.",
      tags: [["wa-notice", "batch_completed"]],
      createdAt: eventAt(2),
    });
    const root = await emitWhatsAppEvent(page, {
      channelName: "Outreach",
      content: "WhatsApp: Corner Cottage Parkhurst (+27 72 555 1188)",
      tags: [
        ["wa", CORNER_COTTAGE_WA_ID],
        ["wa-name", "Corner Cottage Parkhurst"],
        ["lead", REFERENCE_PROSPECT_IDS["sunday-edit"]],
      ],
      createdAt: eventAt(3),
    });
    await emitWhatsAppEvent(page, {
      channelName: "Outreach",
      content: "Please send the details. I can talk tomorrow morning.",
      parentEventId: root.id,
      tags: [
        ["wa", CORNER_COTTAGE_WA_ID],
        ["wa-name", "Corner Cottage Parkhurst"],
        ["wa-dir", "in"],
        ["lead", REFERENCE_PROSPECT_IDS["sunday-edit"]],
      ],
      createdAt: eventAt(4),
    });

    const activity = page.getByTestId("whatsapp-discussion-activity");
    const summary = activity.locator("summary");
    await expect(summary).toHaveText(
      "3 updates: Number connected, Batch sent, Corner Cottage Parkhurst replied",
    );
    await summary.click();
    await expect(activity).toContainText("WhatsApp number connected.");
    await expect(activity).toContainText(
      "18 guesthouses messaged, 18 delivered",
    );
    const replyActivity = activity
      .getByRole("listitem")
      .filter({ hasText: "Corner Cottage Parkhurst replied" });
    await expect(replyActivity).toContainText(
      "Please send the details. I can talk tomorrow morning.",
    );

    await replyActivity.getByRole("button", { name: "Open chat" }).click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
    await expect(
      page.getByTestId(`whatsapp-contact-${CORNER_COTTAGE_WA_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".c3wa-thread-head-copy")).toContainText(
      "Corner Cottage Parkhurst",
    );
  });

  test("WhatsApp chats opens from the channel header and the dock add menu, and a DM header has no WhatsApp trigger", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(page, "/channels/e2e-whatsapp-general-channel");

    await page.getByRole("button", { name: "Open work area" }).click();
    await expect(page.getByTestId("work-area-empty")).toBeVisible();
    await page.getByRole("button", { name: "Add work area tab" }).click();
    await page.getByRole("menuitem", { name: "WhatsApp chats" }).click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await page.getByTestId("channel-whatsapp-chats-trigger").click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(
      page.getByRole("searchbox", { name: "Search chats" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Replied" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sent" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Opted out" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "WhatsApp chats" }),
    ).toBeVisible();

    await gotoWhatsAppScreen(page, "/channels/e2e-whatsapp-aya-dm");
    await expect(page.getByTestId("chat-title")).toHaveText("Aya");
    await expect(
      page.getByTestId("channel-whatsapp-chats-trigger"),
    ).toHaveCount(0);
  });
});
