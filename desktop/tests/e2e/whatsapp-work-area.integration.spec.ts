import { expect, test, type Page } from "@playwright/test";

import {
  JACARANDA_WA_ID,
  OUTREACH_CHANNEL_ID,
  PLANE_TREE_WA_ID,
  WHATSAPP_BATCH_ID,
  WHATSAPP_SECOND_BATCH_ID,
  installWhatsAppMockBridge,
  gotoWhatsAppScreen,
} from "../helpers/whatsappOutreach";
import { REFERENCE_PROSPECT_IDS } from "../../src/testing/e2eReferenceWorkspace";

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
  }) => { id: string };
  __BUZZ_E2E_WHATSAPP_STATE__?: {
    commands: Array<{ kind: number; body: Record<string, unknown> }>;
    contacts: Array<Record<string, unknown>>;
    threads: Record<
      string,
      { contact: Record<string, unknown>; messages: unknown[] }
    >;
    batch: { batchId: string; status: string };
  };
};

async function emitOutreachEvent(
  page: Page,
  content: string,
  tags: string[][],
  parentEventId?: string,
) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as WhatsAppEventWindow
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "Outreach",
          }) ?? false,
      ),
    )
    .toBe(true);
  const event = await page.evaluate(
    ({ content, tags, parentEventId }) =>
      (window as WhatsAppEventWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Outreach",
        content,
        kind: 9,
        pubkey: "deadbeef".repeat(8),
        parentEventId,
        extraTags: tags,
        createdAt: Math.floor(Date.now() / 1000),
      }),
    { content, tags, parentEventId },
  );
  if (!event) throw new Error("Mock WhatsApp channel event was not emitted");
  return event;
}

async function goToOutreach(page: Page) {
  await installWhatsAppMockBridge(page);
  await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);
  await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
}

test.describe("WhatsApp work area conversations and approvals", () => {
  test("opens a replied contact from its channel card and approves or rejects drafts", async ({
    page,
  }) => {
    await goToOutreach(page);
    const root = await emitOutreachEvent(
      page,
      "WhatsApp: Plane Tree Guesthouse (+27 82 123 7135)",
      [
        ["wa", PLANE_TREE_WA_ID],
        ["wa-name", "Plane Tree Guesthouse"],
        ["lead", REFERENCE_PROSPECT_IDS["form-field"]],
      ],
    );
    await emitOutreachEvent(
      page,
      "Please send the details. I can talk tomorrow morning.",
      [
        ["wa", PLANE_TREE_WA_ID],
        ["wa-name", "Plane Tree Guesthouse"],
        ["wa-dir", "in"],
        ["lead", REFERENCE_PROSPECT_IDS["form-field"]],
      ],
      root.id,
    );

    const replyCard = page.getByTestId("whatsapp-channel-reply");
    await expect(replyCard).toBeVisible();
    await replyCard.getByRole("button", { name: "Open in WhatsApp" }).click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await expect(page.getByTestId("work-area-panel")).toBeVisible();
    await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
    await expect(
      page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".c3wa-thread-head-copy")).toContainText(
      "Plane Tree Guesthouse",
    );

    const firstDraft = page.getByTestId("whatsapp-draft-e2e-wa-agent-draft");
    const secondDraft = page.getByTestId(
      "whatsapp-draft-e2e-wa-agent-draft-reject",
    );
    await expect(firstDraft).toBeVisible();
    await expect(secondDraft).toBeVisible();
    await firstDraft.getByRole("button", { name: "Send" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47049 &&
                body.draftId === "e2e-wa-agent-draft" &&
                body.decision === "approve",
            ) ?? false,
        ),
      )
      .toBe(true);
    await secondDraft.getByRole("button", { name: "Discard" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47049 &&
                body.draftId === "e2e-wa-agent-draft-reject" &&
                body.decision === "reject",
            ) ?? false,
        ),
      )
      .toBe(true);
  });

  test("shows the sent template text and the contact name from the thread row", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(
      page,
      "/channels/e2e-whatsapp-general-channel",
      "batch=identity",
    );
    await page.getByRole("button", { name: "WhatsApp chats" }).click();
    await expect(page.getByTestId("work-area-panel")).toBeVisible();
    await page.getByRole("tab", { name: "All" }).click();
    await page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();

    await expect(page.locator(".c3wa-thread-head-copy")).toContainText(
      "Jacaranda Lane Guesthouse",
    );
    const thread = page.getByTestId("whatsapp-thread-messages");
    await expect(thread).toContainText("guesthouses in Melville, Johannesburg");
    await expect(thread).toContainText("This site could be yours");
    await expect(
      page.getByText("No messages yet.", { exact: true }),
    ).toHaveCount(0);
  });

  test("held batch messages show approval state, preview, and batch actions", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(
      page,
      "/channels/e2e-whatsapp-general-channel",
      "batch=held",
    );
    await page.getByRole("button", { name: "WhatsApp chats" }).click();

    const contactButton = page.getByTestId(
      `whatsapp-contact-${JACARANDA_WA_ID}`,
    );
    const contactRow = page
      .locator(".c3wa-contact-row")
      .filter({ has: contactButton });
    await expect(contactRow.locator(".c3wa-contact-chip")).toHaveText(
      "Waiting for your approval",
    );
    await expect(contactRow).not.toContainText(/\bSent\b/u);
    await expect(contactButton).toContainText("This site could be yours");
    await expect(
      contactRow.getByRole("button", {
        name: /^Review batch for /u,
      }),
    ).toBeVisible();

    await contactButton.click();
    const thread = page.getByTestId("whatsapp-thread-messages");
    await expect(thread).toContainText("Waiting for your approval");
    await expect(thread).toContainText("This site could be yours");
    const heldMessage = page.getByTestId(
      "whatsapp-message-e2e-wa-jacaranda-held-template",
    );
    await expect(heldMessage).toContainText("Waiting for your approval");
    await expect(heldMessage).not.toContainText(/\bSent\b/u);
    await expect(heldMessage).not.toContainText("Approved by Basheer Phiri");
    await expect(
      page.locator(".c3wa-contact-row").filter({
        has: page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`),
      }),
    ).not.toContainText(/\bSent\b/u);
    await expect(
      page.getByText("No messages yet.", { exact: true }),
    ).toHaveCount(0);
    const approvalCard = page.getByTestId("whatsapp-thread-held-batch");
    await expect(approvalCard).not.toContainText(/\bSent\b/u);
    await expect(
      approvalCard.getByRole("button", { name: "Review" }),
    ).toBeEnabled();
    await approvalCard.getByRole("button", { name: "Review" }).click();
    await expect(page.getByTestId("whatsapp-batch-page")).toBeVisible();
  });

  test("approves a held batch from the inbox approval card", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(
      page,
      "/channels/e2e-whatsapp-general-channel",
      "batch=held",
    );
    await page.getByRole("button", { name: "WhatsApp chats" }).click();
    await page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();

    const approvalCard = page.getByTestId("whatsapp-thread-held-batch");
    await expect(
      approvalCard.getByRole("button", { name: "Approve batch" }),
    ).toBeEnabled();
    await approvalCard.getByRole("button", { name: "Approve batch" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          (batchId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47049 &&
                body.batchId === batchId &&
                body.decision === "approve",
            ) ?? false,
          WHATSAPP_BATCH_ID,
        ),
      )
      .toBe(true);
  });

  test("waiting contact still shows its batch preview if the thread is empty", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(
      page,
      "/channels/e2e-whatsapp-general-channel",
      "batch=held",
    );
    await page.evaluate((waId) => {
      const state = (window as WhatsAppEventWindow).__BUZZ_E2E_WHATSAPP_STATE__;
      if (state?.threads[waId]) state.threads[waId].messages = [];
    }, JACARANDA_WA_ID);
    await page.getByRole("button", { name: "WhatsApp chats" }).click();
    await page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();

    const thread = page.getByTestId("whatsapp-thread-messages");
    await expect(thread).toContainText("Waiting for your approval");
    await expect(thread).toContainText("This site could be yours");
    await expect(
      page.getByText("No messages yet.", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByTestId("whatsapp-thread-held-batch")
      .getByRole("button", { name: "Review" })
      .click();
    await expect(page.getByTestId("whatsapp-batch-page")).toBeVisible();
  });

  test("pending channel batch approval sends one owner decision", async ({
    page,
  }) => {
    await goToOutreach(page);
    const batchPrefix = WHATSAPP_SECOND_BATCH_ID.replaceAll("-", "");
    await emitOutreachEvent(
      page,
      `Batch ${batchPrefix} is waiting for approval: 3 message(s), template hl_vb. Nothing is sent until the owner or an admin approves it.`,
      [["wa-notice", "batch_pending"]],
    );
    const card = page.getByTestId("whatsapp-channel-batch-pending");
    await card.getByRole("button", { name: "Approve and send" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          (batchId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47049 &&
                body.batchId === batchId &&
                body.decision === "approve",
            ) ?? false,
          WHATSAPP_SECOND_BATCH_ID,
        ),
      )
      .toBe(true);
  });

  test("pending channel batch review opens each message and reject records the decision", async ({
    page,
  }) => {
    await goToOutreach(page);
    const batchPrefix = WHATSAPP_SECOND_BATCH_ID.replaceAll("-", "");
    await emitOutreachEvent(
      page,
      `Batch ${batchPrefix} is waiting for approval: 3 message(s), template hl_vb. Nothing is sent until the owner or an admin approves it.`,
      [["wa-notice", "batch_pending"]],
    );
    const card = page.getByTestId("whatsapp-channel-batch-pending");
    await card.getByRole("button", { name: "Review each message" }).click();
    await expect(page.getByTestId("whatsapp-batch-page")).toBeVisible();

    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);
    await emitOutreachEvent(
      page,
      `Batch ${batchPrefix} is waiting for approval: 3 messages, template hl_vb.`,
      [["wa-notice", "batch_pending"]],
    );
    await page
      .getByTestId("whatsapp-channel-batch-pending")
      .getByRole("button", { name: "Reject" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          (batchId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47049 &&
                body.batchId === batchId &&
                body.decision === "reject",
            ) ?? false,
          WHATSAPP_SECOND_BATCH_ID,
        ),
      )
      .toBe(true);
  });
});
