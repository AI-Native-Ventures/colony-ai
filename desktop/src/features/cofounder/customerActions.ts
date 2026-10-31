import { COMPANY_RECORD_SCHEMA_VERSION } from "./cofounderRecords";
import { customerDTag } from "./customerRecords";
import type {
  AttachmentView,
  CustomerRecordView,
  MilestoneKind,
} from "./customerRecords";

/**
 * Mirrors `CustomerAction` in buzz-core (`company_customers.rs`): each op takes
 * only its own fields. Once a head exists every write names it as the expected
 * head; before the first head exists the field is left out.
 */
export type CustomerActionInput =
  | { op: "refresh"; partyId: string; expectedHeadEventId?: string }
  | {
      op: "convert_to_client";
      partyId: string;
      note?: string;
      expectedHeadEventId?: string;
    }
  | {
      op: "record_milestone";
      partyId: string;
      milestoneKind: MilestoneKind;
      /** Unix seconds it happened; never in the future. */
      at: number;
      /** Required for `other`, refused for the other kinds. */
      title?: string;
      note?: string;
      /** A Blossom file reference, for example the signed agreement. */
      fileRef?: string;
      expectedHeadEventId?: string;
    }
  | {
      op: "attach_email";
      partyId: string;
      from: string;
      subject: string;
      /** Unix seconds the email was sent. */
      date: number;
      /** A short summary, at most 4 KB; never the whole email. */
      summary: string;
      fileRefs?: string[];
      expectedHeadEventId?: string;
    }
  | {
      op: "attach_file";
      partyId: string;
      label: string;
      fileRef: string;
      expectedHeadEventId?: string;
    }
  | {
      op: "remove_attachment";
      partyId: string;
      attachmentId: string;
      expectedHeadEventId?: string;
    };

/** The signed event content and tags of one customer record action (kind 47069). */
export function buildCustomerActionEvent(input: CustomerActionInput): {
  content: string;
  tags: string[][];
} {
  const { op, ...fields } = input;
  const body: Record<string, unknown> = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    op,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") body[key] = value;
  }
  return {
    content: JSON.stringify(body),
    tags: [["d", customerDTag(input.partyId)]],
  };
}

/** One-tap helpers. Each names the exact head the caller saw. */
export const customerActions = {
  /** Ask the relay to recompute the record. It recomputes at most once a minute. */
  refresh: (record: CustomerRecordView): CustomerActionInput => ({
    op: "refresh",
    partyId: record.partyId,
    expectedHeadEventId: record.eventId,
  }),
  /** Create the record of a business that has none yet (no expected head). */
  create: (partyId: string): CustomerActionInput => ({
    op: "refresh",
    partyId,
  }),
  convertToClient: (
    record: CustomerRecordView,
    note?: string,
  ): CustomerActionInput => ({
    op: "convert_to_client",
    partyId: record.partyId,
    note,
    expectedHeadEventId: record.eventId,
  }),
  recordMilestone: (
    record: CustomerRecordView,
    milestone: {
      milestoneKind: MilestoneKind;
      at: number;
      title?: string;
      note?: string;
      fileRef?: string;
    },
  ): CustomerActionInput => ({
    op: "record_milestone",
    partyId: record.partyId,
    ...milestone,
    expectedHeadEventId: record.eventId,
  }),
  attachEmail: (
    record: CustomerRecordView,
    email: {
      from: string;
      subject: string;
      date: number;
      summary: string;
      fileRefs?: string[];
    },
  ): CustomerActionInput => ({
    op: "attach_email",
    partyId: record.partyId,
    ...email,
    expectedHeadEventId: record.eventId,
  }),
  attachFile: (
    record: CustomerRecordView,
    file: { label: string; fileRef: string },
  ): CustomerActionInput => ({
    op: "attach_file",
    partyId: record.partyId,
    ...file,
    expectedHeadEventId: record.eventId,
  }),
  removeAttachment: (
    record: CustomerRecordView,
    attachment: Pick<AttachmentView, "attachmentId">,
  ): CustomerActionInput => ({
    op: "remove_attachment",
    partyId: record.partyId,
    attachmentId: attachment.attachmentId,
    expectedHeadEventId: record.eventId,
  }),
};
