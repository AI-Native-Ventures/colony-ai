import type { Colony3Extras } from "../../src/testing/e2eBridge";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  COLONY3_PEOPLE,
  colony3At,
  colony3Extras,
} from "./colony3Conversations";

/** Channels the Browse channels board lists besides the reference sidebar ones. */
export const COLONY3_BROWSE_CHANNEL_IDS = {
  general: "1e1a7000-0000-4000-8000-000000000021",
  autumnShoot: "1e1a7000-0000-4000-8000-000000000022",
  welcomeEveryone: "1e1a7000-0000-4000-8000-000000000023",
  watercooler: "1e1a7000-0000-4000-8000-000000000024",
} as const;

/** Anonymous extra members so the member counts read as the board's. */
function filler(channelId: string, count: number, tag: string) {
  return Array.from({ length: count }, (_, index) => ({
    channelId,
    pubkey: `${tag}${index.toString(16).padStart(2, "0")}`
      .repeat(32)
      .slice(0, 64),
    role: "member" as const,
  }));
}

function fillerKeys(count: number, tag: string): string[] {
  return Array.from({ length: count }, (_, index) =>
    `${tag}${index.toString(16).padStart(2, "0")}`.repeat(32).slice(0, 64),
  );
}

/**
 * Extra channels and members for the Browse channels board: general (joined,
 * 9 members), autumn-shoot (archived, 4), welcome-everyone (open, not joined,
 * 9) and the Watercooler forum (not joined, 6; hidden because forums are cut).
 * Marketing, Operations and Sales get filler members to reach the board's
 * 7, 5 and 6.
 */
export function colony3BrowseExtras(): Colony3Extras {
  const ids = COLONY3_BROWSE_CHANNEL_IDS;
  const members = (count: number, tag: string) =>
    fillerKeys(count, tag).map((pubkey) => ({
      pubkey,
      role: "member" as const,
    }));
  return colony3Extras({
    channels: [
      {
        id: ids.general,
        name: "general",
        description: "General conversation and community updates.",
        members: members(8, "a1"),
        lastMessageAt: colony3At(8, 30),
      },
      {
        id: ids.autumnShoot,
        name: "autumn-shoot",
        description: "Planning for the autumn photo shoot",
        archived: true,
        members: members(3, "a2"),
      },
      {
        id: ids.welcomeEveryone,
        name: "welcome-everyone",
        description: "Say hi, ask a question, or share what brought you here.",
        selfIsMember: false,
        members: members(9, "a3"),
      },
      {
        id: ids.watercooler,
        name: "Watercooler",
        description: "Long-form threads for ideas, questions and checklists",
        channelType: "forum",
        selfIsMember: false,
        members: members(6, "a4"),
      },
    ],
    members: [
      ...filler(REFERENCE_CHANNEL_IDS.marketing, 4, "b1"),
      ...filler(REFERENCE_CHANNEL_IDS.operations, 2, "b2"),
      ...filler(REFERENCE_CHANNEL_IDS.sales, 3, "b3"),
    ],
  });
}

/** Messages behind the dialog on The Olive House (the dimmed page). */
export function colony3OliveBackdropMessages(): NonNullable<
  Colony3Extras["messages"]
> {
  const channelId = REFERENCE_CHANNEL_IDS.oliveHouse;
  return [
    {
      channelId,
      id: "c3d-olive-nandi-1416",
      pubkey: COLONY3_PEOPLE.nandi.pubkey,
      createdAt: colony3At(9, 16),
      content: "Could the caption on slide two mention the Saturday market?",
    },
    {
      channelId,
      id: "c3d-olive-mina-1358",
      pubkey: REFERENCE_AGENTS.mina.pubkey,
      createdAt: colony3At(9, 30),
      content:
        "The Olive House’s next post is ready. I drafted three carousel concepts from the spring brief.",
    },
  ];
}

const RELAY_WS_URL = "ws://localhost:3000";

export const COLONY3_PERSONA_IDS = {
  scout: "c3d00000-0000-4000-8000-000000000001",
  aya: "c3d00000-0000-4000-8000-000000000002",
  writer: "c3d00000-0000-4000-8000-000000000003",
} as const;

/**
 * Agents for the Channel members and Add agents boards: Mina (here, answers
 * two people), Theo (waking, only Lerato) and Noor (needs setup, anyone) are
 * the running agents in The Olive House; Scout, Aya and Writer are the
 * definitions offered by Add agents, with Scout and Aya already running
 * elsewhere (so their job titles come from the team) and Writer not yet run.
 */
export function colony3MembersBridgeOptions() {
  const { mina, theo, scout, aya } = REFERENCE_AGENTS;
  const oliveId = REFERENCE_CHANNEL_IDS.oliveHouse;
  const persona = (
    id: string,
    displayName: string,
    avatarUrl: string | null = null,
  ) => ({
    id,
    displayName,
    avatarUrl,
    systemPrompt: `You are ${displayName}.`,
    isActive: true,
  });
  return {
    managedAgents: [
      {
        pubkey: mina.pubkey,
        name: mina.name,
        status: "running" as const,
        channelIds: [oliveId],
        respondTo: "allowlist" as const,
        respondToAllowlist: [
          COLONY3_PEOPLE.noluthando.pubkey,
          COLONY3_PEOPLE.sam.pubkey,
        ],
      },
      {
        pubkey: theo.pubkey,
        name: theo.name,
        status: "running" as const,
        channelIds: [oliveId],
        respondTo: "owner-only" as const,
      },
      {
        pubkey: COLONY3_EXTRA_AGENTS.noor.pubkey,
        name: COLONY3_EXTRA_AGENTS.noor.name,
        status: "running" as const,
        channelIds: [oliveId],
        respondTo: "anyone" as const,
      },
      {
        pubkey: scout.pubkey,
        name: scout.name,
        status: "running" as const,
        personaId: COLONY3_PERSONA_IDS.scout,
      },
      {
        pubkey: aya.pubkey,
        name: aya.name,
        status: "running" as const,
        personaId: COLONY3_PERSONA_IDS.aya,
      },
    ],
    managedAgentRuntimes: [
      {
        pubkey: mina.pubkey,
        relayUrl: RELAY_WS_URL,
        lifecycle: "ready" as const,
      },
      {
        pubkey: theo.pubkey,
        relayUrl: RELAY_WS_URL,
        lifecycle: "waking" as const,
      },
      {
        pubkey: COLONY3_EXTRA_AGENTS.noor.pubkey,
        relayUrl: RELAY_WS_URL,
        localSetup: false,
        lifecycle: "stopped" as const,
      },
    ],
    personas: [
      persona(COLONY3_PERSONA_IDS.scout, "Scout"),
      persona(COLONY3_PERSONA_IDS.aya, "Aya"),
      persona(COLONY3_PERSONA_IDS.writer, "Writer"),
    ],
    replaceDefaultTeams: true,
    teams: [
      {
        name: "Research Agents",
        personaIds: [
          COLONY3_PERSONA_IDS.scout,
          COLONY3_PERSONA_IDS.aya,
          COLONY3_PERSONA_IDS.writer,
        ],
      },
    ],
  };
}
