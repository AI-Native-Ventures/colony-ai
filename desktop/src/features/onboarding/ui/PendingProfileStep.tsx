import * as React from "react";

import { downscaleIconToDataUrl } from "@/features/communities/lib/downscaleIcon";
import { savePendingProfile } from "../pendingProfile";
import { AvatarStep } from "./AvatarStep";
import { FirstRunLink } from "./firstRunControls";
import { ProfileDoneCard, ProfileFrame, ProfilePair } from "./ProfileFrame";
import { ProfileStep } from "./ProfileStep";
import type { ProfileStepState } from "./types";

/**
 * Name and photo right after an advanced sign-in. There is no business to
 * publish a profile to yet, so the choice is kept (see `pendingProfile`) and
 * published when the business is set up.
 */
export function PendingProfileStep({
  pubkey,
  onBack,
  onDone,
}: {
  pubkey: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [page, setPage] = React.useState<"name" | "avatar">("name");
  const [displayName, setDisplayName] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState("");

  const finish = (withName: boolean, withAvatar: boolean) => {
    const name = displayName.trim();
    if (name || (withAvatar && avatarUrl))
      savePendingProfile(pubkey, {
        displayName: withName ? name : "",
        avatarUrl: withAvatar && avatarUrl ? avatarUrl : undefined,
      });
    onDone();
  };

  const state: ProfileStepState = {
    avatar: { draftUrl: avatarUrl, savedUrl: "" },
    isReadyToSubmit: true,
    isSaving: false,
    isUploadingAvatar: false,
    name: { draftValue: displayName, savedValue: "" },
    saveRecovery: {
      canAdvanceWithoutSaving: false,
      canSkipForNow: false,
      errorMessage: null,
    },
  };

  return (
    <ProfileFrame stage="before" testId="onboarding-gate">
      <div className="c3fr-wide-top c3fr-profile-top">
        <FirstRunLink data-testid="onboarding-back" onClick={onBack}>
          Back
        </FirstRunLink>
      </div>
      {page === "name" ? (
        <ProfileStep
          actions={{
            advanceWithoutSaving: () => setPage("avatar"),
            clearAvatarDraft: () => setAvatarUrl(""),
            importExistingKey: () => undefined,
            onUploadingChange: () => undefined,
            // Skipping the name skips the photo too: nothing is kept.
            skipForNow: () => onDone(),
            submit: () => setPage("avatar"),
            updateAvatarUrl: setAvatarUrl,
            updateDisplayName: setDisplayName,
          }}
          state={state}
        />
      ) : (
        <ProfilePair>
          <ProfileDoneCard name={displayName.trim()} />
          <AvatarStep
            actions={{
              advanceWithoutSaving: () => finish(true, false),
              back: () => setPage("name"),
              onUploadingChange: () => undefined,
              skipForNow: () => finish(true, false),
              submit: () => finish(true, true),
              updateAvatarUrl: setAvatarUrl,
            }}
            processImage={downscaleIconToDataUrl}
            showAlwaysSkip
            state={state}
          />
        </ProfilePair>
      )}
    </ProfileFrame>
  );
}
