import { expect } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES } from "../helpers/bridge";
import type {
  MockCompanyFunctionHead,
  MockNumbers,
  MockWorkerRun,
} from "../../src/testing/e2eBridge";
import {
  makeCofounderNumbersFixture,
  PROPOSED_COFOUNDER_GOAL_ID,
} from "../../src/testing/cofounderNumbersFixtures";

export { PROPOSED_COFOUNDER_GOAL_ID };

export const OWNER_PUBKEY = "deadbeef".repeat(8);
export const AYA_PUBKEY = TEST_IDENTITIES.alice.pubkey;
export const SCOUT_PUBKEY = TEST_IDENTITIES.bob.pubkey;
export const WORKER_ID = "11111111-1111-4111-8111-111111111111";
export const MAP_CHANNEL_ID = "e2e-company-map-whatsapp";

export function numbersFixture(includeProposal = false): MockNumbers {
  return makeCofounderNumbersFixture({
    ownerPubkey: OWNER_PUBKEY,
    scoutPubkey: SCOUT_PUBKEY,
    salesLeadPubkey: AYA_PUBKEY,
    includeProposal,
  });
}

export const EMPTY_APPROVAL_SWITCHES = {
  approveEveryHire: false,
  approvePlaybookChanges: false,
  approveEveryDiscoveryCampaign: false,
};

export function functionHead(
  functionId: MockCompanyFunctionHead["function"],
  state: MockCompanyFunctionHead["state"],
  leadPubkey?: string,
): MockCompanyFunctionHead {
  return { function: functionId, state, leadPubkey: leadPubkey ?? null };
}

export function workerRun(
  overrides: Partial<MockWorkerRun> = {},
): MockWorkerRun {
  const now = Math.floor(Date.now() / 1000);
  const run: MockWorkerRun = {
    workerId: WORKER_ID,
    parentPubkey: AYA_PUBKEY,
    label: "Research: Linden guesthouses",
    model: "gemini-flash",
    status: "done",
    startedAt: now - 120,
    deadlineAt: now + 480,
    finishedAt: now - 20,
    inputTokens: 240,
    outputTokens: 510,
    costUsd: 0.06,
    outputText: "Three guesthouses match the brief.",
    ...overrides,
  };
  if (run.status !== "running") return run;
  return {
    workerId: run.workerId,
    parentPubkey: run.parentPubkey,
    label: run.label,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt,
    deadlineAt: run.deadlineAt,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
  };
}

export function fixture({
  role = "owner",
  enabled = true,
  includeAya = true,
  includeScout = false,
  numbers = numbersFixture(),
  functionHeads = [
    functionHead("sales", "filled", AYA_PUBKEY),
    functionHead("operations", "covered_by_scout"),
  ],
  workerRuns = [],
}: {
  role?: "owner" | "admin" | "member";
  enabled?: boolean;
  includeAya?: boolean;
  includeScout?: boolean;
  numbers?: MockNumbers;
  functionHeads?: MockCompanyFunctionHead[];
  workerRuns?: MockWorkerRun[];
} = {}) {
  const relaySecret = generateSecretKey();
  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRole: role,
    relayRequiresMembership: true,
    relayMembers: [
      { pubkey: OWNER_PUBKEY, role },
      ...(includeAya ? [{ pubkey: AYA_PUBKEY, role: "member" as const }] : []),
      ...(includeScout
        ? [{ pubkey: SCOUT_PUBKEY, role: "member" as const }]
        : []),
    ],
    cofounderSettings: {
      enabled,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: EMPTY_APPROVAL_SWITCHES,
    },
    companyNumbers: numbers,
    companyFunctionHeads: functionHeads,
    companyWorkerRuns: workerRuns,
    searchProfiles: [
      { pubkey: OWNER_PUBKEY, displayName: "Lerato Molefe", isAgent: false },
      ...(includeAya
        ? [{ pubkey: AYA_PUBKEY, displayName: "Aya", isAgent: true }]
        : []),
      ...(includeScout
        ? [{ pubkey: SCOUT_PUBKEY, displayName: "Scout", isAgent: true }]
        : []),
    ],
    relayAgents: [
      ...(includeAya
        ? [
            {
              pubkey: AYA_PUBKEY,
              ownerPubkey: OWNER_PUBKEY,
              name: "Aya",
              agentType: "agent",
              status: "online" as const,
            },
          ]
        : []),
      ...(includeScout
        ? [
            {
              pubkey: SCOUT_PUBKEY,
              ownerPubkey: OWNER_PUBKEY,
              name: "Scout",
              agentType: "agent",
              status: "online" as const,
            },
          ]
        : []),
    ],
    managedAgents: [
      ...(includeAya
        ? [
            {
              pubkey: AYA_PUBKEY,
              name: "Aya",
              status: "running" as const,
              channelNames: ["general"],
            },
          ]
        : []),
      ...(includeScout
        ? [
            {
              pubkey: SCOUT_PUBKEY,
              name: "Scout",
              status: "running" as const,
              channelNames: ["general"],
            },
          ]
        : []),
    ],
  };
}

export async function selectMapPart(
  page: import("@playwright/test").Page,
  functionId: "sales" | "operations" | "customer_success" | "finance" | "brand",
  name: string,
) {
  await page.getByTestId(`cofounder-map-${functionId}`).click();
  await expect(page.getByTestId("cofounder-map-part-card")).toContainText(name);
  await page.mouse.move(0, 0);
  await waitForAnimations(page);
}

export async function openMapPart(
  page: import("@playwright/test").Page,
  functionId: "sales" | "operations" | "customer_success" | "finance" | "brand",
  name: string,
) {
  await selectMapPart(page, functionId, name);
  await page.getByRole("link", { name: `Open ${name}`, exact: true }).click();
}

export async function seedCofounderTheme(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
) {
  await page.addInitScript(
    ({ name, pubkey, relayUrl }) => {
      // The profile is intentionally persistent for browser locking. Clear
      // every theme record so its newer outbox revision cannot override the
      // proof's requested theme from an earlier test.
      for (const key of Object.keys(localStorage)) {
        if (
          key === "buzz-theme-cache" ||
          key.startsWith("colony.appearance.v1:") ||
          key.startsWith("buzz-community-theme.v1:") ||
          key.startsWith("buzz-community-theme-outbox.v1:") ||
          key.startsWith("buzz-community-theme-migrated.v1:")
        ) {
          localStorage.removeItem(key);
        }
      }
      const preference = {
        version: 1,
        theme: name,
        accent: "#5B45BE",
        followSystem: false,
      };
      localStorage.setItem("buzz-theme", name);
      localStorage.setItem("buzz-follow-system", "false");
      localStorage.setItem("buzz-accent-color", "#5B45BE");
      localStorage.setItem(
        `buzz-community-theme.v1:${pubkey}:${encodeURIComponent(relayUrl)}`,
        JSON.stringify(preference),
      );
    },
    {
      name: theme === "dark" ? "buzz-dark" : "buzz",
      pubkey: OWNER_PUBKEY,
      relayUrl: "ws://localhost:3000",
    },
  );
}

export async function seedCompanyMapBusiness(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript((logoUrl) => {
    const communityId = "e2e-default-community";
    const communities = JSON.parse(
      window.localStorage.getItem("buzz-communities") ?? "[]",
    ) as Array<Record<string, unknown>>;
    window.localStorage.setItem(
      "buzz-communities",
      JSON.stringify(
        communities.map((community) =>
          community.id === communityId
            ? { ...community, name: "Horizon Labs" }
            : community,
        ),
      ),
    );
    window.localStorage.setItem(
      `colony-business-profile.v1:${communityId}`,
      JSON.stringify({
        name: "Horizon Labs",
        website: "https://horizonlabs.test",
        description: "",
        logoDataUrl: null,
        logoUrl,
      }),
    );
  }, "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='28' fill='%2324212a'/%3E%3Cpath d='M31 65c13-28 33-28 57-8' fill='none' stroke='%23f2ca72' stroke-linecap='round' stroke-width='12'/%3E%3Ccircle cx='84' cy='38' r='9' fill='%23e989b4'/%3E%3C/svg%3E");
}

/** Makes the shared Needs you summary settle without adding a money approval. */
export async function seedCompanyMapMoneyRails(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript(() => {
    const listeners = new Set<() => void>();
    const snapshot = {
      paymentLinks: [],
      connections: [],
      availability: "ready" as const,
      errorMessage: null,
    };
    const testWindow = window as Window & {
      __BUZZ_E2E_MONEY_RAILS__?: {
        getSnapshot: () => {
          paymentLinks: [];
          connections: [];
          availability: "ready";
          errorMessage: null;
        };
        subscribe: (listener: () => void) => () => void;
        execute: () => Promise<undefined>;
      };
    };
    testWindow.__BUZZ_E2E_MONEY_RAILS__ = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      execute: async () => undefined,
    };
  });
}

export async function seedCompanyMapWhatsApp(
  page: import("@playwright/test").Page,
  outreachChannelId: string | null,
  includeCallRequest = true,
  connected = true,
) {
  await page.addInitScript(
    ({
      channelId,
      connected,
      includeCallRequest,
    }: {
      channelId: string | null;
      connected: boolean;
      includeCallRequest: boolean;
    }) => {
      const testWindow = window as Window & {
        __BUZZ_E2E_WHATSAPP__?: (request: {
          action: "post" | "command";
          path?: string;
          body?: Record<string, unknown>;
        }) => Promise<unknown>;
      };
      testWindow.__BUZZ_E2E_WHATSAPP__ = async (request) => {
        if (
          request.action === "post" &&
          request.path === "/api/whatsapp/query" &&
          request.body?.what === "status"
        ) {
          return {
            connected,
            connectionId: "e2e-company-map-whatsapp",
            displayPhoneNumber: "+27 61 534 0627",
            verifiedName: "Horizon Labs",
            quality: "GREEN",
            phoneStatus: "CONNECTED",
            dailyNewChatCap: 30,
            newChatsSentToday: 0,
            sendingPaused: false,
            pauseReason: null,
            issues: [],
            outreachChannelId: channelId,
            templatesSyncedAt: null,
            templates: [],
            webhookUrl: null,
          };
        }
        if (
          request.action === "post" &&
          request.path === "/api/whatsapp/query" &&
          request.body?.what === "contacts"
        ) {
          return {
            contacts: includeCallRequest
              ? [
                  {
                    waId: "27123456789",
                    e164: "+27212345678",
                    stage: "wants_call",
                    windowOpen: false,
                    optedOut: false,
                    paused: false,
                    unanswered: false,
                  },
                ]
              : [],
          };
        }
        if (
          request.action === "post" &&
          request.path === "/api/whatsapp/query" &&
          request.body?.what === "batches"
        ) {
          return { batches: [] };
        }
        return {};
      };
    },
    { channelId: outreachChannelId, connected, includeCallRequest },
  );
}
