import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import {
  planeTreeCustomerRecord,
  PLANE_TREE_CLIENT_ID,
  PLANE_TREE_PROPOSAL_ID,
} from "../../src/testing/cofounderCustomerFixtures";
import {
  REFERENCE_CHANNEL_IDS,
  REFERENCE_AGENTS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import type {
  MoneyLinkCard,
  MoneyRailsSnapshot,
} from "../../src/features/cofounder/moneyRails";
import type {
  MoneyRailsAction,
  MoneyRailsMockBridge,
} from "../../src/features/cofounder/moneyRailsBridge";
import { KIND_STREAM_MESSAGE } from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const PLANE_TREE_PARTY_ID = REFERENCE_PROSPECT_IDS["form-field"];
const APPROVAL_CARD_ID = "7f3c2a91-4b1d-4a2f-8e63-2d90a74ce112";
const API_KEY_CANARY = "sk_test_money_rails_secret_never_echo";
const NOTICE_ADDRESS =
  "https://horizon-labs.colony.ainative.ventures/hooks/pay/7f3c2a91";
const RELAY_SECRET = generateSecretKey();
const OWNER_MESSAGE_ID = "91".repeat(32);
const SCOUT_MESSAGE_ID = "92".repeat(32);

const PAYMENT_CARD: MoneyLinkCard = {
  id: APPROVAL_CARD_ID,
  headEventId: "money-link-head-v1",
  revision: 1,
  state: "needs_you",
  customerPartyId: PLANE_TREE_PARTY_ID,
  invoiceId: "invoice-plane-tree-deposit-v1",
  recipientRef: "recipient-thandeka-whatsapp",
  draftedBy: TEST_IDENTITIES.alice.pubkey,
  customerName: "Plane Tree Guesthouse",
  title: "Deposit for Plane Tree Guesthouse",
  amountMinor: 375_000,
  currency: "ZAR",
  purpose: "Website build deposit · quote Q-0012, signed 2 Nov",
  invoiceLabel: "half of the R7,500 quote",
  provider: {
    connectionId: "yoco-browser",
    name: "Yoco",
    host: "pay.yoco.com",
    route: "browser",
  },
  recipient: {
    name: "Thandeka",
    channel: "WhatsApp",
    address: "+27 82 *** 7135",
  },
  expiresLabel: "Tuesday 17 November",
  message:
    "Hi Thandeka, thanks for signing. Here is the deposit link for your new website: [the Yoco link goes here]. Horizon Labs",
  statusDetail: null,
  providerReference: null,
  approvedHeadEventId: null,
  expiresInDays: 14,
  browserGrant: null,
};

function cardInState(
  state: MoneyLinkCard["state"],
  index: number,
): MoneyLinkCard {
  return {
    ...PAYMENT_CARD,
    id: `a17e0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    headEventId: `money-link-state-head-${index}`,
    state,
    title: `${state.replaceAll("_", " ")} payment link`,
    message: "",
    invoiceLabel: "",
    approvedHeadEventId: state === "needs_you" ? null : `approved-${index}`,
    statusDetail:
      state === "failed" ? "The provider could not create this link." : null,
    providerReference: state === "paid" ? "8KX2-41" : null,
    browserGrant:
      state === "creating_link"
        ? {
            host: "pay.yoco.com",
            from: 1_793_000_000,
            until: 1_793_000_900,
            usedAt: null,
          }
        : null,
  };
}

const STATE_CARDS = [
  "draft",
  "needs_you",
  "creating_link",
  "sent",
  "payment_reported",
  "paid",
  "expired",
  "cancelled",
  "failed",
].map((state, index) => cardInState(state as MoneyLinkCard["state"], index));

const INITIAL_SNAPSHOT: MoneyRailsSnapshot = {
  paymentLinks: [
    PAYMENT_CARD,
    {
      ...cardInState("paid", 1),
      title: "Deposit",
      amountMinor: 375_000,
      purpose: "Website build deposit",
      expiresLabel: "Sent 3 Nov 09:20 on WhatsApp",
      statusDetail: "Confirmed by Yoco, not just reported",
    },
    {
      ...cardInState("payment_reported", 2),
      title: "Test link",
      amountMinor: 1_000,
      statusDetail: "Notice came in, Yoco has no match",
      providerReference: null,
    },
    {
      ...cardInState("expired", 3),
      title: "Expired payment link",
      expiresLabel: "Expired 29 Oct",
    },
  ],
  connections: [
    {
      id: "yoco-browser",
      provider: "Yoco",
      host: "pay.yoco.com",
      route: "browser",
      status: "connected",
      lastUsed: "3 Nov, 09:20",
      noticeAddress: NOTICE_ADDRESS,
    },
    {
      id: "google-calendar",
      provider: "Google Calendar",
      host: "calendar.google.com",
      route: "browser",
      status: "connected",
      lastUsed: "2 Nov, 14:00",
      noticeAddress: "",
    },
  ],
};

type MoneyRailsWindow = Window & {
  __BUZZ_E2E_MONEY_RAILS__?: MoneyRailsMockBridge;
  __BUZZ_E2E_MONEY_RAILS_ACTIONS__?: Array<Record<string, unknown>>;
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    kind?: number;
    pubkey?: string;
    extraTags?: string[][];
  }) => { id: string } | undefined;
  __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
    channelName: string;
    kind?: number;
  }) => boolean;
};

const cofounderMock = {
  relaySelf: getPublicKey(RELAY_SECRET),
  companyMemberRelayPrivateKeyHex: bytesToHex(RELAY_SECRET),
  referenceWorkspace: true,
  whatsappGuesthouses: true,
  colony3Sidebar: true,
  relayRequiresMembership: true,
  relayRole: "owner" as const,
  relayMembers: [{ pubkey: OWNER_PUBKEY, role: "owner" as const }],
  cofounderSettings: {
    enabled: true,
    moneyPreference: "cheapest_first" as const,
    approvalSwitches: {
      approveEveryHire: false,
      approvePlaybookChanges: false,
      approveEveryDiscoveryCampaign: false,
    },
  },
};

async function installMoneyRailsMock(
  page: Page,
  theme: "light" | "dark",
  snapshot: MoneyRailsSnapshot = INITIAL_SNAPSHOT,
  customerRecord = false,
  approvalChat = false,
  mobileApproval = false,
) {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    ({ selectedTheme, relayUrl, selfPubkey }) => {
      const themeName = selectedTheme === "dark" ? "buzz-dark" : "buzz";
      window.localStorage.setItem("buzz-theme", themeName);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem("buzz-accent-color", "#5B45BE");
      window.localStorage.setItem(
        `buzz-community-theme.v1:${selfPubkey}:${encodeURIComponent(relayUrl)}`,
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    {
      selectedTheme: theme,
      relayUrl: "ws://localhost:3000",
      selfPubkey: "deadbeef".repeat(8),
    },
  );

  let companyCustomerRecords: Array<Record<string, unknown>> | undefined;
  if (customerRecord) {
    const record = planeTreeCustomerRecord({
      scoutPubkey: TEST_IDENTITIES.alice.pubkey,
      ayaPubkey: TEST_IDENTITIES.bob.pubkey,
      ownerPubkey: OWNER_PUBKEY,
    });
    record.partyId = PLANE_TREE_PARTY_ID;
    record.clientId = PLANE_TREE_CLIENT_ID;
    record.clientStatus = "active";
    record.money = {
      currency: "ZAR",
      quoteTotalMinor: 750_000,
      depositPaidMinor: 375_000,
      depositPaidAt: Math.floor(
        new Date("2026-11-03T09:20:00+02:00").getTime() / 1_000,
      ),
      balanceDueMinor: 375_000,
      otherCurrencyFacts: 0,
    };
    record.quotes = [
      {
        proposalId: PLANE_TREE_PROPOSAL_ID,
        revision: 1,
        totalMinor: 750_000,
        currency: "ZAR",
        draftedAt: 1_792_500_000,
        acceptedAt: 1_792_600_000,
      },
    ];
    companyCustomerRecords = [record];
  }

  await installMockBridge(page, {
    ...cofounderMock,
    ...(companyCustomerRecords ? { companyCustomerRecords } : {}),
    ...(approvalChat
      ? {
          colony3Extras: {
            clearMessageChannelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
            readChannelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
            messages: [
              ...(!mobileApproval
                ? [
                    {
                      channelId: REFERENCE_CHANNEL_IDS.scoutDm,
                      id: OWNER_MESSAGE_ID,
                      pubkey: OWNER_PUBKEY,
                      createdAt: Math.floor(
                        new Date("2026-11-03T09:12:00+02:00").getTime() / 1_000,
                      ),
                      kind: KIND_STREAM_MESSAGE,
                      content:
                        "Thandeka signed. Send Plane Tree the deposit link.",
                    },
                  ]
                : []),
              {
                channelId: REFERENCE_CHANNEL_IDS.scoutDm,
                id: SCOUT_MESSAGE_ID,
                pubkey: REFERENCE_AGENTS.scout.pubkey,
                createdAt: Math.floor(
                  new Date("2026-11-03T09:13:00+02:00").getTime() / 1_000,
                ),
                kind: KIND_STREAM_MESSAGE,
                tags: [["paylink", APPROVAL_CARD_ID]],
                content:
                  "Ready. R3,750 is half of the R7,500 quote, through your Yoco.",
              },
            ],
          },
        }
      : {}),
  });

  await page.addInitScript(
    ({ initialSnapshot, noticeAddress }) => {
      let state = JSON.parse(
        JSON.stringify(initialSnapshot),
      ) as MoneyRailsSnapshot;
      const listeners = new Set<() => void>();
      const actions: Array<Record<string, unknown>> = [];
      const notify = () => {
        for (const listener of [...listeners]) listener();
      };
      const testWindow = window as MoneyRailsWindow;
      testWindow.__BUZZ_E2E_MONEY_RAILS_ACTIONS__ = actions;
      testWindow.__BUZZ_E2E_MONEY_RAILS__ = {
        getSnapshot: () => state,
        getPaymentLinkDetails: (linkId) => {
          return state.paymentLinks.find((card) => card.id === linkId) ?? null;
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async execute(action: MoneyRailsAction) {
          if (action.type === "connect") {
            const safeAction = {
              type: "connect",
              provider: action.provider,
              host: action.host,
              route: action.route,
              hadApiKey: Boolean(action.apiKey),
            };
            actions.push(safeAction);
            const connection = {
              id: `connection-${String(action.provider).toLowerCase()}`,
              provider: action.provider,
              host: action.host,
              route: action.route,
              status: "connected" as const,
              lastUsed: "Just now",
              noticeAddress,
            };
            state = {
              ...state,
              connections: [
                ...state.connections.filter(
                  (item) => item.provider !== action.provider,
                ),
                connection,
              ],
            };
            notify();
            return connection;
          }

          if (action.type === "connect")
            throw new Error("Unexpected connect action");
          const linkId = String(action.linkId ?? "");
          const cardIndex = state.paymentLinks.findIndex(
            (card) => card.id === linkId,
          );
          const card = state.paymentLinks[cardIndex];
          actions.push({
            type: action.type,
            linkId,
            headEventId: action.headEventId,
            ...(action.type === "edit" ? { changes: action.changes } : {}),
          });
          if (!card || card.headEventId !== action.headEventId) {
            throw new Error(
              "This payment link changed. Review the latest version.",
            );
          }

          let nextCard: MoneyLinkCard;
          if (action.type === "edit") {
            const revision = card.revision + 1;
            nextCard = {
              ...card,
              ...(action.changes as Partial<MoneyLinkCard>),
              headEventId: `money-link-head-v${revision}`,
              revision,
              state: "needs_you",
              statusDetail: null,
              approvedHeadEventId: null,
            };
          } else if (action.type === "approve" || action.type === "retry") {
            nextCard = {
              ...card,
              state: "sent",
              approvedHeadEventId: card.headEventId,
              statusDetail: null,
            };
          } else if (action.type === "reject") {
            nextCard = {
              ...card,
              state: "cancelled",
              statusDetail: "Rejected by the owner.",
            };
          } else {
            throw new Error("Unknown payment link action.");
          }
          state = {
            ...state,
            paymentLinks: state.paymentLinks.map((item, index) =>
              index === cardIndex ? nextCard : item,
            ),
          };
          notify();
          return nextCard;
        },
      };
    },
    { initialSnapshot: snapshot, noticeAddress: NOTICE_ADDRESS },
  );
}

async function waitForLiveSubscription(page: Page, channelName: string) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ name, kind }) =>
          (
            window as MoneyRailsWindow
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
            kind,
          }) ?? false,
        { name: channelName, kind: KIND_STREAM_MESSAGE },
      ),
    )
    .toBe(true);
}

async function emitMockMessage(
  page: Page,
  content: string,
  options: { cardId?: string; pubkey?: string } = {},
) {
  return page.evaluate(
    ({ body, cardId, pubkey, channelName, kind }) => {
      const testWindow = window as MoneyRailsWindow;
      return testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: body,
        kind,
        pubkey,
        ...(cardId ? { extraTags: [["paylink", cardId]] } : {}),
      });
    },
    {
      body: content,
      cardId: options.cardId,
      pubkey: options.pubkey ?? TEST_IDENTITIES.alice.pubkey,
      channelName: "Scout",
      kind: KIND_STREAM_MESSAGE,
    },
  );
}

async function revealMockMessage(page: Page, messageId: string) {
  const row = page.locator(
    `[data-testid="message-row"][data-message-id="${messageId}"]`,
  );
  const threadJump = page.getByTestId("thread-scroll-to-latest");
  const timelineJump = page.getByTestId("message-scroll-to-latest");
  await expect
    .poll(async () => {
      return (
        (await row.count()) > 0 ||
        (await threadJump.isVisible()) ||
        (await timelineJump.isVisible())
      );
    })
    .toBe(true);
  if (await threadJump.isVisible()) await threadJump.click();
  if (await timelineJump.isVisible()) await timelineJump.click();
  await expect(row).toBeAttached();
  await row.scrollIntoViewIfNeeded();
}

async function openScoutDm(page: Page) {
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
  await waitForLiveSubscription(page, "Scout");
}

async function openMoneySettings(page: Page) {
  const isMobile = await page.evaluate(() => window.innerWidth < 600);
  const mobileTrigger = page.getByTestId("mobile-open-navigation");
  if (isMobile) {
    await expect(mobileTrigger).toBeVisible();
    await mobileTrigger.click();
    const sidebar = page.getByRole("dialog", { name: "Sidebar" });
    await expect(sidebar).toBeVisible();
    await sidebar.getByTestId("sidebar-settings").click();
  } else {
    await page.getByTestId("open-settings").click();
    await page.getByTestId("profile-popover-settings").click();
  }
  await expect(page.getByTestId("settings-view")).toBeVisible();
  const business = page.getByTestId("settings-group-business");
  await business.click();
  const tab = page.getByTestId("settings-inner-money-calendar");
  await tab.click();
  await expect(page.getByTestId("settings-panel-money-calendar")).toBeVisible();
}

async function capture(page: Page, filename: string) {
  const path = resolve("test-results/screenshots/money-rails-pay-ui", filename);
  mkdirSync(dirname(path), { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path });
}

async function clearConversationJumpPills(page: Page) {
  const selectors = [
    '[data-testid="thread-scroll-to-latest"]:visible',
    '[data-testid="message-scroll-to-latest"]:visible',
  ];
  for (const selector of selectors) {
    const buttons = page.locator(selector);
    for (
      let attempt = 0;
      attempt < 2 && (await buttons.count()) > 0;
      attempt++
    ) {
      await buttons.first().click();
      await expect(buttons).toHaveCount(0);
    }
  }
}

test("payment link board is exact in chat at desktop and phone sizes", async ({
  browser,
}) => {
  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { width: 1440, height: 1180, suffix: "1440" },
      { width: 390, height: 1260, suffix: "390" },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      try {
        const page = await context.newPage();
        await installMoneyRailsMock(
          page,
          theme,
          INITIAL_SNAPSHOT,
          false,
          true,
          viewport.width < 600,
        );
        await openScoutDm(page);

        const card = page.getByTestId(`money-rail-card-${APPROVAL_CARD_ID}`);
        await expect(card).toBeVisible();
        await expect(page.getByTestId("message-unread-divider")).toHaveCount(0);
        await expect(card).toContainText("Needs you");
        await expect(card).toContainText("Deposit for Plane Tree Guesthouse");
        await expect(card).toContainText("R3,750");
        await expect(card).toContainText("half of the R7,500 quote");
        await expect(card).toContainText("Yoco, made in your browser tab");
        await expect(card).toContainText("Scout can only ask for money");
        await expect(
          card.getByRole("button", {
            name: `Approve payment link: ${PAYMENT_CARD.title}`,
          }),
        ).toBeEnabled();
        if (viewport.width < 600) {
          await card.evaluate((element) =>
            element.scrollIntoView({ block: "start", inline: "nearest" }),
          );
          await clearConversationJumpPills(page);
          await expect(
            card.locator(".cf-money-rail-paid-status-row"),
          ).toBeHidden();
          const rejectButton = card.getByTestId(
            `money-rail-reject-${APPROVAL_CARD_ID}`,
          );
          const [rejectBox, composerBox] = await Promise.all([
            rejectButton.boundingBox(),
            page.getByTestId("message-composer").boundingBox(),
          ]);
          if (!rejectBox || !composerBox) {
            throw new Error("Approval actions or composer are not visible.");
          }
          expect(rejectBox.y + rejectBox.height).toBeLessThan(composerBox.y);
        } else {
          await clearConversationJumpPills(page);
        }
        await capture(
          page,
          `MRPaymentLinkApproval-${viewport.suffix}-${theme}.png`,
        );
      } finally {
        await context.close();
      }
    }
  }
});

test("Needs you edit makes the old approval unavailable and sends the new head", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1180 });
  await installMoneyRailsMock(page, "light");
  await page.goto("/#/today/needs-you");
  await expect(page.getByTestId("cofounder-needs-you-screen")).toBeVisible();

  const card = page.getByTestId(`money-rail-card-${APPROVAL_CARD_ID}`);
  await expect(card).toBeVisible();
  await card.getByTestId(`money-rail-edit-${APPROVAL_CARD_ID}`).click();
  await card.getByRole("textbox", { name: "Payment amount" }).fill("3900");
  await expect(
    card.getByTestId(`money-rail-approve-${APPROVAL_CARD_ID}`),
  ).toBeDisabled();
  await card.getByTestId(`money-rail-save-edit-${APPROVAL_CARD_ID}`).click();
  await expect(card).toHaveAttribute(
    "data-head-event-id",
    "money-link-head-v2",
  );
  await expect(
    card.getByTestId(`money-rail-approve-${APPROVAL_CARD_ID}`),
  ).toBeEnabled();
  await card.getByTestId(`money-rail-approve-${APPROVAL_CARD_ID}`).click();
  await expect(card).toHaveCount(0);
  const updatedCard = await page.evaluate(
    (linkId) =>
      (window as MoneyRailsWindow).__BUZZ_E2E_MONEY_RAILS__
        ?.getSnapshot()
        .paymentLinks.find((item) => item.id === linkId),
    APPROVAL_CARD_ID,
  );
  expect(updatedCard?.state).toBe("sent");

  const actions = await page.evaluate(
    () => (window as MoneyRailsWindow).__BUZZ_E2E_MONEY_RAILS_ACTIONS__ ?? [],
  );
  expect(actions).toEqual([
    {
      type: "edit",
      linkId: APPROVAL_CARD_ID,
      headEventId: "money-link-head-v1",
      changes: expect.objectContaining({ amountMinor: 390_000 }),
    },
    {
      type: "approve",
      linkId: APPROVAL_CARD_ID,
      headEventId: "money-link-head-v2",
    },
  ]);
});

test("every payment link state is shown in a message attachment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1180 });
  const snapshot = {
    ...INITIAL_SNAPSHOT,
    paymentLinks: STATE_CARDS,
  };
  await installMoneyRailsMock(page, "light", snapshot);
  await openScoutDm(page);

  for (const card of STATE_CARDS) {
    const message = await emitMockMessage(page, `Status card ${card.state}`, {
      cardId: card.id,
    });
    if (!message?.id) throw new Error("The mock message was not emitted.");
    expect(message.tags).toContainEqual(["paylink", card.id]);
    await revealMockMessage(page, message.id);
    const locator = page.getByTestId(`money-rail-card-${card.id}`);
    await expect(locator).toBeVisible();
    await expect(locator).toHaveAttribute("data-state", card.state);
    if (card.state === "payment_reported")
      await expect(locator).toContainText("Payment reported, check");
    if (card.state === "paid")
      await expect(locator).toContainText(
        "Confirmed by Yoco, not just reported",
      );
  }
});

test("provider connect dialog keeps API key masked and never returns it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1180 });
  await installMoneyRailsMock(page, "light");
  await page.goto("/#/today");
  await openMoneySettings(page);
  await page.getByTestId("money-rail-add-provider").click();

  const dialog = page.getByTestId("money-rail-connect-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Provider")).toHaveValue(
    "Paystack · paystack.com",
  );
  await dialog.getByLabel("Use an API key").check();
  const keyField = dialog.getByTestId("money-rail-api-key");
  await expect(keyField).toHaveAttribute("type", "password");
  await expect(dialog).toContainText("Locked to api.paystack.co");
  await keyField.fill(API_KEY_CANARY);
  await expect(dialog).not.toContainText(API_KEY_CANARY);
  await expect(
    dialog.getByRole("textbox", { name: "Payment notice address" }),
  ).toHaveValue("Available after connecting");
  await capture(page, "MRPaymentConnect-1440-light.png");

  await dialog.getByTestId("money-rail-connect-provider").click();
  await expect(dialog).toBeVisible();
  await expect(keyField).toHaveValue("");
  await expect(
    dialog.getByRole("textbox", { name: "Payment notice address" }),
  ).toHaveValue(NOTICE_ADDRESS);
  await expect(
    page.getByTestId("money-rail-connection-connection-paystack"),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(API_KEY_CANARY);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const actions = await page.evaluate(
    () => (window as MoneyRailsWindow).__BUZZ_E2E_MONEY_RAILS_ACTIONS__ ?? [],
  );
  expect(actions).toEqual([
    {
      type: "connect",
      provider: "Paystack",
      host: "api.paystack.co",
      route: "api",
      hadApiKey: true,
    },
  ]);
  expect(JSON.stringify(actions)).not.toContain(API_KEY_CANARY);
});

test("payment board screenshots cover connect and customer states across themes and sizes", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { width: 1440, height: 1180, suffix: "1440" },
      { width: 390, height: 844, suffix: "390" },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      try {
        const page = await context.newPage();
        await installMoneyRailsMock(page, theme);
        await page.goto("/#/today");
        await openMoneySettings(page);
        if (viewport.width < 600) {
          await expect(
            page.getByRole("dialog", { name: "Sidebar" }),
          ).toBeHidden();
          await expect(
            page.getByTestId("settings-panel-money-calendar"),
          ).toBeVisible();
        }
        await page.getByTestId("money-rail-add-provider").click();
        const dialog = page.getByTestId("money-rail-connect-dialog");
        await dialog.getByLabel("Use an API key").check();
        const keyField = dialog.getByTestId("money-rail-api-key");
        await keyField.fill(API_KEY_CANARY);
        await keyField.evaluate((element: HTMLInputElement) => element.blur());
        await dialog
          .locator(".cf-money-rail-dialog-body")
          .evaluate((element) => {
            element.scrollTop = 0;
          });
        await dialog.evaluate((element) => {
          element.scrollTop = 0;
        });
        await capture(page, `MRPaymentConnect-${viewport.suffix}-${theme}.png`);
      } finally {
        await context.close();
      }

      const customerContext = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      try {
        const page = await customerContext.newPage();
        const screenshotSnapshot = {
          ...INITIAL_SNAPSHOT,
          paymentLinks: INITIAL_SNAPSHOT.paymentLinks.filter(
            (card) =>
              card.state === "paid" || card.state === "payment_reported",
          ),
        };
        await installMoneyRailsMock(page, theme, screenshotSnapshot, true);
        await page.goto(`/#/clients/record/${PLANE_TREE_PARTY_ID}`);
        await expect(page.getByTestId("customer-record-screen")).toBeVisible();
        const links = page.getByTestId("customer-payment-links");
        await expect(links).toContainText("Paid");
        await expect(links).toContainText("Check");
        if (viewport.width < 600) {
          await links.evaluate((element) =>
            element.scrollIntoView({ block: "start", inline: "nearest" }),
          );
        }
        await capture(page, `MRPaymentPaid-${viewport.suffix}-${theme}.png`);
      } finally {
        await customerContext.close();
      }
    }
  }
});

test("customer record distinguishes paid, reported, and expired links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1180 });
  await installMoneyRailsMock(page, "light", INITIAL_SNAPSHOT, true);
  await page.goto(`/#/clients/record/${PLANE_TREE_PARTY_ID}`);
  await expect(page.getByTestId("customer-record-screen")).toBeVisible();

  const links = page.getByTestId("customer-payment-links");
  const paidId =
    INITIAL_SNAPSHOT.paymentLinks.find((link) => link.state === "paid")?.id ??
    "missing-paid-link";
  const reportedId =
    INITIAL_SNAPSHOT.paymentLinks.find(
      (link) => link.state === "payment_reported",
    )?.id ?? "missing-reported-link";
  const expiredId =
    INITIAL_SNAPSHOT.paymentLinks.find((link) => link.state === "expired")
      ?.id ?? "missing-expired-link";
  await expect(
    links.getByTestId(`customer-payment-link-${paidId}`),
  ).toContainText("Sent 3 Nov 09:20 on WhatsApp");
  await expect(page.locator(".cf-customer-payment-confirmation")).toContainText(
    "Confirmed by Yoco, not just reported",
  );
  await expect(
    links.getByTestId(`customer-payment-link-${reportedId}`),
  ).toContainText("Check");
  await expect(
    links.getByTestId(`customer-payment-link-${expiredId}`),
  ).toContainText("Expired");
});
