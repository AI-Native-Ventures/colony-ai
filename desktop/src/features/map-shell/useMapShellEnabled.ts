import { useEffect, useMemo, useState } from "react";

import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useFeatureEnabled } from "@/shared/features";

import {
  mapShellCofounderEnabledStorageKey,
  readRememberedMapShellEnabled,
  resolveMapShellLaunchState,
  writeRememberedMapShellEnabled,
  type MapShellLaunchState,
} from "./mapShellLaunchState";

const MAP_SHELL_LAUNCH_TIMEOUT_MS = 8_000;

function useMapShellLaunchTimeoutFallback({
  hasRememberedCofounderSetting,
  hasResolvedCofounderSetting,
  launchKey,
}: {
  hasRememberedCofounderSetting: boolean;
  hasResolvedCofounderSetting: boolean;
  launchKey: string | null;
}): boolean {
  const [timedOutLaunchKey, setTimedOutLaunchKey] = useState<string | null>(
    null,
  );
  const shouldWait =
    launchKey !== null &&
    !hasRememberedCofounderSetting &&
    !hasResolvedCofounderSetting;

  useEffect(() => {
    if (!shouldWait || !launchKey) {
      setTimedOutLaunchKey(null);
      return;
    }

    setTimedOutLaunchKey(null);
    const timeoutId = window.setTimeout(
      () => setTimedOutLaunchKey(launchKey),
      MAP_SHELL_LAUNCH_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [launchKey, shouldWait]);

  return launchKey !== null && timedOutLaunchKey === launchKey;
}

export function useMapShellLaunchState(): MapShellLaunchState {
  const mapHomeEnabled = useFeatureEnabled("map_home");
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const scope = useMemo(
    () => (communityId && relayUrl ? { id: communityId, relayUrl } : null),
    [communityId, relayUrl],
  );
  const settings = useCofounderSettingsQuery(
    mapHomeEnabled ? communityId : null,
  );
  const cofounderEnabled = settings.data?.settings.enabled;
  const cofounderSettingsFailed = settings.isError || settings.failureCount > 0;
  const rememberedCofounderEnabled = scope
    ? readRememberedMapShellEnabled(scope)
    : null;
  const launchKey =
    mapHomeEnabled && scope ? mapShellCofounderEnabledStorageKey(scope) : null;
  const cofounderSettingsTimedOut = useMapShellLaunchTimeoutFallback({
    hasRememberedCofounderSetting: rememberedCofounderEnabled !== null,
    hasResolvedCofounderSetting:
      typeof cofounderEnabled === "boolean" || cofounderSettingsFailed,
    launchKey,
  });

  useEffect(() => {
    if (!scope || typeof cofounderEnabled !== "boolean") return;
    writeRememberedMapShellEnabled(scope, cofounderEnabled);
  }, [cofounderEnabled, scope]);

  if (!scope) return "legacy";

  return resolveMapShellLaunchState({
    cofounderEnabled,
    cofounderSettingsError: cofounderSettingsFailed,
    cofounderSettingsTimedOut,
    mapHomeEnabled,
    rememberedCofounderEnabled,
  });
}

export function useMapShellEnabled(): boolean {
  return useMapShellLaunchState() === "map";
}
