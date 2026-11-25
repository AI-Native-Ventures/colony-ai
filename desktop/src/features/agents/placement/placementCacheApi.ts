import { invokeTauri } from "@/shared/api/tauri";

import type { Home } from "./placementTypes";

export type PlacementCacheEntry = {
  agent: string;
  home: Home;
  generation: number;
};

/**
 * Tells the native spawn gate where the relay says agents work, so no local
 * start can run a second copy of an agent that works in the cloud.
 */
export async function setPlacementCache(
  entries: readonly PlacementCacheEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await invokeTauri("set_placement_cache", { entries });
}
