import { useEffect, useMemo } from "react";

import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useFeatureEnabled } from "@/shared/features";

import {
  readRememberedMapShellEnabled,
  resolveMapShellLaunchState,
  writeRememberedMapShellEnabled,
  type MapShellLaunchState,
} from "./mapShellLaunchState";

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
  const rememberedCofounderEnabled = scope
    ? readRememberedMapShellEnabled(scope)
    : null;

  useEffect(() => {
    if (!scope || typeof cofounderEnabled !== "boolean") return;
    writeRememberedMapShellEnabled(scope, cofounderEnabled);
  }, [cofounderEnabled, scope]);

  if (!scope) return "legacy";

  return resolveMapShellLaunchState({
    cofounderEnabled,
    mapHomeEnabled,
    rememberedCofounderEnabled,
  });
}

export function useMapShellEnabled(): boolean {
  return useMapShellLaunchState() === "map";
}
