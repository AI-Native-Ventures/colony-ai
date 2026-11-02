import { mkdirSync } from "node:fs";

import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
  REFERENCE_OUTREACH_PEOPLE,
  REFERENCE_PROSPECT_IDS,
  referenceChannelLastMessageAt,
  referenceRestaurantProspectId,
} from "../../src/testing/e2eReferenceWorkspace";
import { cedarCafeLeadRecord } from "../../src/testing/cofounderCustomerFixtures";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const OUT = process.env.OL_UI_PROOF_DIR ?? "test-results/outreach-lists-ui";
const RELAY_SECRET = generateSecretKey();
const RELAY_SELF = getPublicKey(RELAY_SECRET);
const LIST_NAME = "Melville guesthouses, Nov";
const appPort = Number(process.env.COLONY_E2E_PORT ?? 4173);
let scoutMessageSequence = 0;
const test = base.extend({
  // Playwright requires the fixture argument to use object destructuring.
  // biome-ignore lint/correctness/noEmptyPattern: This fixture creates its own context.
  context: async ({}, use) => {
    const profile = process.env.OL_UI_CHROME_PROFILE;
    const options = {
      baseURL: `http://127.0.0.1:${appPort}`,
      viewport: { width: 1280, height: 720 },
    };
    if (profile) {
      const context = await chromium.launchPersistentContext(profile, {
        ...options,
        headless: true,
        channel: "chrome",
        args: ["--use-mock-keychain", "--password-store=basic"],
      });
      try {
        await use(context);
      } finally {
        await context.close();
      }
      return;
    }
    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--use-mock-keychain", "--password-store=basic"],
    });
    const context: BrowserContext = await browser.newContext(options);
    try {
      await use(context);
    } finally {
      await browser.close();
    }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});
const WHATSAPP_GUESTHOUSE_CONTACT_ROWS = [
  [
    "Jacaranda Lane Guesthouse",
    "+27 82 555 9900",
    REFERENCE_PROSPECT_IDS.stillroom,
  ],
  [
    "Koppie View Lodge",
    "+27 71 555 2286",
    REFERENCE_PROSPECT_IDS["north-note"],
  ],
  [
    "The Seventh Street Rooms",
    "+27 83 555 9031",
    REFERENCE_PROSPECT_IDS["studio-local"],
  ],
  [
    "Bramble & Brick Guesthouse",
    "+27 72 555 5517",
    REFERENCE_PROSPECT_IDS["woven-living"],
  ],
  [
    "Leafy Stoep Guesthouse",
    "+27 84 555 1173",
    REFERENCE_PROSPECT_IDS["little-kin"],
  ],
  [
    "Melville Manor B&B",
    "+27 11 555 0192",
    REFERENCE_PROSPECT_IDS["the-olive-house"],
  ],
  [
    "The Quiet Owl B&B",
    "+27 76 555 3842",
    REFERENCE_PROSPECT_IDS["quiet-owl-bb"],
  ],
  [
    "Marigold House",
    "+27 77 555 6604",
    REFERENCE_PROSPECT_IDS["marigold-house"],
  ],
  [
    "Melville Hill Cottages",
    "+27 84 555 7013",
    REFERENCE_PROSPECT_IDS["melville-hill-cottages"],
  ],
  [
    "Corner Cottage Parkhurst",
    "+27 72 555 1188",
    REFERENCE_PROSPECT_IDS["sunday-edit"],
  ],
  [
    "Lavender Hill Guesthouse",
    "+27 79 555 2241",
    REFERENCE_PROSPECT_IDS["gather-house"],
  ],
  [
    "The Green Shutter B&B",
    "+27 60 555 3422",
    REFERENCE_PROSPECT_IDS["common-ground"],
  ],
] as const;
const RESTAURANT_NO_PHONE_CONTACT_ROWS = [
  ["Johannesburg Restaurant 40", "", referenceRestaurantProspectId(39)],
  ["Johannesburg Restaurant 41", "", referenceRestaurantProspectId(40)],
] as const;

type ReferenceOptions = {
  colony3Sidebar?: boolean;
  whatsappGuesthouses?: boolean;
  mockWhatsApp?: boolean;
  outreachBoard?: boolean;
  outreachMentionBoard?: boolean;
  searchProfilesOnly?: boolean;
  restaurantsBoard?: boolean;
};

function johannesburgTodayAt(hour: number, minute: number): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Africa/Johannesburg",
    year: "numeric",
  }).formatToParts(new Date());
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return new Date(
    `${read("year")}-${read("month")}-${read("day")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+02:00`,
  );
}

async function openReference(
  page: Page,
  route: string,
  width: number,
  theme: "light" | "dark" = "light",
  options: ReferenceOptions = {},
) {
  mkdirSync(OUT, { recursive: true });
  await page.clock.setFixedTime(johannesburgTodayAt(10, 0));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
  await page.emulateMedia({ colorScheme: theme });
  const outreachMessageAt = Math.floor(
    Date.parse(referenceChannelLastMessageAt(20)) / 1_000,
  );
  const scoutMessageAt = Math.floor(
    Date.parse(referenceChannelLastMessageAt(48)) / 1_000,
  );
  await page.addInitScript(
    (themeName) => {
      const relayUrl = "ws://localhost:3000";
      const staleThemePrefixes = [
        "buzz-community-theme.v1:",
        "buzz-community-theme-outbox.v1:",
        "colony.appearance.v1:",
      ];
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (
          key &&
          staleThemePrefixes.some((prefix) => key.startsWith(prefix))
        ) {
          window.localStorage.removeItem(key);
        }
      }
      window.localStorage.removeItem("buzz-theme-cache");
      window.localStorage.setItem("buzz-theme", themeName);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem("buzz-accent-color", "#5B45BE");
      window.localStorage.setItem(
        `buzz-community-theme.v1:${"deadbeef".repeat(8)}:${encodeURIComponent(relayUrl)}`,
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    theme === "dark" ? "buzz-dark" : "buzz",
  );
  if (options.mockWhatsApp) {
    await page.addInitScript(
      ({
        leadBoard,
        restaurantsBoard,
        rows,
        scoutPubkey,
      }: {
        leadBoard: boolean;
        restaurantsBoard: boolean;
        rows: readonly (readonly [string, string, string])[];
        scoutPubkey: string;
      }) => {
        const windowWithMock = window as Window & {
          __BUZZ_E2E_WHATSAPP__?: (request: {
            action: "post" | "command";
            path?: string;
            body?: Record<string, unknown>;
            kind?: number;
          }) => Promise<unknown>;
        };
        const dateAtJohannesburgTime = (
          daysAgo: number,
          hour: number,
          minute: number,
        ) => {
          const parts = new Intl.DateTimeFormat("en-US", {
            day: "2-digit",
            month: "2-digit",
            timeZone: "Africa/Johannesburg",
            year: "numeric",
          }).formatToParts(new Date());
          const read = (type: string) =>
            Number(parts.find((part) => part.type === type)?.value ?? 0);
          const date = new Date(
            Date.UTC(read("year"), read("month") - 1, read("day") - daysAgo),
          );
          const stamp = [
            date.getUTCFullYear(),
            String(date.getUTCMonth() + 1).padStart(2, "0"),
            String(date.getUTCDate()).padStart(2, "0"),
          ].join("-");
          return `${stamp}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+02:00`;
        };
        const todayMorning = dateAtJohannesburgTime(0, 9, 40);
        const yesterdayMorning = dateAtJohannesburgTime(1, 10, 30);
        const template = {
          title: "Built a site for you",
          name: "hl_vb",
          proposedTitle: null,
          titleCustom: true,
          language: "en",
          category: "MARKETING",
          status: "APPROVED",
          body: "A short website idea for your guesthouse.",
          slots: 0,
          buttons: [],
        };
        const followUpTemplate = {
          ...template,
          title: "New site follow up",
          name: "hl_follow_up",
        };
        const readyBatchRows = rows
          .filter(
            ([businessName]) =>
              businessName !== "Melville Manor B&B" &&
              businessName !== "Hillside Hideaway",
          )
          .slice(0, 10);
        const pendingBatch = {
          batchId: "ol-ui-demo-batch",
          status: "pending",
          createdBy: scoutPubkey,
          template: "hl_vb",
          language: "en",
          note: "Scout wants to message 10 guesthouses in Melville",
          materialLinks: readyBatchRows.map(
            ([businessName]) =>
              `https://preview.example.com/${businessName.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-")}`,
          ),
          decidedBy: null,
          decidedAt: null,
          createdAt: "2026-11-02T10:46:00+02:00",
          nextSendAt: null,
          rows: readyBatchRows.map(([businessName, e164], idx) => ({
            idx,
            to: e164,
            leadId:
              idx < 4
                ? `1e1a7000-0000-4000-9000-${String(900096 + idx).padStart(12, "0")}`
                : null,
            params: ["guesthouses", "Melville"],
            preview: `Hey, my name is Pam from Horizon Labs. I came across ${businessName} while looking for guesthouses in Melville and built something for you. This site could be yours. Interested?`,
            state: "ready",
            skipReason: null,
          })),
          counts: { total: 10, ready: 10, sent: 0, failed: 0, dropped: 0 },
        };
        const contactFor = (
          businessName: string,
          e164: string,
          leadId: string,
          index: number,
        ) => {
          const boardIndex = index - 96;
          const boardSent = [4, 7, 9].includes(boardIndex);
          const boardReply = boardIndex === 8;
          const boardNoWhatsApp = [5, 10].includes(boardIndex);
          const boardOptedOut = boardIndex === 6;
          const contactedAt = leadBoard
            ? boardSent
              ? todayMorning
              : null
            : index === 2
              ? todayMorning
              : index === 3 || index === 4 || index === 7
                ? yesterdayMorning
                : null;
          const repliedAt = (leadBoard ? boardReply : index === 2)
            ? dateAtJohannesburgTime(0, 9, 35)
            : null;
          const noWhatsApp =
            restaurantsBoard || (leadBoard ? boardNoWhatsApp : index === 5);
          const lastOutboundState = leadBoard
            ? boardSent
              ? "sent"
              : null
            : index === 3
              ? "delivered"
              : index === 4
                ? "read"
                : index === 7
                  ? "sent"
                  : null;
          return {
            waId: e164.replace(/\D/gu, ""),
            e164,
            displayName: businessName,
            profileName: businessName,
            businessName,
            website: null,
            label: null,
            leadId,
            ownerPubkey: null,
            threadRootEventId: null,
            lastInboundAt: repliedAt,
            lastContactedAt: contactedAt,
            lastOutboundState,
            lastReplyAt: repliedAt,
            stage: noWhatsApp
              ? "not_on_whatsapp"
              : boardOptedOut
                ? "stopped"
                : repliedAt
                  ? "replied"
                  : contactedAt
                    ? "contacted"
                    : "none",
            stageSetBy: "auto",
            stageChangedAt: contactedAt,
            windowOpen: false,
            windowClosesAt: null,
            optedOut: boardOptedOut,
            paused: false,
            pauseReason: null,
            unanswered: false,
            awaitingApproval: false,
          };
        };
        const contacts = leadBoard
          ? rows.map(([businessName, e164], offset) => {
              const index = 96 + offset;
              return contactFor(
                businessName,
                index >= 106 ? "" : e164,
                `1e1a7000-0000-4000-9000-${String(900000 + index).padStart(12, "0")}`,
                index,
              );
            })
          : rows.map(([businessName, e164, leadId], index) =>
              contactFor(businessName, e164, leadId, index),
            );
        windowWithMock.__BUZZ_E2E_WHATSAPP__ = async (request) => {
          if (
            request.action !== "post" ||
            request.path !== "/api/whatsapp/query"
          ) {
            return {};
          }
          switch (request.body?.what) {
            case "status":
              return {
                connected: true,
                connectionId: "e2e-outreach-lists",
                displayPhoneNumber: "+27 61 534 0627",
                verifiedName: "Horizon Labs",
                quality: "GREEN",
                phoneStatus: "CONNECTED",
                dailyNewChatCap: 30,
                newChatsSentToday: 16,
                sendingPaused: false,
                pauseReason: null,
                issues: [],
                outreachChannelId: null,
                templatesSyncedAt: null,
                templates: [template, followUpTemplate],
                webhookUrl: null,
              };
            case "templates":
              return { templates: [template, followUpTemplate] };
            case "contacts":
              return { contacts };
            case "batches":
              return {
                batches: [
                  {
                    batchId: pendingBatch.batchId,
                    status: pendingBatch.status,
                    createdBy: pendingBatch.createdBy,
                    template: pendingBatch.template,
                    language: pendingBatch.language,
                    rows: pendingBatch.counts,
                    createdAt: pendingBatch.createdAt,
                  },
                ],
              };
            case "batch":
              return request.body?.batchId === pendingBatch.batchId
                ? pendingBatch
                : {};
            default:
              return {};
          }
        };
      },
      {
        leadBoard: options.outreachBoard === true,
        restaurantsBoard: options.restaurantsBoard === true,
        rows: options.restaurantsBoard
          ? RESTAURANT_NO_PHONE_CONTACT_ROWS
          : WHATSAPP_GUESTHOUSE_CONTACT_ROWS,
        scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
      },
    );
  }
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceWorkspaceBusinessName: "Horizon Labs",
    referenceWorkspaceOutreachReady: true,
    referenceWorkspaceLeadCount: options.outreachBoard ? 108 : undefined,
    referenceWorkspaceOutreachBoard: options.outreachBoard,
    referenceWorkspaceOutreachSidebar: true,
    cofounderSettings: {
      enabled: true,
      moneyPreference: "cheapest_first",
      approvalSwitches: {
        approveEveryHire: false,
        approvePlaybookChanges: false,
        approveEveryDiscoveryCampaign: false,
      },
    },
    companyMemberRelayPrivateKeyHex: bytesToHex(RELAY_SECRET),
    companyCustomerRecords: [
      {
        ...cedarCafeLeadRecord({
          scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
          ayaPubkey: REFERENCE_AGENTS.aya.pubkey,
          ownerPubkey: "deadbeef".repeat(8),
        }),
        partyId: REFERENCE_PROSPECT_IDS.stillroom,
        leadId: REFERENCE_PROSPECT_IDS.stillroom,
        displayName: "Jacaranda Lane Guesthouse",
      },
    ],
    referenceWorkspaceOutreachMentionBoard: options.outreachMentionBoard,
    referenceWorkspaceRestaurantsBoard: options.restaurantsBoard,
    referenceWorkspaceDisplayName: options.whatsappGuesthouses
      ? "Basheer Phiri"
      : options.outreachBoard ||
          options.outreachMentionBoard ||
          options.restaurantsBoard
        ? "Basheer Phiri"
        : undefined,
    colony3Sidebar:
      !options.outreachBoard &&
      !options.outreachMentionBoard &&
      (options.colony3Sidebar ||
        options.whatsappGuesthouses ||
        options.restaurantsBoard),
    searchProfiles:
      options.whatsappGuesthouses ||
      options.outreachBoard ||
      options.outreachMentionBoard
        ? [
            {
              pubkey: REFERENCE_AGENTS.scout.pubkey,
              displayName: "Scout",
              jobTitle: "Chief of Staff",
              isAgent: true,
              ownerPubkey: "deadbeef".repeat(8),
            },
            {
              pubkey: REFERENCE_OUTREACH_PEOPLE.aya.pubkey,
              displayName: "Aya Molefe",
              jobTitle: "Sales",
              isAgent: false,
            },
          ]
        : undefined,
    searchProfilesOnly: options.outreachBoard || options.outreachMentionBoard,
    colony3Extras:
      options.whatsappGuesthouses ||
      options.outreachBoard ||
      options.outreachMentionBoard
        ? {
            messages: [
              {
                channelId: REFERENCE_CHANNEL_IDS.outreach,
                id: "ol-ui-outreach-unread-1",
                pubkey: "self",
                createdAt: outreachMessageAt,
                content: "WhatsApp batch ready for review.",
              },
              {
                channelId: REFERENCE_CHANNEL_IDS.outreach,
                id: "ol-ui-outreach-unread-2",
                pubkey: REFERENCE_AGENTS.scout.pubkey,
                createdAt: outreachMessageAt + 60,
                content: "Two replies came in overnight.",
              },
              {
                channelId: REFERENCE_CHANNEL_IDS.scoutDm,
                id: "ol-ui-scout-morning-update",
                pubkey: REFERENCE_AGENTS.scout.pubkey,
                createdAt: scoutMessageAt,
                content:
                  "Morning. 3 replies came in overnight on WhatsApp; Seventh Street Rooms wants a call.",
              },
            ],
            lastMessageAt: {
              [REFERENCE_CHANNEL_IDS.scoutDm]: scoutMessageAt,
            },
          }
        : undefined,
    relayAgents:
      options.whatsappGuesthouses ||
      options.outreachBoard ||
      options.outreachMentionBoard
        ? [
            {
              pubkey: REFERENCE_AGENTS.scout.pubkey,
              ownerPubkey: "deadbeef".repeat(8),
              name: REFERENCE_AGENTS.scout.name,
              channelIds: [
                REFERENCE_CHANNEL_IDS.scoutDm,
                REFERENCE_CHANNEL_IDS.sales,
              ],
            },
          ]
        : undefined,
    whatsappGuesthouses: options.whatsappGuesthouses,
    relayRole: "owner",
    relayRequiresMembership: true,
    relayMembers: [{ pubkey: "deadbeef".repeat(8), role: "owner" }],
    relaySelf: RELAY_SELF,
  });
  await page.goto(`/#${route}`);
  await page.reload();
  if (route.startsWith("/channels/")) {
    await expect(page.getByTestId("message-input")).toBeVisible();
  } else {
    const screenTestId =
      route === "/campaign"
        ? "w10-campaign-page"
        : route.startsWith("/sales/lead/")
          ? "w10-prospect-page"
          : "w10-leads-page";
    await expect(page.getByTestId(screenTestId)).toBeVisible();
  }
  if (options.outreachMentionBoard && width !== 390) {
    const businessToggle = page.getByTestId("sidebar-nav-business-toggle");
    if ((await businessToggle.getAttribute("aria-expanded")) !== "true") {
      await businessToggle.click();
    }
    await expect(businessToggle).toHaveAttribute("aria-expanded", "true");
  }
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(theme === "dark");
}

async function capture(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  const heights: Record<string, number> = {
    OLAddToList: 1100,
    OLCampaignSelect: 1160,
    OLCampaignSelectDark: 1160,
    OLChatResolved: 1800,
    OLChatResolvedDark: 1800,
    OLFilterMenu: 1160,
    OLLeadPhone: 900,
    OLLeadPhoneDark: 900,
    OLLeadsSelect: 1240,
    OLLeadsSelectDark: 1240,
    OLLeadsSelectMore: 1240,
    OLListPage: 1140,
    OLListPageDark: 1140,
    OLMentionPicker: 1000,
    OLMentionPickerDark: 1000,
    OLSidebar: 1240,
  };
  const originalViewport = page.viewportSize();
  const height = heights[name];
  if (originalViewport && height && originalViewport.height !== height) {
    await page.setViewportSize({ ...originalViewport, height });
  }
  await page.mouse.move(0, 0);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    ...(clip ? { clip } : { fullPage: false }),
    path: `${OUT}/${name}.png`,
  });
  if (originalViewport && height && originalViewport.height !== height) {
    await page.setViewportSize(originalViewport);
  }
}

async function jumpTimelineToLatest(page: Page) {
  const jumpToLatest = page.getByTestId("message-scroll-to-latest");
  const timeline = page.getByTestId("message-timeline");
  const isTimelineAtBottom = () =>
    timeline.evaluate(
      (element) =>
        element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
    );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await jumpToLatest.isVisible())) break;
    await jumpToLatest.click();
    await expect.poll(isTimelineAtBottom, { timeout: 3_000 }).toBe(true);
    await page.waitForTimeout(120);
    if (await jumpToLatest.isVisible()) {
      const bounds = await timeline.boundingBox();
      if (bounds) {
        await page.mouse.move(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
        await page.mouse.wheel(0, -160);
        await page.mouse.wheel(0, 4_000);
      }
    }
  }
  await expect(jumpToLatest).toBeHidden();
}

async function waitForMockLiveSubscription(
  page: Page,
  channelName: string,
  kind?: number,
) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ channelName: name, kind: subscribedKind }) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
            kind: subscribedKind,
          }) ?? false,
        { channelName, kind },
      ),
    )
    .toBe(true);
}

async function seedOutreachUnread(page: Page) {
  await page.evaluate((channelId) => {
    window.location.hash = `/channels/${channelId}`;
  }, REFERENCE_CHANNEL_IDS.outreach);
  await page.getByRole("button", { name: "Discussion", exact: true }).click();
  await expect(page.getByTestId("message-input")).toBeVisible();
  await waitForMockLiveSubscription(page, "Outreach", 40002);
  await page.evaluate((channelId) => {
    window.location.hash = `/channels/${channelId}`;
  }, REFERENCE_CHANNEL_IDS.general);
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "Outreach", 40002);
  const latestFixtureMessageAt = Math.floor(
    Date.parse(referenceChannelLastMessageAt(20)) / 1_000,
  );
  const firstCreatedAt = Math.max(
    Math.floor(Date.now() / 1_000) + 60,
    latestFixtureMessageAt + 120,
  );
  for (const [index, content] of [
    "WhatsApp batch ready for review.",
    "Two replies came in overnight.",
  ].entries()) {
    const eventId = await page.evaluate(
      ({ author, body, createdAt }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "Outreach",
          content: body,
          pubkey: author,
          kind: 40002,
          createdAt,
        })?.id,
      {
        author: REFERENCE_AGENTS.scout.pubkey,
        body: content,
        createdAt: firstCreatedAt + index,
      },
    );
    expect(eventId).toBeTruthy();
  }
  await expect(page.getByTestId("channel-unread-Outreach")).toHaveText(
    "2 unread notifications",
  );
  await page.evaluate(() => {
    window.location.hash = "/leads";
  });
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  await expect(page.getByTestId("channel-unread-Outreach")).toHaveText(
    "2 unread notifications",
  );
  await expect(page.getByTestId("channel-unread-Sales")).toHaveCount(0);
}

async function emitScoutMessage(
  page: Page,
  content: string,
  extraTags: string[][] = [],
  createdAtOverride?: Date,
) {
  await waitForMockLiveSubscription(page, "Scout");
  const latestFixtureMessageAt = Math.floor(
    Date.parse(referenceChannelLastMessageAt(48)) / 1_000,
  );
  const pageNow = await page.evaluate(() => Math.floor(Date.now() / 1_000));
  const createdAt = createdAtOverride
    ? Math.floor(createdAtOverride.getTime() / 1_000)
    : Math.max(pageNow + 60, latestFixtureMessageAt + 120) +
      scoutMessageSequence++;
  const eventId = await page.evaluate(
    ({ scoutPubkey, body, tags, createdAt: eventCreatedAt }) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Scout",
        content: body,
        pubkey: scoutPubkey,
        extraTags: tags,
        createdAt: eventCreatedAt,
      })?.id,
    {
      scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
      body: content,
      tags: extraTags,
      createdAt,
    },
  );
  expect(eventId).toBeTruthy();
  return eventId;
}

async function emitPendingBatchNotice(
  page: Page,
  listId: string,
  createdAtOverride?: Date,
) {
  await emitScoutMessage(
    page,
    "10 are ready, each with a website preview. Nothing goes out until you approve.",
    [
      ["wa-notice", "batch_pending"],
      ["wa-batch", "ol-ui-demo-batch"],
      ["list", listId],
      ["wa-template", "hl_vb:en"],
      [
        "wa-skipped",
        "2 of 12: Melville Manor B&B has no WhatsApp number, Hillside Hideaway opted out.",
      ],
    ],
    createdAtOverride,
  );
  await expect(
    page.getByTestId("whatsapp-channel-batch-pending"),
  ).toBeVisible();
}

test.describe("Outreach lists", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("creates a campaign list, previews a batch, and references it in Scout chat", async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openReference(page, "/leads", 1440, "light", {
      mockWhatsApp: true,
      outreachBoard: true,
    });
    const leads = page.getByTestId("w10-leads-page");
    await expect(leads).toBeVisible();
    await expect(page.getByTestId("mobile-workspace-header")).toHaveCount(0);
    await seedOutreachUnread(page);
    await capture(page, "OLSidebar", { x: 0, y: 0, width: 280, height: 1240 });
    const whatsappMenu = page.locator(".c3l-whatsapp-filter-menu");
    await whatsappMenu.locator(":scope > summary").click();
    const whatsappMenuContent = page.locator(
      ".c3l-whatsapp-filter-menu-content",
    );
    await expect(whatsappMenuContent).toBeVisible();
    await expect(whatsappMenuContent).toContainText("97");
    await expect(whatsappMenuContent).toContainText(
      "In a batch, waiting for you4",
    );
    await expect(whatsappMenuContent).toContainText("Sent3");
    await expect(whatsappMenuContent).toContainText("Replied1");
    await expect(whatsappMenuContent).toContainText("Opted out1");
    await expect(whatsappMenuContent).toContainText("No WhatsApp number2");
    await expect(whatsappMenuContent).toContainText(
      "In a batch, waiting for you",
    );
    await expect(whatsappMenuContent).toContainText(
      "Counts are for leads with a phone number.",
    );
    await capture(page, "OLFilterMenu");
    await whatsappMenu.locator(":scope > summary").click();

    await page.locator(".c3l-filter-menu > summary").click();
    const filterMenu = page.locator(".c3l-filter-menu-content");
    await expect(filterMenu).toBeVisible();
    const phoneOption = filterMenu
      .locator("label")
      .filter({ hasText: "Has phone number" });
    const whatsappOption = filterMenu
      .locator("label")
      .filter({ hasText: "Not contacted" });
    const stageOption = filterMenu.locator("label").filter({ hasText: "New" });
    await expect(phoneOption).toContainText("106");
    await expect(whatsappOption).toContainText("97");
    await expect(stageOption).toContainText("96");
    await phoneOption.getByRole("checkbox").check();
    await whatsappOption.getByRole("checkbox").check();
    await stageOption.getByRole("checkbox").check();
    await expect(page.locator(".c3l-match-count")).toHaveText(
      "96 of 108 match",
    );
    await page.locator(".c3l-filter-menu > summary").click();
    await leads
      .getByRole("checkbox", { name: "Select all 8 leads on this page" })
      .check();
    const selectionToolbar = page.getByRole("toolbar", {
      name: "Selected leads",
    });
    await expect(selectionToolbar).toContainText("8 selected");
    await expect(
      page.getByRole("button", {
        name: "Select all 96 matching leads",
      }),
    ).toBeVisible();
    await capture(page, "OLLeadsSelect");
    const desktopMore = selectionToolbar.locator(
      ".c3l-selection-more > summary",
    );
    await desktopMore.click();
    await expect(page.getByRole("button", { name: "Mark lost" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Discuss in Sales" }),
    ).toBeVisible();
    const leadStageMenu = selectionToolbar.locator(".c3l-selection-stage-menu");
    await leadStageMenu.locator(":scope > summary").click();
    await expect(
      leadStageMenu.getByRole("button", { name: "Qualified" }),
    ).toBeVisible();
    await leadStageMenu.locator(":scope > summary").click();
    await capture(page, "OLLeadsSelectMore");
    await desktopMore.click();

    await page
      .getByRole("button", { name: "Select all 96 matching leads" })
      .click();
    await expect(selectionToolbar).toContainText("96 selected");
    await selectionToolbar
      .getByRole("button", { name: "Add to outreach list" })
      .click();
    const leadAddDialog = page.getByTestId("outreach-list-dialog");
    await expect(leadAddDialog).toBeVisible();
    await expect(leadAddDialog).toContainText(
      "Add 96 leads to an outreach list",
    );
    await expect(leadAddDialog).toContainText(
      "Every lead with a phone number, not contacted on WhatsApp, stage New.",
    );
    await expect(leadAddDialog).toContainText("12 leads · used today");
    await expect(leadAddDialog).toContainText(
      "41 leads · from Restaurants prospects",
    );
    await expect(leadAddDialog).toContainText("6 leads · used 3 weeks ago");
    const newListName = leadAddDialog.getByRole("textbox", {
      name: "New list name",
    });
    await expect(newListName).toBeVisible();
    const newListOption = leadAddDialog.locator(".c3l-outreach-new-option");
    await expect(newListOption).toHaveClass(/c3l-outreach-list-option/);
    await expect(newListOption).toHaveClass(/is-selected/);
    await expect(newListOption).toHaveCSS("border-top-width", "2px");
    const newListOptionBackground = await newListOption.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(newListOptionBackground).not.toBe("rgb(255, 255, 255)");
    const newListNameBox = await newListName.boundingBox();
    if (!newListNameBox) throw new Error("New list name has no bounds");
    expect(newListNameBox.width).toBeGreaterThan(400);
    await newListName.evaluate((input) => input.blur());
    await capture(page, "OLAddToList");
    await leadAddDialog.getByRole("button", { name: "Cancel" }).click();
    await selectionToolbar.getByRole("button", { name: "Ask Scout" }).click();
    await expect(page).toHaveURL(new RegExp(REFERENCE_CHANNEL_IDS.scoutDm));

    await openReference(page, "/campaign", 1440, "light", {
      mockWhatsApp: true,
      restaurantsBoard: true,
    });
    const campaign = page.getByTestId("w10-campaign-page");
    await expect(
      campaign.getByRole("heading", { name: "Restaurants prospects" }),
    ).toBeVisible();
    await expect(campaign.locator(".c3d-run")).toHaveCount(0);
    await expect(campaign.getByLabel("Filter prospects")).toHaveCount(0);
    await expect(campaign.getByLabel("Export visible prospects")).toHaveCount(
      0,
    );
    await campaign.locator(".c3l-filter-menu > summary").click();
    const campaignFilters = campaign.locator(".c3l-filter-menu-content");
    await expect(
      campaignFilters.locator("label").filter({ hasText: "Has phone number" }),
    ).toContainText("39");
    await expect(
      campaignFilters.locator("label").filter({ hasText: "Not contacted" }),
    ).toContainText("39");
    await campaignFilters
      .locator("label")
      .filter({ hasText: "Has phone number" })
      .getByRole("checkbox")
      .check();
    await campaignFilters
      .locator("label")
      .filter({ hasText: "Not contacted" })
      .getByRole("checkbox")
      .check();
    await campaign.locator(".c3l-filter-menu > summary").click();
    await expect(campaign.locator(".c3l-match-count")).toHaveText(
      "39 of 41 match",
    );
    await campaign
      .getByRole("checkbox", { name: "Select all 7 prospects on this page" })
      .check();
    const campaignToolbar = page.getByRole("toolbar", {
      name: "Selected prospects",
    });
    await expect(campaignToolbar).toContainText("7 selected");
    await expect(
      campaignToolbar.getByRole("button", { name: "Accept as lead" }),
    ).toBeVisible();
    const campaignMore = campaignToolbar.locator(
      ".c3d-selection-more > summary",
    );
    await campaignMore.click();
    await expect(
      campaignToolbar.getByRole("button", { name: "Discuss in Sales" }),
    ).toBeVisible();
    const campaignStageMenu = campaignToolbar.locator(
      ".c3d-selection-stage-menu",
    );
    await campaignStageMenu.locator(":scope > summary").click();
    await expect(
      campaignStageMenu.getByRole("button", { name: "Qualified" }),
    ).toBeVisible();
    await campaignStageMenu.locator(":scope > summary").click();
    await campaignMore.click();
    await expect(
      campaignToolbar.getByRole("button", { name: "Clear selection" }),
    ).toBeVisible();
    const campaignToolbarBox = await campaignToolbar.boundingBox();
    if (!campaignToolbarBox) throw new Error("Campaign toolbar has no bounds");
    expect(campaignToolbarBox.height).toBeLessThanOrEqual(64);
    expect(campaignToolbarBox.width).toBeLessThanOrEqual(1105);
    await expect(
      campaign.getByTestId("campaign-selection-page-notice"),
    ).toContainText("All 7 on this page are selected.");
    await expect(
      campaign.getByRole("button", {
        name: "Select all 39 matching prospects",
      }),
    ).toBeVisible();
    await capture(page, "OLCampaignSelect");
    await campaign
      .getByRole("button", { name: "Select all 39 matching prospects" })
      .click();
    await expect(campaignToolbar).toContainText("39 selected");
    await campaignToolbar.getByRole("button", { name: "Ask Scout" }).click();
    await expect(page).toHaveURL(new RegExp(REFERENCE_CHANNEL_IDS.scoutDm));
    await openReference(page, "/campaign", 1440, "light", {
      whatsappGuesthouses: true,
      mockWhatsApp: true,
    });
    const listCampaign = page.getByTestId("w10-campaign-page");
    await listCampaign
      .getByRole("checkbox", { name: "Select Jacaranda Lane Guesthouse" })
      .check();
    const listCampaignToolbar = page.getByRole("toolbar", {
      name: "Selected prospects",
    });
    await page
      .getByRole("button", { name: "Select all 12 matching prospects" })
      .click();
    await expect(listCampaignToolbar).toContainText("12 selected");
    await listCampaignToolbar
      .getByRole("button", { name: "Add to outreach list" })
      .click();
    const addDialog = page.getByTestId("outreach-list-dialog");
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("New list name").fill(LIST_NAME);
    await addDialog.getByRole("button", { name: "Create list" }).click();
    await expect(addDialog).toBeHidden();

    await page.evaluate(() => {
      window.location.hash = "/lists";
    });
    const lists = page.getByTestId("outreach-lists-page");
    await expect(lists.getByRole("link", { name: LIST_NAME })).toBeVisible();
    const href = await lists
      .getByRole("link", { name: LIST_NAME })
      .getAttribute("href");
    const listId = href?.split("/").at(-1);
    expect(listId).toBeTruthy();
    await capture(page, "OLListsIndex");

    await lists.getByRole("link", { name: LIST_NAME }).click();
    const detail = page.getByTestId("outreach-list-detail");
    await expect(
      detail.getByRole("heading", { name: LIST_NAME }),
    ).toBeVisible();
    await expect(
      detail.getByRole("link", { name: "Jacaranda Lane Guesthouse" }),
    ).toBeVisible();
    await expect(detail).toContainText("Guesthouses, Johannesburg");
    const summary = detail.getByRole("region", { name: "List summary" });
    const metrics = summary.locator(".c3l-list-summary-card");
    await expect(metrics).toHaveCount(4);
    await expect(metrics.nth(0)).toContainText("12");
    await expect(metrics.nth(1)).toContainText("11");
    await expect(metrics.nth(2)).toContainText("4");
    await expect(metrics.nth(3)).toContainText("1");
    await detail
      .getByLabel("Default WhatsApp template")
      .selectOption("hl_vb:en");
    await expect(detail).toContainText("Built a site for you");
    await expect(detail.getByRole("status")).toBeHidden();
    await capture(page, "OLListPage");
    await detail
      .getByRole("button", { name: "Prepare WhatsApp batch" })
      .click();
    const batch = page.getByTestId("outreach-batch-dialog");
    await expect(batch).toBeVisible();
    await expect(batch).toContainText("Sending waits for approval.");
    await expect(
      batch.getByRole("button", { name: "Prepare for approval" }),
    ).toBeEnabled();
    await capture(page, "OLListBatchApproval");
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      window.location.hash = "/leads";
    });
    await expect(leads).toBeVisible();
    await leads
      .locator("tbody tr")
      .filter({ hasText: "Jacaranda Lane Guesthouse" })
      .getByRole("link", { name: "Review lead" })
      .click();
    const lead = page.getByTestId("w10-prospect-page");
    await expect(
      lead.getByRole("button", { name: "Make client" }),
    ).toBeVisible();
    const contact = lead.locator(
      'section[aria-labelledby="c3l-contact-title"]',
    );
    const whatsApp = lead.getByTestId("whatsapp-lead-detail-card");
    await expect(contact).toContainText("+27 82 555 4410");
    await expect(contact).toContainText("Google Maps");
    await expect(contact).toContainText("Nomsa");
    await expect(contact).toContainText("4th Avenue, Melville, Johannesburg");
    await expect(whatsApp).toContainText("Uses the business phone.");
    await expect(whatsApp).toContainText("+27 82 555 4410");
    await expect(whatsApp).toContainText(LIST_NAME);
    await expect(page.getByTestId("lead-breadcrumb")).toContainText(
      /Business\s*\/\s*Sales\s*\/\s*Leads\s*\/\s*Jacaranda Lane Guesthouse/,
    );
    await capture(page, "OLLeadPhone");
    await whatsApp.getByRole("button", { name: "Use another number" }).click();
    const numberDialog = page.getByTestId("whatsapp-number-dialog");
    await numberDialog.getByLabel("WhatsApp number").fill("+27 82 555 9901");
    await numberDialog.getByRole("button", { name: "Save number" }).click();
    await expect(numberDialog).toBeHidden();
    await expect(whatsApp).toContainText("+27825559901");
    await expect(whatsApp).toContainText("Using the saved WhatsApp number.");
    await whatsApp.getByRole("button", { name: "Use another number" }).click();
    await numberDialog
      .getByRole("button", { name: "Use business phone" })
      .click();
    await expect(numberDialog).toBeHidden();
    await expect(whatsApp).toContainText("+27 82 555 4410");
    await expect(whatsApp).toContainText("Uses the business phone.");
    await page.getByRole("button", { name: "Ask Scout" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`),
    );
    await expect(page.getByTestId("message-input")).toBeVisible();
    const picker = page.getByTestId("lead-reference-picker");
    const composer = page.getByTestId("message-input");
    await page.getByTestId("reference-lead-button").click();
    await expect(picker).toBeVisible();
    const identities = picker.getByRole("region", {
      name: "People and agents",
    });
    await expect(
      identities.getByRole("button", { name: /Scout/ }),
    ).toBeVisible();
    await expect(
      identities.getByRole("button", { name: /Scout/ }),
    ).toContainText("AI employee");
    await page.keyboard.press("Escape");
    await composer.pressSequentially("@", { delay: 60 });
    await expect(picker).toBeVisible();
    await composer.pressSequentially("Scout", { delay: 60 });
    await picker
      .getByRole("region", { name: "People and agents" })
      .getByRole("button", { name: /Scout/ })
      .click();
    await composer.pressSequentially(" research ");
    await composer.pressSequentially(`@${LIST_NAME}`);
    const search = picker.getByRole("textbox", {
      name: "Search mentions and references",
    });
    await expect(search).toHaveValue(LIST_NAME);
    const listChoice = picker.getByTestId(`outreach-mention-list-${listId}`);
    await expect(listChoice).toBeVisible();
    await search.press("Enter");

    const chip = composer.locator(
      `[data-composer-buzz-link][data-href="buzz://list/${listId}"]`,
    );
    await expect(chip).toContainText(LIST_NAME);
    await page.keyboard.type(" more and update their records");
    await page.clock.setFixedTime(johannesburgTodayAt(10, 12));
    await page.getByTestId("send-message").click();
    await emitScoutMessage(
      page,
      "Done for 12 guesthouses. 9 records now have a website, phone or contact name added.",
      [
        ["list", listId],
        [
          "lead-update-summary",
          JSON.stringify({
            schemaVersion: 1,
            listId,
            listName: LIST_NAME,
            updatedCount: 9,
            updatedFields: "website, phone or contact name added",
            missingWebsite: [
              "Melville Manor B&B",
              "Hillside Hideaway",
              "Fourth Avenue Rooms",
            ],
            source: "Each change shows on the lead with the page Scout used",
          }),
        ],
      ],
      johannesburgTodayAt(10, 19),
    );
    const updateSummary = page.getByTestId("lead-update-summary");
    await expect(updateSummary).toContainText(
      "9 records: website, phone or contact name added",
    );
    await expect(updateSummary).toContainText(
      "Melville Manor B&B, Hillside Hideaway, Fourth Avenue Rooms",
    );
    await expect(
      updateSummary.getByRole("button", { name: "Open the list" }),
    ).toBeVisible();
    await composer.pressSequentially("@Scout");
    await picker
      .getByRole("region", { name: "People and agents" })
      .getByRole("button", { name: /Scout/ })
      .click();
    await composer.pressSequentially(" prepare WhatsApp messages for ");
    await composer.pressSequentially(`@${LIST_NAME}`);
    await expect(search).toHaveValue(LIST_NAME);
    await search.press("Enter");
    await composer.pressSequentially(" with @Built a site for you");
    await expect(search).toHaveValue("Built a site for you");
    await picker
      .getByRole("region", { name: "Templates" })
      .getByRole("button", { name: /Built a site for you/ })
      .click();
    await expect(
      composer.locator(
        '[data-composer-buzz-link][data-buzz-link-kind="template"]',
      ),
    ).toHaveAttribute("data-href", "buzz://template/hl_vb?lang=en");
    await page.clock.setFixedTime(johannesburgTodayAt(10, 24));
    await page.getByTestId("send-message").click();
    const templateReference = page
      .locator(".c3o-reference")
      .filter({
        hasText: /Built a site for you|This template is no longer available/,
      })
      .last();
    await expect(templateReference).toHaveAttribute("data-state", "ready");
    await expect(templateReference).toContainText("Built a site for you");
    await emitPendingBatchNotice(page, listId, johannesburgTodayAt(10, 31));
    const pendingCard = page.getByTestId("whatsapp-channel-batch-pending");
    await expect(pendingCard).toContainText(LIST_NAME);
    await expect(pendingCard).toContainText("Built a site for you");
    await expect(pendingCard).toContainText("Skipped 2 of 12");
    await expect(pendingCard).toContainText("Jacaranda Lane Guesthouse");
    const firstPendingRow = pendingCard.getByTestId(
      "whatsapp-channel-batch-row-0",
    );
    await expect(
      firstPendingRow.getByRole("link", { name: /Website preview/ }),
    ).toBeVisible();
    await expect(
      firstPendingRow.getByRole("button", { name: "Edit" }),
    ).toBeVisible();
    await expect(
      firstPendingRow.getByRole("button", { name: "Remove" }),
    ).toBeVisible();
    await expect(
      pendingCard.getByRole("button", { name: "Approve all 10" }),
    ).toBeEnabled();
    const reference = page
      .getByRole("button", {
        name: `Open outreach list: ${LIST_NAME}`,
      })
      .last();
    await expect(reference).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1800 });
    await jumpTimelineToLatest(page);
    await capture(page, "OLChatResolved");
    await reference.click();
    await expect(page.getByTestId("outreach-list-detail")).toBeVisible();

    await openReference(
      page,
      `/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`,
      1440,
      "light",
      { mockWhatsApp: true, outreachMentionBoard: true },
    );
    await expect(
      page.getByText(
        "Morning. 3 replies came in overnight on WhatsApp; Seventh Street Rooms wants a call.",
      ),
    ).toBeVisible();
    const boardComposer = page.getByTestId("message-input");
    await boardComposer.pressSequentially("@Scout");
    const boardPicker = page.getByTestId("lead-reference-picker");
    await expect(boardPicker).toBeVisible();
    await boardPicker
      .getByRole("region", { name: "People and agents" })
      .getByRole("button", { name: /Scout/ })
      .click();
    await boardComposer.pressSequentially(" prepare WhatsApp messages for ");
    await boardComposer.pressSequentially("@Melville guesthouses, Nov");
    await expect(boardPicker).toBeVisible();
    await boardPicker
      .getByRole("region", { name: "Lists" })
      .getByRole("button", { name: /Melville guesthouses, Nov/ })
      .click();
    await boardComposer.pressSequentially(" with @");
    await expect(boardPicker).toBeVisible();
    const boardLists = boardPicker.getByRole("region", { name: "Lists" });
    await expect(boardLists).toContainText("Melville guesthouses, follow up");
    await expect(boardLists.locator(".c3r-name")).toHaveText([
      "Melville guesthouses, Nov",
      "Melville guesthouses, follow up",
    ]);
    await expect(
      boardPicker.getByRole("region", { name: "Campaigns" }),
    ).toContainText("Discovery · 24 found");
    await expect(
      boardPicker.getByRole("region", { name: "Templates" }),
    ).toContainText("New site follow up");
    await expect(
      boardPicker.getByRole("region", { name: "Templates" }),
    ).toContainText("Marketing · approved");
    await capture(page, "OLMentionPicker");
    const boardPeople = boardPicker.getByRole("region", {
      name: "People and agents",
    });
    await expect(
      boardPeople.getByRole("button", { name: /Aya Molefe/ }),
    ).toContainText("Sales");
    const boardLeads = boardPicker.getByRole("region", { name: "Leads" });
    await expect(boardLeads.locator(".c3r-name")).toHaveText([
      "Melville Manor B&B",
    ]);
    await expect(boardLeads.locator(".c3r-meta")).toHaveText(["Lead · New"]);
    await expect(
      page
        .getByTestId("dm-list")
        .locator('button[data-testid^="channel-"] [data-sidebar-row-label]'),
    ).toHaveText(["Scout", "Aya"]);
    const boardSearch = boardPicker.getByRole("textbox", {
      name: "Search mentions and references",
    });
    await expect(boardSearch).toHaveValue("");
    await expect(boardPicker.locator(".c3r-mention-search-wrap")).toHaveCSS(
      "clip-path",
      "inset(50%)",
    );
    await capture(page, "OLMentionPicker");
  });

  test("keeps lead selection and the shared list inside a 390px view", async ({
    page,
  }) => {
    await openReference(page, "/leads", 390, "light", {
      whatsappGuesthouses: true,
      mockWhatsApp: true,
      outreachBoard: true,
    });
    const leads = page.getByTestId("w10-leads-page");
    await expect(leads).toBeVisible();
    await expect(page.getByTestId("mobile-workspace-header")).toHaveCount(0);
    await expect(page.getByTestId("leads-mobile-header")).toBeVisible();
    for (const name of [
      "Jacaranda Lane Guesthouse",
      "Koppie View Lodge",
      "Bramble & Brick Guesthouse",
      "Leafy Stoep Guesthouse",
      "Melville Manor B&B",
      "Hillside Hideaway",
    ]) {
      await leads.getByRole("checkbox", { name: `Select ${name}` }).check();
    }
    const toolbar = page.getByRole("toolbar", { name: "Selected leads" });
    await expect(leads.locator(".c3l-match-select-all")).toBeVisible();
    await expect(leads.locator(".c3l-page-selection-note")).toBeHidden();
    await expect(toolbar.locator(".c3l-selection-link")).toBeHidden();
    await expect(
      toolbar.getByRole("button", { name: "Add to list" }),
    ).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Batch" })).toBeVisible();
    await expect(
      toolbar.locator(".c3l-selection-more > summary"),
    ).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Clear" })).toBeVisible();
    const toolbarBox = await toolbar.boundingBox();
    if (!toolbarBox) throw new Error("Selection toolbar has no bounds");
    expect(toolbarBox.x).toBeGreaterThanOrEqual(0);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(391);
    await leads.evaluate((element) => element.scrollTo({ top: 0 }));
    await capture(page, "OLMobileSelect");

    await openReference(page, "/campaign", 390, "light", {
      whatsappGuesthouses: true,
      mockWhatsApp: true,
    });
    const campaign = page.getByTestId("w10-campaign-page");
    await campaign
      .getByRole("checkbox", { name: "Select Jacaranda Lane Guesthouse" })
      .check();
    const campaignToolbar = page.getByRole("toolbar", {
      name: "Selected prospects",
    });
    await page
      .getByRole("button", { name: "Select all 12 matching prospects" })
      .click();
    await expect(campaignToolbar).toContainText("12 selected");
    await campaignToolbar
      .getByRole("button", { name: "Add to outreach list" })
      .click();
    const dialog = page.getByTestId("outreach-list-dialog");
    await dialog.getByLabel("New list name").fill("Melville guesthouses, Nov");
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(dialog).toBeHidden();

    await page.evaluate(() => {
      window.location.hash = "/lists";
    });
    const lists = page.getByTestId("outreach-lists-page");
    await expect(
      lists.getByRole("link", { name: "Melville guesthouses, Nov" }),
    ).toBeVisible();
    await lists
      .getByRole("link", { name: "Melville guesthouses, Nov" })
      .click();
    const mobileList = page.getByTestId("outreach-list-detail");
    await expect(mobileList).toBeVisible();
    await expect(page.getByTestId("mobile-workspace-header")).toHaveCount(0);
    await expect(page.getByTestId("list-mobile-header")).toBeVisible();
    await mobileList
      .getByLabel("Default WhatsApp template")
      .selectOption("hl_vb:en");
    await expect(mobileList).toContainText("Built a site for you");
    await expect(mobileList.getByRole("status")).toBeHidden();
    const firstMobileMember = mobileList
      .locator(".c3l-list-members tbody tr")
      .filter({ hasText: "Jacaranda Lane Guesthouse" });
    await expect(
      firstMobileMember.locator(".c3l-list-status-badge:visible"),
    ).toHaveCount(1);
    await mobileList.evaluate((element) => element.scrollTo({ top: 0 }));
    await capture(page, "OLMobileList");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    await page.evaluate((channelId) => {
      window.location.hash = `/channels/${channelId}`;
    }, REFERENCE_CHANNEL_IDS.scoutDm);
    await expect(page.getByTestId("message-input")).toBeVisible();
    const composer = page.getByTestId("message-input");
    const picker = page.getByTestId("lead-reference-picker");
    await composer.pressSequentially("@Scout");
    await picker
      .getByRole("region", { name: "People and agents" })
      .getByRole("button", { name: /Scout/ })
      .click();
    await composer.pressSequentially(" prepare messages for ");
    await composer.pressSequentially(`@${LIST_NAME}`);
    await picker
      .getByRole("region", { name: "Lists" })
      .getByRole("button", { name: new RegExp(LIST_NAME) })
      .click();
    await composer.pressSequentially(" with @bui");
    await expect(picker).toBeVisible();
    await expect(
      picker.getByLabel("Search mentions and references"),
    ).toHaveValue("bui");
    await expect(picker).toContainText("Built a site for you");
    await capture(page, "OLMobileMention");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(2);
  });

  test("covers campaign prospects and the business phone default", async ({
    page,
  }) => {
    await openReference(page, "/campaign", 1440, "light", {
      colony3Sidebar: true,
      mockWhatsApp: true,
    });
    const campaign = page.getByTestId("w10-campaign-page");
    await expect(
      campaign.getByRole("heading", {
        name: "Independent brands needing social support",
      }),
    ).toBeVisible();
    await campaign
      .getByRole("checkbox", { name: "Select Form & Field" })
      .check();
    await page
      .getByRole("toolbar", { name: "Selected prospects" })
      .getByRole("button", { name: "Ask Scout" })
      .click();
    await expect(page).toHaveURL(new RegExp(REFERENCE_CHANNEL_IDS.scoutDm));
    await openReference(page, "/campaign", 1440);
    const reopenedCampaign = page.getByTestId("w10-campaign-page");
    await reopenedCampaign
      .getByRole("checkbox", { name: "Select Form & Field" })
      .check();
    await expect(
      reopenedCampaign.getByRole("toolbar", { name: "Selected prospects" }),
    ).toContainText("1 selected");
    await openReference(page, "/sales/lead/form-field", 1440);
    const detail = page.getByTestId("w10-prospect-page");
    const whatsApp = detail.getByTestId("whatsapp-lead-detail-card");
    await expect(whatsApp).toContainText("Uses the business phone.");
    await expect(whatsApp).toContainText("+27 21 555 0142");
  });

  test("matches the approved dark outreach boards", async ({ page }) => {
    await openReference(page, "/leads", 1440, "dark", {
      mockWhatsApp: true,
      outreachBoard: true,
    });
    const leads = page.getByTestId("w10-leads-page");
    await seedOutreachUnread(page);
    await page.locator(".c3l-filter-menu > summary").click();
    const filterMenu = page.locator(".c3l-filter-menu-content");
    await expect(filterMenu).toBeVisible();
    const phoneOption = filterMenu
      .locator("label")
      .filter({ hasText: "Has phone number" });
    const whatsappOption = filterMenu
      .locator("label")
      .filter({ hasText: "Not contacted" });
    const stageOption = filterMenu.locator("label").filter({ hasText: "New" });
    await expect(phoneOption).toContainText("106");
    await expect(whatsappOption).toContainText("97");
    await expect(stageOption).toContainText("96");
    await phoneOption.getByRole("checkbox").check();
    await whatsappOption.getByRole("checkbox").check();
    await stageOption.getByRole("checkbox").check();
    await expect(page.locator(".c3l-match-count")).toHaveText(
      "96 of 108 match",
    );
    await page.locator(".c3l-filter-menu > summary").click();
    await leads
      .getByRole("checkbox", { name: "Select all 8 leads on this page" })
      .check();
    const darkSelection = page.getByRole("toolbar", { name: "Selected leads" });
    await expect(darkSelection).toContainText("8 selected");
    await capture(page, "OLLeadsSelectDark");

    await openReference(page, "/campaign", 1440, "dark", {
      mockWhatsApp: true,
      restaurantsBoard: true,
    });
    const campaign = page.getByTestId("w10-campaign-page");
    await campaign.locator(".c3l-filter-menu > summary").click();
    const campaignFilters = campaign.locator(".c3l-filter-menu-content");
    await campaignFilters
      .locator("label")
      .filter({ hasText: "Has phone number" })
      .getByRole("checkbox")
      .check();
    await campaignFilters
      .locator("label")
      .filter({ hasText: "Not contacted" })
      .getByRole("checkbox")
      .check();
    await campaign.locator(".c3l-filter-menu > summary").click();
    await expect(campaign.locator(".c3l-match-count")).toHaveText(
      "39 of 41 match",
    );
    await campaign
      .getByRole("checkbox", { name: "Select all 7 prospects on this page" })
      .check();
    const campaignToolbar = page.getByRole("toolbar", {
      name: "Selected prospects",
    });
    await expect(campaignToolbar).toContainText("7 selected");
    await capture(page, "OLCampaignSelectDark");

    await openReference(
      page,
      `/sales/lead/${REFERENCE_PROSPECT_IDS.stillroom}`,
      1440,
      "dark",
      {
        whatsappGuesthouses: true,
        mockWhatsApp: true,
      },
    );
    await expect(
      page
        .getByTestId("whatsapp-lead-detail-card")
        .getByText("Uses the business phone."),
    ).toBeVisible();
    await openReference(page, "/campaign", 1440, "dark", {
      whatsappGuesthouses: true,
      mockWhatsApp: true,
    });
    const darkCampaign = page.getByTestId("w10-campaign-page");
    await darkCampaign
      .getByRole("checkbox", { name: "Select Jacaranda Lane Guesthouse" })
      .check();
    const darkToolbar = page.getByRole("toolbar", {
      name: "Selected prospects",
    });
    await page
      .getByRole("button", { name: "Select all 12 matching prospects" })
      .click();
    await expect(darkToolbar).toContainText("12 selected");
    await darkToolbar
      .getByRole("button", { name: "Add to outreach list" })
      .click();
    const dialog = page.getByTestId("outreach-list-dialog");
    await dialog.getByLabel("New list name").fill(LIST_NAME);
    await dialog.getByRole("button", { name: "Create list" }).click();
    await page.evaluate(() => {
      window.location.hash = "/lists";
    });
    const lists = page.getByTestId("outreach-lists-page");
    const createdDarkList = lists.getByRole("link", { name: LIST_NAME });
    const darkListHref = await createdDarkList.getAttribute("href");
    const createdDarkListId = darkListHref?.split("/").at(-1);
    expect(createdDarkListId).toBeTruthy();
    await createdDarkList.click();
    const darkList = page.getByTestId("outreach-list-detail");
    await darkList
      .getByLabel("Default WhatsApp template")
      .selectOption("hl_vb:en");
    await expect(darkList).toContainText("Built a site for you");
    await expect(darkList.getByRole("status")).toBeHidden();
    await capture(page, "OLListPageDark");
    await page.evaluate(() => {
      window.location.hash = "/leads";
    });
    const darkLeads = page.getByTestId("w10-leads-page");
    await expect(darkLeads).toBeVisible();
    await darkLeads
      .locator("tbody tr")
      .filter({ hasText: "Jacaranda Lane Guesthouse" })
      .getByRole("link", { name: "Review lead" })
      .click();
    const darkLead = page.getByTestId("w10-prospect-page");
    await expect(
      darkLead.getByTestId("whatsapp-lead-detail-card"),
    ).toContainText("Uses the business phone.");
    await expect(
      darkLead.getByTestId("whatsapp-lead-detail-card"),
    ).toContainText(LIST_NAME);
    await expect(page.getByTestId("lead-breadcrumb")).toContainText(
      /Business\s*\/\s*Sales\s*\/\s*Leads\s*\/\s*Jacaranda Lane Guesthouse/,
    );
    await capture(page, "OLLeadPhoneDark");

    await openReference(page, "/leads", 390, "dark", {
      whatsappGuesthouses: true,
      mockWhatsApp: true,
      outreachBoard: true,
    });
    const mobileLeads = page.getByTestId("w10-leads-page");
    for (const name of [
      "Jacaranda Lane Guesthouse",
      "Koppie View Lodge",
      "Bramble & Brick Guesthouse",
      "Leafy Stoep Guesthouse",
      "Melville Manor B&B",
      "Hillside Hideaway",
    ]) {
      await mobileLeads
        .getByRole("checkbox", { name: `Select ${name}` })
        .check();
    }
    await mobileLeads.evaluate((element) => element.scrollTo({ top: 0 }));
    await capture(page, "OLMobileSelectDark");

    await openReference(page, "/campaign", 390, "dark", {
      whatsappGuesthouses: true,
      mockWhatsApp: true,
    });
    const mobileCampaign = page.getByTestId("w10-campaign-page");
    await mobileCampaign
      .getByRole("checkbox", { name: "Select Jacaranda Lane Guesthouse" })
      .check();
    const mobileToolbar = page.getByRole("toolbar", {
      name: "Selected prospects",
    });
    await page
      .getByRole("button", { name: "Select all 12 matching prospects" })
      .click();
    await expect(mobileToolbar).toContainText("12 selected");
    await mobileToolbar
      .getByRole("button", { name: "Add to outreach list" })
      .click();
    const mobileDialog = page.getByTestId("outreach-list-dialog");
    await mobileDialog.getByLabel("New list name").fill(LIST_NAME);
    await mobileDialog.getByRole("button", { name: "Create list" }).click();
    await page.evaluate(() => {
      window.location.hash = "/lists";
    });
    const mobileLists = page.getByTestId("outreach-lists-page");
    await mobileLists.getByRole("link", { name: LIST_NAME }).click();
    const mobileList = page.getByTestId("outreach-list-detail");
    await mobileList
      .getByLabel("Default WhatsApp template")
      .selectOption("hl_vb:en");
    await expect(mobileList).toContainText("Built a site for you");
    await expect(mobileList.getByRole("status")).toBeHidden();
    const firstMobileMember = mobileList
      .locator(".c3l-list-members tbody tr")
      .filter({ hasText: "Jacaranda Lane Guesthouse" });
    await expect(
      firstMobileMember.locator(".c3l-list-status-badge:visible"),
    ).toHaveCount(1);
    await mobileList.evaluate((element) => element.scrollTo({ top: 0 }));
    await capture(page, "OLMobileListDark");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(2);

    await openReference(
      page,
      `/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`,
      1440,
      "dark",
      { mockWhatsApp: true, outreachMentionBoard: true },
    );
    await expect(
      page.getByText(
        "Morning. 3 replies came in overnight on WhatsApp; Seventh Street Rooms wants a call.",
      ),
    ).toBeVisible();
    const darkListId = "3f1a7000-0000-4000-9000-000000000001";
    const composer = page.getByTestId("message-input");
    const picker = page.getByTestId("lead-reference-picker");
    await composer.pressSequentially("@Scout");
    await expect(picker).toBeVisible();
    await picker
      .getByRole("region", { name: "People and agents" })
      .getByRole("button", { name: /Scout/ })
      .click();
    await composer.pressSequentially(" research ");
    await composer.pressSequentially(`@${LIST_NAME}`);
    const search = picker.getByRole("textbox", {
      name: "Search mentions and references",
    });
    await expect(search).toHaveValue(LIST_NAME);
    await expect(
      picker.getByTestId(`outreach-mention-list-${darkListId}`),
    ).toBeVisible();
    await search.press("Enter");
    const listChip = composer.locator(
      `[data-composer-buzz-link][data-href="buzz://list/${darkListId}"]`,
    );
    await expect(listChip).toContainText(LIST_NAME);
    await page.keyboard.type(" more and update their records");
    await page.clock.setFixedTime(johannesburgTodayAt(10, 12));
    await page.getByTestId("send-message").click();
    await emitScoutMessage(
      page,
      "Done for 12 guesthouses. 9 records now have a website, phone or contact name added.",
      [
        ["list", darkListId],
        [
          "lead-update-summary",
          JSON.stringify({
            schemaVersion: 1,
            listId: darkListId,
            listName: LIST_NAME,
            updatedCount: 9,
            updatedFields: "website, phone or contact name added",
            missingWebsite: [
              "Melville Manor B&B",
              "Hillside Hideaway",
              "Fourth Avenue Rooms",
            ],
            source: "Each change shows on the lead with the page Scout used",
          }),
        ],
      ],
      johannesburgTodayAt(10, 19),
    );
    const darkUpdateSummary = page.getByTestId("lead-update-summary");
    await expect(darkUpdateSummary).toContainText(
      "9 records: website, phone or contact name added",
    );
    await expect(
      darkUpdateSummary.getByRole("button", { name: "Open the list" }),
    ).toBeVisible();

    await composer.pressSequentially("@Scout");
    await picker
      .getByRole("region", { name: "People and agents" })
      .getByRole("button", { name: /Scout/ })
      .click();
    await composer.pressSequentially(" prepare WhatsApp messages for ");
    await composer.pressSequentially(`@${LIST_NAME}`);
    await expect(search).toHaveValue(LIST_NAME);
    await search.press("Enter");
    await composer.pressSequentially(" with @");
    await expect(picker).toBeVisible();
    const darkLists = picker.getByRole("region", { name: "Lists" });
    await expect(darkLists).toContainText("Melville guesthouses, follow up");
    await expect(darkLists.locator(".c3r-name")).toHaveText([
      LIST_NAME,
      "Melville guesthouses, follow up",
    ]);
    await expect(
      picker.getByRole("region", { name: "Campaigns" }),
    ).toContainText("Discovery · 24 found");
    await expect(
      picker.getByRole("region", { name: "Templates" }),
    ).toContainText("New site follow up");
    await expect(picker.getByRole("region", { name: "Leads" })).toContainText(
      "Melville Manor B&B",
    );
    await capture(page, "OLMentionPickerDark");
    await composer.pressSequentially("Built a site for you");
    await expect(search).toHaveValue("Built a site for you");
    await picker
      .getByRole("region", { name: "Templates" })
      .getByRole("button", { name: /Built a site for you/ })
      .click();
    await page.clock.setFixedTime(johannesburgTodayAt(10, 24));
    await page.getByTestId("send-message").click();
    await emitPendingBatchNotice(page, darkListId, johannesburgTodayAt(10, 31));
    const pendingCard = page.getByTestId("whatsapp-channel-batch-pending");
    await expect(pendingCard).toContainText(LIST_NAME);
    await expect(pendingCard).toContainText("Built a site for you");
    await expect(pendingCard).toContainText("Skipped 2 of 12");
    await expect(
      pendingCard.getByRole("button", { name: "Approve all 10" }),
    ).toBeEnabled();
    const darkReference = page
      .getByRole("button", { name: `Open outreach list: ${LIST_NAME}` })
      .last();
    await expect(darkReference).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1800 });
    await jumpTimelineToLatest(page);
    await capture(page, "OLChatResolvedDark");
  });
});
