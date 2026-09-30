import type { CompanyRoleDraft } from "./ui/CompanyRoleFields";

export type SavedCompanyRoleDraft = {
  displayName: string;
  roleDraft: CompanyRoleDraft;
};

const volatileDrafts = new Map<string, SavedCompanyRoleDraft | null>();

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function key(relayUrl: string | null | undefined, personaId: string) {
  return relayUrl ? `company-role-draft:${relayUrl}:${personaId}` : null;
}

function isRisk(value: unknown): value is "low" | "medium" | "high" | "" {
  return (
    value === "" || value === "low" || value === "medium" || value === "high"
  );
}

function parseDraft(value: unknown): SavedCompanyRoleDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const roleDraft = record.roleDraft;
  if (
    typeof record.displayName !== "string" ||
    record.displayName.length > 180 ||
    typeof roleDraft !== "object" ||
    roleDraft === null ||
    Array.isArray(roleDraft)
  ) {
    return null;
  }
  const role = roleDraft as Record<string, unknown>;
  if (
    typeof role.job !== "string" ||
    role.job.length > 2000 ||
    typeof role.skills !== "string" ||
    role.skills.length > 4000 ||
    !Array.isArray(role.workerMenu) ||
    role.workerMenu.length > 32 ||
    !role.workerMenu.every(
      (item) => typeof item === "string" && item.length <= 120,
    ) ||
    !Array.isArray(role.tools) ||
    role.tools.length > 64
  ) {
    return null;
  }
  const tools = role.tools.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }
    const tool = item as Record<string, unknown>;
    if (
      typeof tool.id !== "string" ||
      tool.id.length > 120 ||
      typeof tool.name !== "string" ||
      tool.name.length > 120 ||
      !isRisk(tool.risk)
    ) {
      return [];
    }
    return [{ id: tool.id, name: tool.name, risk: tool.risk }];
  });
  if (tools.length !== role.tools.length) return null;
  return {
    displayName: record.displayName,
    roleDraft: {
      job: role.job,
      skills: role.skills,
      tools,
      workerMenu: [...role.workerMenu],
    },
  };
}

export function readCompanyRoleDraft(
  relayUrl: string | null | undefined,
  personaId: string,
): SavedCompanyRoleDraft | null {
  const storageValue = storage();
  const storageKey = key(relayUrl, personaId);
  if (!storageKey) return null;
  if (volatileDrafts.has(storageKey)) {
    return volatileDrafts.get(storageKey) ?? null;
  }
  if (!storageValue) return null;
  try {
    const raw = storageValue.getItem(storageKey);
    if (!raw) return null;
    const parsed = parseDraft(JSON.parse(raw) as unknown);
    if (parsed) {
      volatileDrafts.set(storageKey, parsed);
      return parsed;
    }
    storageValue.removeItem(storageKey);
    return null;
  } catch {
    return null;
  }
}

export function writeCompanyRoleDraft(
  relayUrl: string | null | undefined,
  personaId: string,
  draft: SavedCompanyRoleDraft,
) {
  const storageValue = storage();
  const storageKey = key(relayUrl, personaId);
  if (!storageKey) return false;
  volatileDrafts.set(storageKey, draft);
  if (!storageValue) return false;
  try {
    storageValue.setItem(storageKey, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeCompanyRoleDraft(
  relayUrl: string | null | undefined,
  personaId: string,
) {
  const storageValue = storage();
  const storageKey = key(relayUrl, personaId);
  if (!storageKey) return;
  volatileDrafts.set(storageKey, null);
  if (storageValue) {
    try {
      storageValue.removeItem(storageKey);
    } catch {
      return;
    }
  }
}

export function resetCompanyRoleDraftStore() {
  volatileDrafts.clear();
}
