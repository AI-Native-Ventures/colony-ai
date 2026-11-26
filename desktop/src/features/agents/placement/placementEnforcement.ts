import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import type { PlacementChange } from "./placementStore";
import type { Home } from "./placementTypes";

export type PlacementAction = {
  pubkey: string;
  /** `stop`: the agent moved to the cloud, this Mac's copy must go.
   * `start`: it moved back, this Mac takes over. */
  action: "stop" | "start";
};

/**
 * What this Mac does about placement changes (spec 5.2).
 *
 * - A head that puts an agent in the cloud stops this Mac's harness for it.
 *   This includes the first read after launch (nothing known before): a
 *   harness left running from before is exactly the second copy to remove.
 * - A head that moves an agent from the cloud back to the Mac starts its
 *   harness. Only a change seen live counts: an agent that was already on the
 *   Mac when the app opened is started by the normal paths when a message
 *   arrives, as before.
 *
 * Only local agents of this Mac are touched.
 */
export function planPlacementActions(
  changes: readonly PlacementChange[],
  agents: readonly ManagedAgent[],
): PlacementAction[] {
  const actions: PlacementAction[] = [];
  for (const change of changes) {
    const agent = agents.find(
      (candidate) => normalizePubkey(candidate.pubkey) === change.pubkey,
    );
    if (agent?.backend.type !== "local") continue;
    if (change.after.home === "cloud" && agent.status === "running") {
      actions.push({ pubkey: change.pubkey, action: "stop" });
    } else if (
      change.after.home === "mac" &&
      change.before.home === "cloud" &&
      agent.status !== "running"
    ) {
      actions.push({ pubkey: change.pubkey, action: "start" });
    }
  }
  return actions;
}

/**
 * Whether this Mac may start an agent by hand (the profile's Start and Restart).
 * An agent homed in the cloud runs there: starting it here would make the
 * second copy that `planPlacementActions` exists to remove.
 */
export function macMayStartAgent(home: Home): boolean {
  return home !== "cloud";
}
