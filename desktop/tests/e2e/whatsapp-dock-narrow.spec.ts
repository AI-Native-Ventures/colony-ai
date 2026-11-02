import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  gotoWhatsAppScreen,
  installWhatsAppMockBridge,
  WHATSAPP_DECIDED_BATCH_ID,
} from "../helpers/whatsappOutreach";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";

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

const headerViewportCases = [
  { label: "2000x1100", width: 2000, height: 1100, workAreaOpen: false },
  { label: "1440x900", width: 1440, height: 900, workAreaOpen: false },
  { label: "1000x650", width: 1000, height: 650, workAreaOpen: true },
  { label: "390x844", width: 390, height: 844, workAreaOpen: true },
] as const;

async function openSocketWelcomeHeader(
  page: Page,
  theme: "light" | "dark",
  viewport: (typeof headerViewportCases)[number],
) {
  await page.setViewportSize(viewport);
  await installWhatsAppMockBridge(page, theme, { workspaceName: "Socket" });

  if (viewport.width < 600) {
    await gotoWhatsAppScreen(
      page,
      `/channels/${REFERENCE_CHANNEL_IDS.welcome}`,
    );
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("home-inbox")).toBeVisible();
    await expect(page.getByTestId("channel-Welcome")).toBeVisible();
    await page.getByTestId("channel-Welcome").click();
  }

  await expect(page.getByTestId("chat-title")).toContainText("Welcome");
  await expect(page.locator("body")).toContainText("Socket");

  const whatsAppButton = page.getByTestId("channel-whatsapp-chats-trigger");
  await whatsAppButton.click();
  const panel = page.getByTestId("work-area-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
  const badge = page.getByTestId("channel-whatsapp-unread-count");
  await expect(badge).toBeVisible();

  if (!viewport.workAreaOpen) {
    await page.getByTestId("channel-work-area-trigger").click();
    await expect(panel).toHaveCount(0);
    await expect(badge).toBeVisible();
  }
}

async function openApprovedChannelWithDock(
  page: Page,
  theme: "light" | "dark",
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await installWhatsAppMockBridge(page, theme, {
    batchVariant: "decided-card-approved",
  });
  if (viewport.width < 600) {
    await gotoWhatsAppScreen(page, `/channels/${REFERENCE_CHANNEL_IDS.sales}`);
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("home-inbox")).toBeVisible();
    await page.getByTestId("channel-Sales").click();
  }
  await expect(page.getByTestId("chat-title")).toHaveText("Sales");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as EventWindow).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "Sales",
          }) ?? false,
      ),
    )
    .toBe(true);
  const event = await page.evaluate(
    ({ batchId, scoutPubkey }) =>
      (window as EventWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Sales",
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
    await openApprovedChannelWithDock(page, theme, viewport);
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
    const approvedCard = await openApprovedChannelWithDock(page, "light", {
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
    await sendButton.click();
    await expect(
      page.getByText("Dock width proof", { exact: true }),
    ).toBeVisible();
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

  test("whatsapp header keeps the label and unread badge inside the action at every requested width", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const artifactDir = resolve(
      process.env.HEADER_WA_BUTTON_SCREENSHOT_DIR ??
        "output/playwright/header-wa-button",
    );
    mkdirSync(artifactDir, { recursive: true });

    for (const theme of ["light", "dark"] as const) {
      for (const viewport of headerViewportCases) {
        const context = await browser.newContext({
          colorScheme: theme,
          viewport: { width: viewport.width, height: viewport.height },
        });
        try {
          const page = await context.newPage();
          await openSocketWelcomeHeader(page, theme, viewport);

          const geometry = await page.evaluate(() => {
            const rect = (element: Element | null) => {
              if (!element) return null;
              const box = element.getBoundingClientRect();
              return {
                x: box.x,
                y: box.y,
                right: box.right,
                bottom: box.bottom,
                width: box.width,
                height: box.height,
              };
            };
            const button = document.querySelector(
              '[data-testid="channel-whatsapp-chats-trigger"]',
            );
            const icon = button?.querySelector("svg") ?? null;
            const label =
              button?.querySelector(".c3c-header-action-label") ?? null;
            const badge =
              button?.querySelector(
                '[data-testid="channel-whatsapp-unread-count"]',
              ) ?? null;
            const actions = Array.from(
              document.querySelectorAll<HTMLButtonElement>(
                ".c3c-header-actions button",
              ),
            )
              .map((action) => ({
                name:
                  action.getAttribute("aria-label") ??
                  action.getAttribute("data-testid") ??
                  action.textContent?.trim() ??
                  "header action",
                box: rect(action),
              }))
              .filter((action) => action.box !== null);

            return {
              button: rect(button),
              icon: rect(icon),
              label: rect(label),
              badge: rect(badge),
              labelDisplay: label ? getComputedStyle(label).display : null,
              buttonDisplay: button ? getComputedStyle(button).display : null,
              actions,
            };
          });

          expect(geometry.button, "WhatsApp action has bounds").not.toBeNull();
          expect(geometry.icon, "WhatsApp icon has bounds").not.toBeNull();
          expect(geometry.label, "WhatsApp label has bounds").not.toBeNull();
          expect(
            geometry.badge,
            "WhatsApp unread badge has bounds",
          ).not.toBeNull();
          if (
            !geometry.button ||
            !geometry.icon ||
            !geometry.label ||
            !geometry.badge
          ) {
            throw new Error("WhatsApp header action is missing visual bounds");
          }

          if (!viewport.workAreaOpen) {
            expect(geometry.labelDisplay).not.toBe("none");
            expect(
              Math.abs(
                geometry.icon.y +
                  geometry.icon.height / 2 -
                  (geometry.label.y + geometry.label.height / 2),
              ),
              "WhatsApp label shares a row with its icon",
            ).toBeLessThanOrEqual(1);
            expect(geometry.label.x).toBeGreaterThanOrEqual(
              geometry.icon.right,
            );
            expect(geometry.buttonDisplay).toBe("flex");
          } else {
            expect(geometry.labelDisplay).toBe("none");
          }

          for (const part of [geometry.icon, geometry.label]) {
            if (geometry.labelDisplay === "none" && part === geometry.label) {
              continue;
            }
            expect(part.x).toBeGreaterThanOrEqual(geometry.button.x - 1);
            expect(part.right).toBeLessThanOrEqual(geometry.button.right + 1);
            expect(part.y).toBeGreaterThanOrEqual(geometry.button.y - 1);
            expect(part.bottom).toBeLessThanOrEqual(geometry.button.bottom + 1);
          }

          expect(geometry.badge.x).toBeGreaterThan(geometry.icon.x);
          expect(geometry.badge.x).toBeLessThan(geometry.icon.right);
          expect(geometry.badge.y).toBeLessThan(
            geometry.icon.y + geometry.icon.height / 2,
          );
          expect(geometry.badge.right).toBeGreaterThan(geometry.icon.right);
          if (geometry.labelDisplay !== "none") {
            expect(geometry.badge.right).toBeLessThanOrEqual(geometry.label.x);
          }

          const actions = geometry.actions
            .filter((action) => action.box !== null)
            .sort((left, right) => (left.box?.x ?? 0) - (right.box?.x ?? 0));
          for (let index = 1; index < actions.length; index += 1) {
            const previous = actions[index - 1];
            const current = actions[index];
            if (!previous?.box || !current?.box) continue;
            const horizontalOverlap =
              Math.min(previous.box.right, current.box.right) -
              Math.max(previous.box.x, current.box.x);
            const verticalOverlap =
              Math.min(previous.box.bottom, current.box.bottom) -
              Math.max(previous.box.y, current.box.y);
            expect(
              horizontalOverlap > 1 && verticalOverlap > 1,
              `${previous.name} overlaps ${current.name}`,
            ).toBe(false);
          }

          await waitForAnimations(page);
          await page.screenshot({
            path: resolve(
              artifactDir,
              `header-wa-button-${viewport.label}-${theme}.png`,
            ),
          });
        } finally {
          await context.close();
        }
      }
    }

    testInfo.annotations.push({
      type: "artifact-dir",
      description: artifactDir,
    });
  });
});
