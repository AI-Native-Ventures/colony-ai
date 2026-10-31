/**
 * Mock bridge model of the co-founder customer record (kind 30679 heads, kind
 * 47069 actions). It applies the same authority and shape rules as the relay
 * (`buzz_core::company_customers`), enough for UI specs: an owner or admin
 * writes, a plain member (a stranger to the record) is refused, a write names
 * the exact head it saw, a refresh younger than a minute changes nothing and
 * converting twice is a no-op. The relay would recompute every other figure
 * from the company's records; the mock keeps the seeded ones. No signature work.
 *
 * This file imports nothing from the bridge, so the bridge can import it.
 */

export type MockCustomerRecord = Record<string, unknown>;

export type MockCustomerState = {
  companyCustomerRecords?: MockCustomerRecord[];
};

export type MockCustomerContext = {
  isAdmin: boolean;
  cofounderEnabled: boolean;
  now: number;
  actorPubkey: string;
  eventId: string;
  /** The id of the current head event of a record, for the expected-head fence. */
  currentHeadEventId: (record: MockCustomerRecord) => string;
};

export type CustomerActionBody = {
  schemaVersion?: number;
  partyId?: string;
  op?: string;
  milestoneKind?: string;
  at?: number;
  title?: string;
  note?: string;
  fileRef?: string;
  from?: string;
  subject?: string;
  date?: number;
  summary?: string;
  fileRefs?: string[];
  label?: string;
  attachmentId?: string;
  expectedHeadEventId?: string;
};

const FRESH_SECS = 60;
const MAX_SUMMARY_BYTES = 4_096;
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

type Entry = {
  entryId: string;
  kind: string;
  at: number;
  [key: string]: unknown;
};

function sortTimeline(timeline: Entry[]): Entry[] {
  return [...timeline].sort(
    (a, b) =>
      a.at - b.at ||
      RANK.indexOf(a.kind) - RANK.indexOf(b.kind) ||
      (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
  );
}

function pushEntry(
  record: MockCustomerRecord,
  kind: string,
  title: string,
  detail: string | null,
  at: number,
  actorPubkey: string | null,
  sourceKind: string,
  sourceId: string,
) {
  const timeline = (record.timeline as Entry[]) ?? [];
  timeline.push({
    entryId: `${sourceKind}:${sourceId}:${kind}`,
    kind,
    title,
    detail,
    at,
    actorPubkey,
    source: { kind: sourceKind, id: sourceId },
  });
  record.timeline = sortTimeline(timeline);
}

function stamp(record: MockCustomerRecord, context: MockCustomerContext) {
  const previous = Number(record.updatedAt ?? 0);
  // A head must be strictly newer than the one it replaces.
  const at = Math.max(context.now, previous + 1);
  record.computedAt = at;
  record.updatedAt = at;
  record.updatedByPubkey = context.actorPubkey;
  record.sourceActionEventId = context.eventId;
}

function validate(action: CustomerActionBody): string | null {
  const present = (value: unknown) => value !== undefined;
  const allowed: Record<string, string[]> = {
    refresh: [],
    convert_to_client: ["note"],
    record_milestone: ["milestoneKind", "at", "title", "note", "fileRef"],
    attach_email: ["from", "subject", "date", "summary", "fileRefs"],
    attach_file: ["label", "fileRef"],
    remove_attachment: ["attachmentId"],
  };
  const required: Record<string, string[]> = {
    refresh: [],
    convert_to_client: [],
    record_milestone: ["milestoneKind", "at"],
    attach_email: ["from", "subject", "date", "summary"],
    attach_file: ["label", "fileRef"],
    remove_attachment: ["attachmentId"],
  };
  const op = action.op ?? "";
  if (!(op in allowed)) return "invalid: unknown customer record op";
  const body = action as Record<string, unknown>;
  for (const key of required[op]) {
    if (!present(body[key]))
      return "invalid: customer action: this op is missing a field it needs";
  }
  for (const key of [
    "milestoneKind",
    "at",
    "title",
    "note",
    "fileRef",
    "from",
    "subject",
    "date",
    "summary",
    "fileRefs",
    "label",
    "attachmentId",
  ]) {
    if (present(body[key]) && !allowed[op].includes(key))
      return "invalid: customer action: this op does not take one of the fields given";
  }
  if (op === "record_milestone") {
    const other = action.milestoneKind === "other";
    if (other !== present(action.title))
      return other
        ? "invalid: customer action: a milestone of kind other needs a title"
        : "invalid: customer action: only a milestone of kind other takes a title";
  }
  if (
    op === "attach_email" &&
    new TextEncoder().encode(action.summary ?? "").length > MAX_SUMMARY_BYTES
  )
    return "invalid: customer action: summary must be a short summary of at most 4 KB, not the whole email";
  return null;
}

/**
 * Applies a customer record action the way the relay would. Returns the
 * relay's refusal, or null when the action was accepted.
 */
export function applyMockCustomerAction(
  state: MockCustomerState,
  action: CustomerActionBody,
  context: MockCustomerContext,
): string | null {
  if (action.schemaVersion !== 1 || !action.partyId || !action.op)
    return "invalid: customer action has an unsupported shape.";
  const invalid = validate(action);
  if (invalid) return invalid;
  if (!context.cofounderEnabled)
    return "restricted: co-founder mode is off for this company, so the customer record is not changed";
  if (!context.isAdmin)
    return "restricted: only the owner, an admin, a Sales or Customer Success lead or Scout can change a customer record";
  const records = state.companyCustomerRecords ?? [];
  state.companyCustomerRecords = records;
  const record = records.find(
    (candidate) => candidate.partyId === action.partyId,
  );
  if (!record) return "conflict: there is no customer with that party id";
  const current = context.currentHeadEventId(record);
  if (action.expectedHeadEventId !== current)
    return `conflict: customer record changed; current head is ${current}`;

  const milestones =
    (record.milestones as Array<Record<string, unknown>>) ?? [];
  const attachments =
    (record.attachments as Array<Record<string, unknown>>) ?? [];
  record.milestones = milestones;
  record.attachments = attachments;
  const chats = record.chats as { emailCount: number };

  switch (action.op) {
    case "refresh": {
      if (context.now - Number(record.computedAt) < FRESH_SECS) return null;
      stamp(record, context);
      return null;
    }
    case "convert_to_client": {
      if (record.conversion !== null && record.conversion !== undefined)
        return null;
      record.conversion = {
        at: context.now,
        source: "owner_action",
        byPubkey: context.actorPubkey,
        actionEventId: context.eventId,
      };
      record.stage = "client";
      pushEntry(
        record,
        "converted",
        "Became a client",
        "Recorded by hand",
        context.now,
        context.actorPubkey,
        "client",
        String(record.partyId),
      );
      break;
    }
    case "record_milestone": {
      const at = Number(action.at);
      if (at > context.now + 300)
        return "invalid: a milestone cannot be in the future; record it when it happened";
      const kind = action.milestoneKind as string;
      const title = action.title?.trim() ?? null;
      if (
        milestones.some(
          (m) => m.kind === kind && m.at === at && (m.title ?? null) === title,
        )
      )
        return null;
      milestones.push({
        milestoneId: context.eventId,
        kind,
        title,
        at,
        note: action.note?.trim() ?? null,
        fileRef: action.fileRef ?? null,
        byPubkey: context.actorPubkey,
        recordedAt: context.now,
      });
      milestones.sort((a, b) => Number(a.at) - Number(b.at));
      pushEntry(
        record,
        kind === "other" ? "milestone" : kind,
        kind === "call_booked"
          ? "Call booked"
          : kind === "agreement_signed"
            ? "Agreement signed"
            : (title ?? "Milestone"),
        action.note?.trim() ?? null,
        at,
        context.actorPubkey,
        "milestone",
        context.eventId,
      );
      break;
    }
    case "attach_email": {
      const known = attachments.some((a) => {
        const email = a.email as Record<string, unknown> | null;
        return (
          email &&
          email.from === action.from &&
          email.subject === action.subject &&
          email.date === action.date
        );
      });
      if (known) return null;
      attachments.push({
        attachmentId: context.eventId,
        kind: "email",
        label: action.subject,
        fileRefs: action.fileRefs ?? [],
        email: {
          from: action.from,
          subject: action.subject,
          date: action.date,
          summary: action.summary,
        },
        addedByPubkey: context.actorPubkey,
        addedAt: context.now,
      });
      chats.emailCount += 1;
      pushEntry(
        record,
        "email",
        `Email from ${action.from}`,
        action.subject ?? null,
        Number(action.date),
        context.actorPubkey,
        "attachment",
        context.eventId,
      );
      break;
    }
    case "attach_file": {
      if (
        attachments.some(
          (a) =>
            a.kind === "file" &&
            (a.fileRefs as string[]).length === 1 &&
            (a.fileRefs as string[])[0] === action.fileRef,
        )
      )
        return null;
      attachments.push({
        attachmentId: context.eventId,
        kind: "file",
        label: action.label,
        fileRefs: [action.fileRef],
        email: null,
        addedByPubkey: context.actorPubkey,
        addedAt: context.now,
      });
      pushEntry(
        record,
        "file",
        action.label ?? "File",
        null,
        context.now,
        context.actorPubkey,
        "attachment",
        context.eventId,
      );
      break;
    }
    case "remove_attachment": {
      const index = attachments.findIndex(
        (a) => a.attachmentId === action.attachmentId,
      );
      if (index < 0) return "conflict: that attachment is not on this record";
      const [removed] = attachments.splice(index, 1);
      if (removed.kind === "email") chats.emailCount -= 1;
      record.timeline = (record.timeline as Entry[]).filter(
        (entry) =>
          entry.entryId !==
            `attachment:${String(removed.attachmentId)}:email` &&
          entry.entryId !== `attachment:${String(removed.attachmentId)}:file`,
      );
      break;
    }
    default:
      return "invalid: unknown customer record op";
  }
  stamp(record, context);
  return null;
}
