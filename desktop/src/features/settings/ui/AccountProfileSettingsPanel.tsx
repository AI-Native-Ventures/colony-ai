import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  useProfileQuery,
  useUpdateProfileMutation,
} from "@/features/profile/hooks";
import { usePresenceQuery } from "@/features/presence/hooks";
import { getAccountAuthClient } from "@/features/onboarding/accountAuthAdapter";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { SettingsSection } from "./SettingsPanels";

type AccountProfileSettingsPanelProps = {
  avatarSaved?: boolean;
  currentPubkey?: string;
  fallbackDisplayName?: string;
  onClose?: () => void;
  onSectionChange: (section: SettingsSection) => void;
};

const accountQueryKey = ["settings-account-auth"] as const;

function accountStatusLabel(status: string | undefined) {
  switch (status) {
    case "online":
      return "Available";
    case "away":
      return "Away";
    case "offline":
      return "Offline";
    default:
      return "";
  }
}

export function AccountProfileSettingsPanel({
  avatarSaved = false,
  currentPubkey,
  fallbackDisplayName,
  onClose,
  onSectionChange,
}: AccountProfileSettingsPanelProps) {
  const profileQuery = useProfileQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const accountQuery = useQuery({
    queryKey: accountQueryKey,
    queryFn: () => getAccountAuthClient().getAccount(),
    retry: false,
    staleTime: 60_000,
  });
  const presenceQuery = usePresenceQuery(currentPubkey ? [currentPubkey] : [], {
    enabled: Boolean(currentPubkey),
  });
  const membershipQuery = useMyRelayMembershipQuery();
  const { activeCommunity } = useCommunities();
  const profileName =
    profileQuery.data?.displayName ?? fallbackDisplayName ?? "";
  const [nameDraft, setNameDraft] = React.useState(profileName);
  const dirtyRef = React.useRef(false);

  React.useEffect(() => {
    if (!dirtyRef.current) setNameDraft(profileName);
  }, [profileName]);

  const timezone = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const status = currentPubkey
    ? presenceQuery.data?.[currentPubkey.toLowerCase()]
    : undefined;
  const membershipRole = membershipQuery.data?.role;
  const roleLabel =
    membershipRole === "owner"
      ? "Owner"
      : membershipRole === "admin"
        ? "Admin"
        : membershipRole === "member"
          ? "Member"
          : "";

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = nameDraft.trim();
    if (!displayName) return;

    updateProfileMutation.mutate(
      { displayName },
      {
        onSuccess: () => {
          dirtyRef.current = false;
        },
      },
    );
  }

  return (
    <section
      aria-busy={
        profileQuery.isLoading ||
        accountQuery.isLoading ||
        membershipQuery.isLoading ||
        presenceQuery.isLoading
      }
      className="w20-account-profile min-w-0"
      data-testid="settings-profile"
      data-ready={
        !profileQuery.isLoading &&
        !accountQuery.isLoading &&
        !membershipQuery.isLoading &&
        !presenceQuery.isLoading
          ? "true"
          : "false"
      }
    >
      <header className="w20-account-profile-header mb-[62px] flex min-h-8 items-center justify-between gap-4">
        <h1 className="w20-account-page-title">Your account</h1>
        <Button
          className="h-8 px-3 text-xs"
          data-testid="settings-profile-back-to-today"
          onClick={onClose}
          size="sm"
          variant="outline"
        >
          Back to Today
        </Button>
      </header>

      <div className="grid min-w-0 grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
        <section
          className="w20-account-profile-card min-w-0 overflow-hidden rounded-[11px] border border-border/70 bg-background/70"
          data-testid="settings-account-profile-card"
        >
          <h2 className="w20-account-card-title px-6 pt-[22px]">
            Your profile
          </h2>
          <form onSubmit={saveProfile}>
            <div className="space-y-4 px-6 pb-[22px]">
              <div className="w20-account-field">
                <label
                  className="w20-account-field-label"
                  htmlFor="account-profile-name"
                >
                  Name
                </label>
                <Input
                  autoComplete="name"
                  className="w20-account-control h-10 rounded-[7px]"
                  data-testid="account-profile-name"
                  id="account-profile-name"
                  onChange={(event) => {
                    dirtyRef.current =
                      event.target.value.trim() !== profileName;
                    setNameDraft(event.target.value);
                  }}
                  value={nameDraft}
                />
              </div>

              <div className="w20-account-field">
                <label
                  className="w20-account-field-label"
                  htmlFor="account-profile-email"
                >
                  Email address
                </label>
                <Input
                  autoComplete="email"
                  className="w20-account-control h-10 rounded-[7px]"
                  data-testid="account-profile-email"
                  id="account-profile-email"
                  readOnly
                  value={accountQuery.data?.email ?? ""}
                />
                <button
                  className="w20-account-email-link pt-1 text-left font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="account-change-email"
                  onClick={() => onSectionChange("security")}
                  type="button"
                >
                  Change your sign-in email
                </button>
              </div>

              <div className="w20-account-field">
                <label
                  className="w20-account-field-label"
                  htmlFor="account-profile-status"
                >
                  Status
                </label>
                <Input
                  className="w20-account-control h-10 rounded-[7px]"
                  data-testid="account-profile-status"
                  id="account-profile-status"
                  readOnly
                  value={accountStatusLabel(status)}
                />
              </div>

              <div className="w20-account-field">
                <label
                  className="w20-account-field-label"
                  htmlFor="account-profile-timezone"
                >
                  Timezone
                </label>
                <select
                  className="w20-account-control h-10 w-full rounded-[7px] border border-input bg-background disabled:cursor-default disabled:opacity-100"
                  data-testid="account-profile-timezone"
                  disabled
                  id="account-profile-timezone"
                  value={timezone}
                >
                  <option value={timezone}>{timezone}</option>
                </select>
              </div>

              {profileQuery.error instanceof Error ||
              updateProfileMutation.error instanceof Error ? (
                <p className="text-sm text-destructive" role="alert">
                  {updateProfileMutation.error instanceof Error
                    ? updateProfileMutation.error.message
                    : profileQuery.error instanceof Error
                      ? profileQuery.error.message
                      : ""}
                </p>
              ) : null}
              {accountQuery.error instanceof Error ? (
                <p className="text-sm text-destructive" role="alert">
                  {accountQuery.error.message}
                </p>
              ) : null}

              <div className="flex justify-end pt-1">
                <Button
                  className="w20-account-save bg-[#705486] text-white hover:bg-[#604776]"
                  data-testid="account-profile-save"
                  disabled={
                    updateProfileMutation.isPending || !nameDraft.trim()
                  }
                  type="submit"
                >
                  Save
                </Button>
              </div>
            </div>
          </form>
        </section>

        <section
          className="w20-account-profile-card min-w-0 overflow-hidden rounded-[11px] border border-border/70 bg-background/70"
          data-testid="settings-account-business-card"
        >
          <h2 className="w20-account-card-title px-6 pt-[22px]">
            This business
          </h2>
          <div className="px-6 pb-6">
            <div className="mt-[18px] grid grid-cols-[145px_minmax(0,1fr)] gap-x-[18px] gap-y-[13px] text-compact leading-[1.7]">
              <span className="text-muted-foreground">Business</span>
              <span
                className="min-w-0 truncate"
                data-testid="account-business-name"
              >
                {activeCommunity?.name ?? ""}
              </span>
              <span className="text-muted-foreground">Your role</span>
              <span data-testid="account-business-role">{roleLabel}</span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                className="w20-account-card-action"
                data-testid="account-business-settings"
                onClick={() => onSectionChange("business-profile")}
                size="sm"
                variant="outline"
              >
                Business settings
              </Button>
              <Button
                className="w20-account-card-action"
                data-testid="account-business-members"
                onClick={() => onSectionChange("people")}
                size="sm"
                variant="outline"
              >
                Members &amp; roles
              </Button>
            </div>
          </div>
        </section>
      </div>
      {avatarSaved ? (
        <div
          className="my-[18px] rounded-[7px] border border-[#dceadd] bg-[#f0f7f1] px-[18px] py-[15px] text-sm text-[#54785c] dark:border-[#425845] dark:bg-[#293b31] dark:text-[#b0c9b6]"
          data-testid="profile-avatar-saved"
          role="status"
        >
          <strong className="font-semibold">Profile photo updated</strong>
        </div>
      ) : null}
    </section>
  );
}
