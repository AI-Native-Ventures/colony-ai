/**
 * Community-scoped singleton holder for the real discovery runner. Kept free of
 * heavy imports so `resetCommunityState()` can call it (AGENTS.md "Community
 * Switching": every module-level community-scoped singleton needs a reset).
 */

let dispose: (() => void) | null = null;

/** Remembers how to stop the runner that belongs to the active community. */
export function registerDiscoveryRuntime(stop: () => void): void {
  dispose?.();
  dispose = stop;
}

/** Stops the active community's runner. Called when the community changes. */
export function resetDiscoveryRuntime(): void {
  const stop = dispose;
  dispose = null;
  stop?.();
}
