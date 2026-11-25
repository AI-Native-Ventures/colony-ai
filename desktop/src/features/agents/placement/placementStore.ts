import { normalizePubkey } from "@/shared/lib/pubkey";

import { MAC_PLACEMENT } from "./placementTypes";
import type { AgentPlacement } from "./placementTypes";

/**
 * What the relay last said about where each agent works, for the code that is
 * not a React component: the start paths (mention reconciler, detached wake,
 * Try again) must never start a local copy of an agent that works in the
 * cloud (spec 5.2, anti-goal 1), and they cannot wait for a render to know.
 *
 * Community scoped: `resetPlacementStore` is wired into `resetCommunityState`.
 */
const placements = new Map<string, AgentPlacement>();

export type PlacementChange = {
  pubkey: string;
  before: AgentPlacement;
  after: AgentPlacement;
};
type Listener = (changes: PlacementChange[]) => void;
const listeners = new Set<Listener>();
const versionListeners = new Set<() => void>();
let version = 0;

function bump() {
  version += 1;
  for (const listener of [...versionListeners]) listener();
}

/** `useSyncExternalStore` seam: a number that changes with every update. */
export function getPlacementsVersion(): number {
  return version;
}

export function subscribePlacementsVersion(listener: () => void): () => void {
  versionListeners.add(listener);
  return () => {
    versionListeners.delete(listener);
  };
}

function same(first: AgentPlacement, second: AgentPlacement) {
  return (
    first.home === second.home &&
    first.generation === second.generation &&
    first.status === second.status &&
    first.cloudReady === second.cloudReady &&
    first.cloudModel === second.cloudModel &&
    first.configVersion === second.configVersion
  );
}

/** The placement of an agent; a Mac placement at generation 0 when unknown. */
export function getPlacement(agentPubkey: string): AgentPlacement {
  return placements.get(normalizePubkey(agentPubkey)) ?? MAC_PLACEMENT;
}

/** Whether the relay places this agent in the cloud. */
export function isCloudPlaced(agentPubkey: string): boolean {
  return getPlacement(agentPubkey).home === "cloud";
}

/**
 * Takes the heads a read found. A head older than the one already known is
 * dropped (a slow read must not undo a flip): generation decides, and the same
 * generation only refreshes status.
 */
export function applyPlacements(next: ReadonlyMap<string, AgentPlacement>) {
  const changes: PlacementChange[] = [];
  for (const [rawPubkey, placement] of next) {
    const pubkey = normalizePubkey(rawPubkey);
    const before = placements.get(pubkey) ?? MAC_PLACEMENT;
    if (placement.generation < before.generation) continue;
    if (placements.has(pubkey) && same(before, placement)) continue;
    placements.set(pubkey, placement);
    changes.push({ pubkey, before, after: placement });
  }
  if (changes.length === 0) return;
  bump();
  for (const listener of [...listeners]) listener(changes);
}

/** Calls `listener` with every change. Returns the unsubscribe. */
export function subscribePlacements(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The community changed: nothing known about its agents carries over. */
export function resetPlacementStore() {
  if (placements.size === 0) return;
  placements.clear();
  bump();
}
