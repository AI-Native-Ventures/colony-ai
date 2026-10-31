/**
 * Customer record seed for the mock bridge, taken from the approved
 * CFCustomerRecord screen: Plane Tree Guesthouse, from the lead Aya found in
 * Discovery to a client with a project at step 3 of 7 in Operations. The UI
 * lane renders it; pass it as `mock.companyCustomerRecords`.
 *
 * The value is the wire content of a relay-signed customer head (kind 30679),
 * keys in camelCase, nulls kept, exactly the shape of `CustomerRecordHead` in
 * `crates/buzz-core/src/company_customers.rs`. Money is minor units (cents):
 * the quote is R18 000.00, the deposit R9 000.00 and the balance R9 000.00.
 * The timeline is built the way the relay orders it: by time, then by the fixed
 * order of kinds, then by entry id. "Quote approved and sent" has no record of
 * its own in Colony, so it is a recorded milestone of kind `other`.
 */
export const PLANE_TREE_PARTY_ID = "6b1d0c58-2f4e-4a37-9c15-d3e8a7f20b41";
export const PLANE_TREE_LEAD_ID = "0e7a9b34-5c21-4d86-8f03-a1b2c3d4e5f6";
export const PLANE_TREE_CLIENT_ID = "b3f5a8c1-7d92-4e60-a4b8-19c0d2e6f731";
export const PLANE_TREE_PROPOSAL_ID = "4c9e2d71-8a05-4b13-b6f4-e07a1d3c5b92";
export const PLANE_TREE_INVOICE_ID = "d8a41f06-3b7c-4259-8e1d-5f60b9c2a374";
export const PLANE_TREE_PAYMENT_ID = "27c6e9b0-1f48-4d5a-93e7-8b04a6d1c5f8";
export const PLANE_TREE_JOB_ID = "9d41b7c2-5e0a-4a63-8f12-c0a7e3d5b6a4";
export const PLANE_TREE_BATCH_ID = "f1a2b3c4-5d6e-4f70-8192-a3b4c5d6e7f8";
export const PLANE_TREE_OPENER_ID = "a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c6d";
export const PLANE_TREE_REPLY_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";

const DAY = 86_400;
const HOUR = 3_600;
/** 26 Oct 2026, 07:33 UTC; the same base as the playbook fixtures. */
const BASE = 1_793_000_000;

const hex = (digit: string, tail = "") =>
  `${tail}${digit.repeat(64 - tail.length)}`;

type Input = {
  /** Scout, the lead agent. */
  scoutPubkey: string;
  /** Aya, the agent that found the lead. */
  ayaPubkey: string;
  /** The owner. */
  ownerPubkey: string;
};

type Entry = {
  entryId: string;
  kind: string;
  title: string;
  detail: string | null;
  at: number;
  actorPubkey: string | null;
  source: { kind: string; id: string };
};

/** Order of entries that share a second; mirrors `TimelineKind::rank` in Rust. */
const RANK = [
  "found",
  "opener_approved",
  "opener_sent",
  "replied",
  "call_booked",
  "quote_drafted",
  "quote_accepted",
  "agreement_signed",
  "milestone",
  "email",
  "file",
  "converted",
  "invoice_issued",
  "payment_received",
  "project_started",
  "project_completed",
];

function entry(
  kind: string,
  title: string,
  detail: string | null,
  at: number,
  actorPubkey: string | null,
  sourceKind: string,
  sourceId: string,
): Entry {
  return {
    entryId: `${sourceKind}:${sourceId}:${kind}`,
    kind,
    title,
    detail,
    at,
    actorPubkey,
    source: { kind: sourceKind, id: sourceId },
  };
}

/** The Plane Tree Guesthouse customer record, as the relay would write it at `BASE + 8 days`. */
export function planeTreeCustomerRecord(input: Input): Record<string, unknown> {
  const { scoutPubkey, ayaPubkey, ownerPubkey } = input;
  const milestones = [
    {
      milestoneId: hex("1", "c"),
      kind: "call_booked",
      title: null,
      at: BASE + 3 * DAY + 3 * HOUR,
      note: "Google Calendar, Fri 30 Oct 14:00",
      fileRef: null,
      byPubkey: ayaPubkey,
      recordedAt: BASE + 3 * DAY + 3 * HOUR,
    },
    {
      milestoneId: hex("2", "c"),
      kind: "other",
      title: "Quote approved and sent",
      at: BASE + 7 * DAY,
      note: "You approved Aya's draft",
      fileRef: null,
      byPubkey: ownerPubkey,
      recordedAt: BASE + 7 * DAY,
    },
    {
      milestoneId: hex("3", "c"),
      kind: "agreement_signed",
      title: null,
      at: BASE + 7 * DAY + 3 * HOUR,
      note: "E-sign, signed by Thandeka",
      fileRef: "blossom:sha256:agreement-signed",
      byPubkey: ayaPubkey,
      recordedAt: BASE + 7 * DAY + 3 * HOUR,
    },
  ];
  const attachments = [
    {
      attachmentId: hex("4", "a"),
      kind: "email",
      label: "Logo and photos",
      fileRefs: ["blossom:sha256:logo", "blossom:sha256:photos"],
      email: {
        from: "Thandeka <thandeka@planetree.example>",
        subject: "Logo and photos",
        date: BASE + 4 * DAY,
        summary: "Sent the logo and 14 photos of the rooms for the site.",
      },
      addedByPubkey: ayaPubkey,
      addedAt: BASE + 4 * DAY + HOUR,
    },
    {
      attachmentId: hex("5", "a"),
      kind: "email",
      label: "Opening hours and rooms",
      fileRefs: [],
      email: {
        from: "Thandeka <thandeka@planetree.example>",
        subject: "Opening hours and rooms",
        date: BASE + 5 * DAY,
        summary: "Five rooms, reception 07:00 to 20:00, no weekend check-in.",
      },
      addedByPubkey: ayaPubkey,
      addedAt: BASE + 5 * DAY + HOUR,
    },
    {
      attachmentId: hex("6", "a"),
      kind: "file",
      label: "Quote, version 1",
      fileRefs: ["blossom:sha256:quote-v1"],
      email: null,
      addedByPubkey: ayaPubkey,
      addedAt: BASE + 7 * DAY + 600,
    },
    {
      attachmentId: hex("7", "a"),
      kind: "file",
      label: "Agreement, signed",
      fileRefs: ["blossom:sha256:agreement-signed"],
      email: null,
      addedByPubkey: ayaPubkey,
      addedAt: BASE + 7 * DAY + 3 * HOUR + 300,
    },
    {
      attachmentId: hex("8", "a"),
      kind: "file",
      label: "Brief and assets",
      fileRefs: ["blossom:sha256:brief-assets"],
      email: null,
      addedByPubkey: scoutPubkey,
      addedAt: BASE + 8 * DAY + HOUR,
    },
  ];

  const entries: Entry[] = [
    entry(
      "found",
      "Found in Discovery",
      "guesthouses in Parkhurst",
      BASE - 6 * DAY,
      ayaPubkey,
      "prospect",
      PLANE_TREE_LEAD_ID,
    ),
    entry(
      "opener_approved",
      "WhatsApp opener approved",
      "Template: Has a website: open to a chat?",
      BASE + 2 * DAY,
      ownerPubkey,
      "whatsapp_batch",
      PLANE_TREE_BATCH_ID,
    ),
    entry(
      "opener_sent",
      "WhatsApp opener sent",
      "Template: Has a website: open to a chat?",
      BASE + 2 * DAY + HOUR,
      ayaPubkey,
      "whatsapp_message",
      PLANE_TREE_OPENER_ID,
    ),
    entry(
      "replied",
      "Replied",
      "Yes, tell me more",
      BASE + 3 * DAY,
      null,
      "whatsapp_message",
      PLANE_TREE_REPLY_ID,
    ),
    entry(
      "quote_drafted",
      "Quote drafted",
      "Version 1",
      BASE + 6 * DAY,
      ayaPubkey,
      "proposal_version",
      hex("9", "b"),
    ),
    entry(
      "quote_accepted",
      "Quote accepted",
      "Accepted by Thandeka",
      BASE + 7 * DAY + 2 * HOUR,
      ownerPubkey,
      "proposal_acceptance",
      hex("9", "d"),
    ),
    entry(
      "converted",
      "Became a client",
      null,
      BASE + 7 * DAY + 2 * HOUR,
      null,
      "client",
      PLANE_TREE_PARTY_ID,
    ),
    entry(
      "invoice_issued",
      "Invoice issued",
      "Version 1",
      BASE + 7 * DAY + 4 * HOUR,
      null,
      "invoice",
      PLANE_TREE_INVOICE_ID,
    ),
    entry(
      "payment_received",
      "Deposit paid",
      "payfast",
      BASE + 8 * DAY - HOUR,
      ownerPubkey,
      "payment",
      PLANE_TREE_PAYMENT_ID,
    ),
    entry(
      "project_started",
      "Project in Operations",
      "Delivery playbook · step 3 of 7: Website build",
      BASE + 8 * DAY,
      scoutPubkey,
      "playbook_job",
      PLANE_TREE_JOB_ID,
    ),
  ];
  for (const milestone of milestones) {
    const kind =
      milestone.kind === "other" ? "milestone" : (milestone.kind as string);
    const title =
      milestone.kind === "call_booked"
        ? "Call booked"
        : milestone.kind === "agreement_signed"
          ? "Agreement signed"
          : (milestone.title as string);
    entries.push(
      entry(
        kind,
        title,
        milestone.note,
        milestone.at,
        milestone.byPubkey,
        "milestone",
        milestone.milestoneId,
      ),
    );
  }
  for (const attachment of attachments) {
    if (attachment.email) {
      entries.push(
        entry(
          "email",
          `Email from ${attachment.email.from}`,
          attachment.email.subject,
          attachment.email.date,
          attachment.addedByPubkey,
          "attachment",
          attachment.attachmentId,
        ),
      );
    } else {
      entries.push(
        entry(
          "file",
          attachment.label,
          null,
          attachment.addedAt,
          attachment.addedByPubkey,
          "attachment",
          attachment.attachmentId,
        ),
      );
    }
  }
  entries.sort(
    (a, b) =>
      a.at - b.at ||
      RANK.indexOf(a.kind) - RANK.indexOf(b.kind) ||
      (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
  );

  return {
    schemaVersion: 1,
    partyId: PLANE_TREE_PARTY_ID,
    displayName: "Plane Tree Guesthouse",
    stage: "client",
    leadId: PLANE_TREE_LEAD_ID,
    clientId: PLANE_TREE_CLIENT_ID,
    clientStatus: "active",
    found: {
      at: BASE - 6 * DAY,
      byPubkey: ayaPubkey,
      search: "guesthouses in Parkhurst",
    },
    conversion: {
      at: BASE + 7 * DAY + 2 * HOUR,
      source: "client_record",
      byPubkey: null,
      actionEventId: null,
    },
    money: {
      currency: "ZAR",
      quoteTotalMinor: 1_800_000,
      depositPaidMinor: 900_000,
      depositPaidAt: BASE + 8 * DAY - HOUR,
      balanceDueMinor: 900_000,
      otherCurrencyFacts: 0,
    },
    quotes: [
      {
        proposalId: PLANE_TREE_PROPOSAL_ID,
        revision: 1,
        totalMinor: 1_800_000,
        currency: "ZAR",
        draftedAt: BASE + 6 * DAY,
        acceptedAt: BASE + 7 * DAY + 2 * HOUR,
      },
    ],
    chats: {
      whatsapp: {
        waId: "27825557135",
        messageCount: 16,
        inboundCount: 7,
        outboundCount: 9,
        lastMessageAt: BASE + 8 * DAY - 5 * HOUR,
        optedOut: false,
      },
      emailCount: 2,
    },
    project: {
      jobId: PLANE_TREE_JOB_ID,
      title: "Plane Tree Guesthouse",
      playbookTitle: "Delivery playbook",
      status: "running",
      currentStepId: "build",
      currentStepTitle: "Website build",
      stepNumber: 3,
      stepCount: 7,
      startedAt: BASE + 8 * DAY,
      endedAt: null,
    },
    milestones,
    attachments,
    timeline: entries,
    computedAt: BASE + 8 * DAY + 2 * HOUR,
    updatedByPubkey: scoutPubkey,
    updatedAt: BASE + 8 * DAY + 2 * HOUR,
    sourceActionEventId: null,
  };
}

/** A lead that has not converted: found, an approved opener, nothing else; every money figure is null. */
export function cedarCafeLeadRecord(input: Input): Record<string, unknown> {
  const partyId = "c2d3e4f5-0a1b-4c2d-8e3f-4a5b6c7d8e90";
  const leadId = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
  const batchId = "3b4c5d6e-7f80-4a91-b2c3-d4e5f6a7b8c9";
  const at = BASE - 2 * DAY;
  return {
    schemaVersion: 1,
    partyId,
    displayName: "Cedar Café",
    stage: "lead",
    leadId,
    clientId: null,
    clientStatus: null,
    found: { at, byPubkey: input.ayaPubkey, search: "cafes in Melville" },
    conversion: null,
    money: {
      currency: null,
      quoteTotalMinor: null,
      depositPaidMinor: null,
      depositPaidAt: null,
      balanceDueMinor: null,
      otherCurrencyFacts: 0,
    },
    quotes: [],
    chats: {
      whatsapp: {
        waId: "27825550142",
        messageCount: 1,
        inboundCount: 0,
        outboundCount: 1,
        lastMessageAt: at + DAY,
        optedOut: false,
      },
      emailCount: 0,
    },
    project: null,
    milestones: [],
    attachments: [],
    timeline: [
      entry(
        "found",
        "Found in Discovery",
        "cafes in Melville",
        at,
        input.ayaPubkey,
        "prospect",
        leadId,
      ),
      entry(
        "opener_approved",
        "WhatsApp opener approved",
        "Template: Has a website: open to a chat?",
        at + DAY,
        input.ownerPubkey,
        "whatsapp_batch",
        batchId,
      ),
    ],
    computedAt: at + DAY,
    updatedByPubkey: input.scoutPubkey,
    updatedAt: at + DAY,
    sourceActionEventId: null,
  };
}
