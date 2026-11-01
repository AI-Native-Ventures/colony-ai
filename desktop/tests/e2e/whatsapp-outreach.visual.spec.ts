import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  JACARANDA_WA_ID,
  PLANE_TREE_LEAD_ID,
  PLANE_TREE_WA_ID,
  OUTREACH_CHANNEL_ID,
  WHATSAPP_BATCH_ID,
  installWhatsAppMockBridge,
  gotoWhatsAppScreen,
} from "../helpers/whatsappOutreach";
import { waitForAnimations } from "../helpers/animations";

const proofDirectory =
  process.env.WA_PROOF_DIR ?? "/private/tmp/colony-whatsapp-outreach-proof";
const screens = [
  {
    name: "Main",
    route: "/settings?section=whatsapp",
    testId: "whatsapp-settings",
  },
  {
    name: "WhatsAppConnect",
    route: "/settings?section=whatsapp",
    query: "whatsapp=disconnected",
    testId: "whatsapp-connect-form",
  },
  {
    name: "OutreachBatch",
    route: `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
    query: "batch=visual",
    testId: "whatsapp-batch-page",
  },
  {
    name: "OutreachBatchSent",
    route: `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
    query: "batch=approved",
    testId: "whatsapp-batch-page",
  },
  {
    name: "SendNowBatch",
    route: `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
    query: "batch=send-now",
    testId: "whatsapp-batch-page",
  },
  {
    name: "Outreach",
    route: `/channels/${OUTREACH_CHANNEL_ID}`,
    testId: "whatsapp-outreach",
  },
  {
    name: "WhatsAppDock",
    route: "/channels/e2e-whatsapp-general-channel",
    query: "batch=held",
    testId: "whatsapp-outreach",
  },
  {
    name: "WhatsAppDockSendNow",
    route: "/channels/e2e-whatsapp-general-channel",
    query: "batch=send-now",
    testId: "whatsapp-outreach",
  },
  {
    name: "LeadWhatsApp",
    route: `/sales/lead/${PLANE_TREE_LEAD_ID}`,
    testId: "w10-prospect-page",
  },
  {
    name: "LeadsWhatsApp",
    route: "/leads",
    query: "batch=leads",
    testId: "w10-leads-page",
  },
] as const;
const requestedScreens = new Set(
  (process.env.WA_VISUAL_FOCUS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
const visualScreens = requestedScreens.size
  ? screens.filter((screen) => requestedScreens.has(screen.name))
  : screens;

test("captures WhatsApp screens at phone and desktop widths in light and dark themes", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  await mkdir(proofDirectory, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await installWhatsAppMockBridge(page, theme);
      for (const width of [390, 1440] as const) {
        for (const screen of visualScreens) {
          const height =
            width === 390
              ? 844
              : screen.name === "Main"
                ? 2670
                : screen.name === "Outreach"
                  ? 1650
                  : screen.name === "OutreachBatch"
                    ? 1480
                    : screen.name === "OutreachBatchSent"
                      ? 1510
                      : screen.name === "WhatsAppDock" ||
                          screen.name === "WhatsAppDockSendNow"
                        ? 1040
                        : screen.name === "LeadWhatsApp" ||
                            screen.name === "LeadsWhatsApp"
                          ? 1240
                          : 1040;
          await page.setViewportSize({ width, height });
          await page.emulateMedia({ colorScheme: theme });
          await gotoWhatsAppScreen(page, screen.route, screen.query);
          const target = page.getByTestId(screen.testId);
          if (screen.name === "Outreach") {
            await page.getByTestId("channel-view-tab-chats").click();
            await page
              .getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`)
              .click();
          }
          if (
            screen.name === "WhatsAppDock" ||
            screen.name === "WhatsAppDockSendNow"
          ) {
            await page.getByTestId("channel-whatsapp-chats-trigger").click();
            await expect(page.getByTestId("work-area-panel")).toBeVisible();
            if (width === 390) {
              await page
                .getByRole("button", { name: "Back to WhatsApp contacts" })
                .click();
            }
            await page
              .getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`)
              .click();
            if (screen.name === "WhatsAppDockSendNow") {
              const queued = page.getByTestId(
                "whatsapp-message-e2e-wa-jacaranda-held-template",
              );
              await expect(queued).toContainText(
                /Sends (today at \d{2}:\d{2}|tomorrow at 08:00)/u,
              );
              const sendNowButton = queued.getByRole("button", {
                name: "Send now (test)",
              });
              await expect(sendNowButton).toBeVisible();
              await sendNowButton.scrollIntoViewIfNeeded();
              await expect(sendNowButton).toBeInViewport();
            } else {
              await expect(
                page.getByTestId("whatsapp-thread-held-batch"),
              ).toBeVisible();
              await expect(
                page.getByTestId("whatsapp-thread-held-batch"),
              ).not.toContainText(/\bSent\b/u);
            }
          }
          await expect(target).toBeVisible({ timeout: 15_000 });
          await expect
            .poll(
              () =>
                page
                  .locator("html")
                  .evaluate((root) => root.classList.contains("dark")),
              { timeout: 3000 },
            )
            .toBe(theme === "dark");
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - window.innerWidth,
            ),
          ).toBeLessThanOrEqual(1);
          if (width === 390 && screen.name === "LeadsWhatsApp") {
            const leadRow = page
              .getByRole("row")
              .filter({ hasText: "Plane Tree Guesthouse" });
            await expect(leadRow).toContainText("Replied");
            await expect(
              leadRow.getByRole("button", { name: "Open chat" }),
            ).toBeVisible();
            const batchLead = page
              .getByRole("row")
              .filter({ hasText: "Melville Hill Cottages" });
            await expect(batchLead).toContainText("In batch");
            await expect(
              batchLead.getByRole("button", { name: "View batch" }),
            ).toBeVisible();
            expect(
              await page
                .locator(".c3l-table-wrap")
                .evaluate(
                  (element) => element.scrollWidth - element.clientWidth,
                ),
            ).toBeLessThanOrEqual(1);
          }
          if (width === 1440 && screen.name === "LeadsWhatsApp") {
            await expect(target.getByText("38 leads")).toBeVisible();
          }
          if (width === 1440 && screen.name === "OutreachBatchSent") {
            await expect(
              page.getByRole("heading", {
                name: "Messaging 18 guesthouses in Melville",
              }),
            ).toBeVisible();
            await expect(
              page.getByTestId("whatsapp-batch-progress"),
            ).toContainText("6 of 18 sent");
            await expect(
              page
                .getByTestId("whatsapp-batch-progress")
                .locator(".c3wa-batch-progress-stats"),
            ).toContainText("11:40");
            await expect(
              target.locator(".c3wa-batch-first-preview"),
            ).toHaveCount(0);
            await expect(
              target.getByTestId("whatsapp-batch-row-6").getByText("Up next"),
            ).toBeVisible();
            await expect(
              target.getByTestId("whatsapp-batch-row-0"),
            ).toContainText("Read");
            await expect(
              target.getByTestId("whatsapp-batch-row-2"),
            ).toContainText("Delivered");
            await expect(
              target.getByText(
                "Jacaranda Lane read it already. Replies land in",
                { exact: false },
              ),
            ).toBeVisible();
          }
          if (screen.name === "SendNowBatch") {
            const sendNowButton = target
              .getByRole("button", { name: "Send now (test)" })
              .first();
            await expect(sendNowButton).toBeVisible();
            await sendNowButton.scrollIntoViewIfNeeded();
            await expect(sendNowButton).toBeInViewport();
            await expect(
              target.getByTestId("whatsapp-batch-row-schedule-0").first(),
            ).toContainText(/Sends (today at \d{2}:\d{2}|tomorrow at 08:00)/u);
          }
          if (screen.name === "Outreach") {
            const threadHeader = target.locator(".c3wa-thread-head");
            await expect(threadHeader.locator("strong")).toHaveText(
              "Plane Tree Guesthouse",
            );
            await expect(threadHeader).toContainText(
              width === 390
                ? "WhatsApp · Replied"
                : "Thandeka · +27 82 *** 7135 · Parkhurst",
            );
          }
          if (width === 390 && screen.name === "OutreachBatch") {
            await expect(
              target.getByRole("heading", {
                name: "18 guesthouses in Melville",
              }),
            ).toBeVisible();
            await expect(
              target.getByRole("button", { name: "Approve all 18" }),
            ).toBeVisible();
          }
          if (width === 390 && screen.name === "Outreach") {
            const reply = target.getByTestId("whatsapp-reply-input");
            await expect(reply).toBeEnabled();
            expect(
              await reply.evaluate(
                (element) => element.getBoundingClientRect().width,
              ),
            ).toBeGreaterThan(160);
          }
          if (width === 390 && screen.name === "LeadWhatsApp") {
            const whatsAppCard = target.getByRole("heading", {
              name: "WhatsApp",
            });
            await expect(whatsAppCard).toBeVisible();
            await expect(whatsAppCard).toBeInViewport();
            await expect(
              target.getByText("Replied", { exact: true }),
            ).toBeVisible();
            await expect(
              target.getByRole("button", { name: "Open chat" }),
            ).toBeVisible();
            await expect(
              target.getByTestId("whatsapp-lead-detail-card"),
            ).toContainText("This looks great! What would it cost?");
          }
          await page.mouse.move(width - 1, height - 1);
          await waitForAnimations(page);
          await page.screenshot({
            path: path.join(
              proofDirectory,
              `${width === 390 && screen.name === "Outreach" ? "MobileOutreach" : width === 390 && screen.name === "OutreachBatch" ? "MobileBatch" : screen.name}-${width}-${theme}.png`,
            ),
            fullPage: width !== 390 && screen.name !== "LeadsWhatsApp",
            animations: "disabled",
          });
        }
      }
    } finally {
      await context.close();
    }
  }
});
