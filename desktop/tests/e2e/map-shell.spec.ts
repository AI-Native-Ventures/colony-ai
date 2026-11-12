import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures/lockedBrowserTest";
import type { Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import type { MockCompanyFunctionHead } from "../../src/testing/e2eBridge";
import { makeCofounderNumbersFixture } from "../../src/testing/cofounderNumbersFixtures";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const CAPTURE_DIR = process.env.MAP_SHELL_CAPTURE_DIR;
const APPROVAL_SWITCHES = {
  approveEveryHire: false,
  approvePlaybookChanges: false,
  approveEveryDiscoveryCampaign: false,
};
test.setTimeout(150_000);

const MAP_SHELL_WORKSPACES = [
  {
    id: "map-shell-workspace-one",
    name: "Signal Story",
    relayUrl: "ws://localhost:3000",
    addedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "map-shell-workspace-two",
    name: "Second workspace",
    relayUrl: "ws://localhost:3001",
    addedAt: "2026-01-02T00:00:00.000Z",
  },
];

function functionHead(
  functionId: MockCompanyFunctionHead["function"],
  state: MockCompanyFunctionHead["state"],
  leadPubkey?: string,
): MockCompanyFunctionHead {
  return { function: functionId, state, leadPubkey: leadPubkey ?? null };
}

function mapShellFixture(cofounderEnabled = true) {
  const relaySecret = generateSecretKey();
  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRole: "owner" as const,
    relayRequiresMembership: true,
    relayMembers: [
      { pubkey: OWNER_PUBKEY, role: "owner" as const },
      { pubkey: TEST_IDENTITIES.alice.pubkey, role: "member" as const },
      { pubkey: TEST_IDENTITIES.bob.pubkey, role: "member" as const },
    ],
    cofounderSettings: {
      enabled: cofounderEnabled,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: APPROVAL_SWITCHES,
    },
    referenceWorkspace: true,
    referenceWorkspaceBusinessName: "Horizon Labs",
    companyNumbers: makeCofounderNumbersFixture({
      ownerPubkey: OWNER_PUBKEY,
      scoutPubkey: TEST_IDENTITIES.bob.pubkey,
      salesLeadPubkey: TEST_IDENTITIES.alice.pubkey,
    }),
    companyFunctionHeads: [
      functionHead("sales", "filled", TEST_IDENTITIES.alice.pubkey),
      functionHead("operations", "covered_by_scout"),
    ],
    searchProfiles: [
      {
        pubkey: OWNER_PUBKEY,
        displayName: "Lerato Molefe",
        isAgent: false,
      },
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        displayName: "Aya",
        isAgent: true,
      },
      {
        pubkey: TEST_IDENTITIES.bob.pubkey,
        displayName: "Scout",
        isAgent: true,
      },
    ],
    relayAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        ownerPubkey: OWNER_PUBKEY,
        name: "Aya",
        agentType: "agent",
        status: "online" as const,
      },
      {
        pubkey: TEST_IDENTITIES.bob.pubkey,
        ownerPubkey: OWNER_PUBKEY,
        name: "Scout",
        agentType: "agent",
        status: "online" as const,
      },
    ],
    referenceWorkspaceOutreachSidebar: true,
  };
}

async function waitForMockBridge(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __TAURI_INTERNALS__?: unknown })
              .__TAURI_INTERNALS__,
          ),
        undefined,
        { timeout: 20_000 },
      );
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await page.reload();
    }
  }
}

async function prepareMapShell(
  page: Page,
  options: {
    theme: "light" | "dark";
    width: number;
    height: number;
    featureEnabled?: boolean;
    cofounderEnabled?: boolean;
    workspaces?: typeof MAP_SHELL_WORKSPACES;
  },
) {
  await page.emulateMedia({ colorScheme: options.theme });
  await page.addInitScript(({ theme }) => {
    window.localStorage.setItem(
      "buzz-theme",
      theme === "dark" ? "buzz-dark" : "buzz",
    );
    window.localStorage.setItem("buzz-follow-system", "false");
  }, options);
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_WHATSAPP__?: (request: {
        action: string;
        path?: string;
        body?: Record<string, unknown>;
      }) => Promise<unknown>;
    };
    testWindow.__BUZZ_E2E_WHATSAPP__ = async (request) => {
      if (request.action !== "post" || request.path !== "/api/whatsapp/query") {
        return {};
      }
      if (request.body?.what !== "contacts") return {};
      return {
        contacts: [
          {
            waId: "27821234567",
            e164: "+27821234567",
            displayName: "Lerato Mokoena",
            profileName: "Lerato",
            businessName: "Corner Cottage",
            website: null,
            label: null,
            leadId: null,
            ownerPubkey: null,
            threadRootEventId: null,
            lastInboundAt: null,
            lastContactedAt: null,
            lastOutboundState: null,
            lastFailureSummary: null,
            deliveryFailure: null,
            lastReplyAt: null,
            stage: "none",
            stageSetBy: "auto",
            stageChangedAt: null,
            queuedFrom: null,
            outreachStatus: null,
            hasSentOutbound: false,
            windowOpen: false,
            windowClosesAt: null,
            optedOut: false,
            paused: false,
            pauseReason: null,
            unanswered: true,
            awaitingApproval: false,
            businessOutreachStopped: false,
            businessStopReason: null,
          },
        ],
      };
    };
  });
  if (options.workspaces) {
    await page.addInitScript((workspaces) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify(workspaces),
      );
      window.localStorage.setItem("buzz-active-community-id", workspaces[0].id);
    }, options.workspaces);
  }
  await installMockBridge(page, mapShellFixture(options.cofounderEnabled), {
    skipCommunitySeed: Boolean(options.workspaces),
    seedPreviewFeatures: true,
    previewFeatureOverrides: { map_home: options.featureEnabled === true },
  });
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.goto("/#/");
  await waitForMockBridge(page);
  await expect(
    options.featureEnabled === true && options.cofounderEnabled !== false
      ? page.getByTestId("cofounder-company-map")
      : page.getByTestId("app-sidebar"),
  ).toBeVisible({ timeout: 15_000 });
}

async function capture(page: Page, name: string) {
  if (!CAPTURE_DIR) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    fullPage: false,
    path: join(CAPTURE_DIR, `${name}.png`),
  });
}

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

function pathname(url: string) {
  return new URL(url).hash.replace(/^#/, "").split(/[?#]/, 1)[0];
}

async function seedChatSectionPreferences(page: Page) {
  await page.evaluate(
    ({ generalChannelId, salesChannelId, ownerPubkey }) => {
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
    },
    {
      generalChannelId: REFERENCE_CHANNEL_IDS.general,
      salesChannelId: REFERENCE_CHANNEL_IDS.sales,
      ownerPubkey: OWNER_PUBKEY,
    },
  );
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
  for (const control of orderedControls.slice(0, 6)) {
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

  await seedChatSectionPreferences(page);
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
    chatsPopover.locator('[data-testid^="map-shell-room-"]').first(),
  ).toBeVisible();
  await expect(
    chatsPopover.getByTestId(`map-shell-room-${REFERENCE_CHANNEL_IDS.general}`),
  ).toBeVisible();
  await expect(
    chatsPopover.getByTestId(`map-shell-room-${REFERENCE_CHANNEL_IDS.sales}`),
  ).toBeVisible();
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
  expect(popoverMetrics).toEqual({
    height: 408,
    width: 340,
    borderRadius: "20px",
    padding: "12px",
  });
  const chatsListOverflow = await chatsPopover
    .locator(".map-shell-chats-list")
    .evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(chatsListOverflow).toBe(true);
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
  await page.getByTestId("map-shell-chats-button").click();
  const room = page.locator('[data-testid^="map-shell-room-"]').first();
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
  await page.keyboard.press("Escape");
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
  await capture(page, "light-390-phone-bar");

  await page.getByTestId("map-shell-mobile-menu-button").click();
  const sheet = page.getByTestId("map-shell-mobile-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Customers" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Team" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Activity" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Chats" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Your team" })).toBeVisible();
  await expect(
    sheet
      .getByTestId(`map-shell-dm-${REFERENCE_CHANNEL_IDS.scoutDm}`)
      .locator(".map-shell-count"),
  ).toHaveText("1");
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
  await page.goto("/#/company/function/operations");
  await expect(page.getByTestId("map-shell-trail")).toBeVisible();
  await page.getByTestId("map-shell-map-button").click();
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
