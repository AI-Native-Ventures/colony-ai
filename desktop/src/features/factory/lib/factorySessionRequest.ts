import type { FactoryScope } from "@/shared/api/factoryRuntime";

function scopeKey(scope: FactoryScope) {
  return [
    scope.relayUrl,
    scope.identityPubkey,
    scope.businessCommunityId,
    scope.clientChannelId ?? "",
  ].join("\u0000");
}

let pendingScopeKey: string | null = null;
const listeners = new Map<string, Set<() => void>>();

export function requestFactorySessionStart(scope: FactoryScope) {
  const key = scopeKey(scope);
  pendingScopeKey = key;
  const scopeListeners = listeners.get(key);
  if (scopeListeners?.size) {
    pendingScopeKey = null;
    for (const listener of scopeListeners) listener();
  }
}

export function subscribeFactorySessionStart(
  scope: FactoryScope,
  listener: () => void,
) {
  const key = scopeKey(scope);
  const scopeListeners = listeners.get(key) ?? new Set<() => void>();
  scopeListeners.add(listener);
  listeners.set(key, scopeListeners);
  if (pendingScopeKey === key) {
    pendingScopeKey = null;
    listener();
  }
  return () => {
    scopeListeners.delete(listener);
    if (scopeListeners.size === 0) listeners.delete(key);
  };
}

/** Clears pending UI requests and listeners when the active community changes. */
export function resetFactorySessionRequests() {
  pendingScopeKey = null;
  listeners.clear();
}
