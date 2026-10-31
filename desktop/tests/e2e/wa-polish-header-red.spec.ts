import { expect, test } from "@playwright/test";

import { installWhatsAppMockBridge } from "../helpers/whatsappOutreach";

test("header action buttons clear the tabs row when a dock narrows the channel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installWhatsAppMockBridge(page, "light");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page.getByTestId("channel-Outreach").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
  await page.getByTestId("channel-whatsapp-chats-trigger").click();
  await expect(page.getByTestId("work-area-panel")).toBeVisible();

  const tabs = await page.getByTestId("channel-view-tabs").boundingBox();
  expect(tabs).not.toBeNull();
  if (!tabs) throw new Error("Channel tabs have no rendered bounds");
  const actionBoxes = await page
    .locator(
      '[data-testid="channel-whatsapp-chats-trigger"], [data-testid="channel-work-area-trigger"]',
    )
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  expect(actionBoxes.length).toBeGreaterThan(0);
  for (const box of actionBoxes) {
    const overlapsTabs =
      box.x < tabs.x + tabs.width &&
      box.x + box.width > tabs.x &&
      box.y < tabs.y + tabs.height &&
      box.y + box.height > tabs.y;
    expect(overlapsTabs, "a header action overlaps the tabs row").toBe(false);
  }

  const badge = page.getByTestId("channel-whatsapp-unread-count");
  if ((await badge.count()) > 0) {
    const badgeBox = await badge.boundingBox();
    expect(badgeBox).not.toBeNull();
    if (!badgeBox) throw new Error("WhatsApp unread badge has no bounds");
    const labelBoxes = await page.locator(".c3c-tab").evaluateAll((items) =>
      items.map((item) => {
        const range = document.createRange();
        range.selectNodeContents(item);
        const { x, y, width, height } = range.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    for (const label of labelBoxes) {
      const overlapsLabel =
        badgeBox.x < label.x + label.width &&
        badgeBox.x + badgeBox.width > label.x &&
        badgeBox.y < label.y + label.height &&
        badgeBox.y + badgeBox.height > label.y;
      expect(overlapsLabel, "the WhatsApp badge overlaps a tab label").toBe(
        false,
      );
    }
  }
});
