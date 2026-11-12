import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useFeatureEnabled } from "@/shared/features";

export function useMapShellEnabled(): boolean {
  const previewEnabled = useFeatureEnabled("map_home");
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(
    previewEnabled ? (activeCommunity?.id ?? null) : null,
  );

  return previewEnabled && settings.data?.settings.enabled === true;
}
