import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import type { Colony3Extras } from "../../src/testing/e2eBridge";
import type { RelayEvent } from "../../src/shared/api/types";
import {
  KIND_ASK_HEAD,
  KIND_MEMBER_POSITION_HEAD,
} from "../../src/shared/constants/kinds";
import {
  COLONY3_EXTRA_AGENTS,
  COLONY3_JOB_TITLES,
  COLONY3_PEOPLE,
  colony3At,
  colony3Extras,
} from "./colony3Conversations";

/**
 * The Activity board's sample data (`Activity.dc.html`): Lerato's inbox with
 * Mina's approval request open as a thread, plus Theo, Aya, Scout, Zinhle and
 * Noor behind it. Spread `colony3ActivityMockOptions()` into the `mock` of
 * `openLerato`; `COLONY3_ACTIVITY_ITEMS` names the rows by feed item id.
 */

/** The signed-in member's pubkey in the mock bridge. */
const SELF = "deadbeef".repeat(8);

const sha = (seed: number) => `${String(seed).padStart(2, "0")}ac`.repeat(16);

/** Feed item ids of the inbox rows, in list order. */
export const COLONY3_ACTIVITY_ITEMS = {
  mina: sha(3),
  theo: sha(4),
  aya: sha(8),
  scout: sha(9),
  zinhle: sha(10),
  noor: sha(11),
} as const;

const OLIVE_ROOT = sha(1);
const MINA_CAROUSEL = sha(2);
const SALES_ROOT = sha(5);
const DM_CHANNEL_ID = "1e1a7000-0000-4000-8000-000000000031";
export const COLONY3_CAROUSEL_FILE = "october-carousel-concepts.md";
const ASK_ID = "c3000000-0000-4000-8000-0000000000a1";

type FeedBucket = NonNullable<Colony3Extras["feed"]>;
type FeedItem = NonNullable<FeedBucket["needs_action"]>[number];

function reply(rootId: string): string[][] {
  return [
    ["e", rootId, "", "root"],
    ["e", rootId, "", "reply"],
  ];
}

/** The open approval Mina raised in the Olive House thread, signed by the relay. */
function approvalAsk(relaySecret: Uint8Array): RelayEvent {
  const channelId = REFERENCE_CHANNEL_IDS.oliveHouse;
  const askerPubkey = REFERENCE_AGENTS.mina.pubkey;
  const decideBy = new Date(colony3At(14, 0) * 1_000).toISOString();
  return finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: colony3At(14, 5),
      tags: [
        ["d", `channel:${channelId}:ask:${ASK_ID}`],
        ["h", channelId],
        ["e", OLIVE_ROOT],
        ["t", "approval"],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        askId: ASK_ID,
        status: "open",
        askerPubkey,
        createdAt: new Date(colony3At(14, 5) * 1_000).toISOString(),
        ask: {
          schemaVersion: 1,
          askId: ASK_ID,
          type: "approval",
          category: "general",
          title: "Approve the October campaign",
          threadRootEventId: OLIVE_ROOT,
          addresseePubkey: SELF,
          decideBy,
          options: null,
        },
        resolution: null,
        cancellation: null,
        sourceActionEventId: "a".repeat(64),
      }),
    },
    relaySecret,
  ) as unknown as RelayEvent;
}

function feed(): FeedBucket {
  const olive = REFERENCE_CHANNEL_IDS.oliveHouse;
  const cedar = REFERENCE_CHANNEL_IDS.cedarCafe;
  const sales = REFERENCE_CHANNEL_IDS.sales;
  const operations = REFERENCE_CHANNEL_IDS.operations;
  const item = (
    fields: Omit<FeedItem, "channel_type"> & { channel_type?: string | null },
  ): FeedItem => ({ channel_type: null, ...fields });
  return {
    needs_action: [
      item({
        id: COLONY3_ACTIVITY_ITEMS.mina,
        kind: 9,
        pubkey: REFERENCE_AGENTS.mina.pubkey,
        content: "Review the Olive House campaign before approval.",
        created_at: colony3At(14, 5),
        channel_id: olive,
        channel_name: "The Olive House",
        tags: [["h", olive], ...reply(OLIVE_ROOT), ["p", SELF]],
        category: "needs_action",
      }),
    ],
    mentions: [
      item({
        id: COLONY3_ACTIVITY_ITEMS.theo,
        kind: 9,
        pubkey: REFERENCE_AGENTS.theo.pubkey,
        content:
          "@Lerato publishing access to Cedar Café’s accounts has expired. Can you reconnect it?",
        created_at: colony3At(13, 40),
        channel_id: cedar,
        channel_name: "Cedar Café",
        tags: [
          ["h", cedar],
          ["p", SELF],
        ],
        category: "mention",
      }),
    ],
    activity: [
      item({
        id: sha(6),
        kind: 9,
        pubkey: REFERENCE_AGENTS.aya.pubkey,
        content: "I found 12 independent businesses that fit.",
        created_at: colony3At(12, 8),
        channel_id: sales,
        channel_name: "Sales",
        tags: [["h", sales], ...reply(SALES_ROOT)],
        category: "activity",
      }),
      item({
        id: sha(7),
        kind: 9,
        pubkey: REFERENCE_AGENTS.aya.pubkey,
        content: "Each one has its source and a short qualification note.",
        created_at: colony3At(12, 14),
        channel_id: sales,
        channel_name: "Sales",
        tags: [["h", sales], ...reply(SALES_ROOT)],
        category: "activity",
      }),
      item({
        id: COLONY3_ACTIVITY_ITEMS.aya,
        kind: 9,
        pubkey: REFERENCE_AGENTS.aya.pubkey,
        content:
          "There are 12 prospects to review. Each profile keeps the source and qualification notes together.",
        created_at: colony3At(12, 20),
        channel_id: sales,
        channel_name: "Sales",
        tags: [["h", sales], ...reply(SALES_ROOT)],
        category: "activity",
      }),
      item({
        id: COLONY3_ACTIVITY_ITEMS.zinhle,
        kind: 9,
        pubkey: COLONY3_PEOPLE.zinhle.pubkey,
        content: "Can we move the Northline call to Thursday morning?",
        created_at: colony3At(17, 30, 1),
        channel_id: DM_CHANNEL_ID,
        channel_name: "",
        channel_type: "dm",
        tags: [["h", DM_CHANNEL_ID]],
        category: "activity",
      }),
    ],
    agent_activity: [
      item({
        id: COLONY3_ACTIVITY_ITEMS.scout,
        kind: 43003,
        pubkey: REFERENCE_AGENTS.scout.pubkey,
        content:
          "Theo’s cost reconciliation stopped on the first try. I’ve asked him to retry with the corrected export.",
        created_at: colony3At(11, 52),
        channel_id: operations,
        channel_name: "Operations",
        tags: [["h", operations]],
        category: "agent_activity",
      }),
      item({
        id: COLONY3_ACTIVITY_ITEMS.noor,
        kind: 9,
        pubkey: COLONY3_EXTRA_AGENTS.noor.pubkey,
        content: "The September books for Cedar Café are reconciled.",
        created_at: colony3At(16, 40, 1),
        channel_id: cedar,
        channel_name: "Cedar Café",
        tags: [["h", cedar]],
        category: "agent_activity",
      }),
    ],
  };
}

/** The relay events behind the feed rows, so opening one loads its thread. */
function messages(): NonNullable<Colony3Extras["messages"]> {
  const olive = REFERENCE_CHANNEL_IDS.oliveHouse;
  const sales = REFERENCE_CHANNEL_IDS.sales;
  const fromFeed = Object.values(feed())
    .flat()
    .filter((entry) => entry.channel_id)
    .map((entry) => ({
      channelId: entry.channel_id as string,
      id: entry.id,
      pubkey: entry.pubkey,
      createdAt: entry.created_at,
      kind: entry.kind,
      tags: entry.tags.filter((tag) => tag[0] !== "h"),
      content: entry.content,
    }));
  const own = new Map(
    fromFeed.map((message) => [message.id, message] as const),
  );
  // Mina's 14:05 message reads as the design's thread, not as the row preview.
  own.set(COLONY3_ACTIVITY_ITEMS.mina, {
    channelId: olive,
    id: COLONY3_ACTIVITY_ITEMS.mina,
    pubkey: REFERENCE_AGENTS.mina.pubkey,
    createdAt: colony3At(14, 5),
    kind: 9,
    tags: [...reply(OLIVE_ROOT), ["p", SELF]],
    content:
      "@Lerato could you review the campaign before I schedule it? Nandi approves the final caption after you.",
  });
  return [
    ...own.values(),
    {
      channelId: olive,
      id: OLIVE_ROOT,
      pubkey: SELF,
      createdAt: colony3At(9, 12),
      kind: 9,
      tags: [["subject", "Spring content campaign"]],
      content:
        "Let’s keep a slower spring focused on the people behind the produce. Fewer posts, better stories.",
    },
    {
      channelId: olive,
      id: MINA_CAROUSEL,
      pubkey: REFERENCE_AGENTS.mina.pubkey,
      createdAt: colony3At(13, 58),
      kind: 9,
      tags: reply(OLIVE_ROOT),
      content: `The Olive House’s next post is ready. I drafted three carousel concepts from the spring brief; the farm-visit story leads. They are in \`${COLONY3_CAROUSEL_FILE}\`.`,
    },
    {
      channelId: sales,
      id: SALES_ROOT,
      pubkey: SELF,
      createdAt: colony3At(9, 14),
      kind: 9,
      tags: [],
      content:
        "@Aya, let’s find independent businesses that need reliable social content.",
    },
  ];
}

/** Team positions (job titles) the relay vouches for, signed by `relaySecret`. */
function positions(relaySecret: Uint8Array): RelayEvent[] {
  const employees = new Set<string>([
    ...Object.values(REFERENCE_AGENTS).map((agent) => agent.pubkey),
    ...Object.values(COLONY3_EXTRA_AGENTS).map((agent) => agent.pubkey),
  ]);
  return Object.entries(COLONY3_JOB_TITLES).map(
    ([pubkey, title]) =>
      finalizeEvent(
        {
          kind: KIND_MEMBER_POSITION_HEAD,
          created_at: colony3At(8, 0, 30),
          tags: [["d", `company:member:${pubkey}`]],
          content: JSON.stringify({
            schemaVersion: 1,
            pubkey,
            title,
            kind: employees.has(pubkey) ? "employee" : "human",
            status: "active",
            sourceActionEventId: "b".repeat(64),
            updatedAt: "2026-09-23T08:00:00.000Z",
          }),
        },
        relaySecret,
      ) as unknown as RelayEvent,
  );
}

/** Mock-bridge options for the Activity board; spread into `openLerato`'s `mock`. */
export function colony3ActivityMockOptions() {
  const relaySecret = generateSecretKey();
  return {
    companyMemberPositionEvents: positions(relaySecret),
    relaySelf: getPublicKey(relaySecret),
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyAskHeads: [approvalAsk(relaySecret)],
    colony3Extras: {
      ...colony3Extras({
        // The All view lists agent updates only from agents the signed-in
        // member owns, so Scout and Noor are Lerato's.
        profiles: [
          {
            pubkey: REFERENCE_AGENTS.scout.pubkey,
            displayName: "Scout",
            isAgent: true,
            ownerPubkey: SELF,
          },
          {
            pubkey: COLONY3_EXTRA_AGENTS.noor.pubkey,
            displayName: "Noor",
            isAgent: true,
            ownerPubkey: SELF,
          },
        ],
        channels: [
          {
            id: DM_CHANNEL_ID,
            name: COLONY3_PEOPLE.zinhle.name,
            channelType: "dm" as const,
            visibility: "private" as const,
            members: [{ pubkey: COLONY3_PEOPLE.zinhle.pubkey }],
            lastMessageAt: colony3At(17, 30, 1),
          },
        ],
        messages: messages(),
      }),
      feed: feed(),
      workspaceFiles: [COLONY3_CAROUSEL_FILE],
    },
  };
}
