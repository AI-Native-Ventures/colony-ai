import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";

export type MapShellLaunchState = "legacy" | "loading" | "map";

export type MapShellCommunityScope = {
  id: string;
  relayUrl: string;
};

type ReadableWritableStorage = Pick<Storage, "getItem" | "setItem">;

export const MAP_SHELL_COFOUNDER_ENABLED_STORAGE_PREFIX =
  "buzz-map-shell-cofounder-enabled.v1";

export function mapShellCofounderEnabledStorageKey(
  scope: MapShellCommunityScope,
): string {
  return `${MAP_SHELL_COFOUNDER_ENABLED_STORAGE_PREFIX}:${encodeURIComponent(
    scope.id,
  )}:${encodeURIComponent(scope.relayUrl)}`;
}

function readStorageItem(
  key: string,
  storage: ReadableWritableStorage | null | undefined,
): string | null {
  if (storage === undefined) return getStorageItem(key);
  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(
  key: string,
  value: string,
  storage: ReadableWritableStorage | null | undefined,
): boolean {
  if (storage === undefined) return setStorageItem(key, value);
  if (!storage) return false;

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readRememberedMapShellEnabled(
  scope: MapShellCommunityScope,
  storage?: ReadableWritableStorage | null,
): boolean | null {
  const value = readStorageItem(
    mapShellCofounderEnabledStorageKey(scope),
    storage,
  );
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function writeRememberedMapShellEnabled(
  scope: MapShellCommunityScope,
  enabled: boolean,
  storage?: ReadableWritableStorage | null,
): boolean {
  return writeStorageItem(
    mapShellCofounderEnabledStorageKey(scope),
    enabled ? "true" : "false",
    storage,
  );
}

export function resolveMapShellLaunchState({
  cofounderEnabled,
  mapHomeEnabled,
  rememberedCofounderEnabled,
}: {
  cofounderEnabled: boolean | undefined;
  mapHomeEnabled: boolean;
  rememberedCofounderEnabled: boolean | null;
}): MapShellLaunchState {
  if (!mapHomeEnabled) return "legacy";
  if (typeof cofounderEnabled === "boolean") {
    return cofounderEnabled ? "map" : "legacy";
  }
  if (rememberedCofounderEnabled !== null) {
    return rememberedCofounderEnabled ? "map" : "legacy";
  }
  return "loading";
}
