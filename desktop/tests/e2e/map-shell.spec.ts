import { expect, test } from "./fixtures/lockedBrowserTest";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  capture,
  MAP_SHELL_WORKSPACES,
  OWNER_PUBKEY,
  prepareMapShell,
  SEARCH_USER_PUBKEY,
} from "./mapShellTestSupport";

test.setTimeout(150_000);

async function seedUnreadChat(page: Page) {
  await page.goto("/#/activity");
  await expect(page.getByTestId("home-inbox")).toBeVisible({
    timeout: 15_000,
  });
  await page.goto("/#/company/function/operations");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Operations/Delivery",
  );
  await expect
    .poll(() =>
      page.evaluate(
        ({ channelName, kind }) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName,
            kind,
          }) ?? false,
        { channelName: "Scout", kind: 9 },
      ),
    )
    .toBe(true);
  const seededActivity = await page.evaluate(
    ({ pubkey, createdAt, ownerPubkey }) => {
      const message = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Scout",
        content: "A new message for the shell preview.",
        pubkey,
        kind: 9,
        createdAt,
        mentionPubkeys: [ownerPubkey],
      });
      const pushFeedItem = window.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__;
      if (!message || !pushFeedItem) return null;
      pushFeedItem({
        category: "mention",
        channel_id: null,
        channel_name: "Scout",
        content: message.content,
        created_at: message.created_at,
        id: message.id,
        kind: message.kind,
        pubkey: message.pubkey,
        tags: message.tags,
      });
      return { messageId: message.id, activitySeeded: true };
    },
    {
      pubkey: REFERENCE_AGENTS.scout.pubkey,
      ownerPubkey: OWNER_PUBKEY,
      createdAt: Math.floor(Date.now() / 1_000) + 60,
    },
  );
  expect(seededActivity?.messageId).toBeTruthy();
  expect(seededActivity?.activitySeeded).toBe(true);
  const isDesktop = await page.evaluate(() => window.innerWidth >= 768);
  if (isDesktop) {
    await expect(page.locator(".map-shell-chat-dot")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".map-shell-bell-dot")).toBeVisible({
      timeout: 15_000,
    });
  }
  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
}

async function seedUnreadChannel(page: Page) {
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.sales}`);
  await expect
    .poll(() =>
      page.evaluate(
        ({ channelName, kind }) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName,
            kind,
          }) ?? false,
        { channelName: "Sales", kind: 9 },
      ),
    )
    .toBe(true);
  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  const message = await page.evaluate(
    ({ createdAt, pubkey }) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Sales",
        content: "A new channel message for the shell preview.",
        createdAt,
        kind: 9,
        pubkey,
      }),
    {
      createdAt: Math.floor(Date.now() / 1_000) + 60,
      pubkey: REFERENCE_AGENTS.scout.pubkey,
    },
  );
  expect(message?.id).toBeTruthy();
  await expect(page.locator(".map-shell-channel-dot")).toBeVisible({
    timeout: 15_000,
  });
}

function pathname(url: string) {
  return new URL(url).hash.replace(/^#/, "").split(/[?#]/, 1)[0];
}

test("desktop shell matches the board and keeps the app journeys reachable", async ({
  page,
}) => {
  await prepareMapShell(page, {
    theme: "light",
    width: 1440,
    height: 900,
    featureEnabled: true,
  });
  await seedUnreadChat(page);
  await seedUnreadChannel(page);

  const bar = page.getByTestId("map-shell-bar");
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("app-top-chrome")).toHaveCount(0);
  await expect(page.getByTestId("map-shell-company")).toContainText(
    "Horizon Labs",
  );
  await expect(
    page
      .locator(".map-shell-desktop-actions")
      .getByTestId("map-shell-needs-you"),
  ).toHaveText("1 need you");
  await expect(page.getByTestId("map-shell-company")).toHaveCSS(
    "height",
    "44px",
  );
  await expect(page.getByTestId("map-shell-map-button")).toHaveCount(0);
  await expect(page.locator(".map-shell-company-mark")).toHaveCSS(
    "width",
    "36px",
  );
  await expect(page.locator(".map-shell-company-mark")).toHaveCSS(
    "height",
    "36px",
  );
  await expect(page.locator(".map-shell-company-name")).toHaveCSS(
    "font-size",
    "17px",
  );
  await expect(page.locator(".map-shell-company-name")).toHaveCSS(
    "font-weight",
    "800",
  );
  await capture(page, "light-1440-home");

  await page.getByTestId("cofounder-map-sales").click();
  const salesPartCard = page.getByTestId("cofounder-map-part-card");
  await expect(salesPartCard).toBeVisible();
  await salesPartCard.getByRole("link", { name: "Open Sales" }).click();
  const salesFunction = page.getByTestId("cofounder-function-screen");
  const mapOriginBack = salesFunction.getByRole("button", {
    name: "Company map",
  });
  await expect(mapOriginBack).toBeVisible();
  await mapOriginBack.click();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await page.goto("/#/company/map");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await expect(page.getByTestId("map-shell-company")).toBeVisible();
  await expect(page.getByTestId("map-shell-map-button")).toHaveCount(0);

  const barMetrics = await bar.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      gap: style.gap,
      borderBottomWidth: style.borderBottomWidth,
    };
  });
  expect(barMetrics).toEqual({
    height: 64,
    paddingLeft: "24px",
    paddingRight: "24px",
    gap: "12px",
    borderBottomWidth: "1px",
  });

  const orderedControls = [
    page.getByTestId("map-shell-chats-button"),
    page.getByTestId("map-shell-channels-button"),
    page.getByTestId("map-shell-customers"),
    page.getByTestId("map-shell-team"),
    page.getByTestId("open-search"),
    page.getByTestId("map-shell-activity"),
    page
      .locator(".map-shell-desktop-actions")
      .getByTestId("map-shell-needs-you"),
    page.getByTestId("map-shell-avatar"),
  ];
  const controlBoxes = await Promise.all(
    orderedControls.map((control) => control.boundingBox()),
  );
  expect(controlBoxes.every(Boolean)).toBe(true);
  expect(controlBoxes.map((box) => box?.x ?? 0)).toEqual(
    [...controlBoxes]
      .map((box) => box?.x ?? 0)
      .sort((left, right) => left - right),
  );
  expect(controlBoxes[0]?.height).toBe(controlBoxes[1]?.height);
  expect(controlBoxes[0]?.y).toBe(controlBoxes[1]?.y);
  for (const control of orderedControls.slice(0, 7)) {
    await expect(control).toHaveCSS("height", "44px");
  }
  await expect(page.getByTestId("map-shell-avatar")).toHaveCSS(
    "height",
    "40px",
  );
  await expect(page.getByTestId("map-shell-avatar")).toHaveCSS("width", "40px");
  await expect(page.getByTestId("map-shell-avatar")).toHaveCSS(
    "border-radius",
    "50%",
  );
  await expect(page.getByTestId("map-shell-chats-button")).toContainText(
    "Chats",
  );
  await expect(page.getByTestId("map-shell-chats-button")).toHaveCSS(
    "padding",
    "0px 12px",
  );
  await expect(page.getByTestId("map-shell-chats-button")).toHaveCSS(
    "gap",
    "8px",
  );
  await expect(page.getByTestId("map-shell-customers")).toHaveText("Customers");
  await expect(page.getByTestId("map-shell-team")).toHaveText("Team");

  await page.goto("/#/company/function/customer_success");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Customer Success/All of Customer Success",
  );
  const longTrailBounds = await page.evaluate(() => {
    const trail = document.querySelector(".map-shell-trail");
    const channels = document.querySelector(
      '[data-testid="map-shell-channels-button"]',
    );
    const needs = document.querySelector('[data-testid="map-shell-needs-you"]');
    if (!trail || !channels || !needs) return null;
    return {
      channelsLeft: channels.getBoundingClientRect().left,
      needsWidth: needs.getBoundingClientRect().width,
      trailRight: trail.getBoundingClientRect().right,
    };
  });
  expect(longTrailBounds).not.toBeNull();
  expect(longTrailBounds?.trailRight).toBeLessThanOrEqual(
    longTrailBounds?.channelsLeft ?? Infinity,
  );
  expect(longTrailBounds?.needsWidth).toBeGreaterThan(0);

  await page.goto("/#/company/function/operations");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Operations/Delivery",
  );
  await expect(
    page
      .getByTestId("map-shell-map-button")
      .locator('[data-part="Operations"]'),
  ).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("map-shell-map-button")).toHaveCSS(
    "height",
    "44px",
  );
  await expect(page.getByTestId("map-shell-map-button")).toHaveCSS(
    "border-radius",
    "12px",
  );
  await expect(page.getByTestId("map-shell-map-button")).toHaveCSS(
    "padding",
    "0px 10px 0px 8px",
  );
  await expect(page.getByTestId("map-shell-map-button")).toHaveCSS(
    "gap",
    "8px",
  );
  await expect(page.locator(".map-shell-desktop-actions")).toHaveCSS(
    "gap",
    "12px",
  );
  await expect(page.locator(".map-shell-company-nav")).toHaveCSS("gap", "2px");
  await page.goto("/#/leads");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Sales/Outreach",
  );
  await expect(
    page.getByTestId("map-shell-map-button").locator('[data-part="Sales"]'),
  ).toHaveAttribute("data-active", "true");
  await capture(page, "light-1440-part");

  await page.goto("/#/company/function/sales");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Sales/All of Sales",
  );
  await capture(page, "light-1440-arm");

  const routeTrails = [
    ["/discovery", "Sales/Lead finding"],
    ["/leads", "Sales/Outreach"],
    ["/pipeline", "Sales/Closing"],
    ["/company/access", "Finance/Costs"],
    ["/work", "Operations/Delivery"],
    ["/today", "Today"],
    ["/today/needs-you", "Needs you"],
    ["/settings", "Settings"],
  ] as const;
  for (const [route, expectedTrail] of routeTrails) {
    await page.goto(`/#${route}`);
    await expect(page.getByTestId("map-shell-trail")).toHaveText(expectedTrail);
    await expect(page.getByTestId("map-shell-bar")).toBeVisible();
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("app-top-chrome")).toHaveCount(0);
  }

  await page.goto(`/#/channels/pins/${REFERENCE_CHANNEL_IDS.general}`);
  await expect(page.getByTestId("channel-pins-screen")).toBeVisible();
  await expect(page.getByTestId("map-shell-bar")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);

  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await page.goto("/#/today");
  await expect(page.getByTestId("map-shell-trail")).toHaveText("Today");

  const channelsButton = page.getByTestId("map-shell-channels-button");
  const channelsPopover = page.getByTestId("map-shell-channels-popover");
  await expect(channelsButton).toHaveAccessibleName(
    "Channels, unread messages",
  );
  await channelsButton.hover();
  await expect(channelsPopover).toBeVisible();
  await expect(channelsPopover).toHaveAccessibleName("Channels");
  await expect(
    channelsPopover.getByTestId(
      `map-shell-channel-${REFERENCE_CHANNEL_IDS.general}`,
    ),
  ).toHaveAccessibleName("general");
  await expect(
    channelsPopover
      .getByTestId(`map-shell-channel-${REFERENCE_CHANNEL_IDS.welcome}`)
      .locator('[data-private="true"]'),
  ).toBeVisible();
  await capture(page, "light-1440-channels-hover");
  await page.getByTestId("map-shell-chats-button").hover();
  await expect(channelsPopover).toHaveCount(0);
  await page.getByTestId("map-shell-chats-button").click();
  const chatsPopover = page.getByTestId("map-shell-chats-popover");
  await expect(chatsPopover).toBeVisible();
  await expect(
    chatsPopover.getByRole("heading", { name: "Customers" }),
  ).toBeVisible();
  await expect(
    chatsPopover.getByRole("heading", { name: "Your team" }),
  ).toBeVisible();
  await expect(chatsPopover.getByRole("heading")).toHaveCount(2);
  await expect(
    chatsPopover.getByTestId("map-shell-wa-27821234567"),
  ).toBeVisible();
  await expect(
    chatsPopover.getByTestId("map-shell-all-customer-chats"),
  ).toBeVisible();
  await expect(
    chatsPopover.locator('[data-testid^="map-shell-room-"]'),
  ).toHaveCount(0);
  await expect(
    chatsPopover.locator('[data-testid^="map-shell-dm-"]').first(),
  ).toBeVisible();
  for (const row of await chatsPopover.locator(".map-shell-chat-row").all()) {
    await expect(row).toHaveCSS("height", "44px");
  }
  await waitForAnimations(page);
  const popoverMetrics = await chatsPopover.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
      borderRadius: style.borderRadius,
      padding: style.padding,
    };
  });
  expect(popoverMetrics.width).toBe(340);
  expect(popoverMetrics.height).toBeLessThanOrEqual(408);
  expect(popoverMetrics.borderRadius).toBe("20px");
  expect(popoverMetrics.padding).toBe("12px");
  const chatsListOverflow = await chatsPopover
    .locator(".map-shell-chats-list")
    .evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(chatsListOverflow).toBe(false);
  await capture(page, "light-1440-chats");

  await chatsPopover.getByTestId("map-shell-wa-27821234567").click();
  await expect.poll(() => pathname(page.url())).toMatch(/^\/channels\//);
  await expect(page.url()).toContain("27821234567");
  await page.goto("/#/activity");
  await page.getByTestId("map-shell-chats-button").click();
  const openChats = page.getByTestId("map-shell-chats-popover");
  await openChats.getByTestId("map-shell-all-customer-chats").click();
  await expect.poll(() => pathname(page.url())).toMatch(/^\/channels\//);
  await page.goto("/#/");
  await page.getByTestId("map-shell-channels-button").click();
  const room = channelsPopover.getByTestId(
    `map-shell-channel-${REFERENCE_CHANNEL_IDS.general}`,
  );
  await expect(room).toBeVisible();
  await room.click();
  await expect.poll(() => pathname(page.url())).toMatch(/^\/channels\//);
  await page.goto("/#/");
  await page.getByTestId("map-shell-chats-button").click();
  const directMessage = page.locator('[data-testid^="map-shell-dm-"]').first();
  await expect(directMessage).toBeVisible();
  await directMessage.click();
  await expect.poll(() => pathname(page.url())).toMatch(/^\/channels\//);

  await page.getByTestId("map-shell-customers").click();
  await expect.poll(() => pathname(page.url())).toBe("/clients");
  await page.getByTestId("map-shell-team").click();
  await expect.poll(() => pathname(page.url())).toBe("/team");
  await page.getByTestId("open-search").click();
  await expect(page.getByTestId("search-results")).toBeVisible();
  await page.getByTestId("search-dialog-input").fill("Nandi");
  const userResult = page.getByTestId(
    `search-result-user-${SEARCH_USER_PUBKEY}`,
  );
  await expect(userResult).toBeVisible();
  await userResult.click();
  await expect.poll(() => pathname(page.url())).toMatch(/^\/channels\//);
  await page.getByTestId("map-shell-activity").click();
  await expect.poll(() => pathname(page.url())).toBe("/activity");
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page
    .locator(".map-shell-desktop-actions")
    .getByTestId("map-shell-needs-you")
    .click();
  await expect.poll(() => pathname(page.url())).toBe("/today/needs-you");

  await page.goto("/#/company/function/operations");
  await page.getByTestId("map-shell-avatar").click();
  const accountMenu = page.getByTestId("profile-popover");
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByTestId("map-shell-power")).toBeVisible();
  await expect(
    accountMenu.getByTestId("profile-popover-settings"),
  ).toBeVisible();
  await expect(accountMenu.getByTestId("map-shell-signout")).toBeVisible();
  await capture(page, "light-1440-avatar");
  await page.keyboard.press("Escape");

  await page.getByTestId("map-shell-map-button").click();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await page.getByTestId("map-shell-company").click();
  await expect(page.getByTestId("workspace-switcher-menu")).toBeVisible();
});

test("dark desktop bar keeps its measured layout", async ({ page }) => {
  await prepareMapShell(page, {
    theme: "dark",
    width: 1440,
    height: 900,
    featureEnabled: true,
  });
  await seedUnreadChat(page);
  await expect(page.getByTestId("map-shell-bar")).toBeVisible();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await expect(
    page
      .locator(".map-shell-desktop-actions")
      .getByTestId("map-shell-needs-you"),
  ).toBeVisible();
  await expect(
    page
      .locator(".map-shell-desktop-actions")
      .getByTestId("map-shell-needs-you"),
  ).toHaveText("1 need you");
  await capture(page, "dark-1440-home");
  await page.goto("/#/company/function/operations");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Operations/Delivery",
  );
  await capture(page, "dark-1440-part");
  await page.goto("/#/company/function/sales");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Sales/All of Sales",
  );
  await capture(page, "dark-1440-arm");
  await page.goto("/#/today");
  await expect(page.getByTestId("map-shell-trail")).toHaveText("Today");
  await page.getByTestId("map-shell-channels-button").hover();
  const channelsPopover = page.getByTestId("map-shell-channels-popover");
  await expect(channelsPopover).toBeVisible();
  await capture(page, "dark-1440-channels-hover");
  await page.getByTestId("map-shell-chats-button").hover();
  await expect(channelsPopover).toHaveCount(0);
  await page.getByTestId("map-shell-chats-button").click();
  await expect(page.getByTestId("map-shell-chats-popover")).toBeVisible();
  await capture(page, "dark-1440-chats");
  await page.keyboard.press("Escape");
  await page.getByTestId("map-shell-avatar").click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await capture(page, "dark-1440-avatar");
});

test("phone bar and sheet stay in bounds and keep every action reachable", async ({
  page,
}) => {
  await prepareMapShell(page, {
    theme: "light",
    width: 390,
    height: 844,
    featureEnabled: true,
  });
  await seedUnreadChat(page);
  const bar = page.getByTestId("map-shell-bar");
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await expect(bar).toHaveCSS("height", "56px");
  await expect(page.getByTestId("map-shell-company")).toHaveCSS(
    "height",
    "44px",
  );
  await expect(
    page
      .locator(".map-shell-mobile-actions")
      .getByTestId("map-shell-needs-you"),
  ).toHaveCSS("height", "44px");
  await expect(page.getByTestId("map-shell-mobile-menu-button")).toHaveCSS(
    "height",
    "44px",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth ===
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await expect(
    page
      .locator(".map-shell-mobile-actions")
      .getByTestId("map-shell-needs-you"),
  ).toHaveText("1 need you");
  await capture(page, "light-390-phone-bar");

  await page.getByTestId("map-shell-mobile-menu-button").click();
  const sheet = page.getByTestId("map-shell-mobile-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Customers" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Team" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Activity" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Channels" })).toHaveCount(1);
  await expect(sheet.getByRole("heading", { name: "Channels" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Chats" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Your team" })).toBeVisible();
  await expect(
    sheet
      .getByTestId(`map-shell-dm-${REFERENCE_CHANNEL_IDS.scoutDm}`)
      .locator(".map-shell-count"),
  ).toHaveText("1");
  await expect(sheet.locator('[data-testid^="map-shell-room-"]')).toHaveCount(
    0,
  );
  const shortControls = await sheet
    .locator("button:visible")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
  expect(shortControls.every((height) => height >= 44)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth ===
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await capture(page, "light-390-phone-sheet");
  await sheet.getByTestId("map-shell-avatar").click();
  const profilePopover = page.getByTestId("profile-popover");
  await expect(profilePopover).toBeVisible();
  await expect(page.getByTestId("map-shell-power")).toBeVisible();
  await waitForAnimations(page);
  const profileControls = await profilePopover
    .locator("button:visible")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
  expect(profileControls.every((height) => height >= 44)).toBe(true);
  await sheet.getByTestId("map-shell-avatar").click();
  await sheet.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("search-results")).toBeVisible();
});

test("dark phone bar and sheet stay in bounds", async ({ page }) => {
  await prepareMapShell(page, {
    theme: "dark",
    width: 390,
    height: 844,
    featureEnabled: true,
  });
  await seedUnreadChat(page);
  await expect(page.getByTestId("map-shell-bar")).toHaveCSS("height", "56px");
  await expect(
    page
      .locator(".map-shell-mobile-actions")
      .getByTestId("map-shell-needs-you"),
  ).toHaveText("1 need you");
  await capture(page, "dark-390-phone-bar");
  await page.getByTestId("map-shell-mobile-menu-button").click();
  const sheet = page.getByTestId("map-shell-mobile-sheet");
  await expect(sheet).toBeVisible();
  await expect(
    sheet
      .getByTestId(`map-shell-dm-${REFERENCE_CHANNEL_IDS.scoutDm}`)
      .locator(".map-shell-count"),
  ).toHaveText("1");
  await capture(page, "dark-390-phone-sheet");
});

test("feature off keeps the current sidebar and home feed", async ({
  page,
}) => {
  await prepareMapShell(page, {
    theme: "light",
    width: 1440,
    height: 900,
    featureEnabled: false,
  });
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("map-shell-bar")).toHaveCount(0);
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page.goto("/#/agents");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("app-top-chrome")).toBeVisible();
  await expect(page.getByTestId("map-shell-bar")).toHaveCount(0);
});

test("App community switching returns to the map when map_home is enabled", async ({
  page,
}) => {
  await prepareMapShell(page, {
    theme: "light",
    width: 1440,
    height: 900,
    featureEnabled: true,
    workspaces: MAP_SHELL_WORKSPACES,
  });
  const stage = page.getByTestId("cofounder-map-stage");
  await page.getByTestId("cofounder-map-sales").click();
  await expect(stage).toHaveAttribute("data-active-part", "sales");
  await expect(page.getByTestId("map-shell-trail")).toHaveText(
    "Sales/All of Sales",
  );
  await page.getByTestId("map-shell-map-button").click();
  await expect(stage).toHaveAttribute("data-active-part", "none");
  await expect(page.getByTestId("map-shell-company")).toBeVisible();

  await page.getByTestId("map-shell-company").click();
  const workspaceMenu = page.getByTestId("workspace-switcher-menu");
  await expect(workspaceMenu).toBeVisible();
  await workspaceMenu
    .getByTestId("workspace-menu-item-map-shell-workspace-two")
    .click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("buzz-active-community-id"),
      ),
    )
    .toBe("map-shell-workspace-two");
  await expect.poll(() => pathname(page.url())).toBe("/");
  await expect(page.getByTestId("map-shell-bar")).toBeVisible();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await expect(page.getByTestId("cofounder-map-stage")).toHaveAttribute(
    "data-active-part",
    "none",
  );
  await expect(page.getByTestId("map-shell-company")).toBeVisible();
  await expect(page.getByTestId("map-shell-map-button")).toHaveCount(0);
  await expect(page.getByTestId("map-shell-trail")).toHaveCount(0);
});

test("cofounder mode off keeps the current sidebar with map_home enabled", async ({
  page,
}) => {
  await prepareMapShell(page, {
    theme: "light",
    width: 1440,
    height: 900,
    featureEnabled: true,
    cofounderEnabled: false,
  });
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("map-shell-bar")).toHaveCount(0);
  await expect(page.getByTestId("home-inbox")).toBeVisible();
});

test("top bar actions open their dialogs without the sidebar", async ({
  page,
}) => {
  await prepareMapShell(page, {
    theme: "light",
    width: 1440,
    height: 900,
    featureEnabled: true,
  });
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);

  await page.getByTestId("map-shell-company").click();
  await page
    .getByTestId("workspace-switcher-menu")
    .getByTestId("workspace-create-action")
    .click();
  const workspaceDialog = page.getByTestId("workspace-action-dialog");
  await expect(workspaceDialog).toBeVisible();
  await workspaceDialog.getByTestId("workspace-dialog-close").click();
  await expect(workspaceDialog).toHaveCount(0);
  await waitForAnimations(page);
  await page.mouse.move(0, 0);
  await expect(page.getByTestId("cofounder-map-stage")).toHaveAttribute(
    "data-active-part",
    "none",
  );

  await page.getByTestId("map-shell-company").click();
  await page
    .getByTestId("workspace-switcher-menu")
    .getByTestId("workspace-join-action")
    .click();
  await expect(page.getByTestId("workspace-join-form")).toBeVisible();
  await page.getByTestId("workspace-dialog-close").click();
  await expect(page.getByTestId("workspace-action-dialog")).toHaveCount(0);
  await waitForAnimations(page);
  await page.mouse.move(0, 0);
  await expect(page.getByTestId("cofounder-map-stage")).toHaveAttribute(
    "data-active-part",
    "none",
  );

  await page.getByTestId("open-search").click();
  await page.getByTestId("search-result-action-create-channel").click();
  const channelDialog = page.getByTestId("create-channel-dialog");
  await expect(channelDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(channelDialog).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+Shift+N");
  await expect(channelDialog).toBeVisible();
  await channelDialog.getByTestId("create-channel-name").fill("map-shell-room");
  await channelDialog.getByTestId("create-channel-submit").click();
  await expect.poll(() => pathname(page.url())).toMatch(/^\/channels\//);
  await expect(channelDialog).toHaveCount(0);
  await expect(page.getByTestId("map-shell-bar")).toBeVisible();
});

test("the need-you count stays on screen while a failed source retries", async ({
  page,
}) => {
  await prepareMapShell(page, {
    theme: "light",
    width: 1440,
    height: 900,
    featureEnabled: true,
  });
  const pill = page
    .locator(".map-shell-desktop-actions")
    .getByTestId("map-shell-needs-you");
  await expect(pill).toHaveText("1 need you");

  // WhatsApp status cannot be read in this workspace, so that count source
  // holds an error and no data. Each retry reports it as loading again.
  const statusState = () =>
    page.evaluate(() => {
      const client = window.__BUZZ_E2E_QUERY_CLIENT__ as unknown as {
        getQueryCache: () => {
          findAll: (filters: { queryKey: readonly unknown[] }) => Array<{
            queryKey: readonly unknown[];
            state: {
              errorUpdateCount: number;
              fetchStatus: string;
              status: string;
            };
          }>;
        };
      };
      const query = client
        .getQueryCache()
        .findAll({ queryKey: ["whatsapp-outreach"] })
        .find((candidate) => candidate.queryKey.at(-1) === "status");
      return query
        ? {
            errors: query.state.errorUpdateCount,
            fetchStatus: query.state.fetchStatus,
            status: query.state.status,
          }
        : null;
    });
  await expect
    .poll(statusState)
    .toMatchObject({ fetchStatus: "idle", status: "error" });
  const before = await statusState();

  await pill.evaluate((element) => {
    const seen: string[] = [];
    (
      window as unknown as { __NEEDS_YOU_TEXTS__: string[] }
    ).__NEEDS_YOU_TEXTS__ = seen;
    new MutationObserver(() => seen.push(element.textContent ?? "")).observe(
      element,
      { characterData: true, childList: true, subtree: true },
    );
  });
  await page.evaluate(() =>
    window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
      queryKey: ["whatsapp-outreach"],
    }),
  );
  await expect
    .poll(async () => {
      const state = await statusState();
      return (
        state !== null &&
        state.errors > (before?.errors ?? 0) &&
        state.fetchStatus === "idle"
      );
    })
    .toBe(true);

  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __NEEDS_YOU_TEXTS__: string[] })
          .__NEEDS_YOU_TEXTS__,
    ),
  ).toEqual([]);
  await expect(pill).toHaveText("1 need you");
});
