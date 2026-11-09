import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

import {
  CORNER_COTTAGE_WA_ID,
  GREEN_SHUTTER_WA_ID,
  JACARANDA_WA_ID,
  OAKLEAF_WA_ID,
  OUTREACH_CHANNEL_ID,
  QUIET_OWL_WA_ID,
  QUEUED_LEAD_WA_ID,
  installWhatsAppMockBridge,
  gotoWhatsAppScreen,
} from "../helpers/whatsappOutreach";
import { waitForAnimations } from "../helpers/animations";

const PLANE_TREE_WA_ID = "27821237135";
const UNLINKED_WA_ID = "27683735905";
const NO_WEBSITE_WA_ID = "27795552241";

type WhatsAppMockState = {
  commands: Array<{ kind: number; body: Record<string, unknown> }>;
  contacts: Array<{
    waId: string;
    stage: string;
    label: string | null;
    displayName: string | null;
  }>;
};

type WhatsAppEventWindow = Window & {
  __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
    channelName: string;
  }) => boolean;
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    pubkey: string;
    kind: number;
    extraTags?: string[][];
    createdAt?: number;
  }) => { id: string };
  __BUZZ_E2E_WHATSAPP_STATE__?: WhatsAppMockState;
  __BUZZ_E2E_WHATSAPP__?: (request: {
    action: "command";
    kind: number;
    body: Record<string, unknown>;
  }) => Promise<unknown>;
};

async function installLogoPreview(page: Page) {
  await page.route("https://img.logo.dev/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3d664b"/><path d="M14 42h36v5H14zm4-7 14-18 14 18z" fill="#f5f2e7"/></svg>',
    }),
  );
}

async function openOutreachFromHome(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page.getByTestId("channel-Outreach").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
  await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible();
}

async function captureSafetyShot(page: Page, name: string) {
  const directory = process.env.OUTREACH_UI_SHOT_DIR;
  if (!directory) return;
  await waitForAnimations(page);
  await page.screenshot({ path: path.join(directory, name) });
}

async function emitOutreachEvent(
  page: Page,
  input: { content: string; tags?: string[][]; pubkey?: string },
) {
  await expect
    .poll(() =>
      page.evaluate(
        (channelName) =>
          (
            window as WhatsAppEventWindow
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }) ?? false,
        "Outreach",
      ),
    )
    .toBe(true);
  const event = await page.evaluate(
    ({ content, tags, pubkey }) =>
      (window as WhatsAppEventWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Outreach",
        content,
        pubkey: pubkey ?? "deadbeef".repeat(8),
        kind: 9,
        extraTags: tags,
        createdAt: Math.floor(Date.now() / 1000),
      }),
    input,
  );
  if (!event) throw new Error("The mock Outreach message was not emitted.");
  return event;
}

test.describe("Outreach desk", () => {
  test("chat and pipeline use the active business name", async ({ page }) => {
    const businessName = "Northbank Studio";
    await installWhatsAppMockBridge(page, "light", {
      businessName,
      deskFixture: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);
    await expect(
      page.getByText(`Private WhatsApp conversations for ${businessName}.`),
    ).toBeVisible();
    await page.getByTestId("channel-view-tab-chats").click();
    await page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`).click();
    await expect
      .soft(page.getByTestId("whatsapp-reply-input"))
      .toHaveAttribute("placeholder", `Reply on WhatsApp as ${businessName}`);
    await page.getByTestId("channel-view-tab-pipeline").click();
    await expect
      .soft(page.locator(".c3wa-desk-eyebrow").filter({ hasText: "WhatsApp" }))
      .toHaveText(`${businessName} · WhatsApp`);
    await expect
      .soft(page.getByTestId("outreach-desk-pipeline"))
      .not.toContainText("Horizon Labs");
  });

  test("shows approved unsent outreach in the first pipeline column but not Needs you", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      deskFixture: true,
      queuedFixture: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);

    const needs = page.getByTestId("outreach-desk-needs-you");
    await expect(needs).not.toContainText("Linden Tree Lodge");

    await page.getByTestId("channel-view-tab-pipeline").click();
    const queuedColumn = page.locator(
      '.c3wa-pipeline-column[data-stage="queued"]',
    );
    await expect(queuedColumn).toBeVisible();
    await expect(
      queuedColumn.getByRole("heading", { name: "Queued to contact" }),
    ).toBeVisible();
    await expect(queuedColumn.locator("> header > span")).toHaveText("1");

    const queuedCard = queuedColumn.getByTestId(
      `outreach-pipeline-card-${QUEUED_LEAD_WA_ID}`,
    );
    await expect(queuedCard).toContainText("Linden Tree Lodge");
    await expect(queuedCard).toContainText("+27 79 444 1101");
    await expect(queuedCard).toContainText("Queued");
    await expect(queuedCard).toContainText(
      "Queued from Batch: Message 12 guesthouses in Melville",
    );
    const openLead = queuedCard.getByRole("button", { name: "Open lead" });
    await expect(openLead).toBeVisible();
    await openLead.click();
    await expect(page.getByTestId("w10-prospect-page")).toBeVisible();
  });

  test("opens on Needs you, approves a batch, books a call, and moves a pipeline card with the keyboard", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", { deskFixture: true });
    await installLogoPreview(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);

    const needs = page.getByTestId("outreach-desk-needs-you");
    const waitingReply = needs.getByTestId(
      `outreach-needs-contact-${PLANE_TREE_WA_ID}`,
    );
    await expect(waitingReply).toHaveCount(1);
    await expect(waitingReply).toContainText("Replied");
    await expect(
      waitingReply.locator("img[alt='Plane Tree Guesthouse']"),
    ).toHaveAttribute("src", /img\.logo\.dev\/form-field\.example/u);

    const wantsCall = needs.getByTestId(
      `outreach-needs-contact-${CORNER_COTTAGE_WA_ID}`,
    );
    await expect(wantsCall).toHaveCount(1);
    await expect(wantsCall).toContainText("Wants a call");

    const batch = needs.getByTestId("outreach-needs-batch-e2e-whatsapp-batch");
    await expect(
      batch.getByRole("button", { name: "Review each message" }),
    ).toBeVisible();
    await batch.getByRole("button", { name: /Approve and send/u }).click();
    await expect(batch).toHaveCount(0);

    const bookCall = wantsCall.getByRole("button", {
      name: "Mark call booked",
    });
    await expect(bookCall).toBeEnabled({ timeout: 15_000 });
    await bookCall.click();
    await expect
      .poll(() =>
        page.evaluate(
          (waId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47052 &&
                body.waId === waId &&
                body.stage === "call_booked",
            ) ?? false,
          CORNER_COTTAGE_WA_ID,
        ),
      )
      .toBe(true);

    await page.getByTestId("channel-view-tab-pipeline").click();
    const callBookedColumn = page.locator(
      '.c3wa-pipeline-column[data-stage="call_booked"]',
    );
    await expect(
      callBookedColumn.getByTestId(
        `outreach-pipeline-card-${CORNER_COTTAGE_WA_ID}`,
      ),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Contacted" })
        .getByTestId(`outreach-pipeline-card-${JACARANDA_WA_ID}`),
    ).toContainText("Waiting for a reply, read");
    await expect(
      page
        .getByRole("region", { name: "Contacted" })
        .getByTestId(`outreach-pipeline-card-${GREEN_SHUTTER_WA_ID}`),
    ).not.toContainText("Waiting for a reply");

    const moveButton = page
      .getByRole("region", { name: "WhatsApp pipeline stages" })
      .getByTestId(`outreach-move-${JACARANDA_WA_ID}`);
    await moveButton.focus();
    await expect(moveButton).toBeFocused();
    await page.keyboard.press("Enter");
    const quoteSentOption = page.getByRole("menuitem", {
      name: "Quote sent",
      exact: true,
    });
    await expect(quoteSentOption).toBeVisible();
    await page.keyboard.press("q");
    await expect(quoteSentOption).toHaveAttribute("data-highlighted", "");
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          (waId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47052 &&
                body.waId === waId &&
                body.stage === "quote_sent",
            ) ?? false,
          JACARANDA_WA_ID,
        ),
      )
      .toBe(true);
  });

  test("renames a contact across Chats and Pipeline and shows fallback identities", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", { deskFixture: true });
    await installLogoPreview(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);
    await page.getByTestId("channel-view-tab-chats").click();

    const unlinkedRow = page.getByTestId(`whatsapp-contact-${UNLINKED_WA_ID}`);
    await expect(unlinkedRow).toContainText("+27 68 373 5905");
    await expect(
      unlinkedRow.getByText("+27 68 373 5905", { exact: true }),
    ).toHaveCount(1);
    await expect(unlinkedRow.locator("svg.lucide-user-round")).toBeVisible();

    const linkedRow = page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`);
    await expect(linkedRow).toContainText("Jacaranda Lane Guesthouse");
    await expect(linkedRow).not.toContainText("+27 82 123 4410");

    const noWebsiteRow = page.getByTestId(
      `whatsapp-contact-${NO_WEBSITE_WA_ID}`,
    );
    await expect(noWebsiteRow.locator(".business-logo-fallback")).toHaveText(
      "L",
    );
    await expect(noWebsiteRow.locator("img")).toHaveCount(0);
    await page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();
    await page.getByTestId("whatsapp-rename-contact").click();
    await page.getByLabel("Contact label").fill("Jacaranda House");
    await page.getByRole("button", { name: "Save label" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          (waId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47052 &&
                body.waId === waId &&
                body.label === "Jacaranda House",
            ) ?? false,
          JACARANDA_WA_ID,
        ),
      )
      .toBe(true);
    await expect(
      page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`),
    ).toContainText("Jacaranda House");

    await page.getByTestId("channel-view-tab-pipeline").click();
    await expect(
      page.getByTestId(`outreach-pipeline-card-${JACARANDA_WA_ID}`).first(),
    ).toContainText("Jacaranda House");
    await page.getByTestId("channel-view-tab-chats").click();
    await page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();
    await page.getByTestId("whatsapp-rename-contact").click();
    await expect(page.getByLabel("Contact label")).toHaveAttribute(
      "maxlength",
      "120",
    );
    await page.getByRole("button", { name: "Clear label" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          (waId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.contacts.find(
              (contact) => contact.waId === waId,
            )?.displayName,
          JACARANDA_WA_ID,
        ),
      )
      .toBe("Mpho");
  });

  test("an owner sees the payment failure, a count-bound recovery, and a per-message send again", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      deskFixture: true,
      paymentRetryCount: 63,
      paymentFailedCount: 1,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);
    await expect(page.getByTestId("outreach-needs-send-health")).toContainText(
      "WhatsApp stopped sending",
    );
    await expect(page.getByTestId("outreach-needs-send-health")).toContainText(
      "63 messages are waiting",
    );
    await page.getByTestId("channel-view-tab-chats").click();
    await expect(page.getByTestId("whatsapp-send-health-banner")).toContainText(
      "Nothing was lost: 63 messages are waiting",
    );
    await page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`).click();

    const failedMessage = page.getByTestId("whatsapp-message-e2e-wa-failed");
    await expect(failedMessage).toContainText(
      "Meta blocked this send: payment problem on your WhatsApp account.",
    );
    const sendAgain = page.getByTestId("whatsapp-send-again-e2e-wa-failed");
    await expect(sendAgain).toHaveText("Send again");
    await sendAgain.click();
    await expect(
      page.getByTestId("whatsapp-resume-retry-dialog"),
    ).toContainText("Retry 63 messages?");
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByTestId("channel-view-tab-pipeline").click();
    await expect(page.getByTestId("whatsapp-send-health-banner")).toContainText(
      "Nothing was lost: 63 messages are waiting",
    );
    await expect(
      page
        .locator(".c3wa-pipeline-columns")
        .getByTestId(`outreach-pipeline-card-${PLANE_TREE_WA_ID}`),
    ).toContainText("Send failed");
    await page.getByTestId("channel-view-tab-chats").click();
    const resume = page.getByTestId("whatsapp-resume-retry-trigger");
    await expect(resume).toHaveText("Resume and retry");
    await resume.click();
    await page.getByRole("button", { name: "Retry 63 messages" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47051 && body.resumeAndRetry === true,
            ) ?? false,
        ),
      )
      .toBe(true);
  });

  test("Meta engagement limits show Not delivered and schedule a delayed per-contact retry", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      deskFixture: true,
      engagementLimit: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);
    await expect(
      page.getByTestId("whatsapp-delivery-health-summary"),
    ).toContainText("12 messages were not delivered by Meta");

    await page.getByTestId("channel-view-tab-chats").click();
    await page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`).click();
    const failedMessage = page.getByTestId("whatsapp-message-e2e-wa-failed");
    await expect(failedMessage).toContainText(
      "Meta did not deliver this one. Meta limits marketing messages",
    );
    await expect(failedMessage).toContainText("Meta error 131049");
    await page.getByTestId("whatsapp-try-again-later-e2e-wa-failed").click();
    await expect(
      page.getByTestId("whatsapp-try-again-later-dialog"),
    ).toContainText("The contact stays paused");
    await page.getByRole("button", { name: "7 days" }).click();
    await page.getByRole("button", { name: "Try again in 7 days" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47052 &&
                (body.retryLater as { days?: unknown } | undefined)?.days === 7,
            ) ?? false,
        ),
      )
      .toBe(true);

    await page.getByTestId("channel-view-tab-pipeline").click();
    await expect(
      page
        .locator(".c3wa-pipeline-columns")
        .getByTestId(`outreach-pipeline-card-${PLANE_TREE_WA_ID}`),
    ).toContainText("Not delivered");
  });

  test("renders safety decisions and requires explicit unknown-send recovery", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      deskFixture: true,
      outreachSafetyFixture: true,
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await openOutreachFromHome(page);

    const needs = page.getByTestId("outreach-desk-needs-you");
    await expect(needs.getByText("Safety checks passed").first()).toBeVisible();
    const unknownSend = page.getByTestId(
      "outreach-unknown-send-e2e-wa-unknown-send",
    );
    await expect(unknownSend).toContainText("Held for you");
    await expect(unknownSend).toContainText(
      "We cannot confirm this message was delivered",
    );
    await captureSafetyShot(page, "ODNeedsYou-safety.png");

    const checkStatus = page.getByTestId(
      "whatsapp-unknown-send-check-e2e-wa-unknown-send",
    );
    await checkStatus.focus();
    await expect(checkStatus).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(unknownSend).toContainText(
      "The relay checked the provider status. Checking it did not send another message.",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47054 &&
                body.action === "check_status" &&
                body.confirm === undefined,
            ) ?? false,
        ),
      )
      .toBe(true);

    const resend = page.getByTestId(
      "whatsapp-unknown-send-resend-e2e-wa-unknown-send",
    );
    await resend.click();
    const resendDialog = page.getByTestId(
      "whatsapp-unknown-send-resend-e2e-wa-unknown-send-dialog",
    );
    await expect(resendDialog).toContainText("Resend this as a new message?");
    await page.keyboard.press("Escape");
    await expect(resendDialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) => kind === 47054 && body.action === "resend",
            ) ?? false,
        ),
      )
      .toBe(false);
    await resend.click();
    await resendDialog
      .getByRole("button", { name: "Resend as new message", exact: true })
      .click();
    await expect(unknownSend).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47054 &&
                body.action === "resend" &&
                body.confirm === true,
            ) ?? false,
        ),
      )
      .toBe(true);

    await page.getByTestId("channel-view-tab-chats").click();
    const awaitingReplyFilter = page.getByRole("tab", {
      name: "Awaiting reply",
      exact: true,
    });
    await awaitingReplyFilter.focus();
    await expect(awaitingReplyFilter).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByTestId(`whatsapp-contact-${OAKLEAF_WA_ID}`),
    ).toContainText("Awaiting reply");

    await page.getByRole("tab", { name: "Opted out", exact: true }).click();
    const optedOut = page.getByTestId(`whatsapp-contact-${QUIET_OWL_WA_ID}`);
    await expect(optedOut.locator("..")).toContainText(
      "Replied “stop”. Permanent.",
    );
    await captureSafetyShot(page, "ODChats-safety.png");
    const undoOptOut = page.getByTestId(
      `whatsapp-opt-out-undo-${QUIET_OWL_WA_ID}`,
    );
    await undoOptOut.click();
    const undoOptOutDialog = page.getByTestId(
      `whatsapp-opt-out-undo-${QUIET_OWL_WA_ID}-dialog`,
    );
    await expect(undoOptOutDialog).toContainText("Undo this opt-out?");
    await page.keyboard.press("Escape");
    await expect(undoOptOutDialog).toHaveCount(0);
    await undoOptOut.click();
    await undoOptOutDialog
      .getByRole("button", { name: "Undo opt-out", exact: true })
      .click();
    await expect(optedOut).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          (waId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47053 &&
                body.action === "opt_out_undo" &&
                body.waId === waId,
            ) ?? false,
          QUIET_OWL_WA_ID,
        ),
      )
      .toBe(true);

    await page.getByRole("tab", { name: "All", exact: true }).click();
    await page.getByTestId(`whatsapp-contact-${CORNER_COTTAGE_WA_ID}`).click();
    await expect(
      page.getByText(
        "Automatic outreach is stopped for everyone at this business.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("whatsapp-reply-input")).toBeDisabled();

    await page.getByTestId("whatsapp-settings-trigger").click();
    const settings = page.getByTestId("whatsapp-settings");
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Safety", exact: true }).click();
    await expect(
      settings.getByText("What counts as an opt-out?"),
    ).toBeVisible();
    await expect(settings.getByText("Whole-business stop")).toBeVisible();
    await expect(settings.getByText("Auto-stop")).toBeVisible();
    await settings.getByRole("button", { name: "Manage list" }).click();
    await settings
      .getByLabel("Never-contact phone number")
      .fill("+27 82 444 0001");
    await settings
      .getByLabel("Never-contact reason")
      .fill("Owner requested no contact");
    await settings.getByRole("button", { name: "Add to list" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47053 &&
                body.action === "never_contact_add" &&
                body.waId === "+27 82 444 0001" &&
                body.reason === "Owner requested no contact",
            ) ?? false,
        ),
      )
      .toBe(true);
    await captureSafetyShot(page, "WAMain-safety.png");
  });

  test("keeps existing Outreach usable when an older relay lacks safety fields", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      deskFixture: true,
      outreachSafetyUnsupported: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);
    await page.getByTestId("channel-view-tab-chats").click();
    await page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`).click();
    await expect(page.getByTestId("whatsapp-reply-input")).toBeEnabled();
    await page.getByTestId("whatsapp-settings-trigger").click();
    await expect(
      page.getByText(
        "Safety details need a current relay. Existing sending controls remain available.",
      ),
    ).toBeVisible();
  });

  test("requires confirmation before marking an unknown send delivered", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      deskFixture: true,
      outreachSafetyFixture: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);

    const unknownSend = page.getByTestId(
      "outreach-unknown-send-e2e-wa-unknown-send",
    );
    const markDelivered = page.getByTestId(
      "whatsapp-unknown-send-delivered-e2e-wa-unknown-send",
    );
    await markDelivered.focus();
    await page.keyboard.press("Enter");
    const deliveredDialog = page.getByTestId(
      "whatsapp-unknown-send-delivered-e2e-wa-unknown-send-dialog",
    );
    await expect(deliveredDialog).toContainText("Mark this message delivered?");
    await page.keyboard.press("Escape");
    await expect(deliveredDialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47054 && body.action === "mark_delivered",
            ) ?? false,
        ),
      )
      .toBe(false);

    await markDelivered.click();
    await deliveredDialog
      .getByRole("button", { name: "Mark delivered", exact: true })
      .click();
    await expect(unknownSend).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
              ({ kind, body }) =>
                kind === 47054 &&
                body.action === "mark_delivered" &&
                body.confirm === true,
            ) ?? false,
        ),
      )
      .toBe(true);
  });

  test("plain members have no stage or rename controls", async ({ page }) => {
    await installWhatsAppMockBridge(page, "light", {
      deskFixture: true,
      outreachChannelMember: false,
      relayRole: "member",
      paymentRetryCount: 63,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);
    await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
    await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible();
    await expect(page.getByTestId("whatsapp-send-health-banner")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("outreach-needs-send-health")).toHaveCount(0);
    await expect(page.getByTestId("whatsapp-resume-retry-trigger")).toHaveCount(
      0,
    );
    await page.getByTestId("channel-view-tab-pipeline").click();
    await expect(
      page.getByTestId(`outreach-move-${JACARANDA_WA_ID}`),
    ).toHaveCount(0);
    await page.getByTestId("channel-view-tab-chats").click();
    await page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();
    await expect(page.getByTestId("whatsapp-rename-contact")).toHaveCount(0);
    const refusal = await page.evaluate(async (waId) => {
      const event = window as WhatsAppEventWindow;
      return event.__BUZZ_E2E_WHATSAPP__?.({
        action: "command",
        kind: 47052,
        body: { waId, stage: "quote_sent" },
      });
    }, JACARANDA_WA_ID);
    await expect
      .poll(() =>
        page.evaluate(
          (waId) =>
            (
              window as WhatsAppEventWindow
            ).__BUZZ_E2E_WHATSAPP_STATE__?.contacts.find(
              (contact) => contact.waId === waId,
            )?.stage,
          JACARANDA_WA_ID,
        ),
      )
      .toBe("contacted");
    expect(refusal).toEqual({
      message:
        "only the owner, admins, their agents and Outreach members can change a contact's stage or name",
    });
  });

  test("Discussion folds WhatsApp activity and removes pending batch notices", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", { deskFixture: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOutreachFromHome(page);
    const root = await emitOutreachEvent(page, {
      content: "WhatsApp number connected.",
      tags: [["wa-notice", "connected"]],
    });
    await emitOutreachEvent(page, {
      content: "A batch is waiting for approval.",
      tags: [
        ["wa-notice", "batch_pending"],
        ["wa-batch", "e2e-whatsapp-batch"],
      ],
    });
    await emitOutreachEvent(page, {
      content: "Batch sent. Three guesthouses messaged.",
      tags: [
        ["wa-notice", "batch_completed"],
        ["wa-batch", "e2e-whatsapp-batch"],
      ],
    });
    await emitOutreachEvent(page, {
      content: "WhatsApp: Corner Cottage Parkhurst (+27 72 555 1188)",
      tags: [
        ["wa", CORNER_COTTAGE_WA_ID],
        ["wa-name", "Corner Cottage Parkhurst"],
      ],
    });
    await emitOutreachEvent(page, { content: "A normal team note." });

    await page.getByTestId("channel-view-tab-discussion").click();
    const activity = page.getByTestId("whatsapp-discussion-activity");
    await expect(activity).toContainText("3 updates");
    await expect(activity).toContainText("Number connected");
    await expect(activity).toContainText("Batch sent");
    await expect(activity).toContainText("Corner Cottage Parkhurst");
    await expect(page.getByText("A normal team note.")).toBeVisible();
    await expect(
      page.getByText("A batch is waiting for approval."),
    ).toHaveCount(0);
    await activity.locator("summary").click();
    await expect(
      activity.getByRole("button", { name: "Open chat", exact: true }),
    ).toBeVisible();
    expect(root.id).toBeTruthy();
  });
});
