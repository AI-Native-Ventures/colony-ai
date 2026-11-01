import { toast } from "sonner";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import {
  useBriefQuery,
  useOnboardingQuery,
} from "@/features/cofounder/initiativeHooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { SettingsSwitchRow } from "@/features/settings/ui/SettingsKit";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";

import { useCofounderSettingsQuery, useSetCofounderSettings } from "../hooks";
import "./cofounderPhase2.css";

export function CofounderSettingRow() {
  const { activeCommunity } = useCommunities();
  const membershipQuery = useMyRelayMembershipLookupQuery();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const setSettings = useSetCofounderSettings();
  const cofounderEnabled = settingsQuery.data?.settings.enabled === true;
  const onboardingQuery = useOnboardingQuery(cofounderEnabled);
  const briefQuery = useBriefQuery(cofounderEnabled);
  const channelsQuery = useChannelsQuery({
    enabled: cofounderEnabled,
  });
  const openDm = useOpenDmMutation();
  const { goChannel } = useAppNavigation();
  const role = membershipQuery.data?.membership?.role;
  const canChange = role === "owner" || role === "admin";
  const settings = settingsQuery.data?.settings;
  const companyName = activeCommunity?.name ?? "This company";
  const scoutPubkey = onboardingQuery.data?.head?.leadPubkey ?? null;
  const scoutProfileQuery = useUsersBatchQuery(
    scoutPubkey ? [scoutPubkey] : [],
    { enabled: cofounderEnabled && scoutPubkey !== null },
  );
  const scoutProfile = scoutPubkey
    ? scoutProfileQuery.data?.profiles[scoutPubkey.toLowerCase()]
    : undefined;
  const scoutChannel = channelsQuery.data?.find(
    (channel) =>
      channel.channelType === "dm" &&
      channel.participantPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === scoutPubkey?.toLowerCase(),
      ),
  );
  const briefHead = briefQuery.data?.head;
  const showGettingToKnowCard =
    cofounderEnabled &&
    onboardingQuery.data?.head?.status === "in_progress" &&
    briefHead?.pending == null &&
    briefHead?.confirmed == null &&
    !onboardingQuery.isError &&
    !briefQuery.isError;
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

  async function openScout() {
    if (!scoutPubkey) return;
    try {
      const channel =
        scoutChannel ?? (await openDm.mutateAsync({ pubkeys: [scoutPubkey] }));
      await goChannel(channel.id);
    } catch {
      toast.error("Could not open Scout's direct message.");
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
      {showGettingToKnowCard ? (
        <div
          className="cf-setting-cofounder-scout"
          data-testid="cofounder-scout-entry"
        >
          <ProfileAvatar
            avatarUrl={scoutProfile?.avatarUrl ?? null}
            className="size-8 text-xs shadow-none"
            iconClassName="h-4 w-4"
            label="Scout"
            shape="squircle"
            testId="cofounder-scout-avatar"
          />
          <p>
            <strong>Scout is getting to know {companyName}</strong>
            <span>
              Reading your website, leads, chats and connected tools. Scout will
              message you a short brief to check.
            </span>
          </p>
          <button
            className="cf-setting-cofounder-scout-button"
            data-testid="cofounder-open-scout"
            disabled={!scoutPubkey || openDm.isPending}
            onClick={() => void openScout()}
            type="button"
          >
            Open Scout
          </button>
        </div>
      ) : null}
    </>
  );
}
