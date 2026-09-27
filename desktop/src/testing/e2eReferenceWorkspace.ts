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
import {
  BUSINESS_RECORD_SCHEMA_VERSION,
  buildDeliverableApprovalTemplate,
  buildDeliverableVersionTemplate,
  computeDeliverableDigests,
} from "@/features/clients/lib/businessRecords";
import {
  KIND_CLIENT_HEAD,
  KIND_DELIVERABLE_APPROVAL,
  KIND_DELIVERABLE_VERSION,
  KIND_STREAM_MESSAGE,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";
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
const REFERENCE_EVENT_SIGNATURE = "mocksig".repeat(20).slice(0, 128);
const REFERENCE_RECORD_TIME = Math.floor(
  new Date("2026-09-23T09:00:00.000Z").getTime() / 1_000,
);

function referenceEventId(index: number): string {
  return `${"e".repeat(56)}${index.toString(16).padStart(8, "0")}`;
}

/** Synthetic business heads used only by the existing visual E2E fixture. */
export function referenceBusinessRecordEvents(
  selfPubkey: string,
  overrides: {
    clientStatus?: string;
    workStatus?: string;
    workShare?: boolean;
  } = {},
): RelayEvent[] {
  const entries = [
    {
      channelId: REFERENCE_CHANNEL_IDS.oliveHouse,
      partyId: "a1a17000-0000-4000-8000-000000000001",
      clientId: REFERENCE_CHANNEL_IDS.oliveHouse,
      displayName: "The Olive House",
      clientStatus: "active",
      workItemId: "b1b17000-0000-4000-8000-000000000001",
      title: "Produce the spring content campaign",
      assignedPubkeys: [REFERENCE_AGENTS.mina.pubkey],
      status: "review",
    },
    {
      channelId: REFERENCE_CHANNEL_IDS.cedarCafe,
      partyId: "a1a17000-0000-4000-8000-000000000002",
      clientId: REFERENCE_CHANNEL_IDS.cedarCafe,
      displayName: "Cedar Café",
      clientStatus: "active",
      workItemId: "b1b17000-0000-4000-8000-000000000002",
      title: "Restore Cedar Café publishing access",
      assignedPubkeys: [REFERENCE_AGENTS.theo.pubkey],
      status: "blocked",
    },
    {
      channelId: REFERENCE_CHANNEL_IDS.northline,
      partyId: "a1a17000-0000-4000-8000-000000000003",
      clientId: REFERENCE_CHANNEL_IDS.northline,
      displayName: "Northline Interiors",
      clientStatus: "onboarding",
      workItemId: "b1b17000-0000-4000-8000-000000000003",
      title: "Complete Northline onboarding",
      assignedPubkeys: [REFERENCE_AGENTS.aya.pubkey],
      status: "active",
    },
  ] as const;

  const events: RelayEvent[] = [];
  let index = 1;
  for (const entry of entries) {
    const clientSourceId = referenceEventId(index++);
    events.push({
      id: referenceEventId(index++),
      pubkey: selfPubkey,
      created_at: REFERENCE_RECORD_TIME,
      kind: KIND_CLIENT_HEAD,
      tags: [
        ["h", entry.clientId],
        ["d", `client:${entry.clientId}:client:${entry.clientId}`],
      ],
      content: JSON.stringify({
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: entry.clientId,
        partyId: entry.partyId,
        displayName: entry.displayName,
        approverPubkeys: [selfPubkey.toLowerCase()],
        status: overrides.clientStatus ?? entry.clientStatus,
        sourceActionEventId: clientSourceId,
      }),
      sig: REFERENCE_EVENT_SIGNATURE,
    });

    const deliverableSeeds =
      entry.clientId === REFERENCE_CHANNEL_IDS.oliveHouse
        ? [
            {
              deliverableId: "c1c17000-0000-4000-8000-000000000001",
              title: "Make room for slow mornings",
              content:
                "A little space. A favourite cup. A slower start. Meet the pieces that make an ordinary morning feel like yours. Explore our spring edit at the link in our bio.",
              version: 2,
              previousContent: "First draft by Mina",
              previousDecision: "changes_requested" as const,
              previousNote:
                "Let the first slide breathe. Keep the product detail on slide two.",
            },
            {
              deliverableId: "c1c17000-0000-4000-8000-000000000002",
              title: "Meet your everyday favourites",
              content:
                "Pieces you reach for, again and again. Discover our spring edit.",
              version: 1,
            },
            {
              deliverableId: "c1c17000-0000-4000-8000-000000000003",
              title: "Small changes. Softer spaces.",
              content:
                "A new texture. A warmer corner. Small changes can make a space your own.",
              version: 1,
              approvalDecision: "approved" as const,
            },
            {
              deliverableId: "c1c17000-0000-4000-8000-000000000004",
              title: "An invitation to slow down",
              content:
                "A quieter weekend starts at home. Discover the spring edit.",
              version: 1,
              approvalDecision: "approved" as const,
            },
          ]
        : [];
    const deliverables = deliverableSeeds.map((seed) => {
      let previousVersionEventId: string | null = null;
      if (seed.previousContent && seed.previousDecision && seed.previousNote) {
        const previousBody = {
          title: seed.title,
          content: seed.previousContent,
        };
        const previousDigests = computeDeliverableDigests(previousBody, []);
        const previousTemplate = buildDeliverableVersionTemplate({
          clientId: entry.clientId,
          workItemId: entry.workItemId,
          deliverableId: seed.deliverableId,
          version: 1,
          previousVersionEventId: null,
          mediaDigests: [],
          body: previousBody,
        });
        previousVersionEventId = referenceEventId(index++);
        events.push({
          id: previousVersionEventId,
          pubkey: REFERENCE_AGENTS.mina.pubkey,
          created_at: REFERENCE_RECORD_TIME + 400,
          kind: KIND_DELIVERABLE_VERSION,
          tags: previousTemplate.tags,
          content: previousTemplate.content,
          sig: REFERENCE_EVENT_SIGNATURE,
        });

        const previousApproval = buildDeliverableApprovalTemplate({
          schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
          clientId: entry.clientId,
          workItemId: entry.workItemId,
          deliverableId: seed.deliverableId,
          versionEventId: previousVersionEventId,
          contentDigest: previousDigests.contentDigest,
          mediaDigest: previousDigests.mediaDigest,
          decision: seed.previousDecision,
          note: seed.previousNote,
        });
        events.push({
          id: referenceEventId(index++),
          pubkey: selfPubkey,
          created_at: REFERENCE_RECORD_TIME + 500,
          kind: KIND_DELIVERABLE_APPROVAL,
          tags: previousApproval.tags,
          content: previousApproval.content,
          sig: REFERENCE_EVENT_SIGNATURE,
        });
      }

      const body = { title: seed.title, content: seed.content };
      const digests = computeDeliverableDigests(body, []);
      const template = buildDeliverableVersionTemplate({
        clientId: entry.clientId,
        workItemId: entry.workItemId,
        deliverableId: seed.deliverableId,
        version: seed.version,
        previousVersionEventId,
        mediaDigests: [],
        body,
      });
      const versionEventId = referenceEventId(index++);
      events.push({
        id: versionEventId,
        pubkey: REFERENCE_AGENTS.mina.pubkey,
        created_at: REFERENCE_RECORD_TIME + 600,
        kind: KIND_DELIVERABLE_VERSION,
        tags: template.tags,
        content: template.content,
        sig: REFERENCE_EVENT_SIGNATURE,
      });

      if (seed.approvalDecision) {
        const approval = buildDeliverableApprovalTemplate({
          schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
          clientId: entry.clientId,
          workItemId: entry.workItemId,
          deliverableId: seed.deliverableId,
          versionEventId,
          contentDigest: digests.contentDigest,
          mediaDigest: digests.mediaDigest,
          decision: seed.approvalDecision,
          note: null,
        });
        events.push({
          id: referenceEventId(index++),
          pubkey: selfPubkey,
          created_at: REFERENCE_RECORD_TIME + 1_200,
          kind: KIND_DELIVERABLE_APPROVAL,
          tags: approval.tags,
          content: approval.content,
          sig: REFERENCE_EVENT_SIGNATURE,
        });
      }

      return {
        deliverableId: seed.deliverableId,
        versionEventId,
        contentDigest: digests.contentDigest,
        mediaDigest: digests.mediaDigest,
        versionDigest: digests.versionDigest,
      };
    });

    const workSourceId = referenceEventId(index++);
    const workDTag = `client:${entry.clientId}:work:${entry.workItemId}`;
    events.push({
      id: referenceEventId(index++),
      pubkey: selfPubkey,
      created_at: REFERENCE_RECORD_TIME + 300,
      kind: KIND_WORK_ITEM_HEAD,
      tags: [
        ["h", entry.channelId],
        ["d", workDTag],
      ],
      content: JSON.stringify({
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: entry.clientId,
        workItemId: entry.workItemId,
        title: entry.title,
        status: overrides.workStatus ?? entry.status,
        assignedPubkeys: [...entry.assignedPubkeys],
        approverPubkeys: [selfPubkey.toLowerCase()],
        deliverables,
        sourceEventId: workSourceId,
      }),
      sig: REFERENCE_EVENT_SIGNATURE,
    });
    if (
      overrides.workShare &&
      entry.clientId === REFERENCE_CHANNEL_IDS.oliveHouse
    ) {
      events.push({
        id: referenceEventId(index++),
        pubkey: selfPubkey,
        created_at: REFERENCE_RECORD_TIME + 1_800,
        kind: KIND_STREAM_MESSAGE,
        tags: [
          ["h", entry.clientId],
          ["p", selfPubkey.toLowerCase()],
          [
            "a",
            `${KIND_WORK_ITEM_HEAD}:${selfPubkey.toLowerCase()}:${workDTag}`,
          ],
        ],
        content: "",
        sig: REFERENCE_EVENT_SIGNATURE,
      });
    }
  }
  return events;
}

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

/** Existing #Olive House discussion shown before the W11 work-share event. */
export function referenceOliveHouseMessages(selfPubkey: string): RelayEvent[] {
  const channelId = REFERENCE_CHANNEL_IDS.oliveHouse;
  const sig = REFERENCE_EVENT_SIGNATURE;
  return [
    {
      id: "reference-olive-lerato-0920",
      pubkey: selfPubkey,
      created_at: todayAt(9, 20),
      kind: KIND_STREAM_MESSAGE,
      tags: [["h", channelId]],
      content:
        "Let’s keep a slower spring focused. Share the content here before we ask Nandi to approve.",
      sig,
    },
    {
      id: "reference-olive-mina-0942",
      pubkey: REFERENCE_AGENTS.mina.pubkey,
      created_at: todayAt(9, 42),
      kind: KIND_STREAM_MESSAGE,
      tags: [["h", channelId]],
      content:
        "The Olive House’s next post is ready. The preview, caption and scheduled date stay together through every revision.",
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
