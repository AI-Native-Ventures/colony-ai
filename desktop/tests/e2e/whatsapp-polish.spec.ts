import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  gotoWhatsAppScreen,
  installWhatsAppMockBridge,
  OUTREACH_CHANNEL_ID,
} from "../helpers/whatsappOutreach";

const UNNAMED_WA_ID = "27683735905";
const UNNAMED_NUMBER = "+27 68 373 5905";

type MockBatch = {
  batchId: string;
  status: string;
  template: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  rows: Array<Record<string, unknown>>;
  counts: Record<string, number>;
};

type MockContact = {
  waId: string;
  e164: string;
  displayName: string;
  leadId: null;
  ownerPubkey: null;
  threadRootEventId: string;
  lastInboundAt: string;
  windowOpen: true;
  windowClosesAt: string;
  optedOut: false;
  paused: false;
  pauseReason: null;
  unanswered: true;
  awaitingApproval: false;
};

type MockState = {
  batch: MockBatch;
  secondPendingBatch: MockBatch;
  contacts: MockContact[];
  threads: Record<
    string,
    { contact: MockContact; messages: Array<Record<string, unknown>> }
  >;
};

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
    extraTags?: string[][];
    createdAt?: number;
  }) => MockMessageEvent;
  __BUZZ_E2E_WHATSAPP_STATE__?: unknown;
};

async function installPolishFixture(
  page: Page,
  theme: "light" | "dark",
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await installWhatsAppMockBridge(page, theme);
  await page.addInitScript((waId) => {
    type MutableBatch = {
      batchId: string;
      status: string;
      template: string;
      decidedBy: string | null;
      decidedAt: string | null;
      createdAt: string;
      rows: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    };
    type MutableContact = {
      waId: string;
      e164: string;
      displayName: string;
      leadId: null;
      ownerPubkey: null;
      threadRootEventId: string;
      lastInboundAt: string;
      windowOpen: true;
      windowClosesAt: string;
      optedOut: false;
      paused: false;
      pauseReason: null;
      unanswered: true;
      awaitingApproval: false;
    };
    type MutableState = {
      batch: MutableBatch;
      secondPendingBatch: MutableBatch;
      contacts: MutableContact[];
      threads: Record<
        string,
        { contact: MutableContact; messages: Array<Record<string, unknown>> }
      >;
    };
    const e164 = "+27683735905";
    const contact: MutableContact = {
      waId,
      e164,
      displayName: e164,
      leadId: null,
      ownerPubkey: null,
      threadRootEventId: "e2e-whatsapp-thread-unnamed-contact",
      lastInboundAt: "2026-10-30T09:14:00+02:00",
      windowOpen: true,
      windowClosesAt: "2026-10-31T09:14:00+02:00",
      optedOut: false,
      paused: false,
      pauseReason: null,
      unanswered: true,
      awaitingApproval: false,
    };
    const state = (
      window as Window & {
        __BUZZ_E2E_WHATSAPP_STATE__?: unknown;
      }
    ).__BUZZ_E2E_WHATSAPP_STATE__ as MutableState | undefined;
    if (!state) throw new Error("Mock WhatsApp state is missing");
    state.contacts.unshift(contact);
    const firstRow = state.batch.rows[0] ?? {};
    state.batch.batchId = "wa-polish-first-rejected-20261031";
    state.batch.status = "rejected";
    state.batch.template = "hl_vb";
    state.batch.decidedBy = "deadbeef".repeat(8);
    state.batch.decidedAt = "2026-10-30T10:30:00+02:00";
    state.batch.rows = [{ ...firstRow, idx: 0, to: e164, leadId: null }];
    state.batch.counts = {
      total: 2,
      ready: 0,
      sent: 0,
      failed: 0,
      dropped: 2,
    };
    const secondRow = state.secondPendingBatch.rows[0] ?? firstRow;
    state.secondPendingBatch.batchId = "wa-polish-second-rejected-20261031";
    state.secondPendingBatch.status = "rejected";
    state.secondPendingBatch.template = "hl_hs_v1";
    state.secondPendingBatch.decidedBy = "deadbeef".repeat(8);
    state.secondPendingBatch.decidedAt = "2026-10-30T11:45:00+02:00";
    state.secondPendingBatch.rows = [
      { ...secondRow, idx: 0, to: e164, leadId: null },
    ];
    state.secondPendingBatch.counts = {
      total: 4,
      ready: 0,
      sent: 0,
      failed: 0,
      dropped: 4,
    };
    state.threads[waId] = {
      contact,
      messages: [
        {
          id: "e2e-wa-unnamed-template",
          waId,
          direction: "out",
          kind: "template",
          text: "Hi, your new website is ready to review.",
          templateName: "hl_vb",
          state: "sent",
          errorCode: null,
          errorText: null,
          eventId: "e2e-wa-unnamed-template-event",
          senderPubkey: "deadbeef".repeat(8),
          createdAt: "2026-10-30T09:10:00+02:00",
        },
        {
          id: "e2e-wa-unnamed-reply",
          waId,
          direction: "in",
          kind: "button",
          text: "Yes, call me",
          templateName: null,
          state: "read",
          errorCode: null,
          errorText: null,
          eventId: "e2e-wa-unnamed-reply-event",
          senderPubkey: null,
          createdAt: "2026-10-30T09:14:00+02:00",
        },
      ],
    };
  }, UNNAMED_WA_ID);
}

async function openOutreachWithDock(page: Page, width: number) {
  if (width < 600) {
    await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("home-inbox")).toBeVisible();
    await page.getByTestId("channel-Outreach").click();
  }
  await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
  if (width < 600) {
    const opened = await page.evaluate(() => {
      const trigger = document.querySelector<HTMLButtonElement>(
        '[data-testid="channel-whatsapp-chats-trigger"]',
      );
      if (!trigger) return false;
      trigger.click();
      return true;
    });
    expect(opened).toBe(true);
  } else {
    await page.getByTestId("channel-whatsapp-chats-trigger").click();
  }
  await expect(page.getByTestId("work-area-panel")).toBeVisible();
  await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
}

async function emitRejectedBatchNotice(page: Page, index: 0 | 1) {
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
  const event = await page.evaluate((batchIndex) => {
    const state = (
      window as Window & {
        __BUZZ_E2E_WHATSAPP_STATE__?: unknown;
      }
    ).__BUZZ_E2E_WHATSAPP_STATE__ as MockState | undefined;
    const batch = batchIndex === 0 ? state?.batch : state?.secondPendingBatch;
    if (!batch) throw new Error("Mock WhatsApp batch is missing");
    return (window as WhatsAppEventWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "Outreach",
      content: `Scout prepared batch ${batch.batchId} using ${batch.template}.`,
      pubkey: "deadbeef".repeat(8),
      kind: 9,
      extraTags: [["wa-notice", "batch_pending"]],
      createdAt: Math.floor(Date.now() / 1000) + batchIndex,
    });
  }, index);
  if (!event) throw new Error("Mock WhatsApp notice was not emitted");
  await expect(page.getByTestId("whatsapp-channel-batch-rejected")).toHaveCount(
    index + 1,
  );
}

async function prepareOwnerView(
  page: Page,
  theme: "light" | "dark",
  viewport: { width: number; height: number },
) {
  await installPolishFixture(page, theme, viewport);
  await openOutreachWithDock(page, viewport.width);
  if (viewport.width >= 600) {
    await emitRejectedBatchNotice(page, 0);
    await emitRejectedBatchNotice(page, 1);
    await expect(
      page.getByTestId("whatsapp-channel-batch-rejected"),
    ).toHaveCount(2);
  }
  if (viewport.width >= 600) {
    const workAreaBounds = await page
      .getByTestId("work-area-panel")
      .boundingBox();
    if (workAreaBounds && workAreaBounds.width <= 768) {
      await page
        .getByRole("button", { name: "Back to WhatsApp contacts" })
        .click();
    }
    await page.getByTestId(`whatsapp-contact-${UNNAMED_WA_ID}`).click();
  }
  const threadHeader = page.locator(".c3wa-thread-head");
  await expect(threadHeader).toBeVisible();
  await expect(threadHeader).toContainText(UNNAMED_NUMBER);
}

async function captureOwnerView(
  browser: Browser,
  theme: "light" | "dark",
  viewport: { width: number; height: number; label: string },
  artifactDir: string,
) {
  const context = await browser.newContext({
    colorScheme: theme,
    viewport: { width: viewport.width, height: viewport.height },
  });
  try {
    const page = await context.newPage();
    await prepareOwnerView(page, theme, viewport);
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(artifactDir, `wa-polish-${viewport.label}-${theme}.png`),
    });
  } finally {
    await context.close();
  }
}

test.describe("WhatsApp owner view polish", () => {
  test("header, contact identity, and rejected batch summaries stay distinct at owner size", async ({
    page,
  }) => {
    await prepareOwnerView(page, "light", { width: 1000, height: 650 });

    const tabs = await page.getByTestId("channel-view-tabs").boundingBox();
    expect(tabs).not.toBeNull();
    if (!tabs) throw new Error("Channel tabs have no rendered bounds");
    const actionBoxes = await page
      .locator(".c3c-header-actions button")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
    expect(actionBoxes.length).toBeGreaterThan(0);
    for (const box of actionBoxes) {
      const separatedHorizontally =
        box.x + box.width <= tabs.x || box.x >= tabs.x + tabs.width;
      const separatedVertically =
        box.y + box.height <= tabs.y || box.y >= tabs.y + tabs.height;
      expect(separatedHorizontally || separatedVertically).toBe(true);
    }

    const workArea = await page.getByTestId("work-area-panel").boundingBox();
    const threadHeaderBox = await page
      .locator(".c3wa-thread-head")
      .boundingBox();
    expect(workArea).not.toBeNull();
    expect(threadHeaderBox).not.toBeNull();
    if (!workArea || !threadHeaderBox) {
      throw new Error(
        "WhatsApp thread is missing its visible work area bounds",
      );
    }
    expect(threadHeaderBox.x).toBeGreaterThanOrEqual(workArea.x);
    expect(threadHeaderBox.x + threadHeaderBox.width).toBeLessThanOrEqual(
      workArea.x + workArea.width,
    );

    const badge = page.getByTestId("channel-whatsapp-unread-count");
    await expect(badge).toBeVisible();
    const badgeBox = await badge.boundingBox();
    expect(badgeBox).not.toBeNull();
    if (!badgeBox) throw new Error("WhatsApp unread badge has no bounds");
    const tabLabelBoxes = await page.locator(".c3c-tab").evaluateAll((tabs) =>
      tabs.map((tab) => {
        const range = document.createRange();
        range.selectNodeContents(tab);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    for (const label of tabLabelBoxes) {
      const intersects =
        badgeBox.x < label.x + label.width &&
        badgeBox.x + badgeBox.width > label.x &&
        badgeBox.y < label.y + label.height &&
        badgeBox.y + badgeBox.height > label.y;
      expect(intersects).toBe(false);
    }

    const threadHeader = page.locator(".c3wa-thread-head");
    const threadHeaderText = (await threadHeader.innerText()).replace(
      /\s+/gu,
      " ",
    );
    expect(threadHeaderText.split(UNNAMED_NUMBER)).toHaveLength(2);
    await expect(
      page
        .getByTestId(`whatsapp-contact-${UNNAMED_WA_ID}`)
        .locator(".c3wa-contact-avatar svg"),
    ).toHaveCount(1);
    await expect(threadHeader.locator(".c3wa-thread-avatar svg")).toHaveCount(
      1,
    );
    await expect(
      page
        .getByTestId("whatsapp-message-e2e-wa-unnamed-reply")
        .locator(".c3wa-message-avatar svg"),
    ).toHaveCount(1);

    const contactRow = page.getByTestId(`whatsapp-contact-${UNNAMED_WA_ID}`);
    const secondLine = contactRow.locator(".c3wa-contact-subtitle");
    await expect(secondLine).toContainText("Replied");
    await expect(secondLine).toContainText("Yes, call me");
    await expect(secondLine).not.toContainText("27683735905");
    await expect(secondLine).not.toContainText("68 373 5905");

    const cards = page.getByTestId("whatsapp-channel-batch-rejected");
    const firstCardText = await cards.nth(0).innerText();
    const secondCardText = await cards.nth(1).innerText();
    expect(firstCardText).not.toBe(secondCardText);
    await expect(cards.nth(0)).toContainText("Built a site for you");
    await expect(cards.nth(0)).toContainText("Basheer Phiri");
    await expect(cards.nth(0)).toContainText("2 messages");
    await expect(cards.nth(1)).toContainText("4 messages");

    const templateMarker = page.locator(
      '[data-testid="work-area-panel"] .c3wa-template-marker',
    );
    await expect(templateMarker).toHaveText("Template: Built a site for you");
    await page
      .getByRole("button", { name: "Back to WhatsApp contacts" })
      .click();
    const settingsButton = page.getByRole("button", {
      name: "WhatsApp settings",
    });
    await expect(settingsButton).toHaveAttribute("title", "WhatsApp settings");
    await settingsButton.hover();
    await expect(page.getByRole("tooltip")).toHaveText("WhatsApp settings");

    await contactRow.click();
    const replyLine = page
      .getByTestId("whatsapp-message-e2e-wa-unnamed-reply")
      .locator(".c3wa-button-reply p");
    const [replyLineBox, replyGlyphBox] = await Promise.all([
      replyLine.boundingBox(),
      replyLine.locator("span").boundingBox(),
    ]);
    expect(replyLineBox).not.toBeNull();
    expect(replyGlyphBox).not.toBeNull();
    if (!replyLineBox || !replyGlyphBox) {
      throw new Error("Reply text or glyph has no rendered bounds");
    }
    expect(
      Math.abs(
        replyLineBox.y +
          replyLineBox.height / 2 -
          (replyGlyphBox.y + replyGlyphBox.height / 2),
      ),
    ).toBeLessThan(2);
  });

  test("captures the owner view at all requested sizes and themes", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const artifactDir = resolve(
      process.env.WA_POLISH_SCREENSHOT_DIR ?? "test-results/wa-polish",
    );
    mkdirSync(artifactDir, { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      for (const viewport of [
        { label: "1000x650", width: 1000, height: 650 },
        { label: "1440x900", width: 1440, height: 900 },
        { label: "390x844", width: 390, height: 844 },
      ].filter((size) =>
        process.env.WA_POLISH_CAPTURE_ONLY
          ? size.label === process.env.WA_POLISH_CAPTURE_ONLY
          : true,
      )) {
        await captureOwnerView(browser, theme, viewport, artifactDir);
      }
    }
    testInfo.annotations.push({
      type: "artifact-dir",
      description: artifactDir,
    });
  });
});
