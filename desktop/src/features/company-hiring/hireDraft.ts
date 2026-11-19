import {
  COMPANY_HIRE_SCHEMA_VERSION,
  parseCompanyHireAction,
} from "./companyHireModels";
import type { HireProposal } from "@/features/company-asks/askRecords";
import type { RespondToMode } from "@/shared/api/types";

export type HireLocalConfiguration = {
  channelIds: string[];
  respondTo: RespondToMode;
  effortLevel?: string;
};

export type HireDraft = {
  proposal: HireProposal;
  /**
   * Local-only setup values. The relay HireProposal intentionally excludes
   * these because its Rust schema rejects unknown fields.
   */
  localConfiguration?: HireLocalConfiguration;
  /** Session-local picture selection; never included in the public hire ask. */
  avatarUrl?: string;
  employeePubkey?: string;
  baseHeadEventId?: string;
};

function isAvatarDraftValue(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 250_000
  ) {
    return false;
  }
  if (value.startsWith("data:image/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function getSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function storageKey(relayUrl: string, hireId: string) {
  return `company-hire:${relayUrl}:${hireId}`;
}

export function defaultHireLocalConfiguration(
  proposal: Pick<HireProposal, "introductionChannelId">,
): HireLocalConfiguration {
  return {
    channelIds: [proposal.introductionChannelId],
    respondTo: "owner-only",
  };
}

function parseLocalConfiguration(
  value: unknown,
  proposal: Pick<HireProposal, "introductionChannelId">,
): HireLocalConfiguration | null {
  if (value === undefined) return defaultHireLocalConfiguration(proposal);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const knownKeys = new Set(["channelIds", "respondTo", "effortLevel"]);
  if (
    Object.keys(record).some((key) => !knownKeys.has(key)) ||
    !Array.isArray(record.channelIds) ||
    record.channelIds.length === 0 ||
    record.channelIds.length > 32 ||
    !record.channelIds.every(
      (channelId) =>
        typeof channelId === "string" &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(channelId),
    ) ||
    new Set(record.channelIds).size !== record.channelIds.length ||
    !record.channelIds.includes(proposal.introductionChannelId) ||
    !["owner-only", "allowlist", "anyone"].includes(String(record.respondTo)) ||
    (record.effortLevel !== undefined &&
      (typeof record.effortLevel !== "string" ||
        !record.effortLevel.trim() ||
        record.effortLevel.length > 64))
  ) {
    return null;
  }
  return {
    channelIds: [...record.channelIds],
    respondTo: record.respondTo as RespondToMode,
    ...(typeof record.effortLevel === "string"
      ? { effortLevel: record.effortLevel }
      : {}),
  };
}

function splitLegacyProposal(value: unknown): {
  proposal: unknown;
  localConfiguration: unknown;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { proposal: value, localConfiguration: undefined };
  }
  const record = value as Record<string, unknown>;
  const { channelIds, respondTo, effortLevel, ...proposal } = record;
  const hasLegacyConfiguration =
    channelIds !== undefined ||
    respondTo !== undefined ||
    effortLevel !== undefined;
  return {
    proposal,
    localConfiguration: hasLegacyConfiguration
      ? { channelIds, respondTo, effortLevel }
      : undefined,
  };
}

export function readHireDraft(
  relayUrl: string | null | undefined,
  hireId: string,
): HireDraft | null {
  const storage = getSessionStorage();
  if (!relayUrl || !storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(relayUrl, hireId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    try {
      storage.removeItem(storageKey(relayUrl, hireId));
    } catch {
      return null;
    }
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    try {
      storage.removeItem(storageKey(relayUrl, hireId));
    } catch {
      return null;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const knownKeys = new Set([
    "proposal",
    "localConfiguration",
    "avatarUrl",
    "employeePubkey",
    "baseHeadEventId",
  ]);
  const split = splitLegacyProposal(record.proposal);
  const createAction = parseCompanyHireAction({
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId,
    action: "create",
    proposal: split.proposal,
  });
  const localConfiguration = createAction?.proposal
    ? parseLocalConfiguration(
        record.localConfiguration ?? split.localConfiguration,
        createAction.proposal,
      )
    : null;
  if (
    !createAction ||
    !localConfiguration ||
    Object.keys(record).some((key) => !knownKeys.has(key)) ||
    (record.avatarUrl !== undefined && !isAvatarDraftValue(record.avatarUrl)) ||
    (record.employeePubkey !== undefined &&
      (typeof record.employeePubkey !== "string" ||
        !/^[0-9a-f]{64}$/.test(record.employeePubkey))) ||
    (record.baseHeadEventId !== undefined &&
      (typeof record.baseHeadEventId !== "string" ||
        !/^[0-9a-f]{64}$/.test(record.baseHeadEventId)))
  ) {
    try {
      storage.removeItem(storageKey(relayUrl, hireId));
    } catch {
      return null;
    }
    return null;
  }
  return {
    proposal: createAction.proposal as HireProposal,
    localConfiguration,
    ...(typeof record.avatarUrl === "string"
      ? { avatarUrl: record.avatarUrl }
      : {}),
    ...(typeof record.employeePubkey === "string"
      ? { employeePubkey: record.employeePubkey }
      : {}),
    ...(typeof record.baseHeadEventId === "string"
      ? { baseHeadEventId: record.baseHeadEventId }
      : {}),
  };
}

export function writeHireDraft(
  relayUrl: string | null | undefined,
  draft: HireDraft,
) {
  const storage = getSessionStorage();
  if (!relayUrl || !storage) return false;
  try {
    storage.setItem(
      storageKey(relayUrl, draft.proposal.hireId),
      JSON.stringify(draft),
    );
    return true;
  } catch {
    return false;
  }
}

export function removeHireDraft(
  relayUrl: string | null | undefined,
  hireId: string,
) {
  const storage = getSessionStorage();
  if (!relayUrl || !storage) return;
  try {
    storage.removeItem(storageKey(relayUrl, hireId));
  } catch {
    return;
  }
}
