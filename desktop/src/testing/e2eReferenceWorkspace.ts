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
import type { HomeFeedVisualFixture, RelayEvent } from "@/shared/api/types";
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

export const REFERENCE_HOME_UNREAD_IDS = [
  "reference-home-inbox-olive-approval",
  "reference-home-inbox-cedar-access",
] as const;
// Offscreen unread thread activity reproduces the reference sidebar dot. The
// forced channel marker keeps this captured timeline free of a New divider.
export const REFERENCE_SALES_UNREAD_ROOT_ID = "reference-sales-unread-root";
export const REFERENCE_SALES_UNREAD_REPLY_ID = "reference-sales-unread-reply";
export const REFERENCE_SALES_VOICE_NOTE_ID = "reference-sales-lerato-0950";
// The Sales capture opens within a channel that has earlier history above the viewport.
export const REFERENCE_SALES_WINDOW_HAS_OLDER_HISTORY = true;

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

export function referenceSalesLastMessageAt(): string {
  return new Date((todayAt(9, 50) + 1) * 1_000).toISOString();
}

/** The frozen r19 Today screen records used by the mock bridge. */
export const REFERENCE_HOME_VISUAL_FIXTURE: HomeFeedVisualFixture = {
  agentWork: [
    {
      id: "run-mina",
      agent: "Mina",
      title: "Prepare October carousel concepts",
      detail: "Waiting for permission to generate images",
      status: "permission",
    },
    {
      id: "run-aya",
      agent: "Aya",
      title: "Prepare Form & Field proposal",
      detail: "Waiting for Lerato to choose the scope",
      status: "question",
    },
    {
      id: "run-theo",
      agent: "Theo",
      title: "Reconcile September costs",
      detail: "Connection expired before external read",
      status: "failed",
    },
    {
      id: "run-noor",
      agent: "Noor",
      title: "Revise Cedar captions",
      detail: "Paused at the approved budget",
      status: "budget",
    },
  ],
  businessReviews: [
    {
      id: "olive-1",
      client: "The Olive House",
      meta: "The Olive House · Agency review · v2",
      title: "Make room for slow mornings",
      artTitle: "Make room for slow mornings.",
      variant: "olive",
      footer: "THE SPRING EDIT",
    },
    {
      id: "cedar-2",
      client: "Cedar Café",
      meta: "Cedar Café · Agency review · v1",
      title: "See you on the sunny side",
      artTitle: "See you on the sunny side.",
      variant: "cedar",
      footer: "YOUR NEIGHBOURHOOD, BREWED",
    },
    {
      id: "cedar-instagram",
      client: "Cedar Café",
      meta: "Cedar Café · @cedarcafe",
      title: "Renew Instagram access",
      variant: "instagram",
    },
    {
      id: "northline-linkedin",
      client: "Northline Interiors",
      meta: "Northline Interiors · Northline Interiors",
      title: "Grant publishing access",
      variant: "linkedin",
    },
    {
      id: "task-access",
      client: "Cedar Café",
      meta: "Theo · Client authorization",
      title: "Restore Cedar Café publishing access",
      variant: "access",
    },
    {
      id: "bloom-enquiry",
      client: "Bloom Florist",
      meta: "Website enquiry · We need consistent Instagram content for our flower studio. Can you help with 8 posts a month?",
      title: "Bloom Florist",
      variant: "enquiry",
    },
  ],
  clientApproval: {
    client: "The Olive House",
    title: "Meet your everyday favourites",
    approver: "Nandi",
    version: 1,
  },
  nextDelivery: {
    title: "Small changes. Softer spaces.",
    detail: "The Olive House · Thu, 01 Oct · 09:00 SAST",
  },
  moneyFollowUp: {
    client: "Cedar Café",
    invoice: "LS-027",
    due: "2026-09-20",
    amount: "R 3 000",
  },
};

/** The two unread review records that drive the reference Inbox badge. */
export function referenceHomeInboxItems(): Array<{
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  created_at: number;
  channel_id: string | null;
  channel_name: string;
  channel_type: null;
  tags: string[][];
  category: "needs_action";
}> {
  const createdAt = todayAt(10, 12);
  return [
    {
      id: REFERENCE_HOME_UNREAD_IDS[0],
      kind: 40007,
      pubkey: REFERENCE_AGENTS.aya.pubkey,
      content: "Review the Olive House campaign before approval.",
      created_at: createdAt,
      channel_id: null,
      channel_name: "",
      channel_type: null,
      tags: [],
      category: "needs_action",
    },
    {
      id: REFERENCE_HOME_UNREAD_IDS[1],
      kind: 40007,
      pubkey: REFERENCE_AGENTS.theo.pubkey,
      content: "Restore Cedar Café publishing access.",
      created_at: createdAt - 60,
      channel_id: null,
      channel_name: "",
      channel_type: null,
      tags: [],
      category: "needs_action",
    },
  ];
}

/** The reference #Sales discussion and the context for its side thread. */
export function referenceSalesMessages(selfPubkey: string): RelayEvent[] {
  const channelId = REFERENCE_CHANNEL_IDS.sales;
  const sig = "mocksig".repeat(20).slice(0, 128);
  const unreadRootId = REFERENCE_SALES_UNREAD_ROOT_ID;
  return [
    {
      id: unreadRootId,
      pubkey: selfPubkey,
      created_at: todayAt(8, 50),
      kind: 9,
      tags: [["h", channelId]],
      content: "Earlier Sales discussion",
      sig,
    },
    {
      id: REFERENCE_SALES_UNREAD_REPLY_ID,
      pubkey: REFERENCE_AGENTS.aya.pubkey,
      created_at: todayAt(9, 50) + 1,
      kind: 9,
      tags: [
        ["h", channelId],
        ["e", unreadRootId, "", "root"],
        ["e", unreadRootId, "", "reply"],
      ],
      content: "The updated shortlist is ready to review.",
      sig,
    },
    {
      id: "reference-sales-lerato-0914",
      pubkey: selfPubkey,
      created_at: todayAt(9, 14),
      kind: 9,
      tags: [["h", channelId]],
      content:
        "@Aya, let’s find independent businesses that need reliable social content. Start with a small, well-qualified list.",
      sig,
    },
    {
      id: "reference-sales-aya-0942",
      pubkey: REFERENCE_AGENTS.aya.pubkey,
      created_at: todayAt(9, 42),
      kind: 9,
      tags: [
        ["h", channelId],
        [
          "link-preview",
          "snapshot",
          "1",
          "https://example.com/independent-brands",
          "Independent brands needing social support",
          "Discovery",
          "Review prospects before outreach.",
          "",
          "",
          "",
          "",
        ],
      ],
      content:
        "There are 12 prospects to review. Each profile keeps the source and qualification notes together.\n\n[​](https://example.com/independent-brands)",
      sig,
    },
    {
      id: "reference-sales-lerato-0950",
      pubkey: selfPubkey,
      created_at: todayAt(9, 50),
      kind: 9,
      tags: [
        ["h", channelId],
        [
          "imeta",
          "url https://example.invalid/voice-note-r17.wav",
          "m audio/wav",
          "filename voice-note-sample.wav",
          "duration 8",
          "transcript Please keep the first slide simple. Show the product detail on slide two, and let Nandi approve the final caption before we schedule it.",
        ],
      ],
      content:
        "[Voice note · Sample audio](https://example.invalid/voice-note-r17.wav)",
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
  storage.setItem(
    `buzz-forced-unread.v1:${selfPubkey}`,
    JSON.stringify({
      [REFERENCE_CHANNEL_IDS.sales]: {
        markerAtWhenForced: null,
        sources: ["manual"],
      },
    }),
  );
  storage.setItem(
    `buzz-home-feed-unread.v1:${selfPubkey}`,
    JSON.stringify([...REFERENCE_HOME_UNREAD_IDS]),
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

  const sortKey = relayUrl
    ? `buzz-channel-sort.v1:${selfPubkey}:${encodeURIComponent(normalizeRelayUrl(relayUrl))}`
    : `buzz-channel-sort.v1:${selfPubkey}`;
  storage.setItem(
    sortKey,
    JSON.stringify({
      version: 1,
      groups: {
        starred: "recent",
        channels: "recent",
        "section:reference-client-work": "recent",
      },
    }),
  );
}
