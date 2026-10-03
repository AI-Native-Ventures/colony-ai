import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  useProfileQuery,
  useUpdateProfileMutation,
} from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { getAccountAuthClient } from "@/features/onboarding/accountAuthAdapter";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { SettingsSection } from "./SettingsPanels";
import { AccountSettingsHeader } from "./AccountSettingsHeader";

type AvatarEditorProfileContextProps = {
  avatarSaved: boolean;
  fallbackDisplayName?: string;
  onEditAvatar: () => void;
  onSectionChange: (section: SettingsSection) => void;
};

const accountQueryKey = ["settings-account-auth"] as const;

export function AvatarEditorProfileContext({
  avatarSaved,
  fallbackDisplayName,
  onEditAvatar,
  onSectionChange,
}: AvatarEditorProfileContextProps) {
  const profileQuery = useProfileQuery();
  const updateProfileMutation = useUpdateProfileMutation();
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

  const isLoading = profileQuery.isLoading || accountQuery.isLoading;

  return (
    <section
      aria-busy={isLoading}
      className="w20-avatar-profile-context min-w-0"
      data-testid="settings-profile"
      data-ready={!isLoading ? "true" : "false"}
    >
      <AccountSettingsHeader
        businessName={activeCommunity?.name}
        onSectionChange={onSectionChange}
        section="profile"
        title="Your profile"
      />

      <section
        aria-labelledby="avatar-context-personal-details-title"
        className="w20-avatar-profile-details"
        data-testid="settings-account-profile-card"
      >
        <h2
          className="w20-account-card-title"
          id="avatar-context-personal-details-title"
        >
          Personal details
        </h2>
        <div className="w20-account-photo-row">
          <ProfileAvatar
            avatarUrl={profileQuery.data?.avatarUrl ?? null}
            className="size-8 rounded-[7px]"
            label={profileName || "Your profile"}
            shape="squircle"
            testId="account-profile-avatar"
          />
          <div className="w20-account-photo-copy">
            <strong>Profile photo</strong>
            <p>Shown to people in your businesses.</p>
          </div>
          <Button
            className="w20-account-avatar-action"
            data-testid="profile-avatar-edit"
            onClick={onEditAvatar}
            size="sm"
            type="button"
            variant="outline"
          >
            Edit avatar
          </Button>
        </div>
        <form
          aria-label="Personal details"
          className="w20-account-profile-form"
          data-testid="account-profile-form"
          onSubmit={saveProfile}
        >
          <div className="w20-account-field">
            <label
              className="w20-account-field-label"
              htmlFor="avatar-context-profile-name"
            >
              Display name
            </label>
            <Input
              autoComplete="name"
              className="w20-account-control"
              data-testid="profile-display-name"
              id="avatar-context-profile-name"
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
              htmlFor="avatar-context-profile-email"
            >
              Email address
            </label>
            <Input
              autoComplete="email"
              className="w20-account-control"
              data-testid="account-profile-email"
              id="avatar-context-profile-email"
              readOnly
              value={accountQuery.data?.email ?? ""}
            />
          </div>
        </form>

        <div aria-hidden="true" className="w20-account-profile-divider" />
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
            We couldn't load your account details. Try again.
            <Button
              disabled={accountQuery.isFetching}
              onClick={() => void accountQuery.refetch()}
              type="button"
              variant="ghost"
            >
              Retry
            </Button>
          </p>
        ) : null}
        {avatarSaved ? (
          <div
            className="w20-account-avatar-saved"
            data-testid="profile-avatar-saved"
            role="status"
          >
            Profile photo updated
          </div>
        ) : null}
      </section>
    </section>
  );
}
