import { hexToBytes } from "@noble/hashes/utils.js";
import type { Page } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  KIND_HIRE_HEAD,
  KIND_MEMBER_POSITION_HEAD,
} from "../../src/shared/constants/kinds";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "./bridge";
import { COLONY3_NOW } from "./colony3Fixture";

/**
 * The Lerato Social hiring fixture for the Colony 3.0 Hire boards: three role
 * packs (Hospitality researcher, Social media manager, Bookkeeper), a team with
 * Scout as Chief of Staff, and Birch's configured draft (or finished hire).
 */
const RELAY_SECRET_HEX = "11".repeat(32);
const RELAY_SELF = getPublicKey(hexToBytes(RELAY_SECRET_HEX));
const SELF_PUBKEY = "deadbeef".repeat(8);
const NOLUTHANDO_PUBKEY = "ab12".repeat(16);
const BIRCH_PUBKEY = "be5c".repeat(16);
const RELAY_WS_URL = "ws://localhost:3000";

export const HIRE_IDS = {
  hireId: "5c0a4a0e-8d0b-4b7a-9d11-0c3a5f1e7b21",
  hospitality: "company-role-hospitality-researcher",
  social: "company-role-social-media-manager",
  bookkeeper: "company-role-bookkeeper",
  builtInHospitality: "built-in-role-hospitality-researcher",
  builtInSocial: "built-in-role-social-media-manager",
  builtInBookkeeper: "built-in-role-bookkeeper",
  scout: REFERENCE_AGENTS.scout.pubkey,
  birch: BIRCH_PUBKEY,
} as const;

const PERSONAS = [
  {
    id: HIRE_IDS.hospitality,
    displayName: "Hospitality researcher",
    systemPrompt: "Research hospitality accounts and report findings.",
    isActive: true,
    runtime: "buzz-agent",
    provider: "openai",
    model: "gpt-5.5",
    envVars: { BUZZ_AGENT_PROVIDER: "openai" },
    companyRole: {
      job: "Hospitality research",
      skills: ["Market research", "Synthesis"],
      tools: [{ name: "Web search", risk: "low" as const }],
      workerMenu: ["buzz-agent"],
    },
  },
  {
    id: HIRE_IDS.social,
    displayName: "Social media manager",
    systemPrompt: "Plan and schedule client social content.",
    isActive: true,
    runtime: "buzz-agent",
    provider: "openai",
    model: "gpt-5.5",
    envVars: { BUZZ_AGENT_PROVIDER: "openai" },
    companyRole: {
      job: "Client social content",
      skills: ["Content planning", "Captions", "Scheduling"],
      tools: [
        { name: "Web search", risk: "low" as const },
        { name: "Social publishing", risk: "high" as const },
      ],
      workerMenu: ["buzz-agent"],
      defaultAllowance: "50",
    },
  },
  {
    id: HIRE_IDS.bookkeeper,
    displayName: "Bookkeeper",
    systemPrompt: "Keep invoices and reconciliation in order.",
    isActive: true,
    runtime: "buzz-agent",
    provider: "openai",
    model: "gpt-5.5",
    envVars: { BUZZ_AGENT_PROVIDER: "openai" },
    companyRole: {
      job: "Invoices and reconciliation",
      skills: ["Reconciliation", "Invoicing"],
      tools: [{ name: "Money records", risk: "medium" as const }],
      workerMenu: ["buzz-agent"],
      defaultAllowance: "50",
    },
  },
];

function positionEvent(input: {
  pubkey: string;
  title: string;
  kind: "human" | "employee";
  managerPubkey?: string;
}) {
  return finalizeEvent(
    {
      kind: KIND_MEMBER_POSITION_HEAD,
      created_at: Math.floor(new Date(COLONY3_NOW).getTime() / 1000),
      tags: [["d", `company:member:${input.pubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        pubkey: input.pubkey,
        title: input.title,
        kind: input.kind,
        status: "active",
        ...(input.managerPubkey ? { managerPubkey: input.managerPubkey } : {}),
        sourceActionEventId: "b".repeat(64),
        updatedAt: COLONY3_NOW,
      }),
    },
    hexToBytes(RELAY_SECRET_HEX),
  );
}

function birchProposal(input: { withAllowance: boolean }) {
  return {
    hireId: HIRE_IDS.hireId,
    rolePack: {
      personaId: HIRE_IDS.hospitality,
      title: "Hospitality researcher",
      job: "Hospitality research",
      skills: ["Market research", "Synthesis"],
      tools: [{ name: "Web search", risk: "low" as const }],
      workerMenu: ["buzz-agent"],
    },
    displayName: "Birch",
    title: "Hospitality Researcher",
    managerPubkey: HIRE_IDS.scout,
    introductionChannelId: REFERENCE_CHANNEL_IDS.sales,
    runtimeId: "buzz-agent",
    providerId: "openai",
    modelId: "gpt-5.5",
    ...(input.withAllowance ? { weeklyAllowance: "50" } : {}),
  };
}

export type HireFixtureState =
  /** The catalog, with a runtime on this Mac. */
  | "roles"
  /** A business with no role personas and no runtime: built-ins and the notice. */
  | "roles-no-runtime"
  /** A business with no role personas yet: the catalog is the built-in roles. */
  | "roles-empty"
  /** Birch's draft on Configure, allowance not set yet. */
  | "configure"
  /** Birch's draft on Review. */
  | "review"
  /** Birch hired. */
  | "success";

/**
 * Installs the mock bridge for a Hire board at the design's size and moment.
 * Navigate to the board's route afterwards.
 */
export async function installHireFixture(
  page: Page,
  state: HireFixtureState,
  overrides: Parameters<typeof installMockBridge>[1] = {},
) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  const draftNeeded = state === "configure" || state === "review";
  if (draftNeeded) {
    const proposal = birchProposal({ withAllowance: state === "review" });
    await page.addInitScript(
      ({ key, value }) => {
        window.sessionStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: `company-hire:${RELAY_WS_URL}:${HIRE_IDS.hireId}`,
        value: { proposal },
      },
    );
  }
  const hiredHead =
    state === "success"
      ? finalizeEvent(
          {
            kind: KIND_HIRE_HEAD,
            created_at: Math.floor(new Date(COLONY3_NOW).getTime() / 1000),
            tags: [["d", `company:hire:${HIRE_IDS.hireId}`]],
            content: JSON.stringify({
              schemaVersion: 1,
              proposal: birchProposal({ withAllowance: true }),
              status: "hired",
              proposedByPubkey: SELF_PUBKEY,
              founderPubkey: SELF_PUBKEY,
              employeePubkey: BIRCH_PUBKEY,
              introductionEventId: "c".repeat(64),
              sourceActionEventId: "b".repeat(64),
            }),
          },
          hexToBytes(RELAY_SECRET_HEX),
        )
      : null;
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    relaySelf: RELAY_SELF,
    companyHireRelayPrivateKeyHex: RELAY_SECRET_HEX,
    companyMemberRelayPrivateKeyHex: RELAY_SECRET_HEX,
    relayRequiresMembership: true,
    relayRole: "owner",
    personas:
      state === "roles-empty" || state === "roles-no-runtime" ? [] : PERSONAS,
    discoverAgentModels: {
      models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
      supportsSwitching: true,
      selectedModel: "gpt-5.5",
    },
    ...(state === "roles-no-runtime"
      ? {
          acpRuntimesCatalog: [
            {
              id: "buzz-agent",
              label: "Colony Agent",
              avatar_url: "",
              availability: "not_installed",
              command: null,
              binary_path: null,
              default_args: [],
              mcp_command: null,
              install_hint: "Ships with the Colony desktop app.",
              install_instructions_url: "https://colony.global",
              can_auto_install: false,
              requires_external_cli: false,
              underlying_cli_path: null,
              node_required: false,
              auth_status: { status: "not_applicable" },
              source: "builtin",
            },
          ],
        }
      : {}),
    relayMembers: [
      { pubkey: SELF_PUBKEY, role: "owner" },
      { pubkey: NOLUTHANDO_PUBKEY, role: "member" },
    ],
    relayAgents: [
      {
        pubkey: HIRE_IDS.scout,
        ownerPubkey: SELF_PUBKEY,
        name: "Scout",
        agentType: "agent",
      },
      ...(state === "success"
        ? [
            {
              pubkey: BIRCH_PUBKEY,
              ownerPubkey: SELF_PUBKEY,
              name: "Birch",
              agentType: "agent",
            },
          ]
        : []),
    ],
    searchProfiles: [
      { pubkey: SELF_PUBKEY, displayName: "Lerato Molefe" },
      { pubkey: NOLUTHANDO_PUBKEY, displayName: "Noluthando Khumalo" },
      { pubkey: HIRE_IDS.scout, displayName: "Scout" },
      ...(state === "success"
        ? [{ pubkey: BIRCH_PUBKEY, displayName: "Birch" }]
        : []),
    ],
    companyMemberPositionEvents: [
      positionEvent({ pubkey: SELF_PUBKEY, title: "Founder", kind: "human" }),
      positionEvent({
        pubkey: HIRE_IDS.scout,
        title: "Chief of Staff",
        kind: "employee",
        managerPubkey: SELF_PUBKEY,
      }),
      positionEvent({
        pubkey: NOLUTHANDO_PUBKEY,
        title: "Account Manager",
        kind: "human",
        managerPubkey: SELF_PUBKEY,
      }),
    ],
    ...(hiredHead ? { companyHireHeads: [hiredHead] } : {}),
    ...overrides,
  } as never);
}

export const HIRE_ROUTES = {
  roles: "/#/hire/roles",
  configure: `/#/hire/configure?personaId=${HIRE_IDS.hospitality}&hireId=${HIRE_IDS.hireId}`,
  review: `/#/hire/review?hireId=${HIRE_IDS.hireId}`,
  success: `/#/hire/success?hireId=${HIRE_IDS.hireId}`,
} as const;
