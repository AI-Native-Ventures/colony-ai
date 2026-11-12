import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import type { CofounderOnboardingStep } from "../../src/features/cofounder/cofounderPhase2Model";
import {
  ESIGN_PLAN_ID,
  esignSetupPlan,
  NOVEMBER_PLAN_ID,
  novemberPlan,
} from "../../src/testing/cofounderPlanFixtures";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  KIND_NUMBERS_ACTION,
  KIND_PLAYBOOK_ACTION,
  KIND_WHATSAPP_BATCH_DECISION,
} from "../../src/shared/constants/kinds";
import { makeCofounderNumbersFixture } from "../../src/testing/cofounderNumbersFixtures";
import {
  DELIVERY_PLAYBOOK_ID,
  FOLLOW_UP_PLAYBOOK_ID,
  NORTHLINE_JOB_ID,
  deliveryJobs,
  deliveryPlaybook,
  followUpPlaybook,
} from "../../src/testing/cofounderPlaybookFixtures";
import type { MockCompanyAccessRecord } from "../../src/testing/mockCompanyAccess";
import { installMockBridge, type RelayBridgeIdentity } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { installBrowserHostFake } from "./helpers/browserHostFake";
import { TEST_IDENTITIES } from "../helpers/bridge";
import type {
  MockCofounderLeadStatus,
  MockManagedAgentSeed,
  MockNumbers,
  MockPlan,
} from "../../src/testing/e2eBridge";
import type {
  MockPlaybook,
  MockPlaybookJob,
} from "../../src/testing/mockCompanyPlaybooks";
import type { LiveMoneyRailsAction } from "../../src/features/cofounder/moneyRailsApi";
import type { MoneyRailsMockBridge } from "../../src/features/cofounder/moneyRailsBridge";
import type {
  MoneyLinkCard,
  MoneyRailsSnapshot,
} from "../../src/features/cofounder/moneyRails";

const APPROVAL_SWITCHES = {
  approveEveryHire: true,
  approvePlaybookChanges: true,
  approveEveryDiscoveryCampaign: true,
};

const NEEDS_YOU_NUMBERS: MockNumbers = {
  reviews: [
    {
      schemaVersion: 1,
      reviewDate: "2026-10-30",
      asOf: 1_791_273_600,
      windowStart: 1_790_668_800,
      previousStart: 1_790_064_000,
      currency: "ZAR",
      otherCurrencyFacts: 0,
      functions: [
        { function: "sales", metrics: [], notTracked: [] },
        { function: "operations", metrics: [], notTracked: [] },
        { function: "customer_success", metrics: [], notTracked: [] },
        { function: "finance", metrics: [], notTracked: [] },
        { function: "brand", metrics: [], notTracked: [] },
      ],
      wins: [],
      misses: [],
      decisions: [
        {
          decisionId: "hire-customer-success",
          title: "Hire a Customer Success lead?",
          detail:
            "Two sites go live next week. Someone should look after those clients so Aya can keep selling. Runs on your AI subscription.",
          function: "customer_success",
          state: "open",
          decidedByPubkey: null,
          decidedAt: null,
          note: null,
        },
      ],
      annotatedByPubkey: REFERENCE_AGENTS.scout.pubkey,
      annotatedAt: 1_791_273_600,
      createdAt: 1_791_273_600,
    },
  ],
};

const CAPABILITY_GAP_ID = "4f60a4ae-70c8-4f7a-a899-338e6b376198";
const PAYMENT_GAP_ID = "b986cc6f-57db-45a7-92b0-238d2855e881";
const NEEDS_YOU_WA_BATCH_ID = "cofounder-needs-you-batch";
const NEEDS_YOU_WA_DRAFT_ID = "cofounder-needs-you-draft";
const NEEDS_YOU_PAYMENT_LINK_ID = "cofounder-needs-you-payment-link";
const NEEDS_YOU_PAYMENT_LINK: MoneyLinkCard = {
  id: NEEDS_YOU_PAYMENT_LINK_ID,
  headEventId: "cofounder-needs-you-payment-link-head",
  revision: 1,
  state: "needs_you",
  customerPartyId: REFERENCE_PROSPECT_IDS["form-field"],
  invoiceId: "cofounder-needs-you-deposit-invoice",
  recipientRef: "recipient-thandeka-whatsapp",
  draftedBy: REFERENCE_AGENTS.aya.pubkey,
  customerName: "Plane Tree Guesthouse",
  title: "Deposit for Plane Tree Guesthouse",
  amountMinor: 375_000,
  currency: "ZAR",
  purpose: "Half of the signed R7,500 quote",
  invoiceLabel: "R7,500 quote",
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
  expiresLabel: "14 days",
  message: "Hi Thandeka, here is the deposit link.",
  statusDetail: null,
  providerReference: null,
  approvedHeadEventId: null,
  expiresInDays: 14,
  browserGrant: null,
};
const NEEDS_YOU_PAYMENT_LINK_NO: MoneyLinkCard = {
  ...NEEDS_YOU_PAYMENT_LINK,
  id: "cofounder-needs-you-payment-link-no",
  headEventId: "cofounder-needs-you-payment-link-no-head",
};

function accessRecord(
  accessId: string,
  name: string,
  category: string,
  usedFor: string,
  cost: string,
): MockCompanyAccessRecord {
  const now = 1_791_273_600;
  return {
    dTag: `company:access:${accessId}`,
    content: {
      schemaVersion: 1,
      accessId,
      entry: {
        name,
        category,
        usedFor,
        agents: [REFERENCE_AGENTS.aya.pubkey],
        cost,
      },
      state: "active",
      grantedByPubkey: TEST_IDENTITIES.tyler.pubkey,
      grantedAt: now,
      viaGapId: null,
      revokedByPubkey: null,
      revokedAt: null,
      revokeReason: null,
      updatedAt: now,
    },
  };
}

function phase2AccessRecords(): MockCompanyAccessRecord[] {
  return [
    accessRecord(
      "esign",
      "E-sign, free plan",
      "esign",
      "Agreements to sign",
      "Free, 3 a month",
    ),
    accessRecord(
      "gmail",
      "Gmail",
      "connected_account",
      "Replying to customers",
      "Free",
    ),
    accessRecord(
      "google-calendar",
      "Google Calendar",
      "calendar",
      "Booking calls",
      "Free",
    ),
    accessRecord(
      "pinterest",
      "Pinterest",
      "connected_account",
      "Posting launch content",
      "Free",
    ),
    paymentLinkGapRecord(),
  ];
}

function capabilityGapRecord(): MockCompanyAccessRecord {
  const now = 1_791_273_600;
  return {
    dTag: `company:capgap:${CAPABILITY_GAP_ID}`,
    content: {
      schemaVersion: 1,
      gapId: CAPABILITY_GAP_ID,
      gap: {
        title: "Connect the e-sign account",
        need: "Scout needs a signing account to prepare customer agreements.",
        options: [
          {
            name: "Free e-sign plan",
            costText: "Free, 3 a month",
            costCents: 0,
            recurring: false,
            works: true,
            note: null,
          },
        ],
        chosen: 0,
        chosenReason: null,
        humanStep: "Sign in to the e-sign account",
        pageUrl: "https://accounts.example.test/esign/login",
        accessId: "esign",
        access: {
          name: "E-sign, free plan",
          category: "esign",
          usedFor: "Agreements to sign",
          agents: [REFERENCE_AGENTS.aya.pubkey],
          cost: "Free, 3 a month",
        },
      },
      state: "proposed",
      proposedByPubkey: REFERENCE_AGENTS.scout.pubkey,
      proposedAt: now,
      approvedCostCents: null,
      updatedAt: now,
    },
  };
}

function needsYouAccessRecords(): MockCompanyAccessRecord[] {
  const approvedGap = capabilityGapRecord();
  approvedGap.content = {
    ...approvedGap.content,
    state: "approved",
    approvedCostCents: 0,
  };
  return [...phase2AccessRecords(), approvedGap];
}

function paymentLinkGapRecord(): MockCompanyAccessRecord {
  const now = 1_791_273_600;
  return {
    dTag: `company:capgap:${PAYMENT_GAP_ID}`,
    content: {
      schemaVersion: 1,
      gapId: PAYMENT_GAP_ID,
      gap: {
        title: "Connect a payment link account",
        need: "To send deposit links from Colony and see when they are paid.",
        options: [
          {
            name: "Payment links",
            costText: "Free to join, a fee per payment",
            costCents: 0,
            recurring: false,
            works: true,
            note: null,
          },
        ],
        chosen: 0,
        chosenReason: null,
        humanStep: "Sign in to the payment link account",
        pageUrl: "https://accounts.example.test/payment-link/login",
        accessId: "payment-links",
        access: {
          name: "Payment link account",
          category: "payment_link",
          usedFor: "Sending deposit links",
          agents: [REFERENCE_AGENTS.scout.pubkey],
          cost: "Fee per payment",
        },
      },
      state: "proposed",
      proposedByPubkey: REFERENCE_AGENTS.scout.pubkey,
      proposedAt: now,
      approvedCostCents: null,
      updatedAt: now,
    },
  };
}

function companyInitiativeRecords(step: CofounderOnboardingStep = "brief"): {
  brief: MockCompanyInitiativeRecord;
  onboarding: MockCompanyInitiativeRecord;
} {
  const now = 1_791_273_600;
  const confirmed = step !== "brief";
  const content = {
    whatYouSell: "Social campaigns and brand work",
    whoBuys: "Local hospitality and retail teams",
    howYouTalk: "Warm, direct and never pushy.",
    sources: ["Website", "Colony history"],
  };
  const briefContent = {
    schemaVersion: 1,
    revision: confirmed ? 2 : 1,
    ...(confirmed
      ? {
          confirmed: content,
          confirmedByPubkey: TEST_IDENTITIES.tyler.pubkey,
          confirmedAt: now,
        }
      : { pending: content }),
    updatedByPubkey: TEST_IDENTITIES.tyler.pubkey,
    updatedAt: now,
  };
  const states = {
    brief: "todo",
    money: "todo",
    approvals: "todo",
    accounts: "todo",
    map: "todo",
  };
  let question: Record<string, unknown> | undefined;
  let accounts: Array<Record<string, unknown>> = [];
  let map: Record<string, unknown> | undefined;
  let status = "in_progress";
  if (step === "brief") {
    states.brief = "asked";
    question = { step: "brief", text: "Does this business brief sound right?" };
  } else {
    states.brief = "done";
  }
  if (["approvals", "account", "map", "complete"].includes(step)) {
    states.money = "done";
  } else if (step === "money") {
    states.money = "asked";
    question = { step: "money", text: "How should I spend money?" };
  }
  if (["account", "map", "complete"].includes(step)) {
    states.approvals = "done";
  } else if (step === "approvals") {
    states.approvals = "asked";
    question = {
      step: "approvals",
      text: "What else should wait for your OK?",
    };
  }
  if (step === "account") {
    states.accounts = "asked";
    question = {
      step: "accounts",
      text: "Please sign in to Pinterest.",
      account: {
        id: "pinterest",
        label: "Pinterest",
        url: "https://accounts.example.test/pinterest/login",
      },
    };
    accounts = [
      {
        id: "pinterest",
        label: "Pinterest",
        url: "https://accounts.example.test/pinterest/login",
        state: "asked",
      },
    ];
  }
  if (step === "map") {
    states.accounts = "done";
    accounts = [
      {
        id: "pinterest",
        label: "Pinterest",
        url: "https://accounts.example.test/pinterest/login",
        state: "done",
      },
    ];
    states.map = "asked";
  }
  if (step === "complete") {
    states.accounts = "skipped";
    states.map = "done";
    status = "complete";
  }
  if (step === "map" || step === "complete") {
    map = {
      entries: [
        {
          function: "sales",
          placement: "existing_agent",
          leadPubkey: REFERENCE_AGENTS.aya.pubkey,
        },
        { function: "operations", placement: "scout" },
        { function: "customer_success", placement: "empty" },
        { function: "finance", placement: "empty" },
        { function: "brand", placement: "empty" },
      ],
      firstFunction: "sales",
      approved: step === "complete",
    };
  }
  return {
    brief: { content: briefContent },
    onboarding: {
      content: {
        schemaVersion: 1,
        revision: 1,
        status,
        leadPubkey: REFERENCE_AGENTS.scout.pubkey,
        steps: [
          { step: "brief", state: states.brief },
          { step: "money", state: states.money },
          { step: "approvals", state: states.approvals },
          { step: "accounts", state: states.accounts },
          { step: "map", state: states.map },
        ],
        ...(question ? { question } : {}),
        accounts,
        ...(map ? { map } : {}),
        startedAt: now,
        resumeCount: 0,
        ...(status === "complete" ? { completedAt: now } : {}),
        updatedByPubkey: TEST_IDENTITIES.tyler.pubkey,
        updatedAt: now,
      },
    },
  };
}

async function boot(
  page: Page,
  options: {
    companyAccessRecords?: MockCompanyAccessRecord[];
    companyLeadStatus?: MockCofounderLeadStatus | null;
    companyFunctionActionErrors?: string[];
    companyNumbers?: MockNumbers;
    companyPlans?: MockPlan[];
    companyPlaybooks?: MockPlaybook[];
    companyPlaybookJobs?: MockPlaybookJob[];
    paymentLinks?: MoneyLinkCard[];
    enabled?: boolean;
    identity?: RelayBridgeIdentity;
    businessName?: string;
    referenceWorkspace?: boolean;
    scoutDmChannelName?: string;
    emptyNeedsYou?: boolean;
    withoutBrief?: boolean;
    /** Scout has not begun: there is no onboarding record yet. */
    withoutOnboarding?: boolean;
    /** Agents on this computer, as the host lists them. */
    managedAgents?: MockManagedAgentSeed[];
    /** Errors the next starts of a managed agent fail with, in order. */
    startManagedAgentErrors?: string[];
    step?: CofounderOnboardingStep;
    theme?: "light" | "dark";
  } = {},
) {
  const theme = options.theme ?? "light";
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    ({ selectedTheme, relayUrl }) => {
      const isDark = selectedTheme === "dark";
      const themeName = isDark ? "buzz-dark" : "buzz";
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("colony.appearance.v1:")) {
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
    { selectedTheme: theme, relayUrl: "ws://localhost:3000" },
  );
  const relaySecret = generateSecretKey();
  const initiative = companyInitiativeRecords(options.step);
  const referenceWorkspace = options.referenceWorkspace ?? true;
  await installMockBridge(
    page,
    {
      relaySelf: getPublicKey(relaySecret),
      companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
      referenceWorkspace,
      colony3Sidebar: referenceWorkspace,
      ...(referenceWorkspace
        ? {
            ...(options.businessName
              ? { referenceWorkspaceBusinessName: options.businessName }
              : {}),
            colony3Extras: {
              ...(options.scoutDmChannelName
                ? {
                    patchChannels: [
                      {
                        id: REFERENCE_CHANNEL_IDS.scoutDm,
                        name: options.scoutDmChannelName,
                      },
                    ],
                  }
                : {}),
            },
          }
        : {}),
      relayRequiresMembership: true,
      relayRole: "owner",
      relayMembers: [
        { pubkey: TEST_IDENTITIES.tyler.pubkey, role: "owner" },
        { pubkey: REFERENCE_AGENTS.aya.pubkey, role: "member" },
        { pubkey: REFERENCE_AGENTS.scout.pubkey, role: "member" },
      ],
      cofounderSettings: {
        enabled: options.enabled ?? true,
        moneyPreference: "cheapest_first",
        approvalSwitches: APPROVAL_SWITCHES,
      },
      companyLeadStatus: options.companyLeadStatus,
      companyBriefRecord: options.withoutBrief ? null : initiative.brief,
      companyOnboardingRecord: options.withoutOnboarding
        ? null
        : initiative.onboarding,
      companyOnboardingAutoAdvance: true,
      ...(options.managedAgents
        ? { managedAgents: options.managedAgents }
        : {}),
      ...(options.startManagedAgentErrors
        ? { startManagedAgentErrors: options.startManagedAgentErrors }
        : {}),
      companyFunctionActionErrors: options.companyFunctionActionErrors,
      companyPlans:
        options.companyPlans ??
        (options.emptyNeedsYou
          ? []
          : [
              novemberPlan({
                scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
                ayaPubkey: REFERENCE_AGENTS.aya.pubkey,
              }),
              esignSetupPlan({
                scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
                ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
              }),
            ]),
      companyPlaybooks: options.companyPlaybooks,
      companyPlaybookJobs: options.companyPlaybookJobs,
      companyNumbers: options.companyNumbers,
      companyAccessRecords:
        options.companyAccessRecords ??
        (options.emptyNeedsYou ? [] : phase2AccessRecords()),
    },
    { identity: options.identity },
  );
  await page.addInitScript(
    ({ batchDecisionKind, emptyNeedsYou, ayaPubkey }) => {
      type WhatsAppMockState = {
        batchStatus: "pending" | "approved" | "rejected" | "completed";
        draftState: "draft" | "rejected" | "queued";
        commands: Array<{ kind: number; body: Record<string, unknown> }>;
        holdNextCommand: boolean;
        failNextCommand: boolean;
        releaseNextCommand: () => void;
      };
      type WhatsAppMockWindow = Window & {
        __BUZZ_E2E_WHATSAPP__?: (request: {
          action: "post" | "command";
          path?: string;
          body?: Record<string, unknown>;
          kind?: number;
        }) => Promise<unknown>;
        __BUZZ_E2E_WHATSAPP_STATE__?: {
          commands: Array<{ kind: number; body: Record<string, unknown> }>;
          connectCalls: number;
          holdNextCommand: boolean;
          failNextCommand: boolean;
          releaseNextCommand: () => void;
        };
      };
      const state: WhatsAppMockState = {
        batchStatus: "pending",
        draftState: "draft",
        commands: [],
        holdNextCommand: false,
        failNextCommand: false,
        releaseNextCommand: () => {},
      };
      const self = window as WhatsAppMockWindow;
      self.__BUZZ_E2E_WHATSAPP_STATE__ = {
        commands: state.commands,
        connectCalls: 0,
        get holdNextCommand() {
          return state.holdNextCommand;
        },
        set holdNextCommand(value: boolean) {
          state.holdNextCommand = value;
        },
        get failNextCommand() {
          return state.failNextCommand;
        },
        set failNextCommand(value: boolean) {
          state.failNextCommand = value;
        },
        releaseNextCommand: () => state.releaseNextCommand(),
      };
      self.__BUZZ_E2E_WHATSAPP__ = async (request) => {
        if (request.action === "command") {
          const body = request.body ?? {};
          state.commands.push({ kind: request.kind ?? 0, body });
          if (state.holdNextCommand) {
            state.holdNextCommand = false;
            await new Promise<void>((resolve) => {
              state.releaseNextCommand = resolve;
            });
          }
          if (state.failNextCommand) {
            state.failNextCommand = false;
            throw new Error("The relay refused the action.");
          }
          if (request.kind === batchDecisionKind) {
            if (body.draftId === "cofounder-needs-you-draft") {
              state.draftState =
                body.decision === "reject" ? "rejected" : "queued";
            }
            if (body.batchId === "cofounder-needs-you-batch") {
              state.batchStatus =
                body.decision === "reject" ? "rejected" : "approved";
            }
          }
          return {};
        }

        const body = request.body ?? {};
        if (request.path !== "/api/whatsapp/query") return {};
        if (body.what === "status") {
          return {
            connected: true,
            connectionId: "e2e-cofounder",
            displayPhoneNumber: "+27 61 534 0627",
            verifiedName: "Horizon Labs",
            quality: "green",
            phoneStatus: "connected",
            dailyNewChatCap: 36,
            newChatsSentToday: 12,
            sendingPaused: false,
            pauseReason: null,
            issues: [],
            outreachChannelId: "e2e-whatsapp-outreach-channel",
            templatesSyncedAt: "2026-10-30T08:45:00+02:00",
            templates: [],
            webhookUrl: null,
          };
        }
        if (body.what === "contacts") {
          return {
            contacts: emptyNeedsYou
              ? []
              : [
                  {
                    waId: "27821237135",
                    e164: "+27 82 123 7135",
                    displayName: "Thandeka",
                    profileName: "Thandeka",
                    businessName: "Plane Tree Guesthouse",
                    website: null,
                    label: "Plane Tree Guesthouse",
                    leadId: null,
                    ownerPubkey: ayaPubkey,
                    threadRootEventId: null,
                    lastInboundAt: "2026-10-29T09:14:00+02:00",
                    lastContactedAt: "2026-10-28T09:40:00+02:00",
                    lastOutboundState: "read",
                    lastFailureSummary: null,
                    deliveryFailure: null,
                    lastReplyAt: "2026-10-29T09:14:00+02:00",
                    stage: "replied",
                    stageSetBy: "auto",
                    stageChangedAt: "2026-10-29T09:14:00+02:00",
                    queuedFrom: null,
                    outreachStatus: "replied",
                    hasSentOutbound: true,
                    windowOpen: true,
                    windowClosesAt: "2026-10-30T09:14:00+02:00",
                    optedOut: false,
                    paused: false,
                    pauseReason: null,
                    unanswered: false,
                    awaitingApproval: false,
                    businessOutreachStopped: false,
                    businessStopReason: null,
                  },
                  {
                    waId: "27829876543",
                    e164: "+27 82 987 6543",
                    displayName: "Lwazi",
                    profileName: "Lwazi",
                    businessName: "Corner Cottage Parkhurst",
                    website: null,
                    label: "Corner Cottage Parkhurst",
                    leadId: null,
                    ownerPubkey: ayaPubkey,
                    threadRootEventId: null,
                    lastInboundAt: "2026-10-29T09:14:00+02:00",
                    lastContactedAt: "2026-10-28T09:40:00+02:00",
                    lastOutboundState: "read",
                    lastFailureSummary: null,
                    deliveryFailure: null,
                    lastReplyAt: "2026-10-29T09:14:00+02:00",
                    stage: "wants_call",
                    stageSetBy: "auto",
                    stageChangedAt: "2026-10-29T09:14:00+02:00",
                    queuedFrom: null,
                    outreachStatus: "replied",
                    hasSentOutbound: true,
                    windowOpen: true,
                    windowClosesAt: "2026-10-30T09:14:00+02:00",
                    optedOut: false,
                    paused: false,
                    pauseReason: null,
                    unanswered: false,
                    awaitingApproval: false,
                    businessOutreachStopped: false,
                    businessStopReason: null,
                  },
                ],
          };
        }
        if (body.what === "batches") {
          const batches =
            !emptyNeedsYou &&
            (state.batchStatus === "pending" ||
              body.state === undefined ||
              body.state === state.batchStatus)
              ? [
                  {
                    batchId: "cofounder-needs-you-batch",
                    status: state.batchStatus,
                    createdBy:
                      "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
                    template: "hl_vb",
                    language: "en",
                    rows: {
                      total: 2,
                      ready: 2,
                      sent: 0,
                      failed: 0,
                      dropped: 0,
                    },
                    createdAt: "2026-10-30T08:46:00+02:00",
                  },
                ]
              : [];
          return { batches };
        }
        if (body.what === "drafts") {
          const drafts =
            !emptyNeedsYou && state.draftState === "draft"
              ? [
                  {
                    id: "cofounder-needs-you-draft",
                    waId: "27821237135",
                    direction: "out",
                    kind: "text",
                    text: "I have a few ideas for your November campaign. Would you like to see them?",
                    templateName: null,
                    state: state.draftState,
                    errorCode: null,
                    errorText: null,
                    eventId: null,
                    senderPubkey:
                      "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
                    createdAt: "2026-10-30T08:47:00+02:00",
                    to: "+27 82 123 7135",
                    params: [],
                  },
                ]
              : [];
          return { drafts };
        }
        if (body.what === "batch") {
          return {
            batchId: "cofounder-needs-you-batch",
            status: state.batchStatus,
            createdBy:
              "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
            template: "hl_vb",
            language: "en",
            note: "November campaign introductions",
            materialLinks: [],
            decidedBy: null,
            decidedAt: null,
            createdAt: "2026-10-30T08:46:00+02:00",
            rows: [
              {
                idx: 0,
                to: "+27 82 123 7135",
                leadId: null,
                params: [],
                preview: "Hello from Horizon Labs",
                state: "ready",
                skipReason: null,
              },
              {
                idx: 1,
                to: "+27 82 987 6543",
                leadId: null,
                params: [],
                preview: "A note from Horizon Labs",
                state: "ready",
                skipReason: null,
              },
            ],
            counts: { total: 2, ready: 2, sent: 0, failed: 0, dropped: 0 },
          };
        }
        return {};
      };
    },
    {
      batchDecisionKind: KIND_WHATSAPP_BATCH_DECISION,
      emptyNeedsYou: options.emptyNeedsYou ?? false,
      ayaPubkey: REFERENCE_AGENTS.aya.pubkey,
    },
  );

  await page.addInitScript((paymentLinks) => {
    type MoneyRailsWindow = Window & {
      __BUZZ_E2E_MONEY_RAILS__?: MoneyRailsMockBridge;
      __BUZZ_E2E_MONEY_RAILS_ACTIONS__?: Array<Record<string, unknown>>;
    };
    let snapshot: MoneyRailsSnapshot = {
      paymentLinks,
      connections: [],
      availability: "ready",
      errorMessage: null,
    };
    const listeners = new Set<() => void>();
    const actions: Array<Record<string, unknown>> = [];
    const testWindow = window as MoneyRailsWindow;
    testWindow.__BUZZ_E2E_MONEY_RAILS_ACTIONS__ = actions;
    testWindow.__BUZZ_E2E_MONEY_RAILS__ = {
      getSnapshot: () => snapshot,
      getPaymentLinkDetails: (linkId) =>
        snapshot.paymentLinks.find((card) => card.id === linkId) ?? null,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async execute(action: LiveMoneyRailsAction) {
        actions.push({
          type: action.type,
          ...(action.type === "connect"
            ? { provider: action.provider, host: action.host }
            : { linkId: action.linkId, headEventId: action.headEventId }),
        });
        if (action.type !== "approve" && action.type !== "reject") {
          throw new Error("This money action is not part of this fixture.");
        }
        const card = snapshot.paymentLinks.find(
          (candidate) => candidate.id === action.linkId,
        );
        if (!card || card.headEventId !== action.headEventId) {
          throw new Error(
            "The payment approval changed. Refresh and try again.",
          );
        }
        const updatedCard: MoneyLinkCard = {
          ...card,
          state: action.type === "approve" ? "creating_link" : "cancelled",
        };
        snapshot = {
          ...snapshot,
          paymentLinks: snapshot.paymentLinks.map((candidate) =>
            candidate.id === updatedCard.id ? updatedCard : candidate,
          ),
        };
        for (const listener of [...listeners]) listener();
        return updatedCard;
      },
    };
  }, options.paymentLinks ?? []);
}

async function capture(page: Page, name: string, fullPage = true) {
  await waitForAnimations(page);
  const themeName = name.includes("-dark") ? "buzz-dark" : "buzz";
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return {
          storedTheme: window.localStorage.getItem("buzz-theme"),
          dark: root.classList.contains("dark"),
          buzzTheme: root.getAttribute("data-buzz-theme"),
        };
      }),
    )
    .toEqual({
      storedTheme: themeName,
      dark: themeName === "buzz-dark",
      buzzTheme: themeName,
    });
  const proofDirectory = process.env.COF_UI_DEFECTS_PROOF_DIR;
  const file = proofDirectory
    ? resolve(proofDirectory, name)
    : test.info().outputPath(name);
  if (proofDirectory) {
    await mkdir(dirname(file), { recursive: true });
  }
  await page.screenshot({ fullPage, path: file });
}

/** A stopped Scout made by the Welcome flow, with "start with the app" off. */
function stoppedScout(): MockManagedAgentSeed {
  return {
    pubkey: REFERENCE_AGENTS.scout.pubkey,
    name: "Scout",
    personaId: "builtin:fizz",
    status: "stopped",
    startOnAppLaunch: false,
  };
}

async function commandCalls(page: Page, command: string) {
  return page.evaluate((commandName) => {
    const bridgeWindow = window as Window & {
      __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{ command: string }>;
    };
    return (
      bridgeWindow.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
        (entry) => entry.command === commandName,
      ).length ?? 0
    );
  }, command);
}

async function lastSignedContent(page: Page, kind: number) {
  return page.evaluate((expectedKind) => {
    const bridgeWindow = window as Window & {
      __BUZZ_E2E_SIGNED_EVENTS__?: Array<{
        kind: number;
        content?: string;
      }>;
    };
    const event = [...(bridgeWindow.__BUZZ_E2E_SIGNED_EVENTS__ ?? [])]
      .reverse()
      .find((candidate) => candidate.kind === expectedKind);
    if (!event?.content) return null;
    try {
      return JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, kind);
}

async function expectCofounderSettingsPublished(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const events =
          (
            window as Window & {
              __BUZZ_E2E_SIGNED_EVENTS__?: Array<{
                kind: number;
                content?: string;
              }>;
            }
          ).__BUZZ_E2E_SIGNED_EVENTS__ ?? [];
        return events.some((event) => {
          if (event.kind !== 47060 || !event.content) return false;
          try {
            return (
              (
                JSON.parse(event.content) as {
                  settings?: { enabled?: boolean };
                }
              ).settings?.enabled === true
            );
          } catch {
            return false;
          }
        });
      }),
    )
    .toBe(true);
}

async function expectNeedsYouContentLoaded(page: Page) {
  await expect(
    page.locator(`[data-row-id="plan:${NOVEMBER_PLAN_ID}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`[data-row-id="plan-step:${ESIGN_PLAN_ID}:signup"]`),
  ).toBeVisible();
  await expect(
    page.getByText("Hire a Customer Success lead?", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Message 2 contacts", { exact: true }),
  ).toBeVisible();
}

test.describe("Co-founder mode Phase 2", () => {
  test("enabled co-founder mode opens the Scout direct message from settings", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(1_791_273_600_000) });
    await boot(page, {
      scoutDmChannelName: "Lerato and Scout",
      step: "brief",
      withoutBrief: true,
      businessName: "Colony",
    });
    await page.goto("/#/settings?section=experimental");
    const card = page.getByTestId("cofounder-scout-entry");
    await expect(card).toBeVisible();
    await expect(
      card.getByText("Scout is getting to know Colony", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(card).toContainText(
      "Reading your website, leads, chats and connected tools. Scout will message you a short brief to check.",
    );
    const avatar = page.getByTestId("cofounder-scout-avatar-image");
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute("alt", "Scout avatar");
    const openScout = page.getByTestId("cofounder-open-scout");
    await expect(openScout).toBeVisible();
    await expect(openScout).toBeEnabled();
    await openScout.click();
    await expect(page).toHaveURL(
      new RegExp(`#\\/channels\\/${REFERENCE_CHANNEL_IDS.scoutDm}$`, "u"),
    );
  });

  test("enabled co-founder mode creates a Scout direct message when none exists", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(1_791_273_600_000) });
    await boot(page, {
      referenceWorkspace: false,
      step: "brief",
      withoutBrief: true,
    });
    await page.goto("/#/settings?section=experimental");
    const openScout = page.getByTestId("cofounder-open-scout");
    await expect(openScout).toBeEnabled();
    await openScout.click();
    await expect(page).toHaveURL(/#\/channels\/[0-9a-f-]{36}$/u);
    await expect(page).not.toHaveURL(
      new RegExp(`#\\/channels\\/${REFERENCE_CHANNEL_IDS.scoutDm}$`, "u"),
    );
  });

  test("a stalled Scout card retries by publishing co-founder mode as enabled", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(1_791_273_600_000) });
    await boot(page, {
      identity: TEST_IDENTITIES.tyler,
      step: "brief",
      withoutBrief: true,
      businessName: "Colony",
    });
    await page.goto("/#/settings?section=experimental");

    const card = page.getByTestId("cofounder-scout-entry");
    await expect(
      card.getByText("Scout is getting to know Colony"),
    ).toBeVisible();
    await page.clock.fastForward(3 * 60 * 1000);
    await expect(card.getByText("Scout has not started yet")).toBeVisible();
    const retry = page.getByTestId("cofounder-retry-scout");
    await expect(retry).toHaveText("Try again");
    await retry.click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const events =
            (
              window as Window & {
                __BUZZ_E2E_SIGNED_EVENTS__?: Array<{
                  kind: number;
                  content?: string;
                }>;
              }
            ).__BUZZ_E2E_SIGNED_EVENTS__ ?? [];
          return events.some((event) => {
            if (event.kind !== 47060 || !event.content) return false;
            try {
              return (
                (
                  JSON.parse(event.content) as {
                    settings?: { enabled?: boolean };
                  }
                ).settings?.enabled === true
              );
            } catch {
              return false;
            }
          });
        }),
      )
      .toBe(true);
  });

  test("co-founder mode starts a stopped Scout by itself and shows the card before Scout has begun", async ({
    page,
  }) => {
    // 2 Nov 2026: Scout was stopped by an update and nothing started it, so
    // the owner had to message Scout. Here nothing is sent and nothing clicked.
    await page.clock.install({ time: new Date(1_791_273_600_000) });
    await boot(page, {
      step: "brief",
      withoutBrief: true,
      withoutOnboarding: true,
      businessName: "Colony",
      managedAgents: [stoppedScout()],
    });
    await page.goto("/#/settings?section=experimental");

    // The card is there although no onboarding record exists yet.
    const card = page.getByTestId("cofounder-scout-entry");
    await expect(
      card.getByText("Scout is getting to know Colony", { exact: true }),
    ).toBeVisible();
    // Scout was started, and told to start with the app from now on.
    await expect
      .poll(() => commandCalls(page, "start_managed_agent"))
      .toBeGreaterThan(0);
    await expect
      .poll(() => commandCalls(page, "set_managed_agent_start_on_app_launch"))
      .toBeGreaterThan(0);
  });

  test("a stalled Scout card with no onboarding record retries by publishing co-founder mode as enabled", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(1_791_273_600_000) });
    await boot(page, {
      identity: TEST_IDENTITIES.tyler,
      step: "brief",
      withoutBrief: true,
      withoutOnboarding: true,
      businessName: "Colony",
      managedAgents: [{ ...stoppedScout(), status: "running" }],
    });
    await page.goto("/#/settings?section=experimental");

    const card = page.getByTestId("cofounder-scout-entry");
    await expect(
      card.getByText("Scout is getting to know Colony"),
    ).toBeVisible();
    await page.clock.fastForward(3 * 60 * 1000);
    await expect(card.getByText("Scout has not started yet")).toBeVisible();
    await page.getByTestId("cofounder-retry-scout").click();
    await expectCofounderSettingsPublished(page);
  });

  test("a Scout that cannot start says so with one Try again, which starts it", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(1_791_273_600_000) });
    await boot(page, {
      identity: TEST_IDENTITIES.tyler,
      step: "brief",
      withoutBrief: true,
      withoutOnboarding: true,
      businessName: "Colony",
      managedAgents: [stoppedScout()],
      startManagedAgentErrors: ["Claude Code is not installed."],
    });
    await page.goto("/#/settings?section=experimental");

    const card = page.getByTestId("cofounder-scout-entry");
    await expect(card.getByText("Scout could not start")).toBeVisible();
    await expect(card).toContainText("Claude Code is not installed.");
    const startsBefore = await commandCalls(page, "start_managed_agent");

    await page.getByTestId("cofounder-retry-scout").click();

    // One press: co-founder mode is saved again (a fresh wake) and Scout starts.
    await expectCofounderSettingsPublished(page);
    await expect
      .poll(() => commandCalls(page, "start_managed_agent"))
      .toBeGreaterThan(startsBefore);
    await expect(card.getByText("Scout could not start")).toHaveCount(0);
    await expect(
      card.getByText("Scout is getting to know Colony"),
    ).toBeVisible();
  });

  test("switching co-founder mode off and on again starts a Scout that could not start", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(1_791_273_600_000) });
    await boot(page, {
      identity: TEST_IDENTITIES.tyler,
      step: "brief",
      withoutBrief: true,
      withoutOnboarding: true,
      businessName: "Colony",
      managedAgents: [stoppedScout()],
      startManagedAgentErrors: ["Claude Code is not installed."],
    });
    await page.goto("/#/settings?section=experimental");

    const card = page.getByTestId("cofounder-scout-entry");
    await expect(card.getByText("Scout could not start")).toBeVisible();
    const startsBefore = await commandCalls(page, "start_managed_agent");

    const toggle = page.getByTestId("cofounder-mode-toggle");
    await toggle.click();
    await expect(card).toHaveCount(0);
    await expect(toggle).toBeEnabled();
    await toggle.click();

    // No click on the card and no message to Scout: the switch is enough.
    await expect
      .poll(() => commandCalls(page, "start_managed_agent"))
      .toBeGreaterThan(startsBefore);
    await expect(card.getByText("Scout could not start")).toHaveCount(0);
  });

  test("the durable wake status explains why Scout could not be reached", async ({
    page,
  }) => {
    await boot(page, {
      step: "brief",
      withoutBrief: true,
      companyLeadStatus: {
        schemaVersion: 1,
        state: "unreachable",
        problem: "several_scouts",
        detail: "The relay found more than one Scout.",
        attempts: 3,
        since: 1_791_273_600,
        updatedAt: 1_791_273_780,
      },
    });
    await page.goto("/#/settings?section=experimental");

    const card = page.getByTestId("cofounder-scout-entry");
    await expect(card.getByText("Scout could not be reached")).toBeVisible();
    await expect(card).toContainText("The relay found more than one Scout.");
    await expect(page.getByTestId("cofounder-retry-scout")).toBeVisible();
  });

  test("co-founder settings hides the getting to know card after Scout sends a brief", async ({
    page,
  }) => {
    await boot(page, { step: "brief" });
    await page.goto("/#/settings?section=experimental");
    await expect(page.getByTestId("cofounder-scout-entry")).toHaveCount(0);
  });

  test("co-founder settings hides the getting to know card after onboarding completes", async ({
    page,
  }) => {
    await boot(page, { step: "complete" });
    await page.goto("/#/settings?section=experimental");
    await expect(page.getByTestId("cofounder-scout-entry")).toHaveCount(0);
  });

  test("Scout guides onboarding one step at a time and then shows a plan in chat", async ({
    page,
  }) => {
    await boot(page, { identity: TEST_IDENTITIES.tyler });
    await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
    await expect(page.getByTestId("cofounder-chat-surface")).toBeVisible();
    await expect(page.getByTestId("cofounder-onboarding")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /what I know about Lerato Social/iu }),
    ).toBeVisible();
    await page.getByTestId("cofounder-brief-confirm").click();
    await expect(page.getByTestId("cofounder-money-best")).toBeVisible();
    await expect(page.getByTestId("cofounder-approval-save")).toHaveCount(0);

    await page.getByTestId("cofounder-money-best").click();
    await expect(page.getByTestId("cofounder-approval-save")).toBeVisible();
    await page
      .getByTestId("cofounder-approval-approveEveryDiscoveryCampaign")
      .uncheck();
    await page.getByTestId("cofounder-approval-save").click();
    await expect(page.getByTestId("cofounder-account-connected")).toBeVisible();
    await page.getByTestId("cofounder-account-connected").click();
    await expect(page.getByTestId("cofounder-map-approve")).toBeVisible();
    await page.getByTestId("cofounder-map-approve").click();
    await expect(
      page.getByRole("button", { name: "Finish onboarding" }),
    ).toBeVisible();
    await page.goto("/#/company/map");
    await expect(page.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "data-state",
      "filled",
    );
    await expect(page.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "aria-label",
      /Sales, led by/iu,
    );
    await expect(page.getByTestId("cofounder-map-operations")).toHaveAttribute(
      "data-state",
      "covered_by_scout",
    );
    await expect(page.getByTestId("cofounder-map-operations")).toHaveAttribute(
      "aria-label",
      "Operations, covered by Scout",
    );
    await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
    await expect(
      page.getByRole("button", { name: "Finish onboarding" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Finish onboarding" }).click();

    const plan = page.getByTestId(`cofounder-plan-${NOVEMBER_PLAN_ID}`);
    await expect(plan).toBeVisible();
    await expect(plan).toContainText("5 won");
    await plan.getByTestId(`cofounder-plan-edit-${NOVEMBER_PLAN_ID}`).click();
    await page
      .getByTestId(`cofounder-plan-title-${NOVEMBER_PLAN_ID}`)
      .fill("A revised guesthouse plan");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(plan).toContainText("A revised guesthouse plan");
    await expect(plan).toContainText("Find 60 guesthouses");
    await plan
      .getByTestId(`cofounder-plan-approve-${NOVEMBER_PLAN_ID}`)
      .click();
    await expect(plan).toContainText("Approved");
  });

  test("an approved company map retries function slot writes before finishing", async ({
    page,
  }) => {
    await boot(page, {
      companyFunctionActionErrors: ["Temporary function slot write failure."],
      identity: TEST_IDENTITIES.tyler,
      step: "map",
    });
    await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
    await page.getByTestId("cofounder-map-approve").click();
    await expect(page.getByRole("alert")).toContainText(
      "Temporary function slot write failure.",
    );

    await page.getByRole("button", { name: "Finish onboarding" }).click();
    await expect(
      page.getByTestId(`cofounder-plan-${NOVEMBER_PLAN_ID}`),
    ).toBeVisible();
    await page.goto("/#/company/map");
    await expect(page.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "data-state",
      "filled",
    );
    await expect(page.getByTestId("cofounder-map-operations")).toHaveAttribute(
      "data-state",
      "covered_by_scout",
    );
  });

  test("Scout plan can be rejected", async ({ page }) => {
    await boot(page, {
      identity: TEST_IDENTITIES.tyler,
      step: "complete",
    });
    await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
    const plan = page.getByTestId(`cofounder-plan-${NOVEMBER_PLAN_ID}`);
    await expect(plan).toBeVisible();
    await plan.getByTestId(`cofounder-plan-reject-${NOVEMBER_PLAN_ID}`).click();
    await expect(plan).toContainText("Rejected");
  });

  test("primary plan actions keep readable contrast in light and dark themes", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"] as const) {
      await boot(page, { step: "complete", theme });
      await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
      const approve = page.getByTestId(
        `cofounder-plan-approve-${NOVEMBER_PLAN_ID}`,
      );
      await expect(approve).toBeVisible();
      const ratio = await approve.evaluate((button) => {
        const parse = (value: string) =>
          value.match(/[\d.]+/gu)?.map(Number) ?? [];
        const toLinear = (channel: number) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (color: string) => {
          const [red, green, blue] = parse(color);
          return (
            0.2126 * toLinear(red ?? 0) +
            0.7152 * toLinear(green ?? 0) +
            0.0722 * toLinear(blue ?? 0)
          );
        };
        const style = window.getComputedStyle(button);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
      expect(ratio, `${theme} primary action contrast`).toBeGreaterThanOrEqual(
        4.5,
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const tableWrap = page.locator(".cf2-plan-table-wrap");
    await expect
      .poll(() =>
        tableWrap.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0);
    await expect(page.locator(".cf2-step-mobile-meta").first()).toBeVisible();
  });

  test("Needs you approves or rejects items and opens the exact prepared page", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    await boot(page, { identity: TEST_IDENTITIES.tyler });
    await page.goto("/#/today/needs-you");
    await expect(page.getByTestId("cofounder-needs-you-screen")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Needs you", exact: true }),
    ).toBeVisible();
    const plan = page.locator(`[data-row-id="plan:${NOVEMBER_PLAN_ID}"]`);
    await expect(plan).toContainText("Get 5 Horizon Labs clients in November");

    await page
      .getByTestId(`needs-you-action-yes-plan:${NOVEMBER_PLAN_ID}`)
      .click();
    await expect(plan).toHaveCount(0);
    await page
      .getByTestId(`needs-you-action-yes-plan-step:${ESIGN_PLAN_ID}:template`)
      .click();
    await expect(
      page.locator(`[data-row-id="plan-step:${ESIGN_PLAN_ID}:template"]`),
    ).toHaveCount(0);
    const paymentGap = page.locator(
      `[data-row-id="capability-gap:${PAYMENT_GAP_ID}"]`,
    );
    await expect(paymentGap).toContainText("Connect a payment link account");
    await page
      .getByTestId(`needs-you-action-yes-capability-gap:${PAYMENT_GAP_ID}`)
      .click();
    await expect(page.getByTestId("work-area-browser")).toBeVisible();
    await expect(page.getByTestId("browser-address")).toHaveValue(
      "https://accounts.example.test/payment-link/login",
    );
  });

  test("Needs you reads WhatsApp batches and drafts and submits draft decisions", async ({
    page,
  }) => {
    await boot(page, { identity: TEST_IDENTITIES.tyler });
    await page.goto("/#/today/needs-you");

    const batch = page.locator(
      `[data-row-id="wa-batch:${NEEDS_YOU_WA_BATCH_ID}"]`,
    );
    const draft = page.locator(
      `[data-row-id="draft:${NEEDS_YOU_WA_DRAFT_ID}"]`,
    );
    await expect(batch).toContainText("Message 2 contacts");
    await expect(draft).toContainText(
      "I have a few ideas for your November campaign.",
    );
    await page
      .getByTestId(`needs-you-action-no-draft:${NEEDS_YOU_WA_DRAFT_ID}`)
      .click();
    await expect(draft).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const testWindow = window as Window & {
            __BUZZ_E2E_WHATSAPP_STATE__?: {
              commands: Array<{
                kind: number;
                body: Record<string, unknown>;
              }>;
            };
          };
          return (
            testWindow.__BUZZ_E2E_WHATSAPP_STATE__?.commands.at(-1) ?? null
          );
        }),
      )
      .toEqual({
        kind: KIND_WHATSAPP_BATCH_DECISION,
        body: { v: 1, draftId: NEEDS_YOU_WA_DRAFT_ID, decision: "reject" },
      });

    await page
      .getByTestId(`needs-you-open-wa-batch:${NEEDS_YOU_WA_BATCH_ID}`)
      .click();
    await expect(page.getByTestId("whatsapp-batch-page")).toBeVisible();
    const batchPage = page.getByTestId("whatsapp-batch-page");
    await expect(batchPage).toContainText("2 businesses");
    await expect(batchPage).toContainText("Guesthouses · 2");
  });

  test("Needs you names and records playbook and numbers decisions", async ({
    page,
  }) => {
    const playbookInput = {
      scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
      ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
    };
    await boot(page, {
      companyPlans: [],
      companyAccessRecords: [],
      companyPlaybooks: [
        deliveryPlaybook(playbookInput),
        followUpPlaybook(playbookInput),
      ],
      companyPlaybookJobs: deliveryJobs(playbookInput),
      companyNumbers: makeCofounderNumbersFixture({
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
        scoutPubkey: REFERENCE_AGENTS.scout.pubkey,
        salesLeadPubkey: REFERENCE_AGENTS.aya.pubkey,
        includeProposal: true,
      }),
      identity: TEST_IDENTITIES.tyler,
    });
    await page.goto("/#/today/needs-you");

    const newPlaybook = page.locator(
      `[data-row-id="playbook:${FOLLOW_UP_PLAYBOOK_ID}"]`,
    );
    const addPlaybook = page.getByTestId(
      `needs-you-action-yes-playbook:${FOLLOW_UP_PLAYBOOK_ID}`,
    );
    await expect(addPlaybook).toHaveText("Add it");
    await addPlaybook.click();
    await expect(newPlaybook).toHaveCount(0);
    await expect
      .poll(() => lastSignedContent(page, KIND_PLAYBOOK_ACTION))
      .toMatchObject({ kind: "approve", playbookId: FOLLOW_UP_PLAYBOOK_ID });

    const change = page.locator(
      `[data-row-id="playbook:${DELIVERY_PLAYBOOK_ID}"]`,
    );
    const rejectChange = page.getByTestId(
      `needs-you-action-no-playbook:${DELIVERY_PLAYBOOK_ID}`,
    );
    await expect(change).toContainText("Change to Delivery");
    await rejectChange.click();
    await expect(change).toHaveCount(0);
    await expect
      .poll(() => lastSignedContent(page, KIND_PLAYBOOK_ACTION))
      .toMatchObject({ kind: "reject", playbookId: DELIVERY_PLAYBOOK_ID });

    const launch = page.locator(
      `[data-row-id="playbook-step:${NORTHLINE_JOB_ID}:launch"]`,
    );
    const goLive = page.getByTestId(
      `needs-you-action-yes-playbook-step:${NORTHLINE_JOB_ID}:launch`,
    );
    await expect(goLive).toHaveText("Go live");
    await goLive.click();
    await expect(launch).toHaveCount(0);
    await expect
      .poll(() => lastSignedContent(page, KIND_PLAYBOOK_ACTION))
      .toMatchObject({
        kind: "approve_step",
        jobId: NORTHLINE_JOB_ID,
        stepId: "launch",
      });

    const proposedGoal = page.locator(
      '[data-row-id="goal:9a0e411d-92ed-4fc0-a6e0-0e75312d8221"]',
    );
    const approveGoal = page.getByTestId(
      "needs-you-action-yes-goal:9a0e411d-92ed-4fc0-a6e0-0e75312d8221",
    );
    await expect(approveGoal).toHaveText("Approve");
    await approveGoal.click();
    await expect(proposedGoal).toHaveCount(0);
    await expect
      .poll(() => lastSignedContent(page, KIND_NUMBERS_ACTION))
      .toMatchObject({
        op: "goal_approve",
        goalId: "9a0e411d-92ed-4fc0-a6e0-0e75312d8221",
      });

    const hireDecision = page.locator(
      '[data-row-id="review-decision:2026-10-30:hire-cs"]',
    );
    await expect(
      page.getByTestId(
        "needs-you-action-yes-review-decision:2026-10-30:hire-cs",
      ),
    ).toHaveText("Hire");
    await expect(
      page.getByTestId(
        "needs-you-action-no-review-decision:2026-10-30:hire-cs",
      ),
    ).toHaveText("No");
    await page
      .getByTestId("needs-you-action-no-review-decision:2026-10-30:hire-cs")
      .click();
    await expect(hireDecision).toHaveCount(0);
    await expect
      .poll(() => lastSignedContent(page, KIND_NUMBERS_ACTION))
      .toMatchObject({
        op: "review_decide",
        reviewDate: "2026-10-30",
        decisionId: "hire-cs",
        choice: "declined",
      });
  });

  test("Needs you completes real plan and capability-gap steps", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    const approvedGap = capabilityGapRecord();
    approvedGap.content = {
      ...approvedGap.content,
      state: "approved",
      approvedCostCents: 0,
    };
    await boot(page, {
      companyAccessRecords: [approvedGap],
      identity: TEST_IDENTITIES.tyler,
    });
    await page.goto("/#/today/needs-you");
    await page
      .getByTestId(`needs-you-action-yes-plan-step:${ESIGN_PLAN_ID}:signup`)
      .click();
    await expect(
      page.locator(`[data-row-id="plan-step:${ESIGN_PLAN_ID}:signup"]`),
    ).toHaveCount(0);
    await page
      .getByTestId(`needs-you-open-capability-gap:${CAPABILITY_GAP_ID}`)
      .click();
    await expect(page.getByTestId("work-area-browser")).toBeVisible();
    await expect(page.getByTestId("browser-address")).toHaveValue(
      "https://accounts.example.test/esign/login",
    );
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByTestId("today-needs-you-link").click();
    await expect(
      page.getByTestId(`needs-you-open-capability-gap:${CAPABILITY_GAP_ID}`),
    ).toBeVisible();
    await page
      .getByTestId(`needs-you-action-yes-capability-gap:${CAPABILITY_GAP_ID}`)
      .click();
    await expect(
      page.locator(`[data-row-id="capability-gap:${CAPABILITY_GAP_ID}"]`),
    ).toHaveCount(0);
  });

  test("Access shows pending requests and persists revocation for the selected tool", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    await boot(page, { identity: TEST_IDENTITIES.tyler });
    await page.goto("/#/company/access");
    await expect(page.getByTestId("cofounder-access-screen")).toBeVisible();
    await expect(page.getByTestId("sidebar-nav-company-content")).toBeHidden();
    await expect(
      page.getByTestId("sidebar-nav-company-toggle"),
    ).toHaveAttribute("data-current", "true");
    await expect(page.getByTestId("sidebar-activity-button")).toHaveAttribute(
      "data-active",
      "false",
    );
    await page.getByTestId("sidebar-nav-company-toggle").click();
    await expect(page.getByTestId("sidebar-company-access")).toHaveAttribute(
      "aria-current",
      "page",
    );
    const pendingPaymentGap = page.getByTestId(
      `cofounder-access-pending-${PAYMENT_GAP_ID}`,
    );
    await expect(pendingPaymentGap).toContainText(
      "Connect a payment link account",
    );
    await expect(pendingPaymentGap).toContainText(
      "Free to join, a fee per payment",
    );

    await page.getByTestId("cofounder-access-revoke-whatsapp").click();
    await expect(page.getByTestId("cofounder-access-whatsapp")).toContainText(
      "Revoked",
    );
    await expect(
      page.getByTestId("cofounder-access-revoke-whatsapp"),
    ).toHaveCount(0);
    await expect(page.getByTestId("cofounder-access-gmail")).toBeVisible();

    await page.goto("/#/company/access");
    await page
      .getByTestId(`cofounder-access-approve-${PAYMENT_GAP_ID}`)
      .click();
    await expect(page.getByTestId("work-area-browser")).toBeVisible();
    await expect(page.getByTestId("browser-address")).toHaveValue(
      "https://accounts.example.test/payment-link/login",
    );
    await page.goto("/#/today/needs-you");
    await expect(
      page.getByTestId(`needs-you-open-capability-gap:${PAYMENT_GAP_ID}`),
    ).toBeVisible();
  });

  test("capability gaps move from approval to the built-in browser step", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    await boot(page, {
      companyAccessRecords: [capabilityGapRecord()],
      identity: TEST_IDENTITIES.tyler,
    });
    await page.goto("/#/today/needs-you");

    const gap = page.locator(
      `[data-row-id="capability-gap:${CAPABILITY_GAP_ID}"]`,
    );
    await expect(gap).toContainText("Connect the e-sign account");
    await page
      .getByTestId(`needs-you-action-yes-capability-gap:${CAPABILITY_GAP_ID}`)
      .click();
    const browserTab = page.getByRole("tabpanel", {
      name: /accounts\.example\.test\/esign/u,
    });
    await expect(browserTab).toBeVisible();
    await expect(browserTab.getByTestId("browser-address")).toHaveValue(
      "https://accounts.example.test/esign/login",
    );

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByTestId("today-needs-you-link").click();
    await expect(
      page.getByTestId(`needs-you-open-capability-gap:${CAPABILITY_GAP_ID}`),
    ).toBeVisible();
    await page
      .getByTestId(`needs-you-open-capability-gap:${CAPABILITY_GAP_ID}`)
      .click();
    await expect(browserTab).toBeVisible();
    await expect(browserTab.getByTestId("browser-address")).toHaveValue(
      "https://accounts.example.test/esign/login",
    );

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByTestId("today-needs-you-link").click();
    await page
      .getByTestId(`needs-you-action-yes-capability-gap:${CAPABILITY_GAP_ID}`)
      .click();
    await expect(gap).toHaveCount(0);
  });

  test("declining a capability gap removes it from both approval surfaces", async ({
    page,
  }) => {
    await boot(page, {
      companyAccessRecords: [capabilityGapRecord()],
      identity: TEST_IDENTITIES.tyler,
    });
    await page.goto("/#/today/needs-you");
    await page
      .getByTestId(`needs-you-action-no-capability-gap:${CAPABILITY_GAP_ID}`)
      .click();

    await expect(
      page.locator(`[data-row-id="capability-gap:${CAPABILITY_GAP_ID}"]`),
    ).toHaveCount(0);
    await page.goto("/#/company/access");
    await expect(
      page.getByTestId(`cofounder-access-pending-${CAPABILITY_GAP_ID}`),
    ).toHaveCount(0);
  });

  test("Needs you matches the measured desktop and phone layout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page, {
      companyNumbers: NEEDS_YOU_NUMBERS,
      identity: TEST_IDENTITIES.tyler,
    });
    await page.goto("/#/today/needs-you");
    await expectNeedsYouContentLoaded(page);

    const desktop = await page.evaluate(() => {
      const pageElement =
        document.querySelector<HTMLElement>(".needs-you-page");
      const row = document.querySelector<HTMLElement>(".needs-you-row");
      const avatar = document.querySelector<HTMLElement>(
        ".needs-you-row-avatar",
      );
      const action = document.querySelector<HTMLElement>(
        ".needs-you-row-actions button",
      );
      const title = document.querySelector<HTMLElement>(
        ".needs-you-row-copy strong",
      );
      const subtitle = document.querySelector<HTMLElement>(
        ".needs-you-row-copy small",
      );
      const heading = document.querySelector<HTMLElement>(
        ".needs-you-heading h1",
      );
      const summaryCopy = document.querySelector<HTMLElement>(
        ".needs-you-heading p",
      );
      const groups = document.querySelector<HTMLElement>(".needs-you-groups");
      const groupRows = document.querySelector<HTMLElement>(
        ".needs-you-group-rows",
      );
      const summary = document.querySelector<HTMLElement>(
        '[data-testid="needs-you-shared-total"]',
      );
      const yesAction = document.querySelector<HTMLElement>(
        ".needs-you-row-actions .needs-you-row-yes",
      );
      const noAction = document.querySelector<HTMLElement>(
        ".needs-you-row-actions .needs-you-row-no",
      );
      const groupHeading = document.querySelector<HTMLElement>(
        ".needs-you-group h2",
      );
      const groupHeadings = Array.from(
        document.querySelectorAll(".needs-you-group h2"),
        (element) => element.textContent?.replace(/\s+/gu, " ").trim() ?? "",
      );
      const rgb = (value: string) =>
        value
          .match(/[\d.]+/gu)
          ?.slice(0, 3)
          .map(Number);
      const rowStyle = row ? getComputedStyle(row) : null;
      const yesStyle = yesAction ? getComputedStyle(yesAction) : null;
      const noStyle = noAction ? getComputedStyle(noAction) : null;
      const headingStyle = heading ? getComputedStyle(heading) : null;
      const summaryStyle = summaryCopy ? getComputedStyle(summaryCopy) : null;
      const groupStyle = groupHeading ? getComputedStyle(groupHeading) : null;
      const titleStyle = title ? getComputedStyle(title) : null;
      const subtitleStyle = subtitle ? getComputedStyle(subtitle) : null;
      const box = (element: HTMLElement | null) => {
        const rect = element?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height } : null;
      };
      return {
        page: box(pageElement),
        paddingTop: pageElement
          ? getComputedStyle(pageElement).paddingTop
          : null,
        row: box(row),
        avatar: box(avatar),
        action: box(action),
        titleFont: title ? getComputedStyle(title).fontSize : null,
        titleWeight: titleStyle?.fontWeight,
        subtitleFont: subtitle ? getComputedStyle(subtitle).fontSize : null,
        subtitleColor: subtitleStyle ? rgb(subtitleStyle.color) : null,
        headingFont: headingStyle?.fontSize,
        headingWeight: headingStyle?.fontWeight,
        headingLineHeight: headingStyle?.lineHeight,
        headingLetterSpacing: headingStyle?.letterSpacing,
        summaryFont: summaryStyle?.fontSize,
        summaryMarginTop: summaryStyle?.marginTop,
        summaryColor: summaryStyle ? rgb(summaryStyle.color) : null,
        groupMarginTop: groups ? getComputedStyle(groups).marginTop : null,
        groupFont: groupStyle?.fontSize,
        groupWeight: groupStyle?.fontWeight,
        groupLetterSpacing: groupStyle?.letterSpacing,
        groupMarginBottom: groupStyle?.marginBottom,
        rowGap: groupRows ? getComputedStyle(groupRows).gap : null,
        rowGapBetweenCopyAndActions: row ? getComputedStyle(row).gap : null,
        rowPadding: row ? getComputedStyle(row).padding : null,
        rowRadius: rowStyle?.borderRadius,
        rowColor: rowStyle ? rgb(rowStyle.color) : null,
        rowCardColor: rowStyle ? rgb(rowStyle.backgroundColor) : null,
        rowShadow: rowStyle?.boxShadow,
        yesPadding: yesStyle?.padding,
        yesRadius: yesStyle?.borderRadius,
        yesFont: yesStyle?.fontSize,
        yesWeight: yesStyle?.fontWeight,
        yesLineHeight: yesStyle?.lineHeight,
        yesColor: yesStyle ? rgb(yesStyle.color) : null,
        yesBackground: yesStyle ? rgb(yesStyle.backgroundColor) : null,
        noPadding: noStyle?.padding,
        noRadius: noStyle?.borderRadius,
        noFont: noStyle?.fontSize,
        noWeight: noStyle?.fontWeight,
        noColor: noStyle ? rgb(noStyle.color) : null,
        noBackground: noStyle ? rgb(noStyle.backgroundColor) : null,
        noShadow: noStyle?.boxShadow,
        groupHeadings,
        groupRowCounts: Array.from(
          document.querySelectorAll<HTMLElement>(".needs-you-group"),
          (group) => ({
            heading: group.querySelector("h2")?.textContent?.trim() ?? "",
            rows: group.querySelectorAll(".needs-you-row").length,
          }),
        ),
        renderedRows: document.querySelectorAll(".needs-you-row").length,
        summaryRows: Number(summary?.dataset.rowCount),
        sharedTotal: Number(summary?.dataset.summaryTotal),
      };
    });
    expect(desktop).toMatchObject({
      page: { width: 1120 },
      paddingTop: "22px",
      row: { height: 58 },
      avatar: { width: 36, height: 36 },
      action: { height: 38 },
      titleFont: "16px",
      titleWeight: "800",
      subtitleFont: "14px",
      subtitleColor: [75, 70, 84],
      headingFont: "40px",
      headingWeight: "800",
      headingLineHeight: "46px",
      headingLetterSpacing: "-1.2px",
      summaryFont: "17px",
      summaryMarginTop: "6px",
      summaryColor: [75, 70, 84],
      groupMarginTop: "16px",
      groupFont: "12px",
      groupWeight: "800",
      groupLetterSpacing: "1.08px",
      groupMarginBottom: "8px",
      rowGap: "6px",
      rowGapBetweenCopyAndActions: "14px",
      rowPadding: "0px 16px 0px 18px",
      rowRadius: "16px",
      rowColor: [37, 34, 44],
      rowCardColor: [255, 255, 255],
      yesPadding: "0px 18px",
      yesRadius: "11px",
      yesFont: "15px",
      yesWeight: "800",
      yesLineHeight: "15px",
      yesColor: [255, 253, 250],
      yesBackground: [91, 69, 190],
      noPadding: "0px 16px",
      noRadius: "11px",
      noFont: "15px",
      noWeight: "700",
      noColor: [75, 70, 84],
      noBackground: [255, 255, 255],
    });
    expect(desktop.rowShadow).toContain("rgb(224, 216, 229)");
    expect(desktop.noShadow).toContain("rgb(224, 216, 229)");
    expect(desktop.noShadow).toContain("inset");
    const groupLabels = desktop.groupHeadings.map(
      (heading) => heading.split(" · ")[0],
    );
    expect(groupLabels).toContain("CUSTOMER SUCCESS");
    expect(groupLabels).toEqual(
      [...groupLabels].sort(
        (left, right) =>
          [
            "SALES",
            "OPERATIONS",
            "FINANCE",
            "CUSTOMER SUCCESS",
            "BRAND",
            "COMPANY",
          ].indexOf(left) -
          [
            "SALES",
            "OPERATIONS",
            "FINANCE",
            "CUSTOMER SUCCESS",
            "BRAND",
            "COMPANY",
          ].indexOf(right),
      ),
    );
    for (const group of desktop.groupRowCounts) {
      expect(group.heading).toMatch(/^[A-Z ]+ · \d+$/u);
      expect(Number(group.heading.split(" · ")[1])).toBe(group.rows);
    }
    expect(desktop.renderedRows).toBe(desktop.summaryRows);
    expect(desktop.renderedRows).toBe(desktop.sharedTotal);
    await expect(page.getByTestId("needs-you-shared-total")).toContainText(
      "Nothing goes out until you say yes.",
    );
    await expect(
      page.locator(`[data-row-id="plan:${NOVEMBER_PLAN_ID}"]`),
    ).toContainText("Approve");
    await expect(
      page.locator(`[data-row-id="wa-batch:${NEEDS_YOU_WA_BATCH_ID}"]`),
    ).toContainText("Send 2");
    await expect(
      page.locator(`[data-row-id="call:27829876543"]`),
    ).toContainText("Pick a time");
    await expect(
      page
        .locator(`[data-row-id="call:27829876543"]`)
        .locator(".needs-you-row-no"),
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-row-id="review-decision:2026-10-30:hire-customer-success"]',
      ),
    ).toContainText("Hire");

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      actionHeights: Array.from(
        document.querySelectorAll<HTMLElement>(".needs-you-row-actions button"),
        (button) => button.getBoundingClientRect().height,
      ),
      titles: Array.from(
        document.querySelectorAll<HTMLElement>(".needs-you-row-copy strong"),
        (title) => {
          const style = getComputedStyle(title);
          return {
            clientWidth: title.clientWidth,
            scrollWidth: title.scrollWidth,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          };
        },
      ),
    }));
    expect(mobile.documentWidth).toBe(mobile.viewportWidth);
    expect(mobile.actionHeights.length).toBeGreaterThan(0);
    expect(mobile.actionHeights.every((height) => height >= 44)).toBe(true);
    expect(mobile.titles.length).toBeGreaterThan(0);
    expect(
      mobile.titles.every(
        ({ clientWidth, scrollWidth }) => scrollWidth === clientWidth,
      ),
    ).toBe(true);
    expect(
      mobile.titles.every(({ textOverflow }) => textOverflow !== "ellipsis"),
    ).toBe(true);
    expect(
      mobile.titles.every(({ whiteSpace }) => whiteSpace === "normal"),
    ).toBe(true);
    const mobileActions = page.locator(".needs-you-row-actions button");
    for (let index = 0; index < (await mobileActions.count()); index += 1) {
      const action = mobileActions.nth(index);
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
    }
  });

  test("Needs you keeps action failures on their row and handles payment links", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page, {
      identity: TEST_IDENTITIES.tyler,
      paymentLinks: [NEEDS_YOU_PAYMENT_LINK, NEEDS_YOU_PAYMENT_LINK_NO],
    });
    await page.goto("/#/today/needs-you");

    const batch = page.locator(
      `[data-row-id="wa-batch:${NEEDS_YOU_WA_BATCH_ID}"]`,
    );
    const batchAction = page.getByTestId(
      `needs-you-action-yes-wa-batch:${NEEDS_YOU_WA_BATCH_ID}`,
    );
    await page.evaluate(() => {
      const testWindow = window as Window & {
        __BUZZ_E2E_WHATSAPP_STATE__?: { holdNextCommand: boolean };
      };
      if (testWindow.__BUZZ_E2E_WHATSAPP_STATE__) {
        testWindow.__BUZZ_E2E_WHATSAPP_STATE__.holdNextCommand = true;
      }
    });
    await batchAction.click();
    await expect(batchAction).toHaveText("Saving…");
    await expect(batchAction).toBeDisabled();
    await page.evaluate(() => {
      const testWindow = window as Window & {
        __BUZZ_E2E_WHATSAPP_STATE__?: { releaseNextCommand: () => void };
      };
      testWindow.__BUZZ_E2E_WHATSAPP_STATE__?.releaseNextCommand();
    });
    await expect(batch).toHaveCount(0);

    const draft = page.locator(
      `[data-row-id="draft:${NEEDS_YOU_WA_DRAFT_ID}"]`,
    );
    const rejectDraft = page.getByTestId(
      `needs-you-action-no-draft:${NEEDS_YOU_WA_DRAFT_ID}`,
    );
    await page.evaluate(() => {
      const testWindow = window as Window & {
        __BUZZ_E2E_WHATSAPP_STATE__?: { failNextCommand: boolean };
      };
      if (testWindow.__BUZZ_E2E_WHATSAPP_STATE__) {
        testWindow.__BUZZ_E2E_WHATSAPP_STATE__.failNextCommand = true;
      }
    });
    await rejectDraft.click();
    await expect(draft).toBeVisible();
    await expect(draft.getByRole("alert")).toHaveText(
      "Could not save. Try again.",
    );
    await expect(rejectDraft).toBeEnabled();

    const paymentLink = page.locator(
      `[data-row-id="payment-link:${NEEDS_YOU_PAYMENT_LINK_ID}"]`,
    );
    await expect(paymentLink).toContainText(
      "Send a deposit link to Thandeka, Plane Tree Guesthouse",
    );
    await expect(paymentLink).toContainText(
      "R3,750. Half of the signed R7,500 quote",
    );
    await paymentLink
      .getByTestId(
        `needs-you-action-yes-payment-link:${NEEDS_YOU_PAYMENT_LINK_ID}`,
      )
      .click();
    await expect(paymentLink).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const testWindow = window as Window & {
            __BUZZ_E2E_MONEY_RAILS_ACTIONS__?: Array<Record<string, unknown>>;
          };
          return testWindow.__BUZZ_E2E_MONEY_RAILS_ACTIONS__?.at(-1) ?? null;
        }),
      )
      .toEqual({
        type: "approve",
        linkId: NEEDS_YOU_PAYMENT_LINK_ID,
        headEventId: NEEDS_YOU_PAYMENT_LINK.headEventId,
      });

    const rejectedPaymentLink = page.locator(
      `[data-row-id="payment-link:${NEEDS_YOU_PAYMENT_LINK_NO.id}"]`,
    );
    const rejectPaymentLink = page.getByTestId(
      `needs-you-action-no-payment-link:${NEEDS_YOU_PAYMENT_LINK_NO.id}`,
    );
    await expect(rejectPaymentLink).toHaveText("No");
    await rejectPaymentLink.click();
    await expect(rejectedPaymentLink).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const testWindow = window as Window & {
            __BUZZ_E2E_MONEY_RAILS_ACTIONS__?: Array<Record<string, unknown>>;
          };
          return testWindow.__BUZZ_E2E_MONEY_RAILS_ACTIONS__?.at(-1) ?? null;
        }),
      )
      .toEqual({
        type: "reject",
        linkId: NEEDS_YOU_PAYMENT_LINK_NO.id,
        headEventId: NEEDS_YOU_PAYMENT_LINK_NO.headEventId,
      });
  });

  test("Needs you captures empty, saving, and refusal states at both sizes and themes", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const viewports = [
      { name: "1440", width: 1440, height: 900 },
      { name: "390", width: 390, height: 844 },
    ];

    for (const theme of ["light", "dark"] as const) {
      for (const viewport of viewports) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          await boot(page, {
            companyPlans: [],
            companyAccessRecords: [],
            emptyNeedsYou: true,
            identity: TEST_IDENTITIES.tyler,
            theme,
          });
          await page.goto("/#/today/needs-you");
          await expect(page.getByTestId("needs-you-empty")).toHaveText(
            "Nothing needs you right now.",
          );
          await expect(page.getByTestId("needs-you-row")).toHaveCount(0);
          await expect(page.locator(".needs-you-group")).toHaveCount(0);
          await expect(page.getByTestId("needs-you-shared-total")).toHaveText(
            "0 things. Nothing goes out until you say yes.",
          );
          const sizeAndOverflow = await page.evaluate(() => ({
            viewportWidth: document.documentElement.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
          }));
          expect(sizeAndOverflow.documentWidth).toBeLessThanOrEqual(
            sizeAndOverflow.viewportWidth,
          );
          await capture(
            page,
            `needs-you-empty-${viewport.name}-${theme}.png`,
            viewport.width === 1440,
          );
        } finally {
          await context.close();
        }
      }
    }

    for (const theme of ["light", "dark"] as const) {
      for (const viewport of viewports) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          await boot(page, { identity: TEST_IDENTITIES.tyler, theme });
          await page.goto("/#/today/needs-you");

          const batch = page.locator(
            `[data-row-id="wa-batch:${NEEDS_YOU_WA_BATCH_ID}"]`,
          );
          const batchAction = page.getByTestId(
            `needs-you-action-yes-wa-batch:${NEEDS_YOU_WA_BATCH_ID}`,
          );
          const batchNo = page.getByTestId(
            `needs-you-action-no-wa-batch:${NEEDS_YOU_WA_BATCH_ID}`,
          );
          await page.evaluate(() => {
            const testWindow = window as Window & {
              __BUZZ_E2E_WHATSAPP_STATE__?: { holdNextCommand: boolean };
            };
            if (testWindow.__BUZZ_E2E_WHATSAPP_STATE__) {
              testWindow.__BUZZ_E2E_WHATSAPP_STATE__.holdNextCommand = true;
            }
          });
          await batchAction.click();
          await expect(batchAction).toHaveText("Saving…");
          await expect(batchAction).toBeDisabled();
          await expect(batchNo).toBeDisabled();
          if (viewport.width === 390) {
            const phone = await page.evaluate(() => ({
              viewportWidth: document.documentElement.clientWidth,
              documentWidth: document.documentElement.scrollWidth,
              actionHeights: Array.from(
                document.querySelectorAll<HTMLElement>(
                  ".needs-you-row-actions button",
                ),
                (button) => button.getBoundingClientRect().height,
              ),
            }));
            expect(phone.documentWidth).toBeLessThanOrEqual(
              phone.viewportWidth,
            );
            expect(phone.actionHeights.every((height) => height >= 44)).toBe(
              true,
            );
          }
          await capture(
            page,
            `needs-you-saving-${viewport.name}-${theme}.png`,
            viewport.width === 1440,
          );
          await page.evaluate(() => {
            const testWindow = window as Window & {
              __BUZZ_E2E_WHATSAPP_STATE__?: { releaseNextCommand: () => void };
            };
            testWindow.__BUZZ_E2E_WHATSAPP_STATE__?.releaseNextCommand();
          });
          await expect(batch).toHaveCount(0);

          const draft = page.locator(
            `[data-row-id="draft:${NEEDS_YOU_WA_DRAFT_ID}"]`,
          );
          const rejectDraft = page.getByTestId(
            `needs-you-action-no-draft:${NEEDS_YOU_WA_DRAFT_ID}`,
          );
          await page.evaluate(() => {
            const testWindow = window as Window & {
              __BUZZ_E2E_WHATSAPP_STATE__?: { failNextCommand: boolean };
            };
            if (testWindow.__BUZZ_E2E_WHATSAPP_STATE__) {
              testWindow.__BUZZ_E2E_WHATSAPP_STATE__.failNextCommand = true;
            }
          });
          await rejectDraft.click();
          await expect(draft.getByRole("alert")).toHaveText(
            "Could not save. Try again.",
          );
          await expect(rejectDraft).toBeEnabled();
          await capture(
            page,
            `needs-you-refusal-${viewport.name}-${theme}.png`,
            viewport.width === 1440,
          );
        } finally {
          await context.close();
        }
      }
    }
  });

  test("Phase 2 surfaces disappear when co-founder mode is off", async ({
    page,
  }) => {
    await boot(page, { enabled: false });
    await page.goto("/#/company/access");
    await expect(page.getByTestId("cofounder-access-screen")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/today$/u);
    await expect(page.getByTestId("today-screen")).toBeVisible();
  });

  test("captures each approved surface at desktop and mobile sizes in light and dark", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const cases = [
      {
        surface: "onboarding",
        route: `/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`,
        step: "map" as const,
      },
      {
        surface: "settings",
        route: "/#/settings?section=experimental",
        step: "brief" as const,
        withoutBrief: true,
        businessName: "Colony",
      },
      {
        surface: "settings-stalled",
        route: "/#/settings?section=experimental",
        step: "brief" as const,
        withoutBrief: true,
        businessName: "Colony",
        stalled: true,
      },
      {
        surface: "plan",
        route: `/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`,
        step: "complete" as const,
      },
      {
        surface: "needs-you",
        route: "/#/today/needs-you",
        step: "brief" as const,
      },
      { surface: "access", route: "/#/company/access", step: "brief" as const },
    ];

    for (const theme of ["light", "dark"] as const) {
      for (const viewport of [
        { name: "1440", width: 1440, height: 900 },
        { name: "390", width: 390, height: 844 },
      ]) {
        for (const item of cases) {
          const screenshotContext = await browser.newContext();
          try {
            const page = await screenshotContext.newPage();
            if (item.surface.startsWith("settings")) {
              await page.clock.install({
                time: new Date(1_791_273_600_000),
              });
            }
            const captureHeight =
              item.surface === "onboarding"
                ? 2400
                : item.surface === "plan"
                  ? 1600
                  : item.surface === "needs-you"
                    ? viewport.height
                    : item.surface === "access"
                      ? viewport.width === 390
                        ? 2100
                        : 1300
                      : viewport.height;
            await page.setViewportSize({
              width: viewport.width,
              height: captureHeight,
            });
            const needsYouPreview = item.surface === "needs-you";
            await boot(page, {
              theme,
              step: item.step,
              ...(item.surface.startsWith("settings")
                ? { businessName: "Colony" }
                : {}),
              ...(item.surface.startsWith("settings")
                ? { withoutBrief: true }
                : {}),
              identity: TEST_IDENTITIES.tyler,
              ...(needsYouPreview
                ? {
                    companyNumbers: NEEDS_YOU_NUMBERS,
                    companyAccessRecords: needsYouAccessRecords(),
                  }
                : {}),
            });
            await page.goto(item.route);
            if (item.surface === "settings-stalled") {
              await page.clock.fastForward(3 * 60 * 1000);
            }
            const expected = (target: Page) =>
              item.surface === "onboarding"
                ? target.getByTestId("cofounder-onboarding")
                : item.surface === "plan"
                  ? target.getByTestId(`cofounder-plan-${NOVEMBER_PLAN_ID}`)
                  : item.surface === "needs-you"
                    ? target.getByTestId("cofounder-needs-you-screen")
                    : item.surface === "access"
                      ? target.getByTestId("cofounder-access-screen")
                      : item.surface === "settings-stalled"
                        ? target.getByTestId("cofounder-retry-scout")
                        : target.getByTestId("cofounder-open-scout");
            await expect(expected(page)).toBeVisible();
            if (item.surface === "settings-stalled") {
              await expect(
                page.getByText("Scout has not started yet"),
              ).toBeVisible();
            }
            if (item.surface === "onboarding") {
              await expect(
                page.getByText("pinterest login is open in the browser"),
              ).toBeVisible();
            }
            if (needsYouPreview) await expectNeedsYouContentLoaded(page);
            await capture(
              page,
              `cofounder-phase2-${item.surface}-${viewport.name}-${theme}.png`,
            );
            if (
              viewport.name === "390" &&
              item.surface !== "settings" &&
              item.surface !== "settings-stalled" &&
              !needsYouPreview
            ) {
              const viewportContext = await browser.newContext({
                viewport: { width: 390, height: 844 },
              });
              try {
                const viewportPage = await viewportContext.newPage();
                await boot(viewportPage, {
                  theme,
                  step: item.step,
                  ...(item.surface === "settings"
                    ? { withoutBrief: true }
                    : {}),
                  identity: TEST_IDENTITIES.tyler,
                  ...(needsYouPreview
                    ? {
                        companyNumbers: NEEDS_YOU_NUMBERS,
                        companyAccessRecords: needsYouAccessRecords(),
                      }
                    : {}),
                });
                await viewportPage.goto(item.route);
                await expect(expected(viewportPage)).toBeVisible();
                if (item.surface === "onboarding") {
                  await expect(
                    viewportPage.getByText(
                      "pinterest login is open in the browser",
                    ),
                  ).toBeVisible();
                }
                if (needsYouPreview)
                  await expectNeedsYouContentLoaded(viewportPage);
                await capture(
                  viewportPage,
                  `cofounder-phase2-${item.surface}-390-${theme}-viewport.png`,
                  false,
                );
              } finally {
                await viewportContext.close();
              }
            }
          } finally {
            await screenshotContext.close();
          }
        }
      }
    }
  });
});
