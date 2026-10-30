import { toast } from "sonner";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useChannelsQuery } from "@/features/channels/hooks";
import { SettingsSwitchRow } from "@/features/settings/ui/SettingsKit";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";

import { useCofounderSettingsQuery, useSetCofounderSettings } from "../hooks";
import "./cofounderPhase2.css";

export function CofounderSettingRow() {
  const { activeCommunity } = useCommunities();
  const membershipQuery = useMyRelayMembershipLookupQuery();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const setSettings = useSetCofounderSettings();
  const channelsQuery = useChannelsQuery({
    enabled: settingsQuery.data?.settings.enabled === true,
  });
  const { goChannel } = useAppNavigation();
  const role = membershipQuery.data?.membership?.role;
  const canChange = role === "owner" || role === "admin";
  const settings = settingsQuery.data?.settings;
  const companyName = activeCommunity?.name ?? "This company";
  const scoutChannel = channelsQuery.data?.find(
    (channel) =>
      channel.channelType === "dm" &&
      channel.name.trim().toLocaleLowerCase() === "scout",
  );
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
    <>
      <SettingsSwitchRow
        checked={settings?.enabled ?? false}
        disabled={disabled}
        help={
          <>
            <span>
              Scout runs {companyName} with you as Chief of Staff. It plans
              work, hires and briefs agents, and asks before anything goes out,
              costs money or carries your brand.
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
      {settings?.enabled ? (
        <div
          className="cf-setting-cofounder-scout"
          data-testid="cofounder-scout-entry"
        >
          <span aria-hidden="true" className="cf-setting-cofounder-scout-mark">
            S
          </span>
          <p>
            <strong>
              Scout is reading what Colony knows about {companyName}
            </strong>
            <span>
              Website, leads, chats and connected tools. Scout will message you
              with a short brief to check.
            </span>
          </p>
          <button
            className="cf-setting-cofounder-scout-button"
            data-testid="cofounder-open-scout"
            disabled={!scoutChannel}
            onClick={() => {
              if (scoutChannel) void goChannel(scoutChannel.id);
            }}
            type="button"
          >
            Open Scout
          </button>
        </div>
      ) : null}
    </>
  );
}
