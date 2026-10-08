import { redactRecord, redactText, redactUrl } from "./redaction.mjs";

/**
 * Bounded, redacted action log. Every record passes through the redactor
 * before it is stored, so neither memory, the UI nor a crash report can hold a
 * credential. Oldest records are dropped first and counted.
 */

export const ACTION_LOG_LIMITS = Object.freeze({
  maxEntries: 500,
  maxBytes: 256 * 1024,
  maxSummary: 300,
});

const STATUSES = new Set([
  "ok",
  "error",
  "denied",
  "confirmation_requested",
  "confirmed",
  "rejected",
  "fenced",
  "grant",
]);

const TEXT_FIELDS = [
  "grantId",
  "agentId",
  "taskId",
  "businessId",
  "tabId",
  "tool",
  "code",
];

/**
 * Reduce tool arguments to a small, non sensitive view. Typed text is never
 * stored, only its length; URLs lose credentials and token parameters.
 */
export function summarizeToolArgs(tool, args = {}) {
  const input = args && typeof args === "object" ? args : {};
  const summary = {};
  if (typeof input.tab === "string") summary.tab = input.tab.slice(0, 80);
  if (typeof input.ref === "string") summary.ref = input.ref.slice(0, 40);
  if (typeof input.url === "string") summary.url = redactUrl(input.url);
  if (tool === "browser_type") {
    summary.chars = typeof input.text === "string" ? input.text.length : 0;
    if (input.submit === true) summary.submit = true;
  }
  if (tool === "browser_select" && Array.isArray(input.values))
    summary.values = input.values.length;
  if (tool === "browser_scroll") {
    if (typeof input.direction === "string")
      summary.direction = input.direction.slice(0, 12);
    if (Number.isFinite(input.amount)) summary.amount = input.amount;
  }
  if (tool === "browser_wait") {
    for (const key of ["text", "textGone"]) {
      if (typeof input[key] === "string")
        summary[key] = redactText(input[key], 80);
    }
    if (typeof input.url === "string") summary.url = redactUrl(input.url);
    if (Number.isFinite(input.timeoutMs)) summary.timeoutMs = input.timeoutMs;
  }
  if (tool === "browser_upload" && typeof input.uploadId === "string")
    summary.uploadId = input.uploadId.slice(0, 40);
  return summary;
}

export function createActionLog({
  maxEntries = ACTION_LOG_LIMITS.maxEntries,
  maxBytes = ACTION_LOG_LIMITS.maxBytes,
  now = Date.now,
} = {}) {
  const records = [];
  let bytes = 0;
  let seq = 0;
  let dropped = 0;

  function normalize(record) {
    const out = {};
    for (const field of TEXT_FIELDS) {
      const value = record?.[field];
      if (typeof value === "string") out[field] = redactText(value, 120);
    }
    out.status = STATUSES.has(record?.status) ? record.status : "error";
    out.summary = redactText(
      record?.summary ?? "",
      ACTION_LOG_LIMITS.maxSummary,
    );
    if (typeof record?.origin === "string")
      out.origin = redactUrl(record.origin);
    if (typeof record?.url === "string") out.url = redactUrl(record.url);
    if (Number.isFinite(record?.durationMs))
      out.durationMs = Math.max(0, Math.round(record.durationMs));
    if (record?.args && typeof record.args === "object")
      out.args = redactRecord(record.args);
    return out;
  }

  function append(record) {
    seq += 1;
    let entry = { seq, ts: now(), ...normalize(record) };
    let size = JSON.stringify(entry).length;
    if (size > maxBytes / 4) {
      // A single record can never evict the whole log.
      entry = {
        ...entry,
        args: { truncated: true },
        summary: entry.summary.slice(0, 80),
      };
      size = JSON.stringify(entry).length;
    }
    records.push({ entry, size });
    bytes += size;
    while (
      records.length > 1 &&
      (records.length > maxEntries || bytes > maxBytes)
    ) {
      bytes -= records.shift().size;
      dropped += 1;
    }
    return entry;
  }

  function entries({ sinceSeq = 0, limit = 100, grantId, tabId } = {}) {
    const cap = Math.max(1, Math.min(limit, maxEntries));
    return records
      .map((item) => item.entry)
      .filter((entry) => entry.seq > sinceSeq)
      .filter((entry) => grantId === undefined || entry.grantId === grantId)
      .filter((entry) => tabId === undefined || entry.tabId === tabId)
      .slice(-cap)
      .map((entry) => structuredClone(entry));
  }

  function stats() {
    return { count: records.length, bytes, dropped, lastSeq: seq };
  }

  return { append, entries, stats };
}
