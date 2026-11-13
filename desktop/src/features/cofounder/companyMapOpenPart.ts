import { useSyncExternalStore } from "react";

import type { FunctionId } from "./cofounderRecords";

let openPart: FunctionId | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): FunctionId | null {
  return openPart;
}

/** The currently open desktop map part, shared with the map-home top bar. */
export function useCompanyMapOpenPart(): FunctionId | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** Open or close the map arm without changing the route. */
export function setCompanyMapOpenPart(part: FunctionId | null): void {
  if (openPart === part) return;
  openPart = part;
  for (const listener of listeners) listener();
}

/** Community-switch reset, registered in resetCommunityState(). */
export function resetCompanyMapOpenPart(): void {
  setCompanyMapOpenPart(null);
}
