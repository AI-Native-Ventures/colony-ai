import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_COMPANY_ACCESS_ACTION,
  KIND_COMPANY_ACCESS_HEAD,
} from "@/shared/constants/kinds";

import {
  COMPANY_RECORD_SCHEMA_VERSION,
  PUBKEY_PATTERN,
  hasOnlyKeys,
  isObject,
  isValidRelayHead,
  oneTagValue,
  parseJson,
  pick,
  readNumber,
} from "./cofounderRecords";
import type { FunctionId } from "./cofounderRecords";

export { KIND_COMPANY_ACCESS_ACTION, KIND_COMPANY_ACCESS_HEAD };

export const ACCESS_D_TAG_PREFIX = "company:access:";
export const CAPABILITY_GAP_D_TAG_PREFIX = "company:capgap:";
export const SLOT_HIRE_D_TAG_PREFIX = "company:slot-hire:";

export type AccessCategory =
  | "whatsapp"
  | "discovery"
  | "credits"
  | "browser_login"
  | "connected_account"
  | "calendar"
  | "esign"
  | "payment_link"
  | "other";

export type AccessEntry = {
  name: string;
  category: AccessCategory;
  usedFor: string;
  /** Agent pubkeys that use it. Empty means every agent. */
  agents: string[];
  cost: string;
};

export type AccessState = "active" | "revoked";

export type AccessHead = {
  accessId: string;
  entry: AccessEntry;
  state: AccessState;
  grantedByPubkey: string;
  viaGapId: string | null;
  revokedByPubkey: string | null;
  revokeReason: string | null;
  eventId: string;
};

export type GapOption = {
  name: string;
  costText: string;
  costCents: number;
  recurring: boolean;
  works: boolean;
  note: string | null;
};

export type CapabilityGap = {
  title: string;
  need: string;
  options: GapOption[];
  chosen: number;
  chosenReason: string | null;
  humanStep: string;
  pageUrl: string | null;
  accessId: string;
  access: AccessEntry;
};

export type GapState =
  | "proposed"
  | "approved"
  | "human_done"
  | "completed"
  | "declined";

export type CapabilityGapHead = {
  gapId: string;
  gap: CapabilityGap;
  state: GapState;
  proposedByPubkey: string;
  proposedAt: number;
  approvedCostCents: number | null;
  eventId: string;
};

export type SlotHireHead = {
  hireId: string;
  functionId: FunctionId;
  eventId: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const ACCESS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ACCESS_CATEGORIES = new Set<string>([
  "whatsapp",
  "discovery",
  "credits",
  "browser_login",
  "connected_account",
  "calendar",
  "esign",
  "payment_link",
  "other",
]);
const GAP_STATES = new Set<string>([
  "proposed",
  "approved",
  "human_done",
  "completed",
  "declined",
]);
const FUNCTIONS = new Set<string>([
  "sales",
  "operations",
  "customer_success",
  "finance",
  "brand",
]);

/** Colony-run tools the relay itself gates. They are active until revoked. */
export const BUILTIN_ACCESS: Record<string, AccessEntry> = {
  whatsapp: {
    name: "WhatsApp business number",
    category: "whatsapp",
    usedFor: "Outreach and replies",
    agents: [],
    cost: "About R0.62 per new chat",
  },
  discovery: {
    name: "Discovery",
    category: "discovery",
    usedFor: "Finding leads",
    agents: [],
    cost: "Covered by subscription",
  },
  credits: {
    name: "Colony credits",
    category: "credits",
    usedFor: "AI work for agents",
    agents: [],
    cost: "Uses your credits",
  },
};

export function accessDTag(accessId: string): string {
  return `${ACCESS_D_TAG_PREFIX}${accessId}`;
}

export function capabilityGapDTag(gapId: string): string {
  return `${CAPABILITY_GAP_D_TAG_PREFIX}${gapId}`;
}

export function slotHireDTag(hireId: string): string {
  return `${SLOT_HIRE_D_TAG_PREFIX}${hireId}`;
}

function parseEntry(value: unknown): AccessEntry | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["name", "category", "usedFor", "agents", "cost"])
  )
    return null;
  const name = pick(value, "name");
  const category = pick(value, "category");
  const usedFor = pick(value, "usedFor");
  const cost = pick(value, "cost");
  const rawAgents = pick(value, "agents");
  const agents = rawAgents === undefined ? [] : rawAgents;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    typeof category !== "string" ||
    !ACCESS_CATEGORIES.has(category) ||
    typeof usedFor !== "string" ||
    typeof cost !== "string" ||
    !Array.isArray(agents) ||
    agents.some(
      (agent) => typeof agent !== "string" || !PUBKEY_PATTERN.test(agent),
    )
  ) {
    return null;
  }
  return {
    name,
    category: category as AccessCategory,
    usedFor,
    agents: (agents as string[]).map((agent) => agent.toLowerCase()),
    cost,
  };
}

function parseOption(value: unknown): GapOption | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "name",
      "costText",
      "costCents",
      "recurring",
      "works",
      "note",
    ])
  )
    return null;
  const name = pick(value, "name");
  const costText = pick(value, "costText");
  const costCents = readNumber(value, "costCents");
  const recurring = pick(value, "recurring");
  const works = pick(value, "works");
  const note = pick(value, "note");
  if (
    typeof name !== "string" ||
    typeof costText !== "string" ||
    costCents === null ||
    typeof recurring !== "boolean" ||
    typeof works !== "boolean" ||
    (note != null && typeof note !== "string")
  ) {
    return null;
  }
  return {
    name,
    costText,
    costCents,
    recurring,
    works,
    note: typeof note === "string" ? note : null,
  };
}

function parseGap(value: unknown): CapabilityGap | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "title",
      "need",
      "options",
      "chosen",
      "chosenReason",
      "humanStep",
      "pageUrl",
      "accessId",
      "access",
    ])
  )
    return null;
  const title = pick(value, "title");
  const need = pick(value, "need");
  const rawOptions = pick(value, "options");
  const chosen = readNumber(value, "chosen");
  const chosenReason = pick(value, "chosenReason");
  const humanStep = pick(value, "humanStep");
  const pageUrl = pick(value, "pageUrl");
  const accessId = pick(value, "accessId");
  const access = parseEntry(pick(value, "access"));
  if (
    typeof title !== "string" ||
    typeof need !== "string" ||
    !Array.isArray(rawOptions) ||
    rawOptions.length === 0 ||
    chosen === null ||
    chosen >= rawOptions.length ||
    (chosenReason != null && typeof chosenReason !== "string") ||
    typeof humanStep !== "string" ||
    (pageUrl != null &&
      (typeof pageUrl !== "string" || !pageUrl.startsWith("https://"))) ||
    typeof accessId !== "string" ||
    !ACCESS_ID_PATTERN.test(accessId) ||
    !access
  ) {
    return null;
  }
  const options = rawOptions.map(parseOption);
  if (options.some((option) => option === null)) return null;
  return {
    title,
    need,
    options: options as GapOption[],
    chosen,
    chosenReason: typeof chosenReason === "string" ? chosenReason : null,
    humanStep,
    pageUrl: typeof pageUrl === "string" ? pageUrl : null,
    accessId,
    access,
  };
}

export function parseAccessHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): AccessHead | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_COMPANY_ACCESS_HEAD))
    return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(ACCESS_D_TAG_PREFIX)) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "accessId",
      "entry",
      "state",
      "grantedByPubkey",
      "grantedAt",
      "viaGapId",
      "revokedByPubkey",
      "revokedAt",
      "revokeReason",
      "updatedAt",
    ])
  )
    return null;
  const accessId = pick(content, "accessId");
  const entry = parseEntry(pick(content, "entry"));
  const state = pick(content, "state");
  const grantedByPubkey = pick(content, "grantedByPubkey");
  const viaGapId = pick(content, "viaGapId");
  const revokedByPubkey = pick(content, "revokedByPubkey");
  const revokeReason = pick(content, "revokeReason");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    typeof accessId !== "string" ||
    dTag !== accessDTag(accessId) ||
    !entry ||
    (state !== "active" && state !== "revoked") ||
    typeof grantedByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(grantedByPubkey) ||
    readNumber(content, "grantedAt") === null ||
    readNumber(content, "updatedAt") === null ||
    (viaGapId != null &&
      (typeof viaGapId !== "string" || !UUID_PATTERN.test(viaGapId))) ||
    (state === "revoked" &&
      (typeof revokedByPubkey !== "string" ||
        !PUBKEY_PATTERN.test(revokedByPubkey) ||
        readNumber(content, "revokedAt") === null)) ||
    (state === "active" && (revokedByPubkey != null || revokeReason != null)) ||
    (revokeReason != null && typeof revokeReason !== "string")
  ) {
    return null;
  }
  return {
    accessId,
    entry,
    state,
    grantedByPubkey: grantedByPubkey.toLowerCase(),
    viaGapId: typeof viaGapId === "string" ? viaGapId : null,
    revokedByPubkey:
      typeof revokedByPubkey === "string"
        ? revokedByPubkey.toLowerCase()
        : null,
    revokeReason: typeof revokeReason === "string" ? revokeReason : null,
    eventId: event.id,
  };
}

export function parseCapabilityGapHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): CapabilityGapHead | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_COMPANY_ACCESS_HEAD))
    return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(CAPABILITY_GAP_D_TAG_PREFIX)) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "gapId",
      "gap",
      "state",
      "proposedByPubkey",
      "proposedAt",
      "approvedByPubkey",
      "approvedAt",
      "approvedCostCents",
      "humanDoneAt",
      "completedAt",
      "declinedReason",
      "updatedAt",
    ])
  )
    return null;
  const gapId = pick(content, "gapId");
  const gap = parseGap(pick(content, "gap"));
  const state = pick(content, "state");
  const proposedByPubkey = pick(content, "proposedByPubkey");
  const proposedAt = readNumber(content, "proposedAt");
  const approvedCostCents =
    pick(content, "approvedCostCents") == null
      ? null
      : readNumber(content, "approvedCostCents");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    typeof gapId !== "string" ||
    !UUID_PATTERN.test(gapId) ||
    dTag !== capabilityGapDTag(gapId) ||
    !gap ||
    typeof state !== "string" ||
    !GAP_STATES.has(state) ||
    typeof proposedByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(proposedByPubkey) ||
    proposedAt === null ||
    readNumber(content, "updatedAt") === null ||
    (pick(content, "approvedCostCents") != null && approvedCostCents === null)
  ) {
    return null;
  }
  return {
    gapId,
    gap,
    state: state as GapState,
    proposedByPubkey: proposedByPubkey.toLowerCase(),
    proposedAt,
    approvedCostCents,
    eventId: event.id,
  };
}

export function parseSlotHireHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): SlotHireHead | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_COMPANY_ACCESS_HEAD))
    return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(SLOT_HIRE_D_TAG_PREFIX)) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "hireId",
      "function",
      "setByPubkey",
      "updatedAt",
    ])
  )
    return null;
  const hireId = pick(content, "hireId");
  const functionId = pick(content, "function");
  const setByPubkey = pick(content, "setByPubkey");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    typeof hireId !== "string" ||
    !UUID_PATTERN.test(hireId) ||
    dTag !== slotHireDTag(hireId) ||
    typeof functionId !== "string" ||
    !FUNCTIONS.has(functionId) ||
    typeof setByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(setByPubkey) ||
    readNumber(content, "updatedAt") === null
  ) {
    return null;
  }
  return { hireId, functionId: functionId as FunctionId, eventId: event.id };
}

export type AccessRow = {
  accessId: string;
  entry: AccessEntry;
  state: AccessState;
  builtin: boolean;
  /** Head event id, or null for a built-in tool nobody has revoked. */
  headEventId: string | null;
  revokeReason: string | null;
};

const BUILTIN_ORDER = ["whatsapp", "discovery", "credits"] as const;

/**
 * The access list: WhatsApp, Discovery and credits always, active until a head
 * says revoked, then every other entry by access id.
 */
export function buildAccessRows(heads: readonly AccessHead[]): AccessRow[] {
  const byId = new Map(heads.map((head) => [head.accessId, head] as const));
  const rows: AccessRow[] = BUILTIN_ORDER.map((accessId) => {
    const head = byId.get(accessId);
    return head
      ? {
          accessId,
          entry: head.entry,
          state: head.state,
          builtin: true,
          headEventId: head.eventId,
          revokeReason: head.revokeReason,
        }
      : {
          accessId,
          entry: BUILTIN_ACCESS[accessId],
          state: "active",
          builtin: true,
          headEventId: null,
          revokeReason: null,
        };
  });
  const others = heads
    .filter(
      (head) => !(BUILTIN_ORDER as readonly string[]).includes(head.accessId),
    )
    .sort((first, second) => first.accessId.localeCompare(second.accessId));
  for (const head of others) {
    rows.push({
      accessId: head.accessId,
      entry: head.entry,
      state: head.state,
      builtin: false,
      headEventId: head.eventId,
      revokeReason: head.revokeReason,
    });
  }
  return rows;
}

export type GapNeedsYouItem = {
  /** `approve`: the owner approves the stated cost. `do`: the one human step. */
  group: "approve" | "do";
  gapId: string;
  title: string;
  detail: string;
  /** Stated cost of the option Scout picked, in plain words. */
  costText: string;
  free: boolean;
  humanStep: string;
  /** The exact https page the built-in browser opens. */
  pageUrl: string | null;
  proposedByPubkey: string;
  headEventId: string;
};

/**
 * Capability gaps that need the owner: a proposed gap waits for cost approval
 * (approve), an approved gap waits for the human step (do). Finished, declined
 * and "done, Scout is finishing" gaps are not listed.
 */
export function buildGapNeedsYouItems(
  gaps: readonly CapabilityGapHead[],
): GapNeedsYouItem[] {
  return gaps
    .filter((head) => head.state === "proposed" || head.state === "approved")
    .sort(
      (first, second) =>
        second.proposedAt - first.proposedAt ||
        first.gapId.localeCompare(second.gapId),
    )
    .map((head) => {
      const chosen = head.gap.options[head.gap.chosen];
      return {
        group: head.state === "proposed" ? "approve" : "do",
        gapId: head.gapId,
        title: head.gap.title,
        detail: head.gap.need,
        costText: chosen?.costText ?? "",
        free: (chosen?.costCents ?? 1) === 0,
        humanStep: head.gap.humanStep,
        pageUrl: head.gap.pageUrl,
        proposedByPubkey: head.proposedByPubkey,
        headEventId: head.eventId,
      };
    });
}

export type AccessActionInput =
  | {
      op: "revoke";
      accessId: string;
      reason?: string;
      expectedHeadEventId: string | null;
    }
  | {
      op: "gap_approve" | "gap_done" | "gap_decline";
      gapId: string;
      reason?: string;
      expectedHeadEventId: string;
    }
  | {
      op: "slot_hire_set";
      hireId: string;
      functionId: FunctionId;
      expectedHeadEventId: string | null;
    };

/** The signed-event content and d-tag for one access, gap or slot hire write. */
export function buildAccessActionEvent(input: AccessActionInput): {
  content: string;
  tags: string[][];
} {
  const base = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    op: input.op,
    ...(input.expectedHeadEventId
      ? { expectedHeadEventId: input.expectedHeadEventId }
      : {}),
  };
  if (input.op === "revoke") {
    return {
      content: JSON.stringify({
        ...base,
        accessId: input.accessId,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
      tags: [["d", accessDTag(input.accessId)]],
    };
  }
  if (input.op === "slot_hire_set") {
    return {
      content: JSON.stringify({
        ...base,
        hireId: input.hireId,
        function: input.functionId,
      }),
      tags: [["d", slotHireDTag(input.hireId)]],
    };
  }
  return {
    content: JSON.stringify({
      ...base,
      gapId: input.gapId,
      ...(input.reason ? { reason: input.reason } : {}),
    }),
    tags: [["d", capabilityGapDTag(input.gapId)]],
  };
}
