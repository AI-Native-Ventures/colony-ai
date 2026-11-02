import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  JACARANDA_WA_ID,
  PLANE_TREE_WA_ID,
  installWhatsAppMockBridge,
  type WhatsAppProofTheme,
} from "../helpers/whatsappOutreach";

const containerWidths = [320, 360, 480, 640, 900, 1200, 2000] as const;
const ownerViewportHeight = 1100;

function deskSurface(page: Page) {
  return page.locator('[data-testid="whatsapp-outreach"][data-mode="desk"]');
}

async function openOutreachDesk(page: Page, theme: WhatsAppProofTheme) {
  await page.setViewportSize({ width: 1800, height: ownerViewportHeight });
  await installWhatsAppMockBridge(page, theme, {
    businessName: "Horizon Labs",
    deskFixture: true,
  });
  await page.route("https://img.logo.dev/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3d664b"/><path d="M14 42h36v5H14zm4-7 14-18 14 18z" fill="#f5f2e7"/></svg>',
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page.getByTestId("channel-Outreach").click();
  await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible();
  await page.getByTestId("channel-view-tab-chats").click();
  await expect(deskSurface(page)).toBeVisible();
}

async function setDeskContainerWidth(page: Page, width: number) {
  const desk = deskSurface(page);
  await desk.evaluate((surface, widthPx) => {
    const card = surface.parentElement;
    if (!(card instanceof HTMLElement)) {
      throw new Error("The Outreach desk has no container card.");
    }
    card.style.width = `${widthPx}px`;
    card.style.minWidth = "0";
    card.style.maxWidth = `${widthPx}px`;
  }, width);
  await expect
    .poll(async () => Math.round((await desk.boundingBox())?.width ?? -1))
    .toBe(width);
}

async function overflowReport(page: Page) {
  return deskSurface(page).evaluate((card) => {
    const cardBox = card.getBoundingClientRect();
    const elements = [card, ...card.querySelectorAll<HTMLElement>("*")];
    const outside: string[] = [];
    const oversized: string[] = [];
    for (const element of elements) {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        element.getClientRects().length === 0
      ) {
        continue;
      }
      const name =
        element.getAttribute("data-testid") ??
        element.getAttribute("aria-label") ??
        element.tagName.toLowerCase() +
          "." +
          String(element.className).trim().replace(/\s+/gu, ".") +
          (element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 32)
            ? `:${element.textContent.trim().replace(/\s+/gu, " ").slice(0, 32)}`
            : "");
      let insideHorizontalScroller = false;
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== card) {
        const ancestorOverflow = getComputedStyle(ancestor).overflowX;
        if (ancestorOverflow === "auto" || ancestorOverflow === "scroll") {
          insideHorizontalScroller = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (
        !insideHorizontalScroller &&
        (box.left < cardBox.left - 1 || box.right > cardBox.right + 1)
      ) {
        outside.push(
          name +
            " (" +
            Math.round(box.left - cardBox.left) +
            ".." +
            Math.round(box.right - cardBox.left) +
            " of " +
            Math.round(cardBox.width) +
            ")",
        );
      }
      const scrollsHorizontally =
        style.overflowX === "auto" || style.overflowX === "scroll";
      const intentionallyEllipsized = style.textOverflow === "ellipsis";
      const visuallyHidden = element.matches(".sr-only, .c3wa-sr-only");
      if (
        !scrollsHorizontally &&
        !intentionallyEllipsized &&
        !visuallyHidden &&
        element.scrollWidth > element.clientWidth + 1
      ) {
        oversized.push(
          name +
            " (scroll " +
            element.scrollWidth +
            ", client " +
            element.clientWidth +
            ")",
        );
      }
    }
    return { outside, oversized };
  });
}

async function expectNoDeskOverflow(page: Page, width: number) {
  const report = await overflowReport(page);
  expect(
    report.outside,
    "At " +
      width +
      "px, element boxes must stay inside the Outreach desk card.",
  ).toEqual([]);
  expect(
    report.oversized,
    `At ${width}px, non-scrolling elements must fit their client width.`,
  ).toEqual([]);
}

async function setViewportForDockContainer(page: Page, width: number) {
  const workAreaWidth = Math.max(1800, 280 + Math.ceil((width + 24) / 0.3115));
  await page.setViewportSize({
    width: workAreaWidth,
    height: ownerViewportHeight,
  });
}

async function expectDockCardInsideConversation(page: Page) {
  const [card, conversation] = await Promise.all([
    deskSurface(page).locator("xpath=..").boundingBox(),
    page.getByTestId("work-area-conversation").boundingBox(),
  ]);
  expect(card).not.toBeNull();
  expect(conversation).not.toBeNull();
  if (!card || !conversation) {
    throw new Error("The Outreach desk or conversation has no bounds.");
  }
  expect(card.x).toBeGreaterThanOrEqual(conversation.x - 1);
  expect(card.x + card.width).toBeLessThanOrEqual(
    conversation.x + conversation.width + 1,
  );
}

async function expectResponsiveLayout(page: Page, width: number) {
  const desk = deskSurface(page);
  const contacts = desk.locator(".c3wa-contact-panel");
  const thread = desk.locator(".c3wa-thread-panel");
  const record = desk.getByTestId("whatsapp-contact-record");

  if (width < 640) {
    await expect(contacts).toBeVisible();
    await expect(thread).toBeHidden();
    const contactRow = desk.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`);
    await contactRow.click();
    await expect(thread).toBeVisible();
    const backToContacts = desk.getByRole("button", {
      name: "Back to WhatsApp contacts",
    });
    await expect(backToContacts).toBeVisible();
    await backToContacts.click();
    await expect(thread).toBeHidden();

    await contactRow.click();
    await desk.getByRole("button", { name: "Record", exact: true }).click();
    await expect(record).toBeVisible();
    await record.getByRole("button", { name: "Back to chat" }).click();
    await expect(thread).toBeVisible();
    await desk
      .getByRole("button", { name: "Back to WhatsApp contacts" })
      .click();
  } else if (width < 1024) {
    await expect(contacts).toBeVisible();
    await expect(thread).toBeVisible();
    await expect(record).toBeHidden();
    await desk.getByRole("button", { name: "Record", exact: true }).click();
    await expect(record).toBeVisible();
    await record.getByRole("button", { name: "Back to chat" }).click();
    await expect(record).toBeHidden();
  } else {
    await expect(contacts).toBeVisible();
    await expect(thread).toBeVisible();
    await expect(record).toBeVisible();
  }
}

test("Outreach desk stays inside its container with the WhatsApp dock open and closed", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const proofDirectory = process.env.OUTREACH_DESK_NARROW_PROOF_DIR
    ? path.resolve(process.env.OUTREACH_DESK_NARROW_PROOF_DIR)
    : testInfo.outputPath("screenshots");
  await mkdir(proofDirectory, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      colorScheme: theme,
      viewport: { width: 1800, height: ownerViewportHeight },
    });
    try {
      const page = await context.newPage();
      await openOutreachDesk(page, theme);
      const wantsCallFilter = deskSurface(page)
        .locator(".c3wa-contact-filters")
        .getByRole("tab", { name: "Wants a call" });

      for (const width of containerWidths) {
        await page.setViewportSize({
          width: Math.max(1800, width + 300),
          height: ownerViewportHeight,
        });
        await setDeskContainerWidth(page, width);
        await expectNoDeskOverflow(page, width);
        if (width === 360) {
          await expect(wantsCallFilter).toHaveAttribute(
            "title",
            "Wants a call",
          );
        }
        await expectResponsiveLayout(page, width);
      }

      await setViewportForDockContainer(page, containerWidths[0]);
      await setDeskContainerWidth(page, containerWidths[0]);
      await page.getByTestId("channel-whatsapp-chats-trigger").click();
      const dock = page.getByTestId("work-area-panel");
      await expect(dock).toBeVisible();
      const dockWhatsApp = page.locator(
        '[data-testid="whatsapp-outreach"][data-mode="dock"]',
      );
      await expect(dockWhatsApp).toBeVisible();
      const channelTabs = page.getByTestId("channel-view-tabs");
      await expect(channelTabs).toHaveCSS("overflow-x", "auto");
      expect(
        await channelTabs.evaluate(
          (tabs) => tabs.scrollWidth > tabs.clientWidth,
        ),
      ).toBe(true);

      for (const width of containerWidths) {
        await setViewportForDockContainer(page, width);
        await setDeskContainerWidth(page, width);
        await expectDockCardInsideConversation(page);
        await expectNoDeskOverflow(page, width);
        await expect(
          deskSurface(page).locator(".c3wa-contact-panel"),
        ).toBeVisible();
        await expect(
          deskSurface(page).locator(".c3wa-thread-panel"),
        ).toHaveCount(0);
        await expect(
          deskSurface(page).getByTestId("whatsapp-contact-record"),
        ).toHaveCount(0);

        if (width === 360) {
          await deskSurface(page)
            .getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`)
            .click();
          await expect(
            dockWhatsApp.locator(".c3wa-thread-panel"),
          ).toHaveAttribute(
            "aria-label",
            "Conversation with Jacaranda Lane Guesthouse",
          );
        }

        if (width === 480) {
          await waitForAnimations(page);
          await page.screenshot({
            path: path.join(
              proofDirectory,
              `outreach-desk-480-dock-${theme}.png`,
            ),
          });
        }
      }
    } finally {
      await context.close();
    }
  }
});
