import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import type { CloudCapabilities } from "./cloudApi";
import type { AgentPlacement } from "./placementTypes";

/** Tries per agent setup before the sync waits for the agent to change. */
export const MAX_UPLOAD_ATTEMPTS = 3;
/** How long a landed upload is trusted before a relay that still reports the
 * agent as not cloud-ready gets it again. The head follows the upload by a
 * moment; a relay that lost the agent is topped up after this. */
export const UPLOAD_SETTLE_MS = 120_000;
/** Wait before the next try after a failed upload: 30 s, then 2 min. */
export const UPLOAD_RETRY_DELAYS_MS = [30_000, 120_000] as const;

/** What the sync remembers about one agent. */
export type BundleSyncEntry = {
  /** The agent setup the relay last accepted (or already held). */
  uploadedFingerprint: string | null;
  /** When that upload landed (ms). */
  uploadedAt: number;
  /** Failed tries for `failedFingerprint`. */
  failures: number;
  failedFingerprint: string | null;
  /** Earliest time (ms) of the next try after a failure. */
  retryAt: number;
};

export type BundleSyncState = Map<string, BundleSyncEntry>;

export type BundleUpload = {
  pubkey: string;
  fingerprint: string;
  relayReady: boolean;
  relayConfigVersion: number;
};

/** What identifies one setup of an agent: it changes when the agent is edited. */
export function agentFingerprint(agent: ManagedAgent): string {
  return agent.updatedAt;
}

export function emptySyncEntry(): BundleSyncEntry {
  return {
    uploadedFingerprint: null,
    uploadedAt: 0,
    failures: 0,
    failedFingerprint: null,
    retryAt: 0,
  };
}

/**
 * The agents to make cloud-ready now (spec 5.3): when the relay says this
 * account may use cloud agents, every agent of this Mac whose key and setup
 * the relay does not hold, or whose setup changed since it was uploaded.
 *
 * - Nothing is planned unless the relay says `enabled` and `allowed`.
 * - Only agents that run on this Mac: a provider-deployed agent has no key here.
 * - An agent the relay holds and that has not changed is left alone.
 * - A failed upload is retried a few times with a wait, then left until the
 *   agent changes: a persistent failure must not loop.
 */
export function planBundleUploads(input: {
  agents: readonly ManagedAgent[];
  placements: ReadonlyMap<string, AgentPlacement>;
  capabilities: CloudCapabilities | null | undefined;
  state: ReadonlyMap<string, BundleSyncEntry>;
  now: number;
}): BundleUpload[] {
  const { capabilities } = input;
  if (!capabilities?.enabled || !capabilities.allowed) return [];
  const uploads: BundleUpload[] = [];
  for (const agent of input.agents) {
    if (agent.backend.type !== "local") continue;
    const pubkey = normalizePubkey(agent.pubkey);
    const placement = input.placements.get(pubkey);
    const fingerprint = agentFingerprint(agent);
    const entry = input.state.get(pubkey) ?? emptySyncEntry();
    const relayReady = placement?.cloudReady ?? false;
    const current = entry.uploadedFingerprint === fingerprint;
    if (
      current &&
      (relayReady || input.now - entry.uploadedAt < UPLOAD_SETTLE_MS)
    ) {
      continue;
    }
    if (entry.failedFingerprint === fingerprint) {
      if (entry.failures >= MAX_UPLOAD_ATTEMPTS) continue;
      if (input.now < entry.retryAt) continue;
    }
    uploads.push({
      pubkey,
      fingerprint,
      relayReady,
      relayConfigVersion: placement?.configVersion ?? 0,
    });
  }
  return uploads;
}

/** Records one upload's result, returning the entry to store. */
export function recordUploadResult(
  previous: BundleSyncEntry | undefined,
  upload: BundleUpload,
  outcome: "ok" | "failed",
  now: number,
): BundleSyncEntry {
  const entry = previous ?? emptySyncEntry();
  if (outcome === "ok") {
    return {
      uploadedFingerprint: upload.fingerprint,
      uploadedAt: now,
      failures: 0,
      failedFingerprint: null,
      retryAt: 0,
    };
  }
  const failures =
    entry.failedFingerprint === upload.fingerprint ? entry.failures + 1 : 1;
  const delay =
    UPLOAD_RETRY_DELAYS_MS[
      Math.min(failures - 1, UPLOAD_RETRY_DELAYS_MS.length - 1)
    ];
  return {
    ...entry,
    failures,
    failedFingerprint: upload.fingerprint,
    retryAt: now + delay,
  };
}
