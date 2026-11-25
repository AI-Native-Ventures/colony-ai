import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { uploadCloudBundle } from "./cloudApi";
import {
  planBundleUploads,
  recordUploadResult,
  UPLOAD_RETRY_DELAYS_MS,
} from "./cloudBundleSync";
import type { BundleSyncEntry } from "./cloudBundleSync";
import { useCloudCapabilities } from "./cloudQueries";
import { usePlacements } from "./placementQueries";

/**
 * Makes every agent of this Mac cloud-ready in the background, ahead of any
 * flip (spec 5.3, owner decision of 25 Nov): when the relay says this account
 * may use cloud agents, each agent's key and config go to the relay, and go
 * again when the agent is edited. A flip from a phone with this Mac closed then
 * finds the agent ready. Mounted once in the app shell.
 *
 * A failed upload is retried a few times with a wait, then left until the agent
 * changes; the agent's own switch says "Open Colony on your Mac once to make it
 * cloud-ready" meanwhile.
 */
export function useCloudBundleSync(): void {
  const managedAgents = useManagedAgentsQuery();
  const { capabilities, available } = useCloudCapabilities();
  const agents = managedAgents.data;
  const pubkeys = React.useMemo(
    () => (agents ?? []).map((agent) => agent.pubkey),
    [agents],
  );
  const placements = usePlacements(pubkeys, { enabled: available });

  const stateRef = React.useRef(new Map<string, BundleSyncEntry>());
  const inFlightRef = React.useRef(false);
  const [kick, setKick] = React.useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `kick` re-runs the plan after a failed upload's wait
  React.useEffect(() => {
    if (!available || !agents || inFlightRef.current) return;
    const uploads = planBundleUploads({
      agents,
      placements,
      capabilities,
      state: stateRef.current,
      now: Date.now(),
    });
    if (uploads.length === 0) return;
    let cancelled = false;
    inFlightRef.current = true;
    void (async () => {
      let retryInMs: number | null = null;
      for (const upload of uploads) {
        if (cancelled) break;
        const key = normalizePubkey(upload.pubkey);
        try {
          await uploadCloudBundle({
            pubkey: upload.pubkey,
            relayReady: upload.relayReady,
            relayConfigVersion: upload.relayConfigVersion,
          });
          stateRef.current.set(
            key,
            recordUploadResult(
              stateRef.current.get(key),
              upload,
              "ok",
              Date.now(),
            ),
          );
        } catch (error) {
          console.warn(
            `[cloud] could not make ${upload.pubkey} cloud-ready`,
            error,
          );
          const entry = recordUploadResult(
            stateRef.current.get(key),
            upload,
            "failed",
            Date.now(),
          );
          stateRef.current.set(key, entry);
          if (entry.failures < UPLOAD_RETRY_DELAYS_MS.length + 1) {
            retryInMs = Math.min(
              retryInMs ?? Number.MAX_SAFE_INTEGER,
              entry.retryAt - Date.now(),
            );
          }
        }
      }
      inFlightRef.current = false;
      if (!cancelled && retryInMs !== null) {
        window.setTimeout(
          () => setKick((value) => value + 1),
          Math.max(retryInMs, 1_000),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agents, available, capabilities, placements, kick]);
}
