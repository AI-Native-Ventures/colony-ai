/**
 * Reference workspace fixture for the visual comparison harness.
 *
 * The frozen design renders a sample business ("Lerato Social") with named
 * agents, starred channels, a client-work section and a #Sales conversation.
 * The default E2E mock data is a generic test community, so comparing it
 * against the reference measured data differences rather than styling. This
 * fixture reproduces the reference's shell and conversation data so the
 * harness compares like with like. It is opt-in through
 * `mock.referenceWorkspace` and never changes the default mock data.
 */
import type { RelayEvent } from "@/shared/api/types";
import { normalizeRelayUrl } from "@/shared/lib/normalizeRelayUrl";

export const REFERENCE_SELF_NAME = "Lerato Molefe";
export const REFERENCE_COMMUNITY_NAME = "Lerato Social";

/** Reference agents (data.js `team`), keyed by their reference ids. */
export const REFERENCE_AGENTS = {
  scout: { name: "Scout", pubkey: "d5d5".repeat(16) },
  aya: { name: "Aya", pubkey: "a4a4".repeat(16) },
  mina: { name: "Mina", pubkey: "b1b1".repeat(16) },
  theo: { name: "Theo", pubkey: "c7c7".repeat(16) },
} as const;

export const REFERENCE_CHANNEL_IDS = {
  sales: "1e1a7000-0000-4000-8000-000000000001",
  marketing: "1e1a7000-0000-4000-8000-000000000002",
  operations: "1e1a7000-0000-4000-8000-000000000003",
  oliveHouse: "1e1a7000-0000-4000-8000-000000000011",
  cedarCafe: "1e1a7000-0000-4000-8000-000000000012",
  northline: "1e1a7000-0000-4000-8000-000000000013",
} as const;

const CLIENT_WORK_SECTION_ID = "reference-client-work";

export type ReferenceChannelSeed = {
  id: string;
  name: string;
  description: string;
  agentMembers: string[];
};

/** Channel order and names as the reference sidebar lists them. */
export function referenceChannelSeeds(): ReferenceChannelSeed[] {
  const { scout, aya, mina, theo } = REFERENCE_AGENTS;
  return [
    {
      id: REFERENCE_CHANNEL_IDS.sales,
      name: "Sales",
      description: "From first hello to lasting partnerships.",
      agentMembers: [aya.pubkey, scout.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.marketing,
      name: "Marketing",
      description: "Our story, shared with care.",
      agentMembers: [mina.pubkey, scout.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.operations,
      name: "Operations",
      description: "The work behind the work.",
      agentMembers: [theo.pubkey, scout.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.oliveHouse,
      name: "The Olive House",
      description: "Client work for The Olive House.",
      agentMembers: [mina.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.cedarCafe,
      name: "Cedar Café",
      description: "Client work for Cedar Café.",
      agentMembers: [mina.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.northline,
      name: "Northline Interiors",
      description: "Client work for Northline Interiors.",
      agentMembers: [aya.pubkey],
    },
  ];
}

function todayAt(hours: number, minutes: number): number {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** The reference #Sales discussion (text rows only). */
export function referenceSalesMessages(selfPubkey: string): RelayEvent[] {
  const channelId = REFERENCE_CHANNEL_IDS.sales;
  const sig = "mocksig".repeat(20).slice(0, 128);
  return [
    {
      id: "reference-sales-lerato-0914",
      pubkey: selfPubkey,
      created_at: todayAt(9, 14),
      kind: 9,
      tags: [
        ["h", channelId],
        ["p", REFERENCE_AGENTS.aya.pubkey],
      ],
      content:
        "@Aya, let's find independent businesses that need reliable social content. Start with a small, well-qualified list.",
      sig,
    },
    {
      id: "reference-sales-aya-0942",
      pubkey: REFERENCE_AGENTS.aya.pubkey,
      created_at: todayAt(9, 42),
      kind: 9,
      tags: [["h", channelId]],
      content:
        "There are 12 prospects to review. Each profile keeps the source and qualification notes together.",
      sig,
    },
  ];
}

/**
 * Writes the reference sidebar state (starred channels, the client-work
 * section) and renames the seeded community, before the app first reads it.
 */
export function seedReferenceSidebarStorage(selfPubkey: string): void {
  const storage = window.localStorage;
  let relayUrl: string | undefined;
  try {
    const communities = JSON.parse(
      storage.getItem("buzz-communities") ?? "[]",
    ) as Array<{ name?: string; relayUrl?: string }>;
    for (const community of communities) {
      community.name = REFERENCE_COMMUNITY_NAME;
      relayUrl ??= community.relayUrl;
    }
    storage.setItem("buzz-communities", JSON.stringify(communities));
  } catch {
    // No seeded community: the app shows its own setup, nothing to rename.
  }

  const now = Date.now();
  const starred = [
    REFERENCE_CHANNEL_IDS.sales,
    REFERENCE_CHANNEL_IDS.marketing,
    REFERENCE_CHANNEL_IDS.operations,
  ];
  storage.setItem(
    `buzz-channel-stars.v1:${selfPubkey}`,
    JSON.stringify({
      version: 1,
      channels: Object.fromEntries(
        starred.map((id) => [id, { starred: true, updatedAt: now }]),
      ),
    }),
  );

  const sections = {
    version: 1,
    sections: [{ id: CLIENT_WORK_SECTION_ID, name: "Client work", order: 0 }],
    assignments: {
      [REFERENCE_CHANNEL_IDS.oliveHouse]: CLIENT_WORK_SECTION_ID,
      [REFERENCE_CHANNEL_IDS.cedarCafe]: CLIENT_WORK_SECTION_ID,
      [REFERENCE_CHANNEL_IDS.northline]: CLIENT_WORK_SECTION_ID,
    },
  };
  const sectionsKey = relayUrl
    ? `buzz-channel-sections.v1:${selfPubkey}:${encodeURIComponent(normalizeRelayUrl(relayUrl))}`
    : `buzz-channel-sections.v1:${selfPubkey}`;
  storage.setItem(sectionsKey, JSON.stringify(sections));
}
