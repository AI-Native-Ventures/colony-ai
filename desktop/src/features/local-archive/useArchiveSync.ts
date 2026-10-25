import * as React from "react";

import {
  announceArchiveSyncEpoch,
  nextArchiveSyncLease,
  startArchiveSync,
  stopArchiveSync,
} from "@/shared/api/tauriArchive";

/**
 * This realm's epoch, announced once at first use.
 *
 * Per-realm, NOT per-effect: the epoch's whole job is to order successive
 * realms, so minting one per effect would make it order announcements instead
 * and leave remounts inside a realm racing exactly as before. Memoizing the
 * promise also means a remount cannot overtake its own predecessor's
 * announcement.
 */
let realmEpoch: Promise<number> | null = null;

function archiveSyncEpoch(): Promise<number> {
  // Clear on failure so a remount can retry; a cached rejection would make one
  // transient IPC error permanent for the life of the realm.
  realmEpoch ??= announceArchiveSyncEpoch().catch((err: unknown) => {
    realmEpoch = null;
    throw err;
  });
  return realmEpoch;
}

/**
 * Starts the native archive sync task once `ready` is true and stops it on
 * unmount.
 *
 * The `ready` gate is load-bearing and cannot move into the backend: kind
 * 24200 is relay-ephemeral, so frames emitted before the listener opens are
 * permanently lost. Observer reconciliation must have seeded kind 24200 into
 * the saved subscription before any listener opens, and only the renderer
 * knows when that finished. The backend task is therefore not self-starting.
 *
 * Everything below this call — subscribing, buffering, batching, archiving —
 * now runs in Rust; the renderer sees no archive traffic at all.
 *
 * `(epoch, lease)` orders every lifecycle command: the epoch
 * is minted by Rust and survives renderer reload (a reload resets the JS lease
 * counter but not the backend's mark), and the lease orders effects inside one
 * realm. The epoch must be resolved BEFORE any lifecycle command is sent — an
 * unawaited announcement is just another racing invoke.
 */
export function useArchiveSync(ready: boolean): void {
  React.useEffect(() => {
    if (!ready) return;

    const lease = nextArchiveSyncLease();
    let stopped = false;

    const started = archiveSyncEpoch()
      .then(async (epoch) => {
        // The cleanup may have run while the epoch was in flight. Issuing the
        // start now would install a task nobody owns, so record the epoch and
        // let the cleanup below stop it under the same mark.
        if (stopped) return epoch;
        await startArchiveSync(epoch, lease);
        return epoch;
      })
      .catch((err: unknown) => {
        console.warn("[useArchiveSync] start_archive_sync failed:", err);
        return null;
      });

    return () => {
      stopped = true;
      // Chained off the same promise so the stop cannot overtake its start:
      // the epoch is not knowable until the announcement resolves.
      void started
        .then(async (epoch) => {
          if (epoch === null) return;
          await stopArchiveSync(epoch, lease);
        })
        .catch((err: unknown) => {
          console.warn("[useArchiveSync] stop_archive_sync failed:", err);
        });
    };
  }, [ready]);
}
