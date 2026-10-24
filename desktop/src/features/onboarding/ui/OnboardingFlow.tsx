import * as React from "react";
import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  profileQueryKey,
  useUpdateProfileMutation,
} from "@/features/profile/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { getMyRelayMembershipLookup } from "@/shared/api/relayMembers";
import { isRelayUnreachableError } from "@/shared/lib/relayError";
import { isRelayMembershipDeniedError } from "@/shared/lib/relayMembershipDenied";
import {
  getIdentity,
  importIdentity,
  persistCurrentIdentity,
} from "@/shared/api/tauriIdentity";
import { AvatarStep } from "./AvatarStep";
import { FirstRunButton, FirstRunLink } from "./firstRunControls";
import { MembershipDenied } from "./MembershipDenied";
import {
  NostrKeyImportForm,
  type NostrKeyImportStage,
} from "./NostrKeyImportForm";
import { useCommunities } from "@/features/communities/useCommunities";
import { CommunityChangeOverlay } from "@/features/communities/ui/CommunityChangeOverlay";
import { ProfileDoneCard, ProfileFrame, ProfilePair } from "./ProfileFrame";
import { ProfileStep } from "./ProfileStep";
import type {
  OnboardingActions,
  OnboardingPage,
  OnboardingProfileSeed,
  OnboardingProfileValues,
  ProfileStepState,
} from "./types";

type MembershipCheckResult = "denied" | "ok" | "unreachable" | "error";

async function checkMembershipStatus(): Promise<MembershipCheckResult> {
  try {
    const { membership, snapshotFound } = await getMyRelayMembershipLookup();
    if (snapshotFound && membership === null) return "denied";
    return "ok";
  } catch (error) {
    if (isRelayMembershipDeniedError(error)) return "denied";
    // Native Tauri commands report connectivity failures with the stable
    // "relay unreachable:" prefix (see desktop/src-tauri/src/relay.rs), which
    // the legacy browser-fetch substrings below do not match.
    if (isRelayUnreachableError(error)) return "unreachable";
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("failed to fetch") ||
        msg.includes("networkerror") ||
        msg.includes("timeout") ||
        msg.includes("econnrefused") ||
        msg.includes("enotfound") ||
        msg.includes("connection") ||
        msg.includes("aborted")
      ) {
        return "unreachable";
      }
    }
    return "error";
  }
}

type OnboardingFlowProps = {
  actions: OnboardingActions;
  identityLost?: boolean;
  initialProfile: OnboardingProfileSeed;
  initialProfileDecisionSettled: boolean;
};

function isFallbackDisplayName(value?: string | null) {
  const normalizedValue = value?.trim().toLowerCase() ?? "";
  return (
    normalizedValue.startsWith("npub1") ||
    normalizedValue.startsWith("nostr:npub1")
  );
}

function sanitizeDisplayName(value?: string | null) {
  const trimmedValue = value?.trim() ?? "";
  return isFallbackDisplayName(trimmedValue) ? "" : trimmedValue;
}

function resolveSavedProfile({
  profile,
}: OnboardingProfileSeed): OnboardingProfileValues {
  return {
    avatarUrl: profile?.avatarUrl ?? "",
    displayName: sanitizeDisplayName(profile?.displayName),
  };
}

function createProfileUpdatePayload({
  draftProfile,
  savedProfile,
}: {
  draftProfile: OnboardingProfileValues;
  savedProfile: OnboardingProfileValues;
}) {
  const nextDisplayName = draftProfile.displayName.trim();
  const nextAvatarUrl = draftProfile.avatarUrl.trim();
  const updatePayload: {
    avatarUrl?: string;
    displayName?: string;
  } = {};

  if (
    nextDisplayName.length > 0 &&
    nextDisplayName !== savedProfile.displayName
  ) {
    updatePayload.displayName = nextDisplayName;
  }

  if (nextAvatarUrl.length > 0 && nextAvatarUrl !== savedProfile.avatarUrl) {
    updatePayload.avatarUrl = nextAvatarUrl;
  }

  return updatePayload;
}

function resolveProfileSaveRecovery(
  errorMessage: string | null,
  savedDisplayName: string,
): ProfileStepState["saveRecovery"] {
  return {
    canAdvanceWithoutSaving:
      errorMessage !== null && savedDisplayName.length > 0,
    canSkipForNow: errorMessage !== null && savedDisplayName.length === 0,
    errorMessage,
  };
}

export function OnboardingFlow({
  actions,
  identityLost = false,
  initialProfile,
  initialProfileDecisionSettled,
}: OnboardingFlowProps) {
  const { complete, skipForNow } = actions;
  const { activeCommunity } = useCommunities();
  const queryClient = useQueryClient();
  const savedProfile = resolveSavedProfile(initialProfile);
  const profileUpdateMutation = useUpdateProfileMutation();
  const { error: profileSaveError, isPending: isSavingProfile } =
    profileUpdateMutation;
  // When identity was lost (keyring cleared after migration), land the user
  // directly on the import step with a recovery notice rather than profile setup.
  const [currentPage, setCurrentPage] = React.useState<OnboardingPage>(
    identityLost ? "key-import" : "profile",
  );
  const [keyImportStage, setKeyImportStage] =
    React.useState<NostrKeyImportStage>("key-entry");
  const [isKeyImporting, setIsKeyImporting] = React.useState(false);
  const [keyImportFormKey, setKeyImportFormKey] = React.useState(0);
  const [profileDraft, setProfileDraft] =
    React.useState<OnboardingProfileValues>(savedProfile);
  const [deniedPubkey, setDeniedPubkey] = React.useState<string>("");
  const [persistError, setPersistError] = React.useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = React.useState(false);
  const [isProfileAdvancePending, setIsProfileAdvancePending] =
    React.useState(false);
  const [membershipRetryPage, setMembershipRetryPage] = React.useState<
    OnboardingPage | "complete"
  >("avatar");
  const [isCommunityChangeOpen, setIsCommunityChangeOpen] =
    React.useState(false);
  const [membershipError, setMembershipError] = React.useState<{
    kind: "unreachable" | "error";
    message?: string;
  } | null>(null);

  const resetProfileSaveError = React.useCallback(() => {
    profileUpdateMutation.reset();
  }, [profileUpdateMutation]);

  const updateProfileDraft = React.useCallback(
    (patch: Partial<OnboardingProfileValues>) => {
      resetProfileSaveError();
      setProfileDraft((current) => ({
        ...current,
        ...patch,
      }));
    },
    [resetProfileSaveError],
  );

  const showAvatarPage = React.useCallback(() => {
    setCurrentPage("avatar");
  }, []);

  const showProfilePage = React.useCallback(() => {
    setMembershipError(null);
    setCurrentPage("profile");
  }, []);

  const showKeyImportPage = React.useCallback(() => {
    setCurrentPage("key-import");
  }, []);

  const saveProfileAndContinue = React.useCallback(
    async (nextPage: OnboardingPage | "complete") => {
      if (!initialProfileDecisionSettled || isProfileAdvancePending) {
        return;
      }
      if (profileDraft.displayName.trim().length === 0) {
        return;
      }

      flushSync(() => {
        setIsProfileAdvancePending(true);
      });

      try {
        // Check membership before attempting the profile save. On open relays
        // this passes instantly. On gated relays it prevents a 403 during save.
        const membershipStatus = await checkMembershipStatus();
        setMembershipError(null);

        if (membershipStatus === "denied") {
          try {
            const identity = await getIdentity();
            setDeniedPubkey(identity.pubkey);
          } catch {
            setDeniedPubkey("");
          }
          setMembershipRetryPage(nextPage);
          setCurrentPage("membership-denied");
          return;
        }

        if (membershipStatus === "unreachable") {
          setMembershipError({ kind: "unreachable" });
          return;
        }

        if (membershipStatus === "error") {
          setMembershipError({
            kind: "error",
            message: "Server error. try again",
          });
          return;
        }

        const updatePayload = createProfileUpdatePayload({
          draftProfile: profileDraft,
          savedProfile,
        });

        if (Object.keys(updatePayload).length > 0) {
          try {
            await profileUpdateMutation.mutateAsync(updatePayload);
          } catch (error) {
            if (isRelayMembershipDeniedError(error)) {
              try {
                const identity = await getIdentity();
                setDeniedPubkey(identity.pubkey);
              } catch {
                setDeniedPubkey("");
              }
              setMembershipRetryPage(nextPage);
              setCurrentPage("membership-denied");
              return;
            }

            // Error falls through to the error banner / recovery buttons.
            return;
          }
        }

        if (nextPage === "complete") {
          complete();
          return;
        }
        showAvatarPage();
      } finally {
        setIsProfileAdvancePending(false);
      }
    },
    [
      initialProfileDecisionSettled,
      isProfileAdvancePending,
      profileDraft,
      profileUpdateMutation,
      savedProfile,
      complete,
      showAvatarPage,
    ],
  );

  const updateDisplayNameDraft = React.useCallback(
    (value: string) => {
      updateProfileDraft({ displayName: value });
    },
    [updateProfileDraft],
  );

  const updateAvatarUrlDraft = React.useCallback(
    (value: string) => {
      updateProfileDraft({ avatarUrl: value });
    },
    [updateProfileDraft],
  );

  const resetAvatarDraft = React.useCallback(() => {
    updateProfileDraft({ avatarUrl: savedProfile.avatarUrl });
  }, [savedProfile.avatarUrl, updateProfileDraft]);

  const advanceFromProfileWithoutSaving = React.useCallback(() => {
    profileUpdateMutation.reset();
    setProfileDraft((current) => ({
      ...current,
      displayName: savedProfile.displayName,
    }));
    showAvatarPage();
  }, [profileUpdateMutation, savedProfile.displayName, showAvatarPage]);

  const saveErrorMessage =
    profileSaveError instanceof Error ? profileSaveError.message : null;
  const profileStepState: ProfileStepState = {
    avatar: {
      draftUrl: profileDraft.avatarUrl,
      savedUrl: savedProfile.avatarUrl,
    },
    isReadyToSubmit: initialProfileDecisionSettled,
    isUploadingAvatar,
    isSaving: isSavingProfile || isProfileAdvancePending,
    name: {
      draftValue: profileDraft.displayName,
      savedValue: savedProfile.displayName,
    },
    saveRecovery: resolveProfileSaveRecovery(
      saveErrorMessage,
      savedProfile.displayName,
    ),
  };
  const avatarStepState: ProfileStepState = {
    ...profileStepState,
    saveRecovery: saveErrorMessage
      ? {
          canAdvanceWithoutSaving: true,
          canSkipForNow: false,
          errorMessage: saveErrorMessage,
        }
      : profileStepState.saveRecovery,
  };
  // Machine-level identity and provider setup have already completed. This
  // relay-scoped flow now owns only the community profile.

  // Swapping the identity changes the pubkey, which remounts this flow
  // (keyed on pubkey in App.tsx) and re-runs the onboarding gate: the new
  // key's relay profile reseeds the steps, and a key that already finished
  // onboarding on this machine skips straight into the app.
  const importExistingKey = React.useCallback(
    async (nsec: string, password?: string) => {
      const identity = await importIdentity(nsec, password);
      relayClient.disconnect();
      queryClient.setQueryData(["identity"], identity);
      queryClient.removeQueries({ queryKey: profileQueryKey });
      profileUpdateMutation.reset();
      setDeniedPubkey("");
      setCurrentPage("profile");
    },
    [profileUpdateMutation, queryClient],
  );

  // Lost-mode "start new identity": confirm first (irreversible), then persist
  // the ephemeral key so the new identity is durable, then let the stage
  // machinery (bootedLost + !identityLost) replace this flow with
  // RelaunchRequiredScreen. No navigation needed here.
  const handleLostModeBack = React.useCallback(async () => {
    const confirmed = window.confirm(
      "This will create a new identity and abandon your previous key. This cannot be undone. Continue?",
    );
    if (!confirmed) {
      return;
    }
    try {
      const identity = await persistCurrentIdentity();
      queryClient.setQueryData(["identity"], identity);
    } catch (error) {
      setPersistError(
        error instanceof Error
          ? error.message
          : "Failed to create a new identity. Please try again.",
      );
    }
  }, [queryClient]);

  const handleKeyImportBack = React.useCallback(() => {
    if (keyImportStage === "backup-password") {
      setKeyImportFormKey((current) => current + 1);
      setKeyImportStage("key-entry");
      return;
    }
    if (identityLost) {
      void handleLostModeBack();
      return;
    }
    showProfilePage();
  }, [handleLostModeBack, identityLost, keyImportStage, showProfilePage]);

  const chromeBackAction =
    currentPage === "profile"
      ? {
          disabled: profileStepState.isSaving,
          onClick: () => {
            setMembershipError(null);
            setIsCommunityChangeOpen(true);
          },
        }
      : currentPage === "key-import"
        ? {
            label:
              keyImportStage === "backup-password"
                ? "Back"
                : identityLost
                  ? "Start new identity"
                  : "Back",
            disabled: isKeyImporting,
            onClick: handleKeyImportBack,
          }
        : currentPage === "avatar"
          ? {
              disabled:
                avatarStepState.isSaving || avatarStepState.isUploadingAvatar,
              onClick: showProfilePage,
            }
          : undefined;

  if (currentPage === "membership-denied") {
    return (
      <>
        <MembershipDenied
          activeRelayUrl={activeCommunity?.relayUrl ?? ""}
          onChangeCommunity={() => setIsCommunityChangeOpen(true)}
          onImportKey={importExistingKey}
          onRetry={() => {
            void saveProfileAndContinue(membershipRetryPage);
          }}
          pubkey={deniedPubkey}
        />
        {isCommunityChangeOpen ? (
          <CommunityChangeOverlay
            escape={{}}
            onClose={() => setIsCommunityChangeOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <ProfileFrame stage="after" testId="onboarding-gate">
        <div className="c3fr-profile-wrap">
          <div className="c3fr-wide-top">
            {chromeBackAction ? (
              <FirstRunLink
                data-testid="onboarding-back"
                disabled={chromeBackAction.disabled}
                onClick={chromeBackAction.onClick}
              >
                {currentPage === "profile"
                  ? "Change community"
                  : (chromeBackAction.label ?? "Back")}
              </FirstRunLink>
            ) : (
              <span />
            )}
          </div>
          {membershipError &&
          (currentPage === "profile" || currentPage === "avatar") ? (
            <div className="c3fr-callout" data-tone="bad">
              <div className="c3fr-callout-body">
                {membershipError.kind === "unreachable" ? (
                  <>
                    <div className="c3fr-callout-text">
                      <h3>Can’t reach this relay</h3>
                      <p>Check your connection or change your community.</p>
                    </div>
                    <div className="c3fr-callout-actions">
                      <FirstRunButton
                        onClick={() => setIsCommunityChangeOpen(true)}
                        size="small"
                      >
                        Change community
                      </FirstRunButton>
                    </div>
                  </>
                ) : (
                  <div className="c3fr-callout-text">
                    <h3>{membershipError.message ?? "Something went wrong"}</h3>
                    <p>The relay returned an error. Try again.</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {currentPage === "profile" ? (
            <ProfileStep
              actions={{
                advanceWithoutSaving: advanceFromProfileWithoutSaving,
                clearAvatarDraft: resetAvatarDraft,
                importExistingKey: showKeyImportPage,
                onUploadingChange: setIsUploadingAvatar,
                skipForNow,
                submit: () => {
                  void saveProfileAndContinue("avatar");
                },
                updateAvatarUrl: updateAvatarUrlDraft,
                updateDisplayName: updateDisplayNameDraft,
              }}
              state={profileStepState}
            />
          ) : currentPage === "key-import" ? (
            <div
              className="c3fr-profile-card"
              data-testid="onboarding-key-import"
            >
              <div className="c3fr-head">
                {identityLost ? (
                  <>
                    <h2 className="c3fr-title c3fr-title-profile" tabIndex={-1}>
                      Re-import your key
                    </h2>
                    <p className="c3fr-lede c3fr-lede-card">
                      Your identity is no longer in the system keyring.
                      Re-import your nsec to restore it. Colony will restart to
                      finish recovery. Or go back to start a new identity with a
                      fresh key.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="c3fr-title c3fr-title-profile" tabIndex={-1}>
                      Use your existing key
                    </h2>
                    <p className="c3fr-lede c3fr-lede-card">
                      Import your Nostr private key to use that identity with
                      Colony. If this key already has a profile on the relay,
                      your name and avatar are restored automatically.
                    </p>
                  </>
                )}
              </div>
              {persistError ? (
                <p className="c3fr-error" role="alert">
                  {persistError}
                </p>
              ) : null}
              <NostrKeyImportForm
                key={keyImportFormKey}
                onBack={handleKeyImportBack}
                onImport={importExistingKey}
                onImportingChange={setIsKeyImporting}
                onStageChange={setKeyImportStage}
                showBack={false}
                showPasswordStageBack={false}
              />
            </div>
          ) : (
            <ProfilePair>
              <ProfileDoneCard
                name={
                  profileStepState.name.draftValue.trim() ||
                  profileStepState.name.savedValue
                }
              />
              <AvatarStep
                actions={{
                  advanceWithoutSaving: complete,
                  back: showProfilePage,
                  onUploadingChange: setIsUploadingAvatar,
                  skipForNow,
                  submit: () => {
                    void saveProfileAndContinue("complete");
                  },
                  updateAvatarUrl: updateAvatarUrlDraft,
                }}
                showAlwaysSkip={true}
                state={avatarStepState}
              />
            </ProfilePair>
          )}
        </div>
      </ProfileFrame>
      {isCommunityChangeOpen ? (
        <CommunityChangeOverlay
          onClose={() => setIsCommunityChangeOpen(false)}
        />
      ) : null}
    </>
  );
}
