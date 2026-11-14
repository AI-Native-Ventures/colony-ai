import { expect, test } from "./fixtures/lockedBrowserTest";
import type { Page } from "@playwright/test";

import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";
import {
  capture,
  DENSE_MAP_SHELL_CHANNELS,
  OWNER_PUBKEY,
  prepareMapShell,
} from "./mapShellTestSupport";

test.setTimeout(150_000);

function pathname(url: string) {
  return new URL(url).hash.replace(/^#/, "").split(/[?#]/, 1)[0];
}

async function applyChannelPreferences(page: Page) {
  await page.evaluate(
    ({ generalChannelId, ownerPubkey, salesChannelId }) => {
      const communities = JSON.parse(
        window.localStorage.getItem("buzz-communities") ?? "[]",
      ) as Array<{ id: string; relayUrl: string }>;
      const activeCommunityId = window.localStorage.getItem(
        "buzz-active-community-id",
      );
      const relayUrl =
        communities.find(({ id }) => id === activeCommunityId)?.relayUrl ??
        "ws://localhost:3000";
      const normalizedRelay = relayUrl.trim().replace(/\/+$/, "").toLowerCase();
      const sectionKey =
        "buzz-channel-sections.v1:" +
        ownerPubkey +
        ":" +
        encodeURIComponent(normalizedRelay);
      const sectionValue = JSON.stringify({
        version: 1,
        sections: [{ id: "client-work", name: "Client work", order: 0 }],
        assignments: { [salesChannelId]: "client-work" },
      });
      const starsKey = `buzz-channel-stars.v1:${ownerPubkey}`;
      const starsValue = JSON.stringify({
        version: 1,
        channels: {
          [generalChannelId]: { starred: true, updatedAt: 1 },
        },
      });
      window.localStorage.setItem(sectionKey, sectionValue);
      window.localStorage.setItem(starsKey, starsValue);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: sectionKey,
          newValue: sectionValue,
          storageArea: window.localStorage,
        }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: starsKey,
          newValue: starsValue,
          storageArea: window.localStorage,
        }),
      );
    },
    {
      generalChannelId: REFERENCE_CHANNEL_IDS.general,
      ownerPubkey: OWNER_PUBKEY,
      salesChannelId: REFERENCE_CHANNEL_IDS.sales,
    },
  );
}

test("channels menu keeps rooms reachable when customer chats are dense", async ({
  page,
}) => {
  await prepareMapShell(page, {
    contactCount: 300,
    extraChannels: DENSE_MAP_SHELL_CHANNELS,
    featureEnabled: true,
    height: 900,
    theme: "light",
    width: 1440,
  });
  await applyChannelPreferences(page);

  const channelsButton = page.getByTestId("map-shell-channels-button");
  const channelsPopover = page.getByTestId("map-shell-channels-popover");
  const channelRows = channelsPopover.locator(
    '[data-testid^="map-shell-channel-"]',
  );
  const sales = channelsPopover.getByTestId(
    `map-shell-channel-${REFERENCE_CHANNEL_IDS.sales}`,
  );

  await channelsButton.hover();
  await expect(channelsPopover).toBeVisible();
  await expect(channelRows).toHaveCount(12);
  await expect(
    channelsPopover.getByRole("heading", { name: "Starred" }),
  ).toBeVisible();
  await expect(
    channelsPopover.getByRole("heading", { name: "Client work" }),
  ).toBeVisible();
  await expect(
    channelsPopover.getByRole("heading", { name: "Channels" }),
  ).toBeVisible();
  await expect(channelRows.first()).toHaveAttribute(
    "data-testid",
    `map-shell-channel-${REFERENCE_CHANNEL_IDS.general}`,
  );
  await expect(sales).toBeVisible();
  await expect(
    channelsPopover.getByTestId(
      `map-shell-channel-${REFERENCE_CHANNEL_IDS.outreach}`,
    ),
  ).toBeVisible();
  await expect(
    sales.evaluate((element) => {
      const list = element.closest(".map-shell-channels-list");
      if (!list) return false;
      const row = element.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      return row.top >= bounds.top && row.bottom <= bounds.bottom;
    }),
  ).resolves.toBe(true);

  await channelsButton.click();
  await expect(channelsPopover).toBeVisible();
  await page.getByTestId("map-shell-company").hover();
  await expect(channelsPopover).toHaveCount(0);

  await channelsButton.click();
  await expect(channelsPopover).toBeVisible();
  await sales.click();
  await expect.poll(() => pathname(page.url())).toMatch(/^\/channels\//);

  await page.goto("/#/");
  await channelsButton.focus();
  await page.keyboard.press("Enter");
  await expect(channelsPopover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(channelsButton).toBeFocused();
  await page.keyboard.press("Space");
  await expect(channelsPopover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(channelsButton).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(channelsPopover).toBeVisible();
  await expect(channelRows.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(sales).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(channelsButton).toBeFocused();

  await page.getByTestId("map-shell-chats-button").click();
  const chatsPopover = page.getByTestId("map-shell-chats-popover");
  await expect(chatsPopover).toBeVisible();
  await expect(
    chatsPopover.locator('[data-testid^="map-shell-wa-"]'),
  ).toHaveCount(8);
  await expect(
    chatsPopover.getByTestId("map-shell-all-customer-chats"),
  ).toBeVisible();
  await expect(
    chatsPopover.locator('[data-testid^="map-shell-room-"]'),
  ).toHaveCount(0);

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("map-shell-mobile-menu-button").click();
  const sheet = page.getByTestId("map-shell-mobile-sheet");
  const channelHeading = sheet
    .getByRole("heading", { name: "Channels" })
    .first();
  const customerHeading = sheet.getByRole("heading", { name: "Customers" });
  await expect(channelHeading).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Channels" })).toHaveCount(1);
  await expect(sheet.getByRole("heading", { name: "Starred" })).toBeVisible();
  await expect(
    sheet.getByRole("heading", { name: "Client work" }),
  ).toBeVisible();
  await expect(customerHeading).toBeVisible();
  expect((await channelHeading.boundingBox())?.y).toBeLessThan(
    (await customerHeading.boundingBox())?.y ?? Infinity,
  );
  await expect(sheet.locator('[data-testid^="map-shell-wa-"]')).toHaveCount(8);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} wide desktop captures the channel menu states`, async ({
    page,
  }) => {
    await prepareMapShell(page, {
      featureEnabled: true,
      height: 1117,
      theme,
      width: 1728,
    });
    await expect(page.getByTestId("map-shell-bar")).toBeVisible();
    await capture(page, `${theme}-1728-home`);

    const channelsButton = page.getByTestId("map-shell-channels-button");
    const channelsPopover = page.getByTestId("map-shell-channels-popover");
    await channelsButton.hover();
    await expect(channelsPopover).toBeVisible();
    await capture(page, `${theme}-1728-channels-hover`);

    await page.getByTestId("map-shell-chats-button").hover();
    await expect(channelsPopover).toHaveCount(0);
    await page.getByTestId("map-shell-chats-button").click();
    await expect(page.getByTestId("map-shell-chats-popover")).toBeVisible();
    await capture(page, `${theme}-1728-chats`);
  });
}
