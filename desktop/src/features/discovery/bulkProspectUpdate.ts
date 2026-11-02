import type { ProspectStage, ProspectHead } from "./businessRecordContract";

export type BulkProspectTarget =
  | { kind: "stage"; stage: ProspectStage }
  | { kind: "mark-lost" };

export type PendingBulkProspectUpdate = {
  schemaVersion: 1;
  channelId: string;
  communityId: string;
  target: BulkProspectTarget;
  prospectIds: string[];
  pendingProspectIds: string[];
  createdAt: number;
};

export type CurrentProspect = {
  eventId: string;
  record: ProspectHead;
};

export type BulkProspectUpdateStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type BulkProspectUpdateDependencies = {
  storage: BulkProspectUpdateStorage;
  loadCurrent(prospectId: string): Promise<CurrentProspect | null>;
  publish(
    current: CurrentProspect,
    target: BulkProspectTarget,
  ): Promise<unknown>;
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>;
  now(): number;
  onProgress?(done: number, total: number): void;
};

const STORAGE_PREFIX = "colony.bulkProspectUpdate.v1:";
const MAX_PROSPECTS = 500;

export function bulkProspectUpdateStorageKey(
  channelId: string,
  communityId: string,
): string {
  return `${STORAGE_PREFIX}${communityId}:${channelId}`;
}

function isTarget(value: unknown): value is BulkProspectTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  if (target.kind === "mark-lost") return true;
  return (
    target.kind === "stage" &&
    typeof target.stage === "string" &&
    ["qualified", "in_conversation", "proposal", "won", "lost"].includes(
      target.stage,
    )
  );
}

function isPendingBulkProspectUpdate(
  value: unknown,
  channelId: string,
  communityId: string,
): value is PendingBulkProspectUpdate {
  if (typeof value !== "object" || value === null) return false;
  const pending = value as Partial<PendingBulkProspectUpdate>;
  return (
    pending.schemaVersion === 1 &&
    pending.channelId === channelId &&
    pending.communityId === communityId &&
    isTarget(pending.target) &&
    Array.isArray(pending.prospectIds) &&
    pending.prospectIds.length > 0 &&
    pending.prospectIds.length <= MAX_PROSPECTS &&
    pending.prospectIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 128,
    ) &&
    Array.isArray(pending.pendingProspectIds) &&
    pending.pendingProspectIds.every(
      (id) =>
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 128 &&
        pending.prospectIds?.includes(id),
    ) &&
    typeof pending.createdAt === "number" &&
    Number.isFinite(pending.createdAt)
  );
}

export function readPendingBulkProspectUpdate(
  storage: BulkProspectUpdateStorage,
  channelId: string,
  communityId: string,
): PendingBulkProspectUpdate | null {
  const key = bulkProspectUpdateStorageKey(channelId, communityId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new Error(
      "Could not read the saved bulk update. Retry when storage is available.",
    );
  }
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "The saved bulk update could not be read. Contact support before starting another one.",
    );
  }
  if (!isPendingBulkProspectUpdate(value, channelId, communityId)) {
    throw new Error(
      "The saved bulk update is invalid. Contact support before starting another one.",
    );
  }
  return value;
}

function savePending(
  storage: BulkProspectUpdateStorage,
  key: string,
  pending: PendingBulkProspectUpdate,
): void {
  try {
    storage.setItem(key, JSON.stringify(pending));
  } catch {
    throw new Error(
      "Could not save a retry record. No bulk changes were started.",
    );
  }
}

function sameIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function sameTarget(
  left: BulkProspectTarget,
  right: BulkProspectTarget,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "mark-lost" ||
      (right.kind === "stage" && left.stage === right.stage))
  );
}

function targetAlreadyApplied(
  head: ProspectHead,
  target: BulkProspectTarget,
): boolean {
  const prospect = head.prospect;
  if (target.kind === "mark-lost") {
    return (
      prospect.stage === "lost" &&
      prospect.qualification === "not_fit" &&
      prospect.lostReason === "Not a fit"
    );
  }
  return (
    prospect.stage === target.stage && prospect.qualification === "qualified"
  );
}

/**
 * Applies one multi-lead stage action with a durable resume journal. Each lead
 * remains a separate relay event, so the journal records the remaining ids
 * before this function publishes any of them.
 */
export async function applyBulkProspectUpdate(
  input: {
    channelId: string;
    communityId: string;
    prospectIds: string[];
    target: BulkProspectTarget;
  },
  dependencies: BulkProspectUpdateDependencies,
): Promise<void> {
  const ids = [...new Set(input.prospectIds)];
  if (
    !input.channelId ||
    !input.communityId ||
    ids.length === 0 ||
    ids.length > MAX_PROSPECTS ||
    ids.some((id) => !id || id.length > 128) ||
    !isTarget(input.target)
  ) {
    throw new Error(
      "Select between 1 and 500 valid leads before changing their stage.",
    );
  }

  const key = bulkProspectUpdateStorageKey(input.channelId, input.communityId);
  await dependencies.exclusive(key, async () => {
    let pending = readPendingBulkProspectUpdate(
      dependencies.storage,
      input.channelId,
      input.communityId,
    );
    if (pending && pending.pendingProspectIds.length === 0) {
      try {
        dependencies.storage.removeItem(key);
      } catch {
        // The empty journal is a durable completion marker and safe to reuse.
      }
      pending = null;
    }
    if (pending) {
      if (
        !sameIds(pending.prospectIds, ids) ||
        !sameTarget(pending.target, input.target)
      ) {
        throw new Error(
          `Finish the saved update for ${pending.pendingProspectIds.length} leads before starting another bulk stage change.`,
        );
      }
    } else {
      pending = {
        schemaVersion: 1,
        channelId: input.channelId,
        communityId: input.communityId,
        target: input.target,
        prospectIds: ids,
        pendingProspectIds: ids,
        createdAt: dependencies.now(),
      };
      savePending(dependencies.storage, key, pending);
    }

    const total = pending.prospectIds.length;
    dependencies.onProgress?.(total - pending.pendingProspectIds.length, total);
    for (const prospectId of [...pending.pendingProspectIds]) {
      const current = await dependencies.loadCurrent(prospectId);
      if (!current) {
        throw new Error(
          `Lead ${prospectId} is unavailable. The update is saved and can be retried.`,
        );
      }
      if (!targetAlreadyApplied(current.record, pending.target)) {
        await dependencies.publish(current, pending.target);
      }
      pending = {
        ...pending,
        pendingProspectIds: pending.pendingProspectIds.filter(
          (id) => id !== prospectId,
        ),
      };
      savePending(dependencies.storage, key, pending);
      dependencies.onProgress?.(
        total - pending.pendingProspectIds.length,
        total,
      );
    }

    try {
      dependencies.storage.removeItem(key);
    } catch {
      // The persisted empty journal proves completion and is safe to reuse.
    }
  });
}
