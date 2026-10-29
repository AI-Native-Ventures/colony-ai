import type { Page } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge, TEST_IDENTITIES } from "./bridge";
import { COLONY3_NOW } from "./colony3Fixture";

/** The instance the Colony 3.0 boards are captured at, as epoch seconds. */
const NOW_SECONDS = Math.floor(new Date(COLONY3_NOW).getTime() / 1000);

export const AYA_INSTRUCTIONS = `You are Aya, Business Development at Lerato Social.

Find independent businesses that need reliable social content. Start with a small, well-qualified list, and keep the source and qualification notes with every profile.

Qualify before you prepare anything: confirm the need, the contact and the budget range. Never guess a price. If a fact is missing, say it is missing.

Prepare proposals from the current service, Social media management, and hand them to Lerato in #Sales for review. Don’t contact anyone outside the company without approval.

When something needs a decision, raise an ask in the thread and mention Scout.`;

const PUBKEYS = {
  owner: TEST_IDENTITIES.tyler.pubkey,
  noluthando: "d1d1".repeat(16),
  sam: "d2d2".repeat(16),
  jules: "d3d3".repeat(16),
  scout: REFERENCE_AGENTS.scout.pubkey,
  aya: REFERENCE_AGENTS.aya.pubkey,
  mina: REFERENCE_AGENTS.mina.pubkey,
  theo: REFERENCE_AGENTS.theo.pubkey,
  noor: "e1e1".repeat(16),
  researcher: "e2e2".repeat(16),
  writer: "e3e3".repeat(16),
} as const;

export const COLONY3_AGENT_PUBKEYS = PUBKEYS;

type AgentSeed = {
  key: keyof typeof PUBKEYS;
  name: string;
  title: string;
  runtime: "codex" | "claude";
  provider: "openai" | "anthropic";
  status: "running" | "stopped";
  /** Pair-scoped runtime lifecycle, which decides Ready / Offline / Needs attention. */
  lifecycle: "ready" | "stopped" | "failed";
  channels?: string[];
  about?: string;
  personaId?: string;
  backend?: { type: "provider"; id: string; config: Record<string, never> };
  manager?: keyof typeof PUBKEYS;
  onTeam: boolean;
  archived?: boolean;
};

/** The seven agents of the Agents board, in the board's order. */
export const COLONY3_AGENTS: readonly AgentSeed[] = [
  {
    key: "aya",
    name: "Aya",
    title: "Business Development",
    runtime: "codex",
    provider: "openai",
    status: "running",
    lifecycle: "ready",
    channels: ["Sales", "Marketing"],
    personaId: "colony3-aya",
    manager: "scout",
    onTeam: true,
  },
  {
    key: "mina",
    name: "Mina",
    title: "Social Media Manager",
    runtime: "claude",
    provider: "anthropic",
    status: "stopped",
    lifecycle: "stopped",
    manager: "noluthando",
    onTeam: true,
  },
  {
    key: "noor",
    name: "Noor",
    title: "Bookkeeper",
    runtime: "claude",
    provider: "anthropic",
    status: "running",
    lifecycle: "failed",
    manager: "owner",
    onTeam: true,
  },
  {
    key: "researcher",
    name: "Researcher",
    title: "Finds and cites sources",
    runtime: "claude",
    provider: "anthropic",
    status: "stopped",
    lifecycle: "stopped",
    onTeam: false,
    archived: true,
  },
  {
    key: "scout",
    name: "Scout",
    title: "Chief of Staff",
    runtime: "claude",
    provider: "anthropic",
    status: "running",
    lifecycle: "ready",
    manager: "owner",
    onTeam: true,
  },
  {
    key: "theo",
    name: "Theo",
    title: "Software Engineer",
    runtime: "codex",
    provider: "openai",
    status: "running",
    lifecycle: "ready",
    manager: "scout",
    onTeam: true,
  },
  {
    key: "writer",
    name: "Writer",
    title: "Drafts and edits copy",
    runtime: "claude",
    provider: "anthropic",
    status: "stopped",
    lifecycle: "stopped",
    backend: { type: "provider", id: "provider-hosted", config: {} },
    onTeam: false,
  },
];

const PEOPLE = [
  { key: "owner", name: "Lerato Molefe", title: "Founder" },
  { key: "noluthando", name: "Noluthando Khumalo", title: "Account Manager" },
  { key: "sam", name: "Sam Patel", title: "Designer" },
  { key: "jules", name: "Jules Adams", title: "Client Partner" },
] as const;

const HARNESS_ENTRY = {
  avatar_url: "",
  availability: "available",
  default_args: [],
  mcp_command: null,
  install_hint: "",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "logged_in" },
};

/** Codex and Claude Code, installed and signed in: the board's two harnesses. */
const ACP_CATALOG = [
  {
    ...HARNESS_ENTRY,
    id: "claude",
    label: "Claude Code",
    command: "claude-agent-acp",
    binary_path: "/usr/local/bin/claude-agent-acp",
    install_instructions_url:
      "https://github.com/agentclientprotocol/claude-agent-acp",
  },
  {
    ...HARNESS_ENTRY,
    id: "codex",
    label: "Codex",
    command: "codex-acp",
    binary_path: "/usr/local/bin/codex-acp",
    install_instructions_url: "https://developers.openai.com/codex/cli/",
  },
];

const COLONY_AGENT_RUNTIME = {
  ...HARNESS_ENTRY,
  id: "buzz-agent",
  label: "Colony Agent",
  command: "buzz-agent",
  binary_path: "/usr/local/bin/buzz-agent",
  mcp_command: "buzz-dev-mcp",
  install_hint: "Ships with the Colony desktop app.",
  install_instructions_url: "https://github.com/block/buzz",
  can_auto_install: false,
  requires_external_cli: false,
  auth_status: { status: "not_applicable" },
  source: "builtin",
};

export type Colony3AgentsOptions = {
  /** Aya's first start, so Last activity reads "Today, 13:20". */
  ayaLastStartedAt?: string;
  /** Gives Aya the "Saved changes apply on the next start." banner. */
  ayaNeedsRestart?: boolean;
  /** Overrides who Aya answers to. */
  ayaRespondTo?: "owner-only" | "allowlist" | "anyone";
  /** Persona the instance is linked to, for read-only and editable states. */
  ayaPersona?: "linked" | "none";
  /** Seeds Aya on the keyless Colony free AI connection for picker coverage. */
  ayaFreeAi?: boolean;
};

/**
 * Brings up the Lerato Social workspace with the Agents board's data: seven
 * agents with their harnesses, models and runtime states, four people, and the
 * signed company positions the Team board reads. Call before `page.goto`.
 */
export async function installColony3Agents(
  page: Page,
  options: Colony3AgentsOptions = {},
) {
  const relaySecret = generateSecretKey();
  await page.addInitScript((id) => {
    localStorage.setItem("buzz:e2e-identity-override.v1", JSON.stringify(id));
  }, TEST_IDENTITIES.tyler);
  const linked = (options.ayaPersona ?? "linked") === "linked";
  const ayaFreeAi = options.ayaFreeAi === true;
  const lastStarted =
    options.ayaLastStartedAt ??
    new Date((NOW_SECONDS - 35 * 60) * 1000).toISOString();

  const positions = [
    ...PEOPLE.map((person) => ({
      pubkey: PUBKEYS[person.key],
      title: person.title,
      kind: "human" as const,
      manager: person.key === "owner" ? undefined : PUBKEYS.owner,
    })),
    ...COLONY3_AGENTS.filter((agent) => agent.onTeam).map((agent) => ({
      pubkey: PUBKEYS[agent.key],
      title: agent.title,
      kind: "employee" as const,
      manager: agent.manager ? PUBKEYS[agent.manager] : undefined,
    })),
  ];

  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    companyMemberRelayPrivateKeyHex: Buffer.from(relaySecret).toString("hex"),
    relaySelf: getPublicKey(relaySecret),
    searchProfiles: [
      ...PEOPLE.map((person) => ({
        pubkey: PUBKEYS[person.key],
        displayName: person.name,
        jobTitle: person.title,
      })),
      ...COLONY3_AGENTS.map((agent) => ({
        pubkey: PUBKEYS[agent.key],
        displayName: agent.name,
        jobTitle: agent.title,
        isAgent: true,
        ownerPubkey: PUBKEYS.owner,
      })),
    ],
    relayMembers: PEOPLE.map((person) => ({
      pubkey: PUBKEYS[person.key],
      role: person.key === "owner" ? "owner" : "member",
    })),
    relayAgents: COLONY3_AGENTS.map((agent) => ({
      pubkey: PUBKEYS[agent.key],
      ownerPubkey: PUBKEYS.owner,
      name: agent.name,
      agentType: "agent",
      channelNames: agent.channels,
    })),
    personas: [
      {
        id: "colony3-aya",
        displayName: "Aya",
        description:
          "Finds independent businesses that need reliable social content, qualifies them, and prepares proposals for Lerato to review.",
        systemPrompt: AYA_INSTRUCTIONS,
        runtime: ayaFreeAi ? "buzz-agent" : "codex",
        provider: ayaFreeAi ? "colony-credits" : "openai",
        model: ayaFreeAi ? "nvidia/nemotron-3-ultra-550b-a55b:free" : "gpt-4o",
        envVars: ayaFreeAi ? { BUZZ_AGENT_PROVIDER: "colony-credits" } : {},
      },
    ],
    managedAgents: COLONY3_AGENTS.map((agent) => ({
      pubkey: PUBKEYS[agent.key],
      name: agent.name,
      about: agent.title,
      runtime: agent.key === "aya" && ayaFreeAi ? "buzz-agent" : agent.runtime,
      provider:
        agent.key === "aya" && ayaFreeAi ? "colony-credits" : agent.provider,
      model:
        agent.key === "aya" && ayaFreeAi
          ? "nvidia/nemotron-3-ultra-550b-a55b:free"
          : agent.key === "aya"
            ? "gpt-4o"
            : "[MODEL]",
      modelSource: "definition" as const,
      status: agent.status,
      backend: agent.backend,
      channelNames: agent.channels,
      personaId: agent.key === "aya" && linked ? agent.personaId : null,
      systemPrompt: agent.key === "aya" && !linked ? AYA_INSTRUCTIONS : null,
      lastStartedAt:
        agent.key === "aya" && agent.status === "running"
          ? lastStarted
          : undefined,
      needsRestart: agent.key === "aya" && options.ayaNeedsRestart === true,
      respondTo:
        agent.key === "aya"
          ? (options.ayaRespondTo ?? "allowlist")
          : "owner-only",
      respondToAllowlist:
        agent.key === "aya" ? [PUBKEYS.owner, PUBKEYS.noluthando] : [],
    })),
    acpRuntimesCatalog: ayaFreeAi
      ? [...ACP_CATALOG, COLONY_AGENT_RUNTIME]
      : ACP_CATALOG,
    colonyCreditsGatewayEnabled: ayaFreeAi,
    globalAgentConfig: {
      env_vars: {},
      provider: "anthropic",
      model: null,
      preferred_runtime: "claude",
    },
    managedAgentRuntimes: COLONY3_AGENTS.map((agent) => ({
      pubkey: PUBKEYS[agent.key],
      relayUrl: "ws://localhost:3000",
      lifecycle: agent.lifecycle,
    })),
    archivedIdentities: COLONY3_AGENTS.filter((agent) => agent.archived).map(
      (agent) => PUBKEYS[agent.key],
    ),
    companyMemberPositionEvents: positions.map((position) =>
      finalizeEvent(
        {
          kind: KIND_MEMBER_POSITION_HEAD,
          created_at: NOW_SECONDS - 3600,
          tags: [["d", `company:member:${position.pubkey}`]],
          content: JSON.stringify({
            schemaVersion: 1,
            pubkey: position.pubkey,
            title: position.title,
            kind: position.kind,
            status: "active",
            ...(position.manager ? { managerPubkey: position.manager } : {}),
            sourceActionEventId: "b".repeat(64),
            updatedAt: new Date((NOW_SECONDS - 3600) * 1000).toISOString(),
          }),
        },
        relaySecret,
      ),
    ),
  } as never);
}

const CHANNEL_IDS = {
  sales: REFERENCE_CHANNEL_IDS.sales,
  marketing: REFERENCE_CHANNEL_IDS.marketing,
  oliveHouse: REFERENCE_CHANNEL_IDS.oliveHouse,
} as const;

/**
 * Scout and Theo are mid-task in The Olive House, as the Working chips and the
 * sidebar's "2:13 · 2" show. `aya` adds Aya's task in #Sales for the profile.
 */
export async function seedColony3AgentsWorking(
  page: Page,
  options: { aya?: { startedAgoMs: number } } = {},
) {
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate(
    ({ scout, theo, aya, ids, ayaTurn }) => {
      const seed = window.__BUZZ_E2E_SEED_ACTIVE_TURNS__;
      if (!seed) return;
      // A fresh sample first, in another channel (the watermark is per
      // channel), so back-dated starts are not read as clock skew.
      for (const agentPubkey of [scout, theo, aya]) {
        seed({
          agentPubkey,
          channelId: ids.marketing,
          turnId: `warm-${agentPubkey.slice(0, 4)}`,
          kind: "turn_completed",
        });
      }
      seed({
        agentPubkey: scout,
        channelId: ids.oliveHouse,
        turnId: "colony3-agents-scout",
        startedAgoMs: 133_000,
      });
      seed({
        agentPubkey: theo,
        channelId: ids.oliveHouse,
        turnId: "colony3-agents-theo",
        startedAgoMs: 40_000,
      });
      if (ayaTurn) {
        seed({
          agentPubkey: aya,
          channelId: ids.sales,
          turnId: "colony3-agents-aya",
          startedAgoMs: ayaTurn.startedAgoMs,
        });
      }
    },
    {
      scout: PUBKEYS.scout,
      theo: PUBKEYS.theo,
      aya: PUBKEYS.aya,
      ids: CHANNEL_IDS,
      ayaTurn: options.aya ?? null,
    },
  );
}
