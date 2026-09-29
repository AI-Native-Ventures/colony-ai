import {
  COMPANY_HIRE_SCHEMA_VERSION,
  parseCompanyHireAction,
} from "./companyHireModels";
import type { HireProposal } from "@/features/company-asks/askRecords";

export type HireDraft = {
  proposal: HireProposal;
  employeePubkey?: string;
  baseHeadEventId?: string;
};

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
  const knownKeys = new Set(["proposal", "employeePubkey", "baseHeadEventId"]);
  const createAction = parseCompanyHireAction({
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId,
    action: "create",
    proposal: record.proposal,
  });
  if (
    !createAction ||
    Object.keys(record).some((key) => !knownKeys.has(key)) ||
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
