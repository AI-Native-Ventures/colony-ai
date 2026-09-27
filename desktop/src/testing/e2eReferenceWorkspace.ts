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
import type {
  ChannelType,
  HomeFeedVisualFixture,
  RelayEvent,
} from "@/shared/api/types";
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
import {
  businessDTag,
  KIND_PROPOSAL_HEAD,
  KIND_PROPOSAL_VERSION,
  KIND_PROSPECT_HEAD,
  KIND_SERVICE_HEAD,
  proposalVersionDTag,
} from "@/features/discovery/businessRecordContract";

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
  oliveStudio: "1e1a7000-0000-4000-8000-000000000004",
  companyForum: "1e1a7000-0000-4000-8000-000000000005",
  minaDm: "1e1a7000-0000-4000-8000-000000000006",
  ayaDm: "1e1a7000-0000-4000-8000-000000000007",
  oliveHouse: "1e1a7000-0000-4000-8000-000000000011",
  cedarCafe: "1e1a7000-0000-4000-8000-000000000012",
  northline: "1e1a7000-0000-4000-8000-000000000013",
} as const;

export const REFERENCE_SERVICE_ID = "1e1a7000-0000-4000-9000-000000000021";
export const REFERENCE_PROPOSAL_ID = "1e1a7000-0000-4000-9000-000000000022";

export const REFERENCE_PROSPECT_IDS = {
  "the-olive-house": "1e1a7000-0000-4000-9000-000000001001",
  "form-field": "1e1a7000-0000-4000-9000-000000001002",
  "sunday-edit": "1e1a7000-0000-4000-9000-000000001003",
  stillroom: "1e1a7000-0000-4000-9000-000000001004",
  "gather-house": "1e1a7000-0000-4000-9000-000000001005",
  "common-ground": "1e1a7000-0000-4000-9000-000000001006",
  "clay-collective": "1e1a7000-0000-4000-9000-000000001007",
  "woven-living": "1e1a7000-0000-4000-9000-000000001008",
  "little-kin": "1e1a7000-0000-4000-9000-000000001009",
  "north-note": "1e1a7000-0000-4000-9000-000000001010",
  "studio-local": "1e1a7000-0000-4000-9000-000000001011",
  "cedar-co": "1e1a7000-0000-4000-9000-000000001012",
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

export const REFERENCE_HOME_UNREAD_IDS = [
  "reference-home-inbox-olive-approval",
  "reference-home-inbox-cedar-access",
] as const;
// Offscreen unread thread activity reproduces the reference sidebar dot while
// the read marker keeps visible top-level messages free of a New divider.
export const REFERENCE_SALES_UNREAD_ROOT_ID = "reference-sales-unread-root";
export const REFERENCE_SALES_UNREAD_REPLY_ID = "reference-sales-unread-reply";
export const REFERENCE_SALES_VOICE_NOTE_ID = "reference-sales-lerato-0950";
export const REFERENCE_SALES_WINDOW_START_DAY_LABEL = "Today";
// The Sales capture opens within a channel that has earlier history above the viewport.
export const REFERENCE_SALES_WINDOW_HAS_OLDER_HISTORY = true;

export type ReferenceChannelSeed = {
  id: string;
  name: string;
  description: string;
  agentMembers: string[];
  visibility?: "open" | "private";
  channelType?: ChannelType;
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
      visibility: "private",
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

const REFERENCE_LEADS = [
  [
    "the-olive-house",
    "The Olive House",
    "Parkhurst, Johannesburg",
    "Independent homeware boutique",
    "Nandi",
    "Open to locally made collections",
    "Website + business directory",
    94,
    "won",
    4500,
  ],
  [
    "form-field",
    "Form & Field",
    "Woodstock, Cape Town",
    "Design-led home and living store",
    "Jules",
    "Example public profile: a clear product offer, but no consistent weekly content series.",
    "Business directory",
    91,
    "new",
    6500,
  ],
  [
    "sunday-edit",
    "The Sunday Edit",
    "Rosebank, Johannesburg",
    "Lifestyle and gift store",
    "Ayesha",
    "Seasonal ranges with a local maker focus",
    "Website + business directory",
    89,
    "new",
    4500,
  ],
  [
    "stillroom",
    "Stillroom",
    "Stellenbosch, Western Cape",
    "Home decor boutique",
    "Lea",
    "Natural materials and everyday objects",
    "Public website",
    88,
    "contacted",
    6500,
  ],
  [
    "gather-house",
    "Gather House",
    "Morningside, Durban",
    "Home and gifting retailer",
    "Thandi",
    "Growing collection of South African makers",
    "Business directory",
    86,
    "new",
    4500,
  ],
  [
    "common-ground",
    "Common Ground Store",
    "Melville, Johannesburg",
    "Independent design retailer",
    "Palesa",
    "Modern craft and thoughtful gifts",
    "Public website",
    85,
    "new",
    8500,
  ],
  [
    "clay-collective",
    "The Clay Collective",
    "Gardens, Cape Town",
    "Ceramics and homeware gallery",
    "Sam",
    "Stockist programme for local ceramicists",
    "Public website",
    84,
    "new",
    6500,
  ],
  [
    "woven-living",
    "Woven Living",
    "Brooklyn, Pretoria",
    "Textile and interiors boutique",
    "Kea",
    "Natural fibre and handmade home goods",
    "Business directory",
    82,
    "proposal",
    8500,
  ],
  [
    "little-kin",
    "Little Kin",
    "Linden, Johannesburg",
    "Neighbourhood gift shop",
    "Maya",
    "Thoughtful gifts and locally made objects",
    "Public website",
    81,
    "new",
    4500,
  ],
  [
    "north-note",
    "North Note",
    "Ballito, KwaZulu-Natal",
    "Coastal homeware store",
    "Dineo",
    "Small seasonal retail collections",
    "Business directory",
    79,
    "new",
    6500,
  ],
  [
    "studio-local",
    "Studio Local",
    "Observatory, Cape Town",
    "Design and craft concept store",
    "Zoe",
    "Features new independent makers monthly",
    "Public website",
    77,
    "new",
    4500,
  ],
  [
    "cedar-co",
    "Cedar & Co.",
    "Somerset West, Western Cape",
    "Home decor and lifestyle",
    "Rene",
    "Established homeware and gift selection",
    "Business directory",
    75,
    "contacted",
    6500,
  ],
] as const;

function referenceW10Event(
  id: number,
  pubkey: string,
  createdAt: number,
  kind: number,
  channelId: string,
  dTag: string,
  content: unknown,
): RelayEvent {
  return {
    id: id.toString(16).padStart(64, "0"),
    pubkey,
    created_at: createdAt,
    kind,
    tags: [
      ["h", channelId],
      ["d", dTag],
    ],
    content: JSON.stringify(content),
    sig: "mocksig".repeat(20).slice(0, 128),
  };
}

/** W10 records from the reference workspace, seeded only in the opt-in E2E fixture. */
export function referenceSalesRecordEvents(
  selfPubkey: string,
  communityId: string,
): RelayEvent[] {
  const channelId = REFERENCE_CHANNEL_IDS.sales;
  const now = Math.floor(Date.now() / 1000);
  const events: RelayEvent[] = [];

  const service = {
    serviceId: REFERENCE_SERVICE_ID,
    name: "Social media management",
    description:
      "Eight image or carousel posts each month. Monthly content plan, captions, scheduling and one monthly report. Two revision rounds. Advertising spend and on-site photography are excluded.",
    currency: "ZAR",
    monthlyFeeMinor: 450000,
    postsPerMonth: 8,
    revisionRounds: 2,
  };
  events.push(
    referenceW10Event(
      1001,
      selfPubkey,
      now - 4_000,
      KIND_SERVICE_HEAD,
      channelId,
      businessDTag(communityId, "service", REFERENCE_SERVICE_ID),
      {
        schemaVersion: 1,
        serviceId: REFERENCE_SERVICE_ID,
        status: "active",
        service,
        sourceActionEventId: "1".repeat(64),
      },
    ),
  );

  REFERENCE_LEADS.forEach((lead, index) => {
    const [
      slug,
      name,
      location,
      vertical,
      contactName,
      fit,
      source,
      score,
      stage,
      value,
    ] = lead;
    const prospectId =
      REFERENCE_PROSPECT_IDS[slug as keyof typeof REFERENCE_PROSPECT_IDS];
    const verifiedAt = now - (index + 1) * 2 * 24 * 60 * 60;
    const qualification = [
      "qualified",
      "contacted",
      "proposal",
      "won",
    ].includes(stage)
      ? "qualified"
      : "unreviewed";
    const prospectStage =
      stage === "contacted"
        ? "in_conversation"
        : stage === "proposal" || stage === "won"
          ? stage
          : "qualified";
    const prospect = {
      prospectId,
      party: {
        partyId: prospectId,
        partyType: "organization",
        displayName: name,
        externalIds: [],
      },
      industry: "Home & Living",
      vertical,
      fitScore: score,
      potentialMonthlyValueMinor: value * 100,
      website: `https://${slug}.example`,
      contactName,
      location,
      email: `hello@${slug}.example`,
      phone: null,
      evidence: [
        {
          title: source,
          url: `https://${slug}.example`,
          excerpt: fit,
          observedAt: verifiedAt,
        },
      ],
      lastVerifiedAt: verifiedAt,
      qualification,
      saved: false,
      stage: prospectStage,
      lostReason: null,
    };
    const eventId = 1010 + index;
    events.push(
      referenceW10Event(
        eventId,
        selfPubkey,
        now - (REFERENCE_LEADS.length - index),
        KIND_PROSPECT_HEAD,
        channelId,
        businessDTag(communityId, "prospect", prospectId),
        {
          schemaVersion: 1,
          prospectId,
          status: "active",
          prospect,
          activities: [],
          sourceActionEventId: "2".repeat(64),
        },
      ),
    );
  });

  const proposalEventId = (1201).toString(16).padStart(64, "0");
  const formFieldId = REFERENCE_PROSPECT_IDS["form-field"];
  const proposalVersion = {
    schemaVersion: 1,
    proposalId: REFERENCE_PROPOSAL_ID,
    prospectPartyId: formFieldId,
    namedAcceptorPubkey: selfPubkey,
    revision: 1,
    previousVersionEventId: null,
    expiresAt: null,
    currency: "ZAR",
    lines: [
      {
        serviceId: REFERENCE_SERVICE_ID,
        description: service.description,
        quantityHundredths: 100,
        unitAmountMinor: 450000,
      },
    ],
    terms: JSON.stringify({
      schemaVersion: 1,
      title: "A consistent social presence for Form & Field",
      scope:
        "8 image or carousel posts each month. Monthly content plan, captions, scheduling and one monthly report. Two revision rounds. Advertising spend and on-site photography are excluded.",
      postsPerMonth: 8,
      revisionRounds: 2,
      serviceStart: "2026-10-01",
    }),
  };
  events.push(
    referenceW10Event(
      1201,
      selfPubkey,
      now - 2_000,
      KIND_PROPOSAL_VERSION,
      channelId,
      proposalVersionDTag(communityId, REFERENCE_PROPOSAL_ID, 1),
      proposalVersion,
    ),
    referenceW10Event(
      1202,
      selfPubkey,
      now - 1_900,
      KIND_PROPOSAL_HEAD,
      channelId,
      businessDTag(communityId, "proposal", REFERENCE_PROPOSAL_ID),
      {
        schemaVersion: 1,
        proposalId: REFERENCE_PROPOSAL_ID,
        currentVersionEventId: proposalEventId,
        currentVersionDigest: "3".repeat(64),
        revision: 1,
        sourceEventId: "4".repeat(64),
      },
    ),
  );
  return events;
}

/** The sidebar-only rows rendered by the C1 full-app shell snapshot. */
export function referenceSidebarChannelSeeds(): ReferenceChannelSeed[] {
  const { aya, mina } = REFERENCE_AGENTS;
  return [
    {
      id: REFERENCE_CHANNEL_IDS.oliveStudio,
      name: "olive-studio",
      description: "Campaign work for Olive Studio.",
      agentMembers: [mina.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.marketing,
      name: "marketing",
      description: "Our story, shared with care.",
      agentMembers: [mina.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.sales,
      name: "sales",
      description: "From first hello to lasting partnerships.",
      agentMembers: [aya.pubkey],
    },
    {
      id: REFERENCE_CHANNEL_IDS.companyForum,
      name: "Company forum",
      description: "Ideas and decisions for the company.",
      agentMembers: [mina.pubkey],
      channelType: "forum",
    },
    {
      id: REFERENCE_CHANNEL_IDS.minaDm,
      name: "Mina",
      description: "Direct message with Mina.",
      agentMembers: [mina.pubkey],
      channelType: "dm",
    },
    {
      id: REFERENCE_CHANNEL_IDS.ayaDm,
      name: "Aya",
      description: "Direct message with Aya.",
      agentMembers: [aya.pubkey],
      channelType: "dm",
    },
  ];
}

function todayAt(hours: number, minutes: number): number {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

export function referenceSalesLastMessageAt(): string {
  return referenceChannelLastMessageAt();
}

export function referenceChannelLastMessageAt(minutesEarlier = 0): string {
  return new Date(
    (todayAt(9, 50) - minutesEarlier * 60 + 1) * 1_000,
  ).toISOString();
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
      created_at: todayAt(9, 50) + 2,
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

export function referenceCommunityId(): string | null {
  try {
    const communities = JSON.parse(
      window.localStorage.getItem("buzz-communities") ?? "[]",
    ) as Array<{ id?: string }>;
    const activeId = window.localStorage.getItem("buzz-active-community-id");
    return (
      communities.find((community) => community.id === activeId)?.id ??
      communities[0]?.id ??
      null
    );
  } catch {
    return null;
  }
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

/** Writes reference sidebar storage and renames the seeded community. */
export function seedReferenceSidebarStorage(
  selfPubkey: string,
  options: { sidebarShell?: boolean } = {},
): void {
  const sidebarShell = options.sidebarShell === true;
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
  const starred = sidebarShell
    ? []
    : [
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
  storage.setItem(`buzz-forced-unread.v1:${selfPubkey}`, JSON.stringify({}));
  storage.setItem(
    `buzz.channel-read-state.v2:${selfPubkey}`,
    JSON.stringify({
      [REFERENCE_CHANNEL_IDS.sales]: referenceSalesLastMessageAt(),
    }),
  );
  storage.setItem(
    `buzz-home-feed-unread.v1:${selfPubkey}`,
    JSON.stringify(sidebarShell ? [] : [...REFERENCE_HOME_UNREAD_IDS]),
  );

  const sections = {
    version: 1,
    sections: sidebarShell
      ? []
      : [{ id: CLIENT_WORK_SECTION_ID, name: "Client work", order: 0 }],
    assignments: sidebarShell
      ? {}
      : {
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
  const sortPreferences = JSON.stringify({
    version: 1,
    groups: {
      starred: "recent",
      channels: "recent",
      "section:reference-client-work": "recent",
    },
  });
  storage.setItem(sortKey, sortPreferences);
  if (!relayUrl) {
    const defaultRelaySortKey = `buzz-channel-sort.v1:${selfPubkey}:${encodeURIComponent(normalizeRelayUrl("ws://localhost:3000"))}`;
    storage.setItem(defaultRelaySortKey, sortPreferences);
  }
}
