import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  gotoWhatsAppScreen,
  installWhatsAppMockBridge,
  OUTREACH_CHANNEL_ID,
  WHATSAPP_DECIDED_BATCH_ID,
} from "../helpers/whatsappOutreach";
import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";

type EventWindow = Window & {
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
};

const viewportCases = [
  { label: "1000x650", width: 1000, height: 650 },
  { label: "1440x900", width: 1440, height: 900 },
  { label: "390x844", width: 390, height: 844 },
] as const;

async function openApprovedOutreachWithDock(
  page: Page,
  theme: "light" | "dark",
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await installWhatsAppMockBridge(page, theme, {
    batchVariant: "decided-card-approved",
  });
  if (viewport.width < 600) {
    await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("home-inbox")).toBeVisible();
    await page.getByTestId("channel-Outreach").click();
  }
  await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as EventWindow).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "Outreach",
          }) ?? false,
      ),
    )
    .toBe(true);
  const event = await page.evaluate(
    ({ batchId, scoutPubkey }) =>
      (window as EventWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Outreach",
        content: `Scout prepared batch ${batchId} using hl_new_site. Nothing is sent until the owner or an admin approves it.`,
        pubkey: scoutPubkey,
        kind: 9,
        extraTags: [["wa-notice", "batch_pending"]],
        createdAt: Math.floor(Date.now() / 1000),
      }),
    {
      batchId: WHATSAPP_DECIDED_BATCH_ID,
      scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
    },
  );
  if (!event) throw new Error("Mock approved batch notice was not emitted");

  const approvedCard = page.getByTestId("whatsapp-channel-batch-approved");
  await expect(approvedCard).toBeVisible();
  await expect(approvedCard).toContainText("Sends tomorrow at 08:00");
  await expect(
    approvedCard.getByRole("button", { name: "Send now (test)" }),
  ).toBeVisible();

  if (viewport.width < 600) {
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
    await page
      .getByRole("button", { name: "WhatsApp chats", exact: true })
      .click();
  }
  await expect(page.getByTestId("work-area-panel")).toBeVisible();
  await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
  return approvedCard;
}

async function captureOwnerView(
  browser: Browser,
  theme: "light" | "dark",
  viewport: (typeof viewportCases)[number],
  artifactDir: string,
) {
  const context = await browser.newContext({
    colorScheme: theme,
    viewport: { width: viewport.width, height: viewport.height },
  });
  try {
    const page = await context.newPage();
    await openApprovedOutreachWithDock(page, theme, viewport);
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(
        artifactDir,
        `wa-dock-narrow-${viewport.label}-${theme}.png`,
      ),
    });
  } finally {
    await context.close();
  }
}

test.use({ video: "off" });

test.describe("WhatsApp dock narrow layout", () => {
  test("channel content and actions stay reachable beside the dock at owner size", async ({
    page,
  }) => {
    const approvedCard = await openApprovedOutreachWithDock(page, "light", {
      width: 1000,
      height: 650,
    });
    const dock = page.getByTestId("work-area-panel");
    const dockBox = await dock.boundingBox();
    expect(dockBox).not.toBeNull();
    if (!dockBox) throw new Error("WhatsApp dock has no rendered bounds");

    const visibleCards = await page
      .locator('[data-testid^="whatsapp-channel-batch-"]')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              right: rect.right,
              testId: element.getAttribute("data-testid"),
            };
          }),
      );
    expect(visibleCards.length).toBeGreaterThan(0);
    for (const card of visibleCards) {
      expect(
        card.right,
        `${card.testId} must stop before the dock`,
      ).toBeLessThanOrEqual(dockBox.x);
    }

    const layout = page.getByTestId("work-area-layout");
    const layoutBox = await layout.boundingBox();
    expect(layoutBox).not.toBeNull();
    if (!layoutBox) throw new Error("Work area layout has no bounds");
    await expect(layout).toHaveAttribute("data-overlay", "false");
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(
      layoutBox.x + layoutBox.width,
    );

    const conversation = page.getByTestId("work-area-conversation");
    const conversationBox = await conversation.boundingBox();
    const composer = page.getByTestId("message-composer");
    const editor = composer.locator('[contenteditable="true"]').first();
    const sendButton = page.getByTestId("send-message");
    expect(conversationBox).not.toBeNull();
    if (!conversationBox) throw new Error("Channel column has no bounds");
    await expect(editor).toBeVisible();
    await editor.fill("Dock width proof");
    await expect(sendButton).toBeEnabled();
    const sendBox = await sendButton.boundingBox();
    expect(sendBox).not.toBeNull();
    if (!sendBox) throw new Error("Composer send button has no bounds");
    expect(sendBox.x).toBeGreaterThanOrEqual(conversationBox.x);
    expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(dockBox.x);
    await sendButton.click();

    const tabs = page.getByRole("navigation", { name: "Channel views" });
    const tabNames = ["Discussion", "Knowledge", "Canvas", "Files"];
    for (const name of tabNames) {
      const tab = tabs.getByText(name, { exact: true });
      await tab.scrollIntoViewIfNeeded();
      const [tabBox, tabsBox] = await Promise.all([
        tab.boundingBox(),
        tabs.boundingBox(),
      ]);
      expect(tabBox, `${name} tab has bounds`).not.toBeNull();
      expect(tabsBox, "channel tabs have bounds").not.toBeNull();
      if (!tabBox || !tabsBox) throw new Error(`${name} tab is not rendered`);
      expect(tabBox.x).toBeGreaterThanOrEqual(tabsBox.x - 1);
      expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(
        tabsBox.x + tabsBox.width + 1,
      );
    }

    const whatsAppButton = page.getByRole("button", {
      name: "WhatsApp chats",
      exact: true,
    });
    const workAreaButton = page.getByRole("button", { name: "Open work area" });
    const headerActions = [
      whatsAppButton,
      workAreaButton,
      page.getByTestId("channel-search-trigger"),
      page.getByTestId("channel-management-trigger"),
    ];
    for (const button of headerActions) {
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error("Channel action button has no bounds");
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(dockBox.x);
    }

    await workAreaButton.click();
    await expect(dock).toHaveCount(0);
    await workAreaButton.press("Enter");
    await expect(dock).toBeVisible();
    await whatsAppButton.press("Enter");
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await expect(approvedCard).toBeVisible();
  });

  test("captures the owner view at every requested size and theme", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const artifactDir = resolve(
      process.env.WA_DOCK_NARROW_SCREENSHOT_DIR ??
        "test-results/wa-dock-narrow",
    );
    mkdirSync(artifactDir, { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      for (const viewport of viewportCases.filter((size) =>
        process.env.WA_DOCK_NARROW_CAPTURE_ONLY
          ? size.label === process.env.WA_DOCK_NARROW_CAPTURE_ONLY
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
