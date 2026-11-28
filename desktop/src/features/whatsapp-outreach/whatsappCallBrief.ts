/**
 * The call brief of a lead: what the person who phones the business needs once the lead is
 * "Ready to call". The relay stores it and checks every field; this module reads its answer,
 * builds the change a person makes, and says who a call is waiting for.
 */

/** What the person who phones a lead needs. Additive: an older relay omits it. */
export type WhatsAppCallBrief = Readonly<{
  /** Where the prepared work is. Only an `http` or `https` address is kept. */
  link: string | null;
  note: string | null;
  /** Hex pubkey of the person who will make the call. Never an agent. */
  assigneePubkey: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}>;

/** A person a call can be given to. */
export type WhatsAppCallCloser = Readonly<{
  pubkey: string;
  role: "owner" | "admin" | "member";
  name: string | null;
}>;

/** The fields of the form a person fills when a lead is ready for its call. */
export type CallBriefDraft = Readonly<{
  link: string;
  note: string;
  assigneePubkey: string;
}>;

/** The `callBrief` part of a contact update: a value sets, `null` clears, absent leaves. */
export type CallBriefChange = {
  link?: string | null;
  note?: string | null;
  assignee?: string | null;
};

/** Longest link and note the relay stores, in characters. */
export const CALL_BRIEF_MAX_CHARS = 2000;

const PUBKEY = /^[0-9a-f]{64}$/iu;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pubkey(value: unknown): string | null {
  return typeof value === "string" && PUBKEY.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * A web address that is safe to open: `http` or `https` with a host and no spaces. Anything
 * else (`javascript:`, a bare word, a mail address) is not a link.
 */
export function safeCallLink(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || /\s/u.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.length > 0 ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Reads a contact's `callBrief`. A missing, empty or unreadable brief is `null`, never an
 * error: the field is additive and must not take the contact list down with it.
 */
export function parseWhatsAppCallBrief(
  value: unknown,
): WhatsAppCallBrief | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const brief = value as Record<string, unknown>;
  const parsed: WhatsAppCallBrief = {
    link: safeCallLink(brief.link),
    note: text(brief.note),
    assigneePubkey: pubkey(brief.assigneePubkey),
    updatedBy: pubkey(brief.updatedBy),
    updatedAt: text(brief.updatedAt),
  };
  return parsed.link || parsed.note || parsed.assigneePubkey ? parsed : null;
}

/** Reads the `call_closers` answer. Rows that are not a person with a pubkey are left out. */
export function parseWhatsAppCallClosers(value: unknown): WhatsAppCallCloser[] {
  if (value === null || typeof value !== "object") {
    throw new Error("The relay returned an unreadable list of people.");
  }
  const rows = (value as { closers?: unknown }).closers;
  if (!Array.isArray(rows)) {
    throw new Error("The relay returned an unreadable list of people.");
  }
  const closers: WhatsAppCallCloser[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const candidate = row as Record<string, unknown>;
    const key = pubkey(candidate.pubkey);
    if (!key || closers.some((closer) => closer.pubkey === key)) continue;
    const role =
      candidate.role === "owner" || candidate.role === "admin"
        ? candidate.role
        : "member";
    closers.push({ pubkey: key, role, name: text(candidate.name) });
  }
  return closers;
}

/** The form as it opens for a contact: what is stored now, or empty. */
export function callBriefDraftFor(
  brief: WhatsAppCallBrief | null | undefined,
): CallBriefDraft {
  return {
    link: brief?.link ?? "",
    note: brief?.note ?? "",
    assigneePubkey: brief?.assigneePubkey ?? "",
  };
}

/**
 * The link a person typed, as the address that will be stored. People leave out `https://`,
 * so a bare address gets it. An empty field is `null` (no link).
 */
export function normalizeCallLink(
  raw: string,
): { ok: true; link: string | null } | { ok: false; reason: string } {
  const typed = raw.trim();
  if (typed.length === 0) return { ok: true, link: null };
  const reason =
    "Enter a full web address, for example https://example.com/preview.";
  const withScheme = /^[a-z][a-z0-9+.-]*:/iu.test(typed)
    ? typed
    : `https://${typed}`;
  const link = safeCallLink(withScheme);
  if (!link) return { ok: false, reason };
  // A bare word such as "preview" would otherwise become https://preview.
  const host = new URL(link).hostname;
  if (!host.includes(".") && host !== "localhost") return { ok: false, reason };
  if (link.length > CALL_BRIEF_MAX_CHARS) {
    return {
      ok: false,
      reason: `The link is longer than ${CALL_BRIEF_MAX_CHARS} characters.`,
    };
  }
  return { ok: true, link };
}

/**
 * What changed between the stored brief and the form, as the relay wants it. Only fields a
 * person actually changed are sent, so two people editing different fields do not undo each
 * other. `null` when nothing changed.
 */
export function callBriefChange(
  stored: WhatsAppCallBrief | null | undefined,
  draft: CallBriefDraft,
):
  | { ok: true; change: CallBriefChange | null }
  | { ok: false; reason: string } {
  const link = normalizeCallLink(draft.link);
  if (!link.ok) return link;
  const note = draft.note.trim();
  if (note.length > CALL_BRIEF_MAX_CHARS) {
    return {
      ok: false,
      reason: `The description is longer than ${CALL_BRIEF_MAX_CHARS} characters.`,
    };
  }
  const assignee = pubkey(draft.assigneePubkey);
  const change: CallBriefChange = {};
  if (link.link !== (stored?.link ?? null)) change.link = link.link;
  if ((note || null) !== (stored?.note ?? null)) change.note = note || null;
  if (assignee !== (stored?.assigneePubkey ?? null)) change.assignee = assignee;
  return { ok: true, change: Object.keys(change).length > 0 ? change : null };
}

/**
 * How a person is named in a list: their name, else their role in plain words. A key is never
 * shown: it tells the reader nothing.
 */
export function callCloserLabel(closer: WhatsAppCallCloser): string {
  if (closer.name) return closer.name;
  if (closer.role === "owner") return "The owner";
  return closer.role === "admin"
    ? "An admin with no name yet"
    : "A team member with no name yet";
}

/**
 * Who has the call, in words. `null` when nobody has it. A person who is no longer on the list
 * of people who can take a call still shows, so a lead never looks unassigned when it is not.
 */
export function callAssigneeName(
  brief: WhatsAppCallBrief | null | undefined,
  closers: readonly WhatsAppCallCloser[] | undefined,
  myPubkey: string | null | undefined,
): string | null {
  const assignee = brief?.assigneePubkey;
  if (!assignee) return null;
  if (myPubkey && assignee === myPubkey.toLowerCase()) return "you";
  const closer = closers?.find((candidate) => candidate.pubkey === assignee);
  return closer ? callCloserLabel(closer) : "a teammate";
}

/**
 * True when this person is the one who should phone the lead now. A lead that only asked for
 * a call waits for whoever looks. A lead that is ready to call waits for the person it was
 * given to, or for whoever looks while nobody has it.
 */
export function contactAwaitsCallFrom(
  contact: Readonly<{
    stage: string;
    callBrief?: WhatsAppCallBrief | null;
  }>,
  myPubkey: string | null | undefined,
): boolean {
  if (contact.stage === "wants_call") return true;
  if (contact.stage !== "ready_to_call") return false;
  const assignee = contact.callBrief?.assigneePubkey ?? null;
  return (
    assignee === null ||
    (typeof myPubkey === "string" && assignee === myPubkey.toLowerCase())
  );
}
