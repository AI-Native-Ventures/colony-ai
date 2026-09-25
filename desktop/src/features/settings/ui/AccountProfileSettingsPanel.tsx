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
import { SettingsOptionGroup } from "./SettingsOptionGroup";
import type { SettingsSection } from "./SettingsPanels";

type AccountProfileSettingsPanelProps = {
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
    if (!displayName || displayName === profileName) return;

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
      <header className="mb-12 flex min-h-8 items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Your account</h1>
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

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[1.65fr_1fr]">
        <SettingsOptionGroup
          className="min-w-0"
          data-testid="settings-account-profile-card"
          title="Your profile"
        >
          <form onSubmit={saveProfile}>
            <div className="space-y-3 px-4 py-4">
              <div className="space-y-1.5">
                <label
                  className="block text-xs font-semibold"
                  htmlFor="account-profile-name"
                >
                  Name
                </label>
                <Input
                  autoComplete="name"
                  className="h-10 text-sm"
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

              <div className="space-y-1.5">
                <label
                  className="block text-xs font-semibold"
                  htmlFor="account-profile-email"
                >
                  Email address
                </label>
                <Input
                  autoComplete="email"
                  className="h-10 text-sm"
                  data-testid="account-profile-email"
                  id="account-profile-email"
                  readOnly
                  value={accountQuery.data?.email ?? ""}
                />
                <button
                  className="pt-1 text-left text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="account-change-email"
                  onClick={() => onSectionChange("security")}
                  type="button"
                >
                  Change your sign-in email
                </button>
              </div>

              <div className="space-y-1.5">
                <label
                  className="block text-xs font-semibold"
                  htmlFor="account-profile-status"
                >
                  Status
                </label>
                <Input
                  className="h-10 text-sm"
                  data-testid="account-profile-status"
                  id="account-profile-status"
                  readOnly
                  value={accountStatusLabel(status)}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="block text-xs font-semibold"
                  htmlFor="account-profile-timezone"
                >
                  Timezone
                </label>
                <Input
                  className="h-10 text-sm"
                  data-testid="account-profile-timezone"
                  id="account-profile-timezone"
                  readOnly
                  value={timezone}
                />
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
                  className="h-8 bg-[#705486] px-4 text-xs text-white hover:bg-[#604776]"
                  data-testid="account-profile-save"
                  disabled={
                    updateProfileMutation.isPending ||
                    !nameDraft.trim() ||
                    nameDraft.trim() === profileName
                  }
                  type="submit"
                >
                  Save
                </Button>
              </div>
            </div>
          </form>
        </SettingsOptionGroup>

        <SettingsOptionGroup
          className="min-w-0"
          data-testid="settings-account-business-card"
          title="This business"
        >
          <div className="space-y-4 px-4 py-4">
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
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
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-8 px-3 text-xs"
                data-testid="account-business-settings"
                onClick={() => onSectionChange("business-profile")}
                size="sm"
                variant="outline"
              >
                Business settings
              </Button>
              <Button
                className="h-8 px-3 text-xs"
                data-testid="account-business-members"
                onClick={() => onSectionChange("people")}
                size="sm"
                variant="outline"
              >
                Members &amp; roles
              </Button>
            </div>
          </div>
        </SettingsOptionGroup>
      </div>
    </section>
  );
}
