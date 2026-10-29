import { toast } from "sonner";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { SettingsSwitchRow } from "@/features/settings/ui/SettingsKit";

import { useCofounderSettingsQuery, useSetCofounderSettings } from "../hooks";

export function CofounderSettingRow() {
  const { activeCommunity } = useCommunities();
  const membershipQuery = useMyRelayMembershipLookupQuery();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const setSettings = useSetCofounderSettings();
  const role = membershipQuery.data?.membership?.role;
  const canChange = role === "owner" || role === "admin";
  const settings = settingsQuery.data?.settings;
  const companyName = activeCommunity?.name ?? "This company";
  const disabled =
    !activeCommunity ||
    !canChange ||
    settingsQuery.isLoading ||
    settingsQuery.isError ||
    setSettings.isPending;

  async function changeEnabled(enabled: boolean) {
    if (!settings || !settingsQuery.data || !canChange) return;
    try {
      await setSettings.mutateAsync({
        settings: { ...settings, enabled },
        expectedHeadEventId: settingsQuery.data.eventId,
      });
    } catch {
      toast.error("Could not update co-founder mode.");
    }
  }

  return (
    <SettingsSwitchRow
      checked={settings?.enabled ?? false}
      disabled={disabled}
      help={
        <>
          <span>
            Scout runs {companyName} with you as Chief of Staff. It plans work,
            hires and briefs agents, and asks before anything goes out, costs
            money or carries your brand.
          </span>
          <span className="mt-1 block">
            {companyName} only · Owner and admins can switch it
          </span>
        </>
      }
      id="cofounder-mode-toggle"
      label="Co-founder mode"
      onCheckedChange={(enabled) => void changeEnabled(enabled)}
      testId="cofounder-mode-toggle"
    />
  );
}
