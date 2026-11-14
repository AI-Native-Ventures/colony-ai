import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { expect } from "./fixtures/lockedBrowserTest";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import type {
  Colony3Extras,
  MockCompanyFunctionHead,
} from "../../src/testing/e2eBridge";
import { makeCofounderNumbersFixture } from "../../src/testing/cofounderNumbersFixtures";

export const OWNER_PUBKEY = "deadbeef".repeat(8);
export const SEARCH_USER_PUBKEY = "feedface".repeat(8);
const CAPTURE_DIR = process.env.MAP_SHELL_CAPTURE_DIR;
const APPROVAL_SWITCHES = {
  approveEveryHire: false,
  approvePlaybookChanges: false,
  approveEveryDiscoveryCampaign: false,
};
export const MAP_SHELL_WORKSPACES = [
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

export type MapShellExtraChannel = NonNullable<
  Colony3Extras["channels"]
>[number];

export const DENSE_MAP_SHELL_CHANNELS: MapShellExtraChannel[] = [
  { id: "1e1a7000-0000-4000-8000-000000000101", name: "Accounts" },
  { id: "1e1a7000-0000-4000-8000-000000000102", name: "Brand" },
  { id: "1e1a7000-0000-4000-8000-000000000103", name: "Design" },
  { id: "1e1a7000-0000-4000-8000-000000000104", name: "Engineering" },
  { id: "1e1a7000-0000-4000-8000-000000000105", name: "Finance" },
  { id: "1e1a7000-0000-4000-8000-000000000106", name: "Operations" },
  { id: "1e1a7000-0000-4000-8000-000000000107", name: "Product" },
  { id: "1e1a7000-0000-4000-8000-000000000108", name: "Support" },
];

function functionHead(
  functionId: MockCompanyFunctionHead["function"],
  state: MockCompanyFunctionHead["state"],
  leadPubkey?: string,
): MockCompanyFunctionHead {
  return { function: functionId, state, leadPubkey: leadPubkey ?? null };
}

function mapShellFixture(
  cofounderEnabled = true,
  extraChannels: MapShellExtraChannel[] = [],
) {
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
      {
        pubkey: SEARCH_USER_PUBKEY,
        displayName: "Nandi",
        isAgent: false,
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
    ...(extraChannels.length > 0
      ? { colony3Extras: { channels: extraChannels } }
      : {}),
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

export async function prepareMapShell(
  page: Page,
  options: {
    theme: "light" | "dark";
    width: number;
    height: number;
    contactCount?: number;
    featureEnabled?: boolean;
    cofounderEnabled?: boolean;
    workspaces?: typeof MAP_SHELL_WORKSPACES;
    extraChannels?: MapShellExtraChannel[];
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
  await page.addInitScript(
    ({ contactCount }) => {
      const testWindow = window as Window & {
        __BUZZ_E2E_WHATSAPP__?: (request: {
          action: string;
          path?: string;
          body?: Record<string, unknown>;
        }) => Promise<unknown>;
      };
      testWindow.__BUZZ_E2E_WHATSAPP__ = async (request) => {
        if (
          request.action !== "post" ||
          request.path !== "/api/whatsapp/query"
        ) {
          return {};
        }
        if (request.body?.what !== "contacts") return {};
        return {
          contacts: Array.from({ length: contactCount }, (_, index) => ({
            waId:
              index === 0
                ? "27821234567"
                : `279${String(index).padStart(8, "0")}`,
            e164:
              index === 0
                ? "+27821234567"
                : `+279${String(index).padStart(8, "0")}`,
            displayName:
              index === 0
                ? "Lerato Mokoena"
                : `Customer ${String(index + 1).padStart(3, "0")}`,
            profileName: index === 0 ? "Lerato" : `Customer ${index + 1}`,
            businessName: index === 0 ? "Corner Cottage" : null,
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
            unanswered: index < 8,
            awaitingApproval: false,
            businessOutreachStopped: false,
            businessStopReason: null,
          })),
        };
      };
    },
    { contactCount: options.contactCount ?? 1 },
  );
  if (options.workspaces) {
    await page.addInitScript((workspaces) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify(workspaces),
      );
      window.localStorage.setItem("buzz-active-community-id", workspaces[0].id);
    }, options.workspaces);
  }
  await installMockBridge(
    page,
    mapShellFixture(options.cofounderEnabled, options.extraChannels),
    {
      skipCommunitySeed: Boolean(options.workspaces),
      seedPreviewFeatures: true,
      previewFeatureOverrides: { map_home: options.featureEnabled === true },
    },
  );
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.goto("/#/");
  await waitForMockBridge(page);
  await expect(
    options.featureEnabled === true && options.cofounderEnabled !== false
      ? page.getByTestId("cofounder-company-map")
      : page.getByTestId("app-sidebar"),
  ).toBeVisible({ timeout: 15_000 });
}

export async function capture(page: Page, name: string) {
  if (!CAPTURE_DIR) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    fullPage: false,
    path: join(CAPTURE_DIR, `${name}.png`),
  });
}
