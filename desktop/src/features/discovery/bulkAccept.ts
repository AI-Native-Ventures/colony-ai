/**
 * Accepting many prospects as leads in one user action. Pure and injectable
 * (publish, sleep) so the partial-failure rules are tested without a relay.
 *
 * Rules (AGENTS.md "Review-Proven Rules" 1 and 5): a caught failure is never
 * hidden, so every row ends as accepted, already a lead, or failed with its
 * own reason; a failed row is retried a bounded number of times and then
 * reported; rows that were saved stay saved, and the failed ones stay
 * selected so the person can retry exactly those.
 */

import { isAccepted, type CampaignProspect } from "./CampaignHelpers";

export const ACCEPT_CONCURRENCY = 3;
/** Waits before the 2nd and 3rd try of one row. */
export const ACCEPT_RETRY_DELAYS_MS = [400, 1_200] as const;

export const ACCEPT_ROLE_NOTE =
  "Only members, admins and owners can accept leads. Ask an owner for access.";

export type AcceptFailure = {
  prospectId: string;
  name: string;
  message: string;
};

export type BulkAcceptResult = {
  /** Rows saved as leads by this action. */
  accepted: string[];
  /** Rows that were already leads, so left alone. */
  alreadyLeads: string[];
  failed: AcceptFailure[];
};

export type BulkAcceptProgress = { done: number; total: number };

type Row = Pick<CampaignProspect, "eventId" | "record">;

function rowName(row: Row): string {
  return row.record.prospect.party.displayName;
}

const FALLBACK_FAILURE =
  "The update could not be saved. Retry when the connection is available.";

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return FALLBACK_FAILURE;
}

/**
 * Accepts every row that is not a lead yet, `concurrency` at a time. Never
 * throws: each row's outcome is in the result. Rows already accepted are
 * skipped without a write.
 */
export async function acceptProspects<T extends Row>(input: {
  rows: readonly T[];
  publish: (row: T) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: BulkAcceptProgress) => void;
  concurrency?: number;
}): Promise<BulkAcceptResult> {
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const result: BulkAcceptResult = {
    accepted: [],
    alreadyLeads: [],
    failed: [],
  };
  const todo: T[] = [];
  const seen = new Set<string>();
  for (const row of input.rows) {
    const id = row.record.prospectId;
    if (seen.has(id)) continue;
    seen.add(id);
    if (isAccepted(row.record.prospect)) result.alreadyLeads.push(id);
    else todo.push(row);
  }

  const total = todo.length;
  let done = 0;
  const report = () => input.onProgress?.({ done, total });
  report();

  async function acceptOne(row: T): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= ACCEPT_RETRY_DELAYS_MS.length; attempt++) {
      try {
        await input.publish(row);
        result.accepted.push(row.record.prospectId);
        return;
      } catch (error) {
        lastError = error;
        const delay = ACCEPT_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await sleep(delay);
      }
    }
    result.failed.push({
      prospectId: row.record.prospectId,
      name: rowName(row),
      message: failureMessage(lastError),
    });
  }

  let next = 0;
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const row = todo[next];
      next += 1;
      if (!row) return;
      await acceptOne(row);
      done += 1;
      report();
    }
  }
  const width = Math.max(
    1,
    Math.min(input.concurrency ?? ACCEPT_CONCURRENCY, todo.length || 1),
  );
  await Promise.all(Array.from({ length: width }, () => worker()));
  return result;
}

/**
 * After the list is refreshed, a row that failed on the last try may still
 * have been saved (the write landed and only its answer was lost). Counts
 * those as accepted so the person is not asked to retry a finished row.
 */
export function reconcileAccepted(
  result: BulkAcceptResult,
  current: readonly Row[],
): BulkAcceptResult {
  const nowAccepted = new Set(
    current
      .filter((row) => isAccepted(row.record.prospect))
      .map((row) => row.record.prospectId),
  );
  const landed = result.failed.filter((failure) =>
    nowAccepted.has(failure.prospectId),
  );
  if (landed.length === 0) return result;
  return {
    accepted: [...result.accepted, ...landed.map((f) => f.prospectId)],
    alreadyLeads: result.alreadyLeads,
    failed: result.failed.filter(
      (failure) => !nowAccepted.has(failure.prospectId),
    ),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The result in plain words, for the status line under the bar. */
export function acceptSummary(result: BulkAcceptResult): string {
  const parts: string[] = [];
  const saved = result.accepted.length;
  const total = saved + result.failed.length;
  if (result.failed.length === 0) {
    parts.push(
      saved === 0
        ? "Nothing to accept."
        : `Accepted ${plural(saved, "prospect", "prospects")} as ${saved === 1 ? "a lead" : "leads"}.`,
    );
  } else {
    parts.push(`Accepted ${saved} of ${total} as leads.`);
  }
  const already = result.alreadyLeads.length;
  if (already > 0) {
    parts.push(
      already === 1
        ? "1 was already a lead."
        : `${already} were already leads.`,
    );
  }
  if (result.failed.length > 0) {
    const names = result.failed
      .slice(0, 3)
      .map((failure) => failure.name)
      .join(", ");
    const more =
      result.failed.length > 3 ? ` and ${result.failed.length - 3} more` : "";
    const reason = result.failed[0]?.message ?? FALLBACK_FAILURE;
    parts.push(
      `${plural(result.failed.length, "prospect", "prospects")} could not be saved (${names}${more}): ${reason} They stay selected, so you can accept them again.`,
    );
  }
  return parts.join(" ");
}

export type AcceptButtonState = {
  label: string;
  disabled: boolean;
  /** Why the button is grey, or what it will skip; null when nothing to say. */
  note: string | null;
};

/** The selection bar's Accept button: label, enabled state and its reason. */
export function acceptButtonState(input: {
  rows: readonly Row[];
  canWrite: boolean;
  progress: BulkAcceptProgress | null;
}): AcceptButtonState {
  if (input.progress) {
    return {
      label: `Accepting ${Math.min(input.progress.done + 1, input.progress.total)} of ${input.progress.total}…`,
      disabled: true,
      note: null,
    };
  }
  const selected = input.rows.length;
  const already = input.rows.filter((row) =>
    isAccepted(row.record.prospect),
  ).length;
  const todo = selected - already;
  if (!input.canWrite) {
    return {
      label: todo > 1 ? `Accept ${todo} as leads` : "Accept as lead",
      disabled: true,
      note: ACCEPT_ROLE_NOTE,
    };
  }
  if (todo === 0) {
    return {
      label: "Accept as lead",
      disabled: true,
      note:
        selected === 1
          ? "This prospect is already a lead."
          : `All ${selected} selected are already leads.`,
    };
  }
  return {
    label: todo === 1 ? "Accept as lead" : `Accept ${todo} as leads`,
    disabled: false,
    note:
      already === 0
        ? null
        : already === 1
          ? "1 selected is already a lead and will be skipped."
          : `${already} selected are already leads and will be skipped.`,
  };
}
