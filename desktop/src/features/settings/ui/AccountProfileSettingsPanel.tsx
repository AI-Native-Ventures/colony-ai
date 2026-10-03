import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  useProfileQuery,
  useUpdateProfileMutation,
} from "@/features/profile/hooks";
import {
  useUserStatusQuery,
  visibleUserStatus,
} from "@/features/user-status/hooks";
import { getAccountAuthClient } from "@/features/onboarding/accountAuthAdapter";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { SettingsSection } from "./SettingsPanels";
import { AccountSettingsHeader } from "./AccountSettingsHeader";

type AccountProfileSettingsPanelProps = {
  fallbackDisplayName?: string;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
};

const accountQueryKey = ["settings-account-auth"] as const;

function roleLabel(role: string | undefined) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "member") return "Member";
  return "";
}

export function AccountProfileSettingsPanel({
  fallbackDisplayName,
  onClose,
  onSectionChange,
}: AccountProfileSettingsPanelProps) {
  const profileQuery = useProfileQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const statusQuery = useUserStatusQuery(
    identityQuery.data?.pubkey ? [identityQuery.data.pubkey] : [],
  );
  const accountQuery = useQuery({
    queryKey: accountQueryKey,
    queryFn: () => getAccountAuthClient().getAccount(),
    retry: false,
    staleTime: 60_000,
  });
  const { activeCommunity } = useCommunities();
  const profileName =
    profileQuery.data?.displayName ?? fallbackDisplayName ?? "";
  const [nameDraft, setNameDraft] = React.useState(profileName);
  const dirtyRef = React.useRef(false);
  const timeZone = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const pubkey = identityQuery.data?.pubkey?.toLowerCase() ?? "";
  const status = visibleUserStatus(statusQuery.data?.[pubkey])?.text ?? "";
  const membershipRole = roleLabel(membershipQuery.data?.role);
  const isLoading =
    profileQuery.isLoading ||
    identityQuery.isLoading ||
    membershipQuery.isLoading ||
    statusQuery.isLoading ||
    accountQuery.isLoading;

  React.useEffect(() => {
    if (!dirtyRef.current) setNameDraft(profileName);
  }, [profileName]);

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
      aria-busy={isLoading}
      className="w20-account-profile min-w-0"
      data-testid="settings-profile"
      data-ready={!isLoading ? "true" : "false"}
    >
      <AccountSettingsHeader onBackToToday={onClose} title="Profile" />

      <div className="w20-account-profile-grid">
        <section
          aria-labelledby="account-profile-title"
          className="w20-account-profile-details"
          data-testid="settings-account-profile-card"
        >
          <h2 className="w20-account-card-title" id="account-profile-title">
            Your profile
          </h2>
          <form
            aria-label="Your profile"
            className="w20-account-profile-form"
            data-testid="account-profile-form"
            onSubmit={saveProfile}
          >
            <div className="w20-account-field">
              <label
                className="w20-account-field-label"
                htmlFor="account-profile-name"
              >
                Name
              </label>
              <Input
                autoComplete="name"
                className="w20-account-control"
                data-testid="profile-display-name"
                id="account-profile-name"
                onChange={(event) => {
                  dirtyRef.current = event.target.value.trim() !== profileName;
                  setNameDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
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
                className="w20-account-control"
                data-testid="account-profile-email"
                id="account-profile-email"
                readOnly
                value={accountQuery.data?.email ?? ""}
              />
              <Button
                className="w20-account-email-link"
                data-testid="account-profile-change-email"
                onClick={() => onSectionChange("security")}
                type="button"
                variant="link"
              >
                Change your sign-in email
              </Button>
            </div>

            <div className="w20-account-field">
              <label
                className="w20-account-field-label"
                htmlFor="account-profile-status"
              >
                Status
              </label>
              <Input
                className="w20-account-control"
                data-testid="account-profile-status"
                id="account-profile-status"
                readOnly
                value={status}
              />
            </div>

            <div className="w20-account-field">
              <label
                className="w20-account-field-label"
                htmlFor="account-profile-timezone"
              >
                Timezone
              </label>
              <Input
                className="w20-account-control"
                data-testid="account-profile-timezone"
                id="account-profile-timezone"
                readOnly
                value={timeZone}
              />
            </div>

            <div className="w20-account-save-row">
              <Button
                className="w20-account-save"
                data-testid="account-profile-save"
                disabled={updateProfileMutation.isPending}
                type="submit"
              >
                Save
              </Button>
            </div>
          </form>
          {profileQuery.error instanceof Error ||
          updateProfileMutation.error instanceof Error ? (
            <p className="w20-account-profile-error" role="alert">
              {updateProfileMutation.error instanceof Error
                ? updateProfileMutation.error.message
                : profileQuery.error instanceof Error
                  ? profileQuery.error.message
                  : ""}
            </p>
          ) : null}
          {accountQuery.error instanceof Error ? (
            <p className="w20-account-profile-error" role="alert">
              {accountQuery.error.message}
            </p>
          ) : null}
        </section>

        <section
          aria-labelledby="account-business-title"
          className="w20-account-business-card"
          data-testid="settings-account-business-card"
        >
          <h2 className="w20-account-card-title" id="account-business-title">
            This business
          </h2>
          <dl className="w20-account-business-facts">
            <div>
              <dt>Business</dt>
              <dd>{activeCommunity?.name ?? ""}</dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd>{membershipRole}</dd>
            </div>
          </dl>
          <div className="w20-account-business-actions">
            <Button
              className="w20-account-card-action"
              data-testid="settings-account-business-settings"
              onClick={() => onSectionChange("business-profile")}
              type="button"
              variant="outline"
            >
              Business settings
            </Button>
            <Button
              className="w20-account-card-action"
              data-testid="settings-account-members-roles"
              onClick={() => onSectionChange("people")}
              type="button"
              variant="outline"
            >
              Members &amp; roles
            </Button>
          </div>
        </section>
      </div>
    </section>
  );
}
