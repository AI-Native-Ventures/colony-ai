import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import { publishProspectAction } from "./businessRecordMutations";
import { loadProspectHead } from "./businessRecordRelay";
import {
  applyBulkProspectUpdate,
  readPendingBulkProspectUpdate,
  type BulkProspectTarget,
  type PendingBulkProspectUpdate,
} from "./bulkProspectUpdate";
import type { ProspectStage } from "./businessRecordContract";

type BulkProspectCoordinates = {
  channelId: string;
  communityId: TenantCommunityId;
};

const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) =>
    window.localStorage.setItem(key, value),
  removeItem: (key: string) => window.localStorage.removeItem(key),
};

function exclusive<T>(key: string, run: () => Promise<T>): Promise<T> {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(`colony:${key}`, { mode: "exclusive" }, run)
    : run();
}

export function getPendingBulkProspectUpdate({
  channelId,
  communityId,
}: BulkProspectCoordinates): PendingBulkProspectUpdate | null {
  return readPendingBulkProspectUpdate(storage, channelId, communityId);
}

export async function updateProspectsStage(input: {
  channelId: string;
  communityId: TenantCommunityId;
  prospectIds: string[];
  stage: ProspectStage;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  return runUpdate(
    input,
    { kind: "stage", stage: input.stage },
    input.onProgress,
  );
}

export async function markProspectsLost(input: {
  channelId: string;
  communityId: TenantCommunityId;
  prospectIds: string[];
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  return runUpdate(input, { kind: "mark-lost" }, input.onProgress);
}

export async function resumePendingProspectUpdate(
  coordinates: BulkProspectCoordinates & {
    onProgress?: (done: number, total: number) => void;
  },
): Promise<void> {
  const pending = getPendingBulkProspectUpdate(coordinates);
  if (!pending) return;
  return runUpdate(
    {
      ...coordinates,
      prospectIds: pending.prospectIds,
    },
    pending.target,
    coordinates.onProgress,
  );
}

function runUpdate(
  input: BulkProspectCoordinates & { prospectIds: string[] },
  target: BulkProspectTarget,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  return applyBulkProspectUpdate(
    {
      ...input,
      target,
    },
    {
      storage,
      exclusive,
      now: Date.now,
      onProgress,
      loadCurrent: (prospectId) =>
        loadProspectHead(input.channelId, input.communityId, prospectId),
      publish: (current, action) => {
        const prospect = current.record.prospect;
        const stage = action.kind === "mark-lost" ? "lost" : action.stage;
        return publishProspectAction({
          channelId: input.channelId,
          communityId: input.communityId,
          current: {
            eventId: current.eventId,
            record: current.record,
          },
          changes: {
            ...prospect,
            displayName: prospect.party.displayName,
            partyType: prospect.party.partyType as "person" | "organization",
            externalIds: prospect.party.externalIds,
            qualification:
              action.kind === "mark-lost" ? "not_fit" : "qualified",
            stage,
            lostReason:
              stage === "lost"
                ? action.kind === "mark-lost"
                  ? "Not a fit"
                  : (prospect.lostReason ?? "Not a fit")
                : null,
          },
        });
      },
    },
  );
}

export function pendingBulkUpdateDescription(
  pending: PendingBulkProspectUpdate,
): string {
  const target =
    pending.target.kind === "mark-lost"
      ? "Mark as lost"
      : `Change stage to ${pending.target.stage.replaceAll("_", " ")}`;
  return `${target} for ${pending.pendingProspectIds.length} of ${pending.prospectIds.length} leads`;
}
