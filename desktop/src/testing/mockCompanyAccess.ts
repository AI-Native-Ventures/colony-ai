/**
 * Mock-relay behaviour for the access list, capability gap and slot hire
 * records (kind 30676 heads, kind 47066 actions). It mirrors the relay broker:
 * who may write what, and the gap lifecycle proposed, approved, human_done,
 * completed (or declined). The e2e bridge signs each record as the relay.
 */

export type MockCompanyAccessRecord = {
  dTag: string;
  content: Record<string, unknown>;
};

type ActionContent = {
  schemaVersion?: number;
  op?: string;
  accessId?: string;
  gapId?: string;
  hireId?: string;
  function?: string;
  entry?: Record<string, unknown>;
  gap?: Record<string, unknown>;
  reason?: string;
};

const ADMIN_OPS = new Set([
  "grant",
  "revoke",
  "gap_approve",
  "gap_decline",
  "gap_done",
]);

export const MOCK_BUILTIN_ACCESS: Record<string, Record<string, unknown>> = {
  whatsapp: {
    name: "WhatsApp business number",
    category: "whatsapp",
    usedFor: "Outreach and replies",
    cost: "About R0.62 per new chat",
  },
  discovery: {
    name: "Discovery",
    category: "discovery",
    usedFor: "Finding leads",
    cost: "Covered by subscription",
  },
  credits: {
    name: "Colony credits",
    category: "credits",
    usedFor: "AI work for agents",
    cost: "Uses your credits",
  },
};

function find(
  records: MockCompanyAccessRecord[],
  dTag: string,
): MockCompanyAccessRecord | undefined {
  return records.find((record) => record.dTag === dTag);
}

function upsert(
  records: MockCompanyAccessRecord[],
  dTag: string,
  content: Record<string, unknown>,
) {
  const existing = find(records, dTag);
  if (existing) existing.content = content;
  else records.push({ dTag, content });
}

/**
 * Applies one action to the mock records. Returns the relay's rejection text,
 * or null when the action was accepted and the records changed.
 */
export function applyMockAccessAction(
  records: MockCompanyAccessRecord[],
  rawContent: string,
  actorPubkey: string,
  actorRole: "owner" | "admin" | "member" | null | undefined,
  nowSeconds: number,
): string | null {
  let action: ActionContent;
  try {
    action = JSON.parse(rawContent) as ActionContent;
  } catch {
    return "invalid: access action is not JSON.";
  }
  if (action.schemaVersion !== 1 || typeof action.op !== "string") {
    return "invalid: access action has an unsupported shape.";
  }
  const isAdmin =
    actorRole === undefined || actorRole === "owner" || actorRole === "admin";
  if (ADMIN_OPS.has(action.op) && !isAdmin) {
    return "restricted: only the owner or an admin can change access.";
  }
  const base = { schemaVersion: 1, updatedAt: nowSeconds };

  if (action.op === "revoke") {
    const accessId = action.accessId ?? "";
    const dTag = `company:access:${accessId}`;
    const existing = find(records, dTag);
    const builtin = MOCK_BUILTIN_ACCESS[accessId];
    if (!existing && !builtin) {
      return "conflict: there is no such access entry to revoke.";
    }
    const current: Record<string, unknown> = existing?.content ?? {
      ...base,
      accessId,
      entry: builtin,
      state: "active",
      grantedByPubkey: actorPubkey,
      grantedAt: nowSeconds,
    };
    if (current.state === "revoked") {
      return "conflict: this access is already revoked.";
    }
    upsert(records, dTag, {
      ...current,
      state: "revoked",
      revokedByPubkey: actorPubkey,
      revokedAt: nowSeconds,
      ...(action.reason ? { revokeReason: action.reason } : {}),
      updatedAt: nowSeconds,
    });
    return null;
  }

  if (action.op === "grant") {
    if (!action.accessId || !action.entry) {
      return "invalid: grant needs accessId and entry.";
    }
    upsert(records, `company:access:${action.accessId}`, {
      ...base,
      accessId: action.accessId,
      entry: action.entry,
      state: "active",
      grantedByPubkey: actorPubkey,
      grantedAt: nowSeconds,
    });
    return null;
  }

  if (action.op === "gap_propose") {
    if (!action.gapId || !action.gap) {
      return "invalid: gap_propose needs gapId and gap.";
    }
    const dTag = `company:capgap:${action.gapId}`;
    if (find(records, dTag)) return "conflict: gap already exists.";
    records.push({
      dTag,
      content: {
        ...base,
        gapId: action.gapId,
        gap: action.gap,
        state: "proposed",
        proposedByPubkey: actorPubkey,
        proposedAt: nowSeconds,
      },
    });
    return null;
  }

  if (action.op === "slot_hire_set") {
    if (!action.hireId || !action.function) {
      return "invalid: slot_hire_set needs hireId and function.";
    }
    upsert(records, `company:slot-hire:${action.hireId}`, {
      ...base,
      hireId: action.hireId,
      function: action.function,
      setByPubkey: actorPubkey,
    });
    return null;
  }

  const gapOps = ["gap_approve", "gap_decline", "gap_done", "gap_complete"];
  if (!gapOps.includes(action.op)) return "invalid: unknown access op.";
  const gapRecord = find(records, `company:capgap:${action.gapId ?? ""}`);
  if (!gapRecord) return "conflict: gap does not exist.";
  const head = gapRecord.content;
  const state = head.state;
  const gap = head.gap as {
    options?: { costCents?: number }[];
    chosen?: number;
    accessId?: string;
    access?: unknown;
  };
  const stateError =
    "conflict: the gap is not in a state that accepts this step.";

  if (action.op === "gap_approve") {
    if (state !== "proposed") return stateError;
    const chosen = gap.options?.[gap.chosen ?? 0];
    gapRecord.content = {
      ...head,
      state: "approved",
      approvedByPubkey: actorPubkey,
      approvedAt: nowSeconds,
      approvedCostCents: chosen?.costCents ?? 0,
      updatedAt: nowSeconds,
    };
    return null;
  }
  if (action.op === "gap_decline") {
    if (state !== "proposed" && state !== "approved") return stateError;
    gapRecord.content = {
      ...head,
      state: "declined",
      ...(action.reason ? { declinedReason: action.reason } : {}),
      updatedAt: nowSeconds,
    };
    return null;
  }
  if (action.op === "gap_done") {
    if (state !== "approved") return stateError;
    gapRecord.content = {
      ...head,
      state: "human_done",
      humanDoneAt: nowSeconds,
      updatedAt: nowSeconds,
    };
    return null;
  }
  // gap_complete: the proposer or an admin, only after the human step.
  if (!isAdmin && head.proposedByPubkey !== actorPubkey) {
    return "restricted: only the owner, an admin or the proposer can finish the gap.";
  }
  if (state !== "human_done") {
    return "conflict: the gap needs the owner's approval and the human step first.";
  }
  gapRecord.content = {
    ...head,
    state: "completed",
    completedAt: nowSeconds,
    updatedAt: nowSeconds,
  };
  upsert(records, `company:access:${gap.accessId ?? ""}`, {
    ...base,
    accessId: gap.accessId,
    entry: gap.access,
    state: "active",
    grantedByPubkey: actorPubkey,
    grantedAt: nowSeconds,
    viaGapId: action.gapId,
  });
  return null;
}
