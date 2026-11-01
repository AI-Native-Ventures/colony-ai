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
  KIND_FORUM_POST,
  KIND_INVOICE_HEAD,
  KIND_INVOICE_VERSION,
  KIND_PAYMENT,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
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
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import { MOCK_TENANT_COMMUNITY_ID } from "./e2eTenant.ts";

export const REFERENCE_SELF_NAME = "Lerato Molefe";
export const REFERENCE_COMMUNITY_NAME = "Lerato Social";

/** Reference agents (data.js `team`), keyed by their reference ids. */
export const REFERENCE_AGENTS = {
  scout: { name: "Scout", pubkey: "d5d5".repeat(16) },
  aya: { name: "Aya", pubkey: "a4a4".repeat(16) },
  mina: { name: "Mina", pubkey: "b1b1".repeat(16) },
  theo: { name: "Theo", pubkey: "c7c7".repeat(16) },
} as const;

/**
 * Colony 3.0 business fixture people: Noor (the Bookkeeper agent who issues
 * invoices and records payments) and Nandi (the client reviewer). Registered
 * by the mock bridge when `colony3Business` is on.
 */
export const COLONY3_BUSINESS_PEOPLE = {
  noor: { name: "Noor", pubkey: "e9e9".repeat(16), isAgent: true },
  nandi: { name: "Nandi", pubkey: "f2f2".repeat(16), isAgent: false },
} as const;

const COLONY3_TODAY_1405 = Math.floor(
  new Date("2026-10-23T14:05:00+02:00").getTime() / 1_000,
);
const COLONY3_OCT_20 = Math.floor(
  new Date("2026-10-20T11:00:00+02:00").getTime() / 1_000,
);
const COLONY3_OCT_21 = Math.floor(
  new Date("2026-10-21T10:00:00+02:00").getTime() / 1_000,
);

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
  /** Colony 3.0 fixture: the private Welcome channel and the Scout DM. */
  welcome: "1e1a7000-0000-4000-8000-000000000014",
  scoutDm: "1e1a7000-0000-4000-8000-000000000015",
} as const;

export const REFERENCE_SERVICE_ID = "1e1a7000-0000-4000-9000-000000000021";
export const REFERENCE_PROPOSAL_ID = "1e1a7000-0000-4000-9000-000000000022";
export const REFERENCE_MONEY_INVOICE_IDS = {
  oliveAugustPaid: "3e3a7000-0000-4000-8000-000000000021",
  cedarAugustPaid: "3e3a7000-0000-4000-8000-000000000022",
  olivePaid: "3e3a7000-0000-4000-8000-000000000026",
  cedarPartial: "3e3a7000-0000-4000-8000-000000000027",
  oliveIssued: "3e3a7000-0000-4000-8000-000000000028",
  northlineDraft: "3e3a7000-0000-4000-8000-000000000029",
} as const;

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
  "marigold-house": "1e1a7000-0000-4000-9000-000000001013",
  "melville-hill-cottages": "1e1a7000-0000-4000-9000-000000001014",
  "linden-tree-lodge": "1e1a7000-0000-4000-9000-000000001015",
  "stoop-on-seventh": "1e1a7000-0000-4000-9000-000000001016",
  "quiet-owl-bb": "1e1a7000-0000-4000-9000-000000001017",
  "red-fern-guesthouse": "1e1a7000-0000-4000-9000-000000001018",
  "garden-gate-rooms": "1e1a7000-0000-4000-9000-000000001019",
  "emmarentia-gardens": "1e1a7000-0000-4000-9000-000000001020",
  "richmond-avenue-bnb": "1e1a7000-0000-4000-9000-000000001021",
  "parkview-guest-rooms": "1e1a7000-0000-4000-9000-000000001022",
  "44-stanley-stay": "1e1a7000-0000-4000-9000-000000001023",
  "milpark-house": "1e1a7000-0000-4000-9000-000000001024",
  "saxonwold-guest-lodge": "1e1a7000-0000-4000-9000-000000001025",
  "houghton-view-rooms": "1e1a7000-0000-4000-9000-000000001026",
  "greenside-courtyard": "1e1a7000-0000-4000-9000-000000001027",
  "northcliff-hill-house": "1e1a7000-0000-4000-9000-000000001028",
  "rosebank-suites": "1e1a7000-0000-4000-9000-000000001029",
  "auckland-park-house": "1e1a7000-0000-4000-9000-000000001030",
  "kingsway-guest-rooms": "1e1a7000-0000-4000-9000-000000001031",
  "the-french-quarter": "1e1a7000-0000-4000-9000-000000001032",
  "melville-corner-rooms": "1e1a7000-0000-4000-9000-000000001033",
  "westcliff-garden-suites": "1e1a7000-0000-4000-9000-000000001034",
  "parkhurst-palm-guesthouse": "1e1a7000-0000-4000-9000-000000001035",
  "little-linden": "1e1a7000-0000-4000-9000-000000001036",
  "orange-grove-manor": "1e1a7000-0000-4000-9000-000000001037",
  "parkview-manor": "1e1a7000-0000-4000-9000-000000001038",
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
    moneyRecordsAvailable?: boolean;
    /** The Colony 3.0 business boards: the design's deliverables, people, dates. */
    colony3Business?: boolean;
  } = {},
): RelayEvent[] {
  const colony3 = overrides.colony3Business === true;
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
        approverPubkeys:
          colony3 && entry.clientId === REFERENCE_CHANNEL_IDS.oliveHouse
            ? [COLONY3_BUSINESS_PEOPLE.nandi.pubkey]
            : [selfPubkey.toLowerCase()],
        status: overrides.clientStatus ?? entry.clientStatus,
        sourceActionEventId: clientSourceId,
      }),
      sig: REFERENCE_EVENT_SIGNATURE,
    });

    type DeliverableSeed = {
      deliverableId: string;
      title: string;
      content: string;
      version: number;
      previousContent?: string;
      previousDecision?: "changes_requested";
      previousNote?: string;
      approvalDecision?: "approved";
      approvalBy?: string;
      versionAt?: number;
      previousAt?: number;
      approvalAt?: number;
    };
    const colony3Seeds: DeliverableSeed[] = [
      {
        deliverableId: "c1c17000-0000-4000-8000-000000000001",
        title: "October carousel concepts",
        content:
          "Three calm slides: the first with one product and one line, then the season at The Olive House.",
        version: 2,
        previousContent: "First draft by Mina",
        previousDecision: "changes_requested",
        previousNote: "Please keep the first slide simple.",
        versionAt: COLONY3_TODAY_1405,
        previousAt: COLONY3_OCT_20,
        approvalAt: COLONY3_OCT_20 + 3_600,
      },
      {
        deliverableId: "c1c17000-0000-4000-8000-000000000002",
        title: "Spring captions",
        content: "Captions for the spring posts, left for Nandi to approve.",
        version: 1,
        approvalDecision: "approved",
        approvalBy: COLONY3_BUSINESS_PEOPLE.nandi.pubkey,
        versionAt: COLONY3_OCT_20,
        approvalAt: COLONY3_OCT_21,
      },
    ];
    const deliverableSeeds: DeliverableSeed[] =
      entry.clientId === REFERENCE_CHANNEL_IDS.oliveHouse
        ? colony3
          ? colony3Seeds
          : [
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
        : colony3 && entry.clientId === REFERENCE_CHANNEL_IDS.northline
          ? [
              {
                deliverableId: "c1c17000-0000-4000-8000-000000000011",
                title: "Onboarding checklist",
                content: "What we need from Northline Interiors to start.",
                version: 1,
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
          created_at: seed.previousAt ?? REFERENCE_RECORD_TIME + 400,
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
          created_at: seed.approvalAt ?? REFERENCE_RECORD_TIME + 500,
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
        created_at: seed.versionAt ?? REFERENCE_RECORD_TIME + 600,
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
          pubkey: seed.approvalBy ?? selfPubkey,
          created_at: seed.approvalAt ?? REFERENCE_RECORD_TIME + 1_200,
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
      created_at:
        colony3 && entry.status === "review"
          ? COLONY3_TODAY_1405
          : REFERENCE_RECORD_TIME + 300,
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
        approverPubkeys:
          colony3 && entry.clientId === REFERENCE_CHANNEL_IDS.oliveHouse
            ? [COLONY3_BUSINESS_PEOPLE.nandi.pubkey]
            : [selfPubkey.toLowerCase()],
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
  if (overrides.moneyRecordsAvailable !== false) {
    events.push(...referenceMoneyRecordEvents(selfPubkey, index, colony3));
  }
  return events;
}

function referenceMoneyRecordEvents(
  selfPubkey: string,
  firstIndex: number,
  colony3 = false,
) {
  const noor = COLONY3_BUSINESS_PEOPLE.noor.pubkey;
  const events: RelayEvent[] = [];
  let index = firstIndex;
  const baseSeeds = [
    {
      clientId: REFERENCE_CHANNEL_IDS.oliveHouse,
      invoiceId: REFERENCE_MONEY_INVOICE_IDS.oliveAugustPaid,
      proposalId: "3e3a7000-0000-4000-9000-000000000021",
      description: "August retainer",
      amountMinor: 600_000,
      issuedAt: new Date("2026-08-01T12:00:00+02:00").getTime() / 1_000,
      dueAt: new Date("2026-08-07T12:00:00+02:00").getTime() / 1_000,
      status: "issued" as const,
      collectedMinor: 600_000,
      paymentDate: new Date("2026-08-05T12:00:00+02:00").getTime() / 1_000,
    },
    {
      clientId: REFERENCE_CHANNEL_IDS.cedarCafe,
      invoiceId: REFERENCE_MONEY_INVOICE_IDS.cedarAugustPaid,
      proposalId: "3e3a7000-0000-4000-9000-000000000022",
      description: "August retainer",
      amountMinor: 390_000,
      issuedAt: new Date("2026-08-01T12:00:00+02:00").getTime() / 1_000,
      dueAt: new Date("2026-08-07T12:00:00+02:00").getTime() / 1_000,
      status: "issued" as const,
      collectedMinor: 390_000,
      paymentDate: new Date("2026-08-08T12:00:00+02:00").getTime() / 1_000,
    },
    {
      clientId: REFERENCE_CHANNEL_IDS.oliveHouse,
      invoiceId: REFERENCE_MONEY_INVOICE_IDS.olivePaid,
      proposalId: "3e3a7000-0000-4000-9000-000000000026",
      description: "September social media retainer",
      amountMinor: 650_000,
      issuedAt: new Date("2026-09-01T12:00:00+02:00").getTime() / 1_000,
      dueAt: new Date("2026-09-07T12:00:00+02:00").getTime() / 1_000,
      status: "issued" as const,
      collectedMinor: 650_000,
      paymentDate: new Date("2026-09-04T12:00:00+02:00").getTime() / 1_000,
    },
    {
      clientId: REFERENCE_CHANNEL_IDS.cedarCafe,
      invoiceId: REFERENCE_MONEY_INVOICE_IDS.cedarPartial,
      proposalId: "3e3a7000-0000-4000-9000-000000000027",
      description: "September social media retainer",
      amountMinor: 450_000,
      issuedAt: new Date("2026-09-01T12:00:00+02:00").getTime() / 1_000,
      dueAt: new Date("2026-09-20T12:00:00+02:00").getTime() / 1_000,
      status: "issued" as const,
      collectedMinor: 150_000,
      paymentDate: new Date("2026-09-10T12:00:00+02:00").getTime() / 1_000,
    },
    {
      clientId: REFERENCE_CHANNEL_IDS.oliveHouse,
      invoiceId: REFERENCE_MONEY_INVOICE_IDS.oliveIssued,
      proposalId: "3e3a7000-0000-4000-9000-000000000028",
      description: "Spring campaign · additional creative",
      amountMinor: 320_000,
      issuedAt: new Date("2026-09-18T12:00:00+02:00").getTime() / 1_000,
      dueAt: new Date("2026-09-30T12:00:00+02:00").getTime() / 1_000,
      status: "issued" as const,
      collectedMinor: 0,
      paymentDate: null,
    },
    {
      clientId: REFERENCE_CHANNEL_IDS.northline,
      invoiceId: REFERENCE_MONEY_INVOICE_IDS.northlineDraft,
      proposalId: "3e3a7000-0000-4000-9000-000000000029",
      description: "First monthly retainer",
      amountMinor: 850_000,
      issuedAt: null,
      dueAt: null,
      status: "draft" as const,
      collectedMinor: 0,
      paymentDate: null,
    },
  ];
  type MoneySeed = Omit<(typeof baseSeeds)[number], "invoiceId"> & {
    invoiceId: string;
    issuer?: string;
    recorder?: string;
  };
  const at = (iso: string) => new Date(iso).getTime() / 1_000;
  // The design's September: Noor issues, 0029 is awaiting payment and the
  // draft is 0030; payments land on 12 and 18 September.
  const colony3Money: Record<string, Partial<MoneySeed>> = {
    [REFERENCE_MONEY_INVOICE_IDS.oliveAugustPaid]: {
      dueAt: at("2026-08-15T12:00:00+02:00"),
    },
    [REFERENCE_MONEY_INVOICE_IDS.cedarAugustPaid]: {
      dueAt: at("2026-08-15T12:00:00+02:00"),
    },
    [REFERENCE_MONEY_INVOICE_IDS.olivePaid]: {
      invoiceId: "3e3a7000-0000-4000-8000-000000000025",
      dueAt: at("2026-09-15T12:00:00+02:00"),
      paymentDate: at("2026-09-12T12:00:00+02:00"),
      issuer: noor,
    },
    [REFERENCE_MONEY_INVOICE_IDS.cedarPartial]: {
      paymentDate: at("2026-09-18T12:00:00+02:00"),
      issuer: noor,
      recorder: noor,
    },
    [REFERENCE_MONEY_INVOICE_IDS.oliveIssued]: {
      invoiceId: "3e3a7000-0000-4000-8000-000000000029",
      issuedAt: at("2026-09-30T12:00:00+02:00"),
      dueAt: at("2026-10-30T12:00:00+02:00"),
      issuer: noor,
    },
    [REFERENCE_MONEY_INVOICE_IDS.northlineDraft]: {
      invoiceId: "3e3a7000-0000-4000-8000-000000000030",
    },
  };
  const seeds: MoneySeed[] = baseSeeds.map((seed) => ({
    ...seed,
    ...(colony3 ? colony3Money[seed.invoiceId] : {}),
  }));
  for (const seed of seeds) {
    const dTag = `client:${seed.clientId}:invoice:${seed.invoiceId}`;
    const proposalVersionEventId = referenceEventId(index++);
    const initialVersionId = referenceEventId(index++);
    const initialHeadId = referenceEventId(index++);
    const line = {
      serviceId: null,
      description: seed.description,
      quantityHundredths: 100,
      unitAmountMinor: seed.amountMinor,
    };
    const draftVersion = {
      schemaVersion: 1,
      clientId: seed.clientId,
      invoiceId: seed.invoiceId,
      version: 1,
      previousVersionEventId: null,
      proposalVersionEventId,
      expectedHeadEventId: null,
      action: "proposal_acceptance",
      currency: "ZAR",
      lines: [line],
      taxLines: [],
      sellerTaxNumber: null,
      customerTaxNumber: null,
      totalMinor: seed.amountMinor,
      status: "draft",
      dueAt: seed.dueAt,
      voidReason: null,
    };
    const draftHead = {
      schemaVersion: 1,
      clientId: seed.clientId,
      invoiceId: seed.invoiceId,
      proposalId: seed.proposalId,
      proposalVersionEventId,
      currency: "ZAR",
      lines: [line],
      taxLines: [],
      sellerTaxNumber: null,
      customerTaxNumber: null,
      totalMinor: seed.amountMinor,
      creditedMinor: 0,
      writtenOffMinor: 0,
      collectedMinor: seed.collectedMinor,
      outstandingMinor: seed.amountMinor - seed.collectedMinor,
      paymentEvidenceCount: seed.paymentDate ? 1 : 0,
      version: 1,
      currentVersionEventId: initialVersionId,
      status: "draft",
      dueAt: seed.dueAt,
      issuedAt: null,
      sourceEventId: initialVersionId,
    };
    events.push({
      id: initialVersionId,
      pubkey: selfPubkey,
      created_at: seed.issuedAt ?? REFERENCE_RECORD_TIME,
      kind: KIND_INVOICE_VERSION,
      tags: [
        ["h", seed.clientId],
        ["d", `${dTag}:version:1`],
      ],
      content: JSON.stringify(draftVersion),
      sig: REFERENCE_EVENT_SIGNATURE,
    });
    if (seed.status === "draft") {
      events.push({
        id: initialHeadId,
        pubkey: selfPubkey,
        created_at: REFERENCE_RECORD_TIME,
        kind: KIND_INVOICE_HEAD,
        tags: [
          ["h", seed.clientId],
          ["d", dTag],
        ],
        content: JSON.stringify(draftHead),
        sig: REFERENCE_EVENT_SIGNATURE,
      });
      continue;
    }
    const issueVersionId = referenceEventId(index++);
    const issueHeadId = referenceEventId(index++);
    const issueVersion = {
      ...draftVersion,
      version: 2,
      previousVersionEventId: initialVersionId,
      expectedHeadEventId: initialHeadId,
      action: "issue",
      status: "issued",
    };
    events.push({
      id: issueVersionId,
      pubkey: seed.issuer ?? selfPubkey,
      created_at: seed.issuedAt ?? REFERENCE_RECORD_TIME,
      kind: KIND_INVOICE_VERSION,
      tags: [
        ["h", seed.clientId],
        ["d", `${dTag}:version:2`],
      ],
      content: JSON.stringify(issueVersion),
      sig: REFERENCE_EVENT_SIGNATURE,
    });
    events.push({
      id: issueHeadId,
      pubkey: seed.issuer ?? selfPubkey,
      created_at: seed.issuedAt ?? REFERENCE_RECORD_TIME,
      kind: KIND_INVOICE_HEAD,
      tags: [
        ["h", seed.clientId],
        ["d", dTag],
      ],
      content: JSON.stringify({
        ...draftHead,
        version: 2,
        currentVersionEventId: issueVersionId,
        status: "issued",
        issuedAt: seed.issuedAt,
        sourceEventId: issueVersionId,
      }),
      sig: REFERENCE_EVENT_SIGNATURE,
    });
    if (seed.paymentDate !== null) {
      const paymentId = `4e4a7000-0000-4000-8000-${seed.invoiceId.slice(-12)}`;
      events.push({
        id: referenceEventId(index++),
        pubkey: seed.recorder ?? selfPubkey,
        created_at: seed.paymentDate,
        kind: KIND_PAYMENT,
        tags: [
          ["h", seed.clientId],
          ["d", `client:${seed.clientId}:payment:${paymentId}`],
        ],
        content: JSON.stringify({
          schemaVersion: 1,
          clientId: seed.clientId,
          invoiceId: seed.invoiceId,
          paymentId,
          provider: "manual",
          providerReference: null,
          amountMinor: seed.collectedMinor,
          currency: "ZAR",
          occurredAt: seed.paymentDate,
          evidenceRef: `receipt:${seed.invoiceId.slice(-4)}`,
          expectedInvoiceHeadEventId: issueHeadId,
        }),
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
/** The Colony 3.0 fixture shows four unread Activity items (the sidebar "4"). */
export const COLONY3_HOME_UNREAD_IDS = [
  ...REFERENCE_HOME_UNREAD_IDS,
  "colony3-home-inbox-carousel",
  "colony3-home-inbox-form-field",
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

const WHATSAPP_GUESTHOUSE_LEADS = [
  [
    "the-olive-house",
    "Melville Manor Guesthouse",
    "Melville, Johannesburg",
    "Guesthouse",
    "Lerato",
    "A family-run stay near the village with breakfast and local recommendations.",
    "Public website",
    94,
    "new",
    6500,
  ],
  [
    "form-field",
    "Plane Tree Guesthouse",
    "Parkhurst, Johannesburg",
    "Guesthouse",
    "Thandeka",
    "An older website that is hard to use on a phone. Most bookings go through Booking.com.",
    "From their current site and Thandeka's reply",
    92,
    "contacted",
    7200,
  ],
  [
    "sunday-edit",
    "Corner Cottage Parkhurst",
    "Parkhurst, Johannesburg",
    "Guesthouse",
    "Lwazi",
    "A restored cottage offering quiet weekend stays.",
    "Business directory",
    90,
    "contacted",
    6000,
  ],
  [
    "stillroom",
    "Jacaranda Lane Guesthouse",
    "Melville, Johannesburg",
    "Guesthouse",
    "Mpho",
    "A leafy guesthouse with rooms for business and weekend travellers.",
    "Public website",
    88,
    "new",
    5800,
  ],
  [
    "gather-house",
    "Lavender Hill Guesthouse",
    "Melville, Johannesburg",
    "Guesthouse",
    "Karen",
    "Garden rooms and breakfast close to the university precinct.",
    "Business directory",
    87,
    "new",
    6200,
  ],
  [
    "common-ground",
    "The Green Shutter B&B",
    "Melville, Johannesburg",
    "Bed and breakfast",
    "Palesa",
    "A small B&B with a clear local identity and room to grow direct bookings.",
    "Public website",
    85,
    "new",
    5600,
  ],
  [
    "clay-collective",
    "Oakleaf Rooms",
    "Melville, Johannesburg",
    "Guest rooms",
    "Sam",
    "Affordable rooms near the main transport routes.",
    "Business directory",
    84,
    "new",
    5200,
  ],
  [
    "woven-living",
    "Bramble & Brick Guesthouse",
    "Westdene, Johannesburg",
    "Guesthouse",
    "Zoe",
    "A character guesthouse with a garden and breakfast service.",
    "Public website",
    82,
    "new",
    6000,
  ],
  [
    "little-kin",
    "Leafy Stoep Guesthouse",
    "Melville, Johannesburg",
    "Guesthouse",
    "Maya",
    "A homely stay with a shaded stoep and local dining nearby.",
    "Business directory",
    81,
    "new",
    5000,
  ],
  [
    "north-note",
    "Koppie View Lodge",
    "Auckland Park, Johannesburg",
    "Lodge",
    "Dineo",
    "A small lodge serving visiting families and academic guests.",
    "Public website",
    79,
    "new",
    6500,
  ],
  [
    "studio-local",
    "The Seventh Street Rooms",
    "Melville, Johannesburg",
    "Guest rooms",
    "Lea",
    "Central rooms near cafes, restaurants and public transport.",
    "Business directory",
    77,
    "new",
    4800,
  ],
  [
    "cedar-co",
    "Brixton View Rooms",
    "Brixton, Johannesburg",
    "Guesthouse",
    "Rene",
    "Comfortable rooms with a view across the western suburbs.",
    "Public website",
    75,
    "contacted",
    5400,
  ],
] as const;

const WHATSAPP_EXTRA_GUESTHOUSE_DETAILS = [
  ["marigold-house", "Marigold House", "Melville, Johannesburg", "Anika"],
  [
    "melville-hill-cottages",
    "Melville Hill Cottages",
    "Melville, Johannesburg",
    "Rethabile",
  ],
  [
    "linden-tree-lodge",
    "Linden Tree Lodge",
    "Emmarentia, Johannesburg",
    "Zanele",
  ],
  [
    "stoop-on-seventh",
    "The Stoop on Seventh",
    "Parkhurst, Johannesburg",
    "Farah",
  ],
  ["quiet-owl-bb", "The Quiet Owl B&B", "Melville, Johannesburg", "Palesa"],
  [
    "red-fern-guesthouse",
    "The Red Fern Guesthouse",
    "Parkhurst, Johannesburg",
    "Musa",
  ],
  ["garden-gate-rooms", "Garden Gate Rooms", "Melville, Johannesburg", "Tumi"],
  [
    "emmarentia-gardens",
    "Emmarentia Gardens Guesthouse",
    "Emmarentia, Johannesburg",
    "Thabo",
  ],
  [
    "richmond-avenue-bnb",
    "Richmond Avenue B&B",
    "Richmond, Johannesburg",
    "Lindi",
  ],
  [
    "parkview-guest-rooms",
    "Parkview Guest Rooms",
    "Parkview, Johannesburg",
    "Noma",
  ],
  ["44-stanley-stay", "44 Stanley Stay", "Milpark, Johannesburg", "Lebo"],
  ["milpark-house", "Milpark House", "Milpark, Johannesburg", "Sihle"],
  [
    "saxonwold-guest-lodge",
    "Saxonwold Guest Lodge",
    "Saxonwold, Johannesburg",
    "Mandla",
  ],
  [
    "houghton-view-rooms",
    "Houghton View Rooms",
    "Houghton, Johannesburg",
    "Zinhle",
  ],
  [
    "greenside-courtyard",
    "Greenside Courtyard Stay",
    "Greenside, Johannesburg",
    "Neo",
  ],
  [
    "northcliff-hill-house",
    "Northcliff Hill House",
    "Northcliff, Johannesburg",
    "Dumisani",
  ],
  ["rosebank-suites", "Rosebank Suites", "Rosebank, Johannesburg", "Mpho"],
  [
    "auckland-park-house",
    "Auckland Park House",
    "Auckland Park, Johannesburg",
    "Lerato",
  ],
  [
    "kingsway-guest-rooms",
    "Kingsway Guest Rooms",
    "Auckland Park, Johannesburg",
    "Sbu",
  ],
  [
    "the-french-quarter",
    "The French Quarter",
    "Melville, Johannesburg",
    "Amira",
  ],
  [
    "melville-corner-rooms",
    "Melville Corner Rooms",
    "Melville, Johannesburg",
    "Dineo",
  ],
  [
    "westcliff-garden-suites",
    "Westcliff Garden Suites",
    "Westcliff, Johannesburg",
    "Aviwe",
  ],
  [
    "parkhurst-palm-guesthouse",
    "Parkhurst Palm Guesthouse",
    "Parkhurst, Johannesburg",
    "Nandi",
  ],
  ["little-linden", "The Little Linden", "Linden, Johannesburg", "Kagiso"],
  [
    "orange-grove-manor",
    "Orange Grove Manor",
    "Orange Grove, Johannesburg",
    "Vusi",
  ],
  ["parkview-manor", "Parkview Manor", "Parkview, Johannesburg", "Naledi"],
] as const;

const WHATSAPP_EXTRA_GUESTHOUSE_LEADS = WHATSAPP_EXTRA_GUESTHOUSE_DETAILS.map(
  ([slug, name, location, contactName], index) =>
    [
      slug,
      name,
      location,
      "Guesthouse",
      contactName,
      name + " is an independently run stay with a warm local welcome.",
      index % 2 === 0 ? "Public website" : "Business directory",
      74 - index,
      "new",
      0,
    ] as const,
);

const WHATSAPP_GUESTHOUSE_ORDER = new Map(
  [
    "form-field",
    "sunday-edit",
    "stillroom",
    "north-note",
    "marigold-house",
    "melville-hill-cottages",
    "gather-house",
    "clay-collective",
    "linden-tree-lodge",
    "stoop-on-seventh",
    "common-ground",
    "woven-living",
    "little-kin",
    "the-olive-house",
    "cedar-co",
    "studio-local",
    "parkview-guest-rooms",
    "44-stanley-stay",
    "milpark-house",
    "saxonwold-guest-lodge",
    "houghton-view-rooms",
    "greenside-courtyard",
    "northcliff-hill-house",
    "rosebank-suites",
    "auckland-park-house",
    "kingsway-guest-rooms",
    "the-french-quarter",
    "melville-corner-rooms",
    "westcliff-garden-suites",
    "parkhurst-palm-guesthouse",
    "little-linden",
    "orange-grove-manor",
    "parkview-manor",
    "quiet-owl-bb",
    "red-fern-guesthouse",
    "garden-gate-rooms",
    "westdene-house",
    "emmarentia-gardens",
    "richmond-avenue-bnb",
  ].map((slug, index) => [slug, index] as const),
);

/** Deliberately long test name for lead-reference picker overflow coverage. */
export const REFERENCE_LONG_LEAD_NAME =
  "The Exceptionally Long Name of a Johannesburg Home and Living Business";

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
  communityId: TenantCommunityId,
  options: {
    longLeadNames?: boolean;
    whatsappGuesthouses?: boolean;
    leadCount?: number;
  } = {},
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

  const sourceLeadSeeds = options.whatsappGuesthouses
    ? [...WHATSAPP_GUESTHOUSE_LEADS, ...WHATSAPP_EXTRA_GUESTHOUSE_LEADS].sort(
        (left, right) =>
          (WHATSAPP_GUESTHOUSE_ORDER.get(left[0]) ?? Number.MAX_SAFE_INTEGER) -
          (WHATSAPP_GUESTHOUSE_ORDER.get(right[0]) ?? Number.MAX_SAFE_INTEGER),
      )
    : REFERENCE_LEADS;
  const requestedLeadCount = Number.isInteger(options.leadCount)
    ? Math.min(500, Math.max(sourceLeadSeeds.length, options.leadCount ?? 0))
    : sourceLeadSeeds.length;
  Array.from(
    { length: requestedLeadCount },
    (_, index) => sourceLeadSeeds[index % sourceLeadSeeds.length],
  ).forEach((lead, index) => {
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
    const isSyntheticLead = index >= sourceLeadSeeds.length;
    const generatedName = isSyntheticLead
      ? options.longLeadNames && index % 9 === 0
        ? `The ${name} Collection and Design Studio ${String(index + 1).padStart(3, "0")}`
        : `${name} ${String(index + 1).padStart(3, "0")}`
      : name;
    const displayName =
      options.longLeadNames && !isSyntheticLead && slug === "cedar-co"
        ? REFERENCE_LONG_LEAD_NAME
        : generatedName;
    const generatedSlug = isSyntheticLead
      ? `${slug}-${String(index + 1).padStart(3, "0")}`
      : slug;
    const extraLeadIndex = WHATSAPP_EXTRA_GUESTHOUSE_DETAILS.findIndex(
      ([extraSlug]) => extraSlug === slug,
    );
    const prospectId = isSyntheticLead
      ? `1e1a7000-0000-4000-9000-${String(900000 + index).padStart(12, "0")}`
      : (REFERENCE_PROSPECT_IDS[slug as keyof typeof REFERENCE_PROSPECT_IDS] ??
        `1e1a7000-0000-4000-9000-${String(1013 + extraLeadIndex).padStart(12, "0")}`);
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
        displayName,
        externalIds: [],
      },
      industry: options.whatsappGuesthouses ? "Hospitality" : "Home & Living",
      vertical,
      fitScore: score,
      potentialMonthlyValueMinor: options.whatsappGuesthouses
        ? null
        : value * 100,
      website:
        options.whatsappGuesthouses && slug === "gather-house"
          ? null
          : `https://${generatedSlug}.example`,
      contactName,
      location,
      email: `hello@${generatedSlug}.example`,
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
        now - (requestedLeadCount - index),
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
      title: options.whatsappGuesthouses
        ? "A website refresh for Plane Tree Guesthouse"
        : "A consistent social presence for Form & Field",
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

/** Unread conversation records shown by the company shell review fixture. */
export function referenceSidebarUnreadMessages(
  selfPubkey: string,
): Record<string, RelayEvent[]> {
  const message = (
    id: string,
    channelId: string,
    pubkey: string,
    content: string,
    createdAt: number,
    kind = KIND_STREAM_MESSAGE,
  ): RelayEvent => ({
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags: [["h", channelId]],
    content,
    sig: REFERENCE_EVENT_SIGNATURE,
  });

  return {
    [REFERENCE_CHANNEL_IDS.oliveStudio]: [
      message(
        "c1-olive-studio-unread-1",
        REFERENCE_CHANNEL_IDS.oliveStudio,
        selfPubkey,
        "Campaign review is ready.",
        todayAt(9, 42),
      ),
      message(
        "c1-olive-studio-unread-2",
        REFERENCE_CHANNEL_IDS.oliveStudio,
        REFERENCE_AGENTS.mina.pubkey,
        "The latest social draft is ready to review.",
        todayAt(9, 50),
      ),
    ],
    [REFERENCE_CHANNEL_IDS.sales]: [
      message(
        "c1-sales-unread-1",
        REFERENCE_CHANNEL_IDS.sales,
        selfPubkey,
        "A new lead is ready for follow-up.",
        todayAt(9, 20),
      ),
      message(
        "c1-sales-unread-2",
        REFERENCE_CHANNEL_IDS.sales,
        REFERENCE_AGENTS.aya.pubkey,
        "The prospect list is ready to review.",
        todayAt(9, 25),
      ),
      message(
        "c1-sales-unread-3",
        REFERENCE_CHANNEL_IDS.sales,
        selfPubkey,
        "I will review the qualified prospects.",
        todayAt(9, 28),
      ),
    ],
    [REFERENCE_CHANNEL_IDS.companyForum]: [
      message(
        "c1-company-forum-unread-1",
        REFERENCE_CHANNEL_IDS.companyForum,
        REFERENCE_AGENTS.mina.pubkey,
        "Company forum update.",
        todayAt(9, 45),
        KIND_FORUM_POST,
      ),
    ],
    [REFERENCE_CHANNEL_IDS.ayaDm]: [
      message(
        "c1-aya-dm-unread-1",
        REFERENCE_CHANNEL_IDS.ayaDm,
        REFERENCE_AGENTS.aya.pubkey,
        "The latest update is ready.",
        todayAt(9, 45),
        KIND_STREAM_MESSAGE_V2,
      ),
    ],
  };
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
export function referenceHomeInboxItems(
  options: { colony3?: boolean } = {},
): Array<{
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
  const items = [
    {
      id: REFERENCE_HOME_UNREAD_IDS[0] as string,
      kind: 40007,
      pubkey: REFERENCE_AGENTS.aya.pubkey,
      content: "Review the Olive House campaign before approval.",
      created_at: createdAt,
      channel_id: null,
      channel_name: "",
      channel_type: null,
      tags: [],
      category: "needs_action" as const,
    },
    {
      id: REFERENCE_HOME_UNREAD_IDS[1] as string,
      kind: 40007,
      pubkey: REFERENCE_AGENTS.theo.pubkey,
      content: "Restore Cedar Café publishing access.",
      created_at: createdAt - 60,
      channel_id: null,
      channel_name: "",
      channel_type: null,
      tags: [],
      category: "needs_action" as const,
    },
  ];
  if (options.colony3) {
    items.push(
      {
        id: COLONY3_HOME_UNREAD_IDS[2],
        kind: 40007,
        pubkey: REFERENCE_AGENTS.mina.pubkey,
        content: "Approve the October carousel concepts.",
        created_at: createdAt - 120,
        channel_id: null,
        channel_name: "",
        channel_type: null,
        tags: [],
        category: "needs_action" as const,
      },
      {
        id: COLONY3_HOME_UNREAD_IDS[3],
        kind: 40007,
        pubkey: REFERENCE_AGENTS.aya.pubkey,
        content: "Review the Form & Field proposal.",
        created_at: createdAt - 180,
        channel_id: null,
        channel_name: "",
        channel_type: null,
        tags: [],
        category: "needs_action" as const,
      },
    );
  }
  return items;
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

/**
 * The tenant community UUID the mock relay namespaces business records with,
 * or null when no community is stored. It is deliberately not the stored
 * community's own id: the real relay's tenant id and the desktop's local id
 * are different values, and the mock must keep them apart.
 */
export function referenceTenantCommunityId(): TenantCommunityId | null {
  try {
    const communities = JSON.parse(
      window.localStorage.getItem("buzz-communities") ?? "[]",
    ) as Array<{ id?: string }>;
    return communities.length > 0 ? MOCK_TENANT_COMMUNITY_ID : null;
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
  options: {
    sidebarShell?: boolean;
    colony3?: boolean;
    businessName?: string;
  } = {},
): void {
  const sidebarShell = options.sidebarShell === true;
  const colony3 = options.colony3 === true;
  const storage = window.localStorage;
  let relayUrl: string | undefined;
  try {
    const communities = JSON.parse(
      storage.getItem("buzz-communities") ?? "[]",
    ) as Array<{ name?: string; relayUrl?: string }>;
    // Only the community the app opens is Lerato Social; other communities
    // seeded beside it (the rail boards) keep their own names.
    const activeId = storage.getItem("buzz-active-community-id");
    const active =
      communities.find(
        (community) => (community as { id?: string }).id === activeId,
      ) ?? communities[0];
    for (const community of communities) {
      if (community === active) {
        community.name = options.businessName ?? REFERENCE_COMMUNITY_NAME;
      }
      relayUrl ??= community.relayUrl;
    }
    relayUrl = active?.relayUrl ?? relayUrl;
    storage.setItem("buzz-communities", JSON.stringify(communities));
  } catch {
    // No seeded community: the app shows its own setup, nothing to rename.
  }

  const now = Date.now();
  const starred =
    sidebarShell || colony3
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
      ...(sidebarShell
        ? {
            [REFERENCE_CHANNEL_IDS.oliveStudio]: new Date(
              todayAt(9, 0) * 1_000,
            ).toISOString(),
            [REFERENCE_CHANNEL_IDS.sales]: new Date(
              todayAt(9, 10) * 1_000,
            ).toISOString(),
            [REFERENCE_CHANNEL_IDS.companyForum]: new Date(
              todayAt(9, 0) * 1_000,
            ).toISOString(),
            [REFERENCE_CHANNEL_IDS.ayaDm]: new Date(
              todayAt(9, 0) * 1_000,
            ).toISOString(),
          }
        : {
            [REFERENCE_CHANNEL_IDS.sales]: referenceSalesLastMessageAt(),
            ...(colony3
              ? { [REFERENCE_CHANNEL_IDS.cedarCafe]: colony3CedarReadAt() }
              : {}),
          }),
    }),
  );
  storage.setItem(
    `buzz-home-feed-unread.v1:${selfPubkey}`,
    JSON.stringify(
      sidebarShell
        ? []
        : [...(colony3 ? COLONY3_HOME_UNREAD_IDS : REFERENCE_HOME_UNREAD_IDS)],
    ),
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
      ...(sidebarShell ? { dms: "recent" } : {}),
      "section:reference-client-work": "recent",
    },
  });
  storage.setItem(sortKey, sortPreferences);
  if (!relayUrl) {
    const defaultRelaySortKey = `buzz-channel-sort.v1:${selfPubkey}:${encodeURIComponent(normalizeRelayUrl("ws://localhost:3000"))}`;
    storage.setItem(defaultRelaySortKey, sortPreferences);
  }
}

/**
 * Colony 3.0 foundation fixture: the channels, sections and unread state the
 * Sidebar board shows for Lerato Social. Client work holds The Olive House,
 * Cedar Café and Northline Interiors; Channels lists Sales, Marketing,
 * Operations and Welcome; Scout is the one direct message. Nothing is starred.
 */
export function colony3ChannelSeeds(): ReferenceChannelSeed[] {
  const { scout } = REFERENCE_AGENTS;
  return [
    ...referenceChannelSeeds(),
    {
      id: REFERENCE_CHANNEL_IDS.welcome,
      name: "Welcome",
      description: "A private channel for getting oriented in this community.",
      agentMembers: [scout.pubkey],
      visibility: "private",
    },
    {
      id: REFERENCE_CHANNEL_IDS.scoutDm,
      name: "Scout",
      description: "Direct message with Scout.",
      agentMembers: [scout.pubkey],
      channelType: "dm",
    },
  ];
}

/**
 * Read marker for Cedar Café. The three unread messages the Sidebar board
 * shows arrive live (see `seedColony3Activity` in the test helpers), because
 * unread counts are built from observed events, not history.
 */
export function colony3CedarReadAt(): string {
  return new Date(todayAt(9, 0) * 1_000).toISOString();
}

export function colony3CedarLastMessageAt(): string {
  return new Date((todayAt(9, 48) + 1) * 1_000).toISOString();
}

export function colony3OliveLastMessageAt(): string {
  return new Date((todayAt(9, 52) + 1) * 1_000).toISOString();
}
