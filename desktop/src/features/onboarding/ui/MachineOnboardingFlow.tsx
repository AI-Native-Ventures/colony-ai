import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";

import {
  getIdentity,
  importIdentity,
  persistCurrentIdentity,
} from "@/shared/api/tauriIdentity";
import {
  type NativeCapability,
  supportsNativeCapability,
} from "@/shared/api/nativeBridge";
import type { IdentityStorage } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import type {
  AccountAuthClient,
  AccountAuthRecord,
} from "../accountAuthClient";
import { AccountAuthFlow } from "./AccountAuthFlow";
import { BackupStep } from "./BackupStep";
import { DefaultConfigStep } from "./DefaultConfigStep";
import { DownloadKeyStep } from "./DownloadKeyStep";
import {
  backupSessionToPasswordEntry,
  resetEncryptedBackupSession,
  useEncryptedBackupSession,
} from "./EncryptedBackupCreator";
import { IdentityKeyHelpContent } from "./IdentityKeyHelpDialog";
import { IdentityKeyIntroduction } from "./IdentityKeyIntroduction";
import { IdentityRecoveryPairing } from "./IdentityRecoveryPairing";
import {
  NostrKeyImportForm,
  type NostrKeyImportStage,
} from "./NostrKeyImportForm";
import { ONBOARDING_SECONDARY_CTA_CLASS } from "./OnboardingChrome";
import { OnboardingCard } from "./OnboardingCard";
import { NativeUnavailableScreen } from "./NativeUnavailableScreen";
import {
  type OnboardingTransitionDirection,
  OnboardingSlideTransition,
} from "./OnboardingSlideTransition";
import { SetupStep } from "./SetupStep";
import { MachineIdentityLanding } from "./MachineIdentityLanding";
import type { HarnessConnectionMethod } from "./harnessConnectionOptions";
import {
  resolveInitialMachineOnboardingState,
  type MachineOnboardingPage,
} from "./machineOnboardingStartup";
import type { DefaultConfigDraft } from "./types";
import { useCommunityOnboarding } from "../communityOnboarding";
import { useDeviceAiConnectionCheck } from "../deviceAiConnection";
import {
  firstRunInviteFromTransaction,
  type FirstRunInvite,
} from "../firstRunInvite";
import { readRememberedSignupName } from "../onboardingProfile";
import { InviteBrand, InviteJoinScene, InviteLinkScene } from "./InviteScenes";
import {
  BusinessSetupStep,
  businessCommunityRelayUrl,
  ownedBusinessProfile,
  readOnboardingBusinessProfile,
  type OnboardingBusinessProfile,
} from "./BusinessSetupStep";
import { ConnectSetupStep } from "./ConnectSetupStep";
import type { SelfServeCommunity } from "@/features/communities/selfProvisioningApi";
import { listOwnedBusinesses } from "@/features/communities/selfProvisioningApi";
import {
  OnboardingScenePresentation,
  type OnboardingBusinessChoice,
} from "./OnboardingScenePresentation";

export type { MachineOnboardingPage } from "./machineOnboardingStartup";

type BackupSubview = "created" | "password";

/** The business Connect sets up AI for, and how the person reached it. */
type ConnectTarget = {
  community: SelfServeCommunity;
  profile: OnboardingBusinessProfile;
  /** "create" made the business here; "owned" opens one the account has. */
  origin: "create" | "owned";
};

function unavailableBody(capability: NativeCapability): string {
  switch (capability) {
    case "identity-backup":
      return "Saving a recovery copy is not available in this version of Colony yet. Your sign-in has not been changed.";
    case "identity-import":
      return "Adding an existing sign-in is not available in this version of Colony yet. Nothing has been changed.";
    case "identity-recovery":
      return "Restoring your sign-in is not available in this version of Colony yet. Open Colony on a supported desktop version and try again.";
    case "identity-create":
      return "Creating or replacing your sign-in is not available in this version of Colony yet.";
    default:
      return "This action is not available in this version of Colony yet.";
  }
}

export function MachineOnboardingFlow({
  complete,
  continueWithIdentity,
  continueWithRecoveredIdentity,
  identityLost,
  initialPage,
  queryClient,
  authClient,
}: {
  complete: (
    pubkey?: string,
    options?: { continueToProfile?: boolean; openAiSettings?: boolean },
  ) => void;
  continueWithIdentity: (pubkey: string) => void;
  continueWithRecoveredIdentity: (pubkey: string) => void;
  identityLost: boolean;
  initialPage?: MachineOnboardingPage;
  queryClient: QueryClient;
  authClient: AccountAuthClient;
}) {
  const initialState = resolveInitialMachineOnboardingState({
    identityLost,
    initialPage,
    supportsCapability: supportsNativeCapability,
  });
  const [page, setPage] = React.useState<MachineOnboardingPage>(
    () => initialState.page,
  );
  const [transitionDirection, setTransitionDirection] =
    React.useState<OnboardingTransitionDirection>("forward");
  const [error, setError] = React.useState<string | null>(null);
  const [unsupportedCapability, setUnsupportedCapability] =
    React.useState<NativeCapability | null>(
      () => initialState.unsupportedCapability,
    );
  const [isPending, setIsPending] = React.useState(false);
  const [identityWasImported, setIdentityWasImported] = React.useState(false);
  const [accountAuthenticated, setAccountAuthenticated] = React.useState(false);
  const communityOnboarding = useCommunityOnboarding();
  // A returning person picking a business on a device with no working AI is
  // sent through Connect first, instead of into a workspace that cannot reply.
  const deviceConnection = useDeviceAiConnectionCheck(page === "businesses");
  // A workspace invite waiting for this person (deep link or pasted link). It
  // lives in the persisted transaction, so it survives a restart mid sign-up.
  const pendingInvite = firstRunInviteFromTransaction(
    communityOnboarding.transaction,
  );
  const pendingInviteRef = React.useRef(pendingInvite);
  pendingInviteRef.current = pendingInvite;
  // Held while the invite scene is up, so a failed claim can keep explaining
  // itself after the failed transaction has been dropped.
  const [inviteSnapshot, setInviteSnapshot] =
    React.useState<FirstRunInvite | null>(null);
  const [accountIdentity, setAccountIdentity] = React.useState({
    email: "",
    name: "",
  });
  const [connectTarget, setConnectTarget] =
    React.useState<ConnectTarget | null>(null);
  const [ownedCommunities, setOwnedCommunities] = React.useState<
    SelfServeCommunity[]
  >([]);
  const [businessListError, setBusinessListError] = React.useState<
    string | null
  >(null);
  const [businessBackPage, setBusinessBackPage] = React.useState<
    "account-auth" | "businesses"
  >("account-auth");
  const [keyImportStage, setKeyImportStage] =
    React.useState<NostrKeyImportStage>("key-entry");
  const [isKeyImporting, setIsKeyImporting] = React.useState(false);
  const [keyImportFormKey, setKeyImportFormKey] = React.useState(0);
  const [keyImportDialog, setKeyImportDialog] = React.useState<
    "backup" | "phone" | null
  >(null);
  const [identityKeyHelpReturnPage, setIdentityKeyHelpReturnPage] =
    React.useState<"identity" | "identity-key-intro">("identity");
  const [phoneRecoveryStep, setPhoneRecoveryStep] = React.useState("loading");
  const [selectedPubkey, setSelectedPubkey] = React.useState<string | null>(
    null,
  );
  const [identityStorage, setIdentityStorage] = React.useState<
    IdentityStorage | undefined
  >();
  const [readyRuntimeIds, setReadyRuntimeIds] = React.useState<string[]>([]);
  const [setupBackAction, setSetupBackAction] = React.useState<
    (() => void) | null
  >(null);
  const [harnessConnectionMethod, setHarnessConnectionMethod] =
    React.useState<HarnessConnectionMethod | null>(null);
  const [configBackTarget, setConfigBackTarget] = React.useState<
    "method" | "list"
  >("method");
  const [isChoosingDifferentHarness, setIsChoosingDifferentHarness] =
    React.useState(false);
  const [defaultConfigDraft, setDefaultConfigDraft] =
    React.useState<DefaultConfigDraft | null>(null);
  const [isDefaultConfigSaving, setIsDefaultConfigSaving] =
    React.useState(false);
  const [backupSubview, setBackupSubview] =
    React.useState<BackupSubview>("created");
  const [backupDirection, setBackupDirection] = React.useState<
    "forward" | "backward"
  >("forward");
  const [returningFromSecurity, setReturningFromSecurity] =
    React.useState(false);
  // Owned here so switching between the onboarding card and the security
  // subview keeps the created backup, password, and test progress.
  const backupSession = useEncryptedBackupSession();
  const reduceMotion = useReducedMotion() ?? false;
  const setupSelectionHandoffRef = React.useRef(false);
  const showUnsupported = React.useCallback((capability: NativeCapability) => {
    setUnsupportedCapability(capability);
    setError(null);
    setPage("unsupported");
  }, []);
  const handleReadyRuntimeIdsChange = React.useCallback(
    (runtimeIds: readonly string[]) => {
      if (setupSelectionHandoffRef.current) return;
      setReadyRuntimeIds(Array.from(new Set(runtimeIds)));
    },
    [],
  );
  const handleSetupBackActionChange = React.useCallback(
    (backAction: () => void) =>
      setSetupBackAction((current) =>
        current === backAction ? current : backAction,
      ),
    [],
  );
  const returnToApiConfig = React.useCallback(() => {
    setIsChoosingDifferentHarness(false);
    setTransitionDirection("backward");
    setPage("config");
  }, []);

  const loadFreshIdentity = React.useCallback(async () => {
    setIsPending(true);
    setError(null);
    try {
      const identity = await getIdentity();
      queryClient.setQueryData(["identity"], identity);
      setSelectedPubkey(identity.pubkey);
      setIdentityStorage(identity.storage);
      if (!supportsNativeCapability("identity-backup")) {
        showUnsupported("identity-backup");
        return;
      }
      setBackupDirection("forward");
      setTransitionDirection("forward");
      setReturningFromSecurity(false);
      setBackupSubview("created");
      setPage("backup");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load identity",
      );
    } finally {
      setIsPending(false);
    }
  }, [queryClient, showUnsupported]);

  const loadRecoveredIdentity = React.useCallback(async () => {
    if (!supportsNativeCapability("identity-recovery")) {
      showUnsupported("identity-recovery");
      return;
    }
    setIsPending(true);
    setError(null);
    try {
      const identity = await getIdentity();
      continueWithRecoveredIdentity(identity.pubkey);
      queryClient.setQueryData(["identity"], identity);
      setIdentityWasImported(true);
      setSelectedPubkey(identity.pubkey);
      setIdentityStorage(identity.storage);
      setTransitionDirection("forward");
      setPage("setup");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load identity",
      );
    } finally {
      setIsPending(false);
    }
  }, [continueWithRecoveredIdentity, queryClient, showUnsupported]);

  const replaceLostIdentity = React.useCallback(async () => {
    if (!supportsNativeCapability("identity-create")) {
      showUnsupported("identity-create");
      return;
    }
    const confirmed = window.confirm(
      "This will create a new identity and abandon your previous key. This cannot be undone. Continue?",
    );
    if (!confirmed) return;

    setIsPending(true);
    setError(null);
    try {
      const identity = await persistCurrentIdentity();
      queryClient.setQueryData(["identity"], identity);
      setSelectedPubkey(identity.pubkey);
      setIdentityStorage(identity.storage);
      setBackupDirection("forward");
      setTransitionDirection("forward");
      setReturningFromSecurity(false);
      setBackupSubview("created");
      setPage("backup");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to save identity",
      );
    } finally {
      setIsPending(false);
    }
  }, [queryClient, showUnsupported]);

  const importExistingIdentity = React.useCallback(
    async (nsec: string, password?: string) => {
      if (!supportsNativeCapability("identity-import")) {
        showUnsupported("identity-import");
        return;
      }
      const identity = await importIdentity(nsec, password);
      continueWithIdentity(identity.pubkey);
      queryClient.setQueryData(["identity"], identity);
      setIdentityWasImported(true);
      setSelectedPubkey(identity.pubkey);
      setTransitionDirection("forward");
      setPage("setup");
    },
    [continueWithIdentity, queryClient, showUnsupported],
  );

  const installAccount = React.useCallback(
    async (account: AccountAuthRecord) => {
      if (!supportsNativeCapability("identity-import")) {
        showUnsupported("identity-import");
        throw new Error(unavailableBody("identity-import"));
      }
      const identity = await getIdentity();
      if (identity.pubkey.toLowerCase() !== account.pubkey.toLowerCase()) {
        throw new Error(
          "The signed-in identity could not be loaded. Try again.",
        );
      }
      continueWithIdentity(identity.pubkey);
      queryClient.setQueryData(["identity"], identity);
      setIdentityWasImported(true);
      setAccountAuthenticated(true);
      setSelectedPubkey(identity.pubkey);
      setIdentityStorage(identity.storage);
      setBusinessListError(null);
      setAccountIdentity({
        email: account.email,
        name: readRememberedSignupName(account.email),
      });
      // Invited people join the workspace they were invited to. They are
      // never sent to create a business of their own.
      const invite = pendingInviteRef.current;
      if (invite) {
        setInviteSnapshot(invite);
        setTransitionDirection("forward");
        setPage("invite");
        return;
      }
      try {
        const owned = await listOwnedBusinesses(
          account.pubkey,
          (id) => readOnboardingBusinessProfile(id)?.name ?? null,
        );
        setOwnedCommunities(owned);
        setBusinessBackPage(owned.length > 0 ? "businesses" : "account-auth");
        setTransitionDirection("forward");
        setPage(owned.length > 0 ? "businesses" : "business");
      } catch {
        setOwnedCommunities([]);
        setBusinessListError(
          "Could not load your businesses. Start a new business or try again later.",
        );
        setBusinessBackPage("businesses");
        setTransitionDirection("forward");
        setPage("businesses");
      }
    },
    [continueWithIdentity, queryClient, showUnsupported],
  );

  const backFromKeyImport = React.useCallback(() => {
    if (keyImportStage === "backup-password") {
      setKeyImportFormKey((current) => current + 1);
      setKeyImportStage("key-entry");
      return;
    }
    if (keyImportDialog) {
      setKeyImportDialog(null);
      setPhoneRecoveryStep("loading");
      return;
    }
    setTransitionDirection("backward");
    setPage("identity");
  }, [keyImportDialog, keyImportStage]);

  const returnToCreatedKey = React.useCallback(() => {
    setBackupDirection("backward");
    setReturningFromSecurity(true);
    setBackupSubview("created");
  }, []);

  const backFromPasswordBackup = React.useCallback(() => {
    resetEncryptedBackupSession(backupSession);
    setBackupDirection("backward");
    setReturningFromSecurity(true);
    setBackupSubview("created");
  }, [backupSession]);

  const backFromSetup = React.useCallback(() => {
    if (accountAuthenticated) {
      setTransitionDirection("backward");
      setPage("account-auth");
      return;
    }
    if (identityWasImported) {
      setKeyImportFormKey((current) => current + 1);
      setKeyImportStage("key-entry");
      setTransitionDirection("backward");
      setPage("key-import");
      return;
    }
    if (backupSubview === "password") {
      backupSessionToPasswordEntry(backupSession);
    }
    setBackupDirection("backward");
    setTransitionDirection("backward");
    setReturningFromSecurity(false);
    setPage("backup");
  }, [accountAuthenticated, backupSession, backupSubview, identityWasImported]);

  const backFromConfig = React.useCallback(() => {
    setupSelectionHandoffRef.current = false;
    setTransitionDirection("backward");
    setIsChoosingDifferentHarness(false);
    if (configBackTarget === "method") {
      setHarnessConnectionMethod(null);
    }
    setPage("setup");
  }, [configBackTarget]);

  // A link opened (or pasted) while the person is already signed in becomes the
  // invite scene instead of a stray business form or a second sign-in.
  const inviteCode = pendingInvite?.code;
  // biome-ignore lint/correctness/useExhaustiveDependencies: inviteCode re-runs this when a new invite arrives; the invite itself is read from the ref.
  React.useEffect(() => {
    const invite = pendingInviteRef.current;
    if (
      !invite ||
      !accountAuthenticated ||
      (page !== "business" && page !== "businesses" && page !== "account-auth")
    )
      return;
    setInviteSnapshot(invite);
    setTransitionDirection("forward");
    setPage("invite");
  }, [accountAuthenticated, inviteCode, page]);

  const chromeBackAction =
    page === "identity-key-help"
      ? {
          onClick: () => {
            setTransitionDirection("backward");
            setPage(identityKeyHelpReturnPage);
          },
        }
      : page === "identity-key-intro"
        ? {
            disabled: isPending,
            onClick: () => {
              setError(null);
              setTransitionDirection("backward");
              setPage("identity");
            },
          }
        : page === "key-import" &&
            (keyImportDialog !== null ||
              !identityLost ||
              keyImportStage === "backup-password")
          ? { disabled: isKeyImporting, onClick: backFromKeyImport }
          : page === "backup" && backupSubview !== "created"
            ? {
                label: "Return to onboarding",
                onClick: returnToCreatedKey,
                testId: "backup-return-to-onboarding",
              }
            : page === "backup"
              ? {
                  onClick: () => {
                    setTransitionDirection("backward");
                    setPage("identity-key-intro");
                  },
                }
              : page === "setup"
                ? { onClick: setupBackAction ?? backFromSetup }
                : page === "config"
                  ? {
                      disabled: isDefaultConfigSaving,
                      onClick: backFromConfig,
                    }
                  : undefined;

  if (page === "invite-link") {
    return (
      <InviteLinkScene
        onBack={() => {
          setTransitionDirection("backward");
          setPage("account-auth");
        }}
        onContinue={(target) => {
          const started = communityOnboarding.start({
            source: "first-community",
            firstCommunityPage: "join",
            relayUrl: target.relayUrl,
            inviteCode: target.code,
          });
          if (!started) {
            return "Another workspace setup is already in progress. Finish it first.";
          }
          setTransitionDirection("forward");
          setPage("account-auth");
          return null;
        }}
      />
    );
  }

  if (page === "invite" && inviteSnapshot && selectedPubkey) {
    return (
      <InviteJoinScene
        email={accountIdentity.email}
        invite={inviteSnapshot}
        name={accountIdentity.name}
        onJoined={() => {
          communityOnboarding.update({
            stage: "connecting",
            communityName: inviteSnapshot.businessName,
            error: undefined,
          });
          complete(selectedPubkey);
        }}
        onTerminalFailure={() => communityOnboarding.clear()}
        secondaryAction={{
          label: "Create my own business instead",
          onClick: () => {
            communityOnboarding.clear();
            setBusinessBackPage("account-auth");
            setTransitionDirection("forward");
            setPage("business");
          },
        }}
        onUseAnotherAccount={() => {
          setAccountAuthenticated(false);
          setTransitionDirection("backward");
          setPage("account-auth");
        }}
        onUseAnotherLink={() => {
          communityOnboarding.clear();
          setTransitionDirection("forward");
          setPage("invite-link");
        }}
      />
    );
  }

  if (page === "account-auth") {
    return (
      <AccountAuthFlow
        authClient={authClient}
        inviteBrand={
          pendingInvite ? <InviteBrand invite={pendingInvite} /> : undefined
        }
        onHaveInviteLink={
          pendingInvite
            ? undefined
            : () => {
                setTransitionDirection("forward");
                setPage("invite-link");
              }
        }
        onAdvanced={() => {
          setAccountAuthenticated(false);
          setTransitionDirection("forward");
          setPage("identity");
        }}
        onAuthenticated={installAccount}
        standalone
      />
    );
  }

  if (page === "identity") {
    return (
      <MachineIdentityLanding
        error={error}
        hasSelectedIdentity={selectedPubkey !== null}
        isPending={isPending}
        onBack={() => {
          setTransitionDirection("backward");
          setPage("account-auth");
        }}
        onContinue={() => {
          if (selectedPubkey && !supportsNativeCapability("identity-read")) {
            showUnsupported("identity-read");
            return;
          }
          if (selectedPubkey) {
            void loadFreshIdentity();
            return;
          }
          setTransitionDirection("forward");
          setPage("identity-key-intro");
        }}
        onOpenHelp={() => {
          setIdentityKeyHelpReturnPage("identity");
          setTransitionDirection("forward");
          setPage("identity-key-help");
        }}
        onUseExistingKey={() => {
          if (!supportsNativeCapability("identity-import")) {
            showUnsupported("identity-import");
            return;
          }
          setKeyImportDialog(null);
          setKeyImportStage("key-entry");
          setTransitionDirection("forward");
          setPage("key-import");
        }}
        transitionDirection={transitionDirection}
      />
    );
  }

  if (page === "businesses") {
    const choices: OnboardingBusinessChoice[] = ownedCommunities.map(
      (community) => ({
        id: community.id,
        name: community.name || community.slug,
        role: "Owner",
      }),
    );
    return (
      <OnboardingScenePresentation
        businessChoices={choices}
        data={{
          name: "",
          email: "",
          business: choices[0]?.name ?? "",
          website: "",
          description: "",
        }}
        error={businessListError}
        onCreateBusiness={() => {
          setBusinessBackPage("businesses");
          setTransitionDirection("forward");
          setPage("business");
        }}
        onSelectBusiness={(id) => {
          if (deviceConnection.checking) return;
          const selected = ownedCommunities.find(
            (community) => community.id === id,
          );
          if (!selected || !selectedPubkey) {
            setBusinessListError("That business is no longer available.");
            return;
          }
          setBusinessListError(null);
          void deviceConnection.resolve().then((connected) => {
            if (connected === null) return;
            if (connected) {
              const started = communityOnboarding.start({
                source: "first-community",
                firstCommunityPage: "owned",
                relayUrl: businessCommunityRelayUrl(selected),
                businessCommunityId: selected.id,
                communityName:
                  readOnboardingBusinessProfile(selected.id)?.name ||
                  selected.name ||
                  selected.slug,
              });
              if (!started) {
                setBusinessListError(
                  "Finish the community setup already in progress before opening this business.",
                );
                return;
              }
              complete(selectedPubkey);
              return;
            }
            setConnectTarget({
              community: selected,
              profile: ownedBusinessProfile(selected),
              origin: "owned",
            });
            setError(null);
            setTransitionDirection("forward");
            setPage("connect");
          });
        }}
        pending={deviceConnection.checking}
        scene="businesses"
      />
    );
  }

  if (page === "business") {
    return (
      <BusinessSetupStep
        additional={businessBackPage === "businesses"}
        onBack={() => {
          setError(null);
          setTransitionDirection("backward");
          setPage(businessBackPage);
        }}
        onCreated={(community, profile) => {
          setConnectTarget({ community, profile, origin: "create" });
          setError(null);
          setTransitionDirection("forward");
          setPage("connect");
        }}
        pubkey={selectedPubkey ?? ""}
      />
    );
  }

  if (page === "connect") {
    if (!connectTarget || !selectedPubkey) {
      return (
        <NativeUnavailableScreen
          body="Business setup is incomplete. Return to business details and retry before connecting."
          onBack={() => setPage("business")}
          title="Business not ready"
          testId="onboarding-business-not-ready"
        />
      );
    }
    const { community, profile, origin } = connectTarget;
    return (
      <ConnectSetupStep
        business={profile}
        communityId={community.id}
        error={error}
        onBack={() => {
          setError(null);
          setTransitionDirection("backward");
          // An owned business goes back to the list it was picked from.
          setPage(origin === "owned" ? "businesses" : "business");
        }}
        onContinue={(destination) => {
          const started = communityOnboarding.start({
            source: "first-community",
            firstCommunityPage: origin,
            relayUrl: businessCommunityRelayUrl(community),
            businessCommunityId: community.id,
            communityName: profile.name || community.name || community.slug,
          });
          if (!started) {
            setError(
              "Finish the community setup already in progress before opening this business.",
            );
            return;
          }
          setError(null);
          complete(selectedPubkey, {
            openAiSettings: destination === "settings",
          });
        }}
      />
    );
  }

  if (page === "unsupported") {
    return (
      <NativeUnavailableScreen
        body={unavailableBody(unsupportedCapability ?? "identity-recovery")}
        onBack={() => {
          setUnsupportedCapability(null);
          setTransitionDirection("backward");
          setPage("identity");
        }}
        testId="machine-onboarding-native-unavailable"
      />
    );
  }

  if (page === "backup" && !supportsNativeCapability("identity-backup")) {
    return (
      <NativeUnavailableScreen
        body={unavailableBody("identity-backup")}
        onBack={() => {
          setTransitionDirection("backward");
          setPage("identity-key-intro");
        }}
        testId="machine-onboarding-native-unavailable"
      />
    );
  }

  return (
    <OnboardingCard
      backAction={chromeBackAction}
      current={page === "config" ? 4 : page === "setup" ? 3 : 2}
      showStepIndicator={page !== "identity-key-help"}
      testId="machine-onboarding-gate"
    >
      {page === "identity-key-intro" ? (
        <IdentityKeyIntroduction
          direction={transitionDirection}
          disabled={isPending}
          error={error}
          onCreate={() => void loadFreshIdentity()}
          onOpenHelp={() => {
            setError(null);
            setIdentityKeyHelpReturnPage("identity-key-intro");
            setTransitionDirection("forward");
            setPage("identity-key-help");
          }}
        />
      ) : page === "identity-key-help" ? (
        <OnboardingSlideTransition
          className="flex min-h-0 w-full flex-col items-stretch justify-start text-left"
          direction={transitionDirection}
          transitionKey={`identity-key-help-${transitionDirection}`}
        >
          <IdentityKeyHelpContent />
        </OnboardingSlideTransition>
      ) : page === "key-import" ? (
        <OnboardingSlideTransition
          className="flex min-h-0 w-full flex-col items-stretch text-left"
          direction={transitionDirection}
          transitionKey={`machine-key-import-${keyImportDialog ?? "key"}-${transitionDirection}`}
        >
          {keyImportDialog === "backup" ? (
            <div className="w-full" data-testid="backup-recovery-dialog">
              <h1 className="text-title font-normal text-foreground">
                Restore from a backup file
              </h1>
              <p className="mt-2 w-full text-base leading-6 text-foreground/80">
                Choose the encrypted backup file you saved from Colony.
              </p>
              <NostrKeyImportForm
                key={keyImportFormKey}
                mode="backup"
                onBack={backFromKeyImport}
                onImport={importExistingIdentity}
                onImportingChange={setIsKeyImporting}
                onStageChange={setKeyImportStage}
                showBack={false}
                showPasswordStageBack={false}
                variant="spotlight"
              />
            </div>
          ) : keyImportDialog === "phone" ? (
            <div
              className="flex min-h-0 w-full flex-1 flex-col"
              data-testid="phone-recovery-dialog"
            >
              <h1 className="text-title font-normal text-foreground">
                {identityLost ? "Recover from your phone" : "Scan to sign in"}
              </h1>
              <p className="mt-2 w-full text-base leading-6 text-foreground/80">
                {phoneRecoveryStep === "loading" || phoneRecoveryStep === "qr"
                  ? "Scan this code with a device where you’re currently signed in to Colony."
                  : "Confirm the code before sharing your identity."}
              </p>
              <div
                className="flex min-h-0 flex-1 items-center justify-center"
                data-testid="identity-recovery-stage"
              >
                <IdentityRecoveryPairing
                  onRecovered={loadRecoveredIdentity}
                  onStepChange={setPhoneRecoveryStep}
                />
              </div>
            </div>
          ) : (
            <>
              <motion.div
                animate={{ opacity: 1 }}
                className="relative z-10 shrink-0 text-left"
                initial={reduceMotion ? false : { opacity: 0 }}
                key={keyImportStage}
                transition={{
                  duration: reduceMotion ? 0 : 0.3,
                  ease: "easeOut",
                }}
              >
                <h1 className="text-title font-normal text-foreground">
                  {keyImportStage === "backup-password"
                    ? "Unlock your account"
                    : "Enter your private key"}
                </h1>
                <div className="mt-2 w-full text-base leading-6 text-foreground/80">
                  {keyImportStage === "backup-password" ? (
                    "Enter your backup password to restore your identity."
                  ) : (
                    <p>
                      Paste your private key to sign in to Colony. You can also
                      use a{" "}
                      <button
                        className="rounded-sm font-medium underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                        data-testid="nostr-import-file-button"
                        disabled={isPending || isKeyImporting}
                        onClick={() => {
                          setKeyImportStage("key-entry");
                          setKeyImportDialog("backup");
                        }}
                        type="button"
                      >
                        backup file
                      </button>
                      , or{" "}
                      <button
                        className="rounded-sm font-medium underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                        data-testid="nostr-import-phone-link"
                        disabled={isPending || isKeyImporting}
                        onClick={() => {
                          setPhoneRecoveryStep("loading");
                          setKeyImportDialog("phone");
                        }}
                        type="button"
                      >
                        recover from your phone
                      </button>
                      .
                    </p>
                  )}
                </div>
              </motion.div>
              <div className="mt-8 w-full">
                <div className="flex flex-col items-stretch">
                  <NostrKeyImportForm
                    key={keyImportFormKey}
                    onBack={backFromKeyImport}
                    onImport={importExistingIdentity}
                    onImportingChange={setIsKeyImporting}
                    onStageChange={setKeyImportStage}
                    showBack={false}
                    showPasswordStageBack={false}
                    variant="spotlight"
                  />
                  {identityLost && keyImportStage === "key-entry" ? (
                    <Button
                      className={`${ONBOARDING_SECONDARY_CTA_CLASS} mt-2 px-5`}
                      disabled={isPending || isKeyImporting}
                      onClick={() => void replaceLostIdentity()}
                      type="button"
                      variant="ghost"
                    >
                      Start new identity
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </OnboardingSlideTransition>
      ) : page === "backup" ? (
        backupSubview === "password" ? (
          <DownloadKeyStep
            direction={backupDirection}
            onBack={backFromPasswordBackup}
            session={backupSession}
          />
        ) : (
          <BackupStep
            direction={backupDirection}
            identityStorage={identityStorage}
            onNext={() => {
              setTransitionDirection("forward");
              setPage("setup");
            }}
            onOpenPasswordBackup={() => {
              resetEncryptedBackupSession(backupSession);
              setBackupDirection("forward");
              setReturningFromSecurity(false);
              setBackupSubview("password");
            }}
            optionsExpanded={false}
            returningFromSecurity={returningFromSecurity}
          />
        )
      ) : page === "setup" ? (
        <SetupStep
          actions={{
            // Fresh-key users return to whichever identity backup subview
            // they used to reach setup; imported keys skip backup entirely.
            back: () => {
              backFromSetup();
            },
            next: (runtimeIds, nextConfigBackTarget = "list") => {
              const ids = Array.from(runtimeIds);
              setupSelectionHandoffRef.current = ids.length > 0;
              setReadyRuntimeIds(ids);
              // Harness install can fail (Windows/PATH/network). Don't soft-lock
              // onboarding, users can finish setup later in Settings → Agents.
              if (ids.length === 0) {
                complete(selectedPubkey ?? undefined, {
                  continueToProfile: !identityWasImported,
                });
                return;
              }
              setConfigBackTarget(nextConfigBackTarget);
              setIsChoosingDifferentHarness(false);
              setTransitionDirection("forward");
              setPage("config");
            },
          }}
          direction={transitionDirection}
          initialMethod={harnessConnectionMethod}
          onInitialListBack={
            isChoosingDifferentHarness ? returnToApiConfig : undefined
          }
          onBackActionChange={handleSetupBackActionChange}
          onMethodChange={setHarnessConnectionMethod}
          onReadyRuntimeIdsChange={handleReadyRuntimeIdsChange}
        />
      ) : (
        <DefaultConfigStep
          actions={{
            back: () => {
              backFromConfig();
            },
            complete: () =>
              complete(selectedPubkey ?? undefined, {
                continueToProfile: !identityWasImported,
              }),
            discardDraft: () => setDefaultConfigDraft(null),
            updateDraft: setDefaultConfigDraft,
            useDifferentHarness:
              harnessConnectionMethod === "api"
                ? () => {
                    setIsChoosingDifferentHarness(true);
                    setTransitionDirection("forward");
                    setPage("setup");
                  }
                : undefined,
          }}
          direction={transitionDirection}
          draft={defaultConfigDraft}
          onSavingChange={setIsDefaultConfigSaving}
          readyRuntimeIds={readyRuntimeIds}
        />
      )}
    </OnboardingCard>
  );
}
