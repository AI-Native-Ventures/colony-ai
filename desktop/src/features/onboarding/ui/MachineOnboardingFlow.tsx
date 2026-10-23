import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";

import {
  getIdentity,
  importIdentity,
  persistCurrentIdentity,
  signOut,
} from "@/shared/api/tauriIdentity";
import {
  type NativeCapability,
  supportsNativeCapability,
} from "@/shared/api/nativeBridge";
import type {
  AccountAuthClient,
  AccountAuthRecord,
} from "../accountAuthClient";
import { AccountAuthFlow } from "./AccountAuthFlow";
import { AdvancedSignIn } from "./AdvancedSignIn";
import { NativeUnavailableScreen } from "./NativeUnavailableScreen";
import {
  type MachineOnboardingPage,
  resolveInitialMachineOnboardingState,
} from "./machineOnboardingStartup";
import { useCommunityOnboarding } from "../communityOnboarding";
import { useDeviceAiConnectionCheck } from "../deviceAiConnection";
import {
  firstRunInviteFromTransaction,
  type FirstRunInvite,
} from "../firstRunInvite";
import { lastVisitedLabel, recordBusinessVisit } from "../businessVisits";
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
  const [error, setError] = React.useState<string | null>(null);
  const [unsupportedCapability, setUnsupportedCapability] =
    React.useState<NativeCapability | null>(
      () => initialState.unsupportedCapability,
    );
  const [isPending, setIsPending] = React.useState(false);
  // True once this computer has a sign-in in hand (an account's key or one of
  // the advanced routes), so a later invite link goes straight to Join.
  const [signedIn, setSignedIn] = React.useState(false);
  // A key made here has no name or photo yet: the profile step follows.
  const [madeNewKey, setMadeNewKey] = React.useState(false);
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
    "account-auth" | "businesses" | "identity"
  >("account-auth");
  const [selectedPubkey, setSelectedPubkey] = React.useState<string | null>(
    null,
  );
  const showUnsupported = React.useCallback((capability: NativeCapability) => {
    setUnsupportedCapability(capability);
    setError(null);
    setPage("unsupported");
  }, []);

  /**
   * Where a signed-in person goes next: the invite they hold, the businesses
   * they own (to pick one), or the business step to make a first one. Account
   * sign-in and the advanced key routes all end here.
   */
  const routeAfterSignIn = React.useCallback(
    async (pubkey: string, backPage: "account-auth" | "identity") => {
      setBusinessListError(null);
      // Invited people join the workspace they were invited to. They are
      // never sent to create a business of their own.
      const invite = pendingInviteRef.current;
      if (invite) {
        setInviteSnapshot(invite);
        setPage("invite");
        return;
      }
      try {
        const owned = await listOwnedBusinesses(
          pubkey,
          (id) => readOnboardingBusinessProfile(id)?.name ?? null,
        );
        setOwnedCommunities(owned);
        setBusinessBackPage(owned.length > 0 ? "businesses" : backPage);
        setPage(owned.length > 0 ? "businesses" : "business");
      } catch {
        setOwnedCommunities([]);
        setBusinessListError(
          "Could not load your businesses. Start a new business or try again later.",
        );
        setBusinessBackPage("businesses");
        setPage("businesses");
      }
    },
    [],
  );

  /** Create my sign-in: use the key this computer holds (or make the first one). */
  const createSignIn = React.useCallback(async () => {
    setIsPending(true);
    setError(null);
    try {
      const identity = await getIdentity();
      queryClient.setQueryData(["identity"], identity);
      continueWithIdentity(identity.pubkey);
      setSelectedPubkey(identity.pubkey);
      setSignedIn(true);
      setMadeNewKey(true);
      setAccountIdentity({ email: "", name: "" });
      await routeAfterSignIn(identity.pubkey, "identity");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load identity",
      );
    } finally {
      setIsPending(false);
    }
  }, [continueWithIdentity, queryClient, routeAfterSignIn]);

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
      setSelectedPubkey(identity.pubkey);
      setSignedIn(true);
      setAccountIdentity({ email: "", name: "" });
      await routeAfterSignIn(identity.pubkey, "identity");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load identity",
      );
    } finally {
      setIsPending(false);
    }
  }, [
    continueWithRecoveredIdentity,
    queryClient,
    routeAfterSignIn,
    showUnsupported,
  ]);

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
      continueWithIdentity(identity.pubkey);
      setSelectedPubkey(identity.pubkey);
      setSignedIn(true);
      setMadeNewKey(true);
      await routeAfterSignIn(identity.pubkey, "identity");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to save identity",
      );
    } finally {
      setIsPending(false);
    }
  }, [continueWithIdentity, queryClient, routeAfterSignIn, showUnsupported]);

  const importExistingIdentity = React.useCallback(
    async (nsec: string, password?: string) => {
      if (!supportsNativeCapability("identity-import")) {
        showUnsupported("identity-import");
        return;
      }
      const identity = await importIdentity(nsec, password);
      continueWithIdentity(identity.pubkey);
      queryClient.setQueryData(["identity"], identity);
      setSelectedPubkey(identity.pubkey);
      setSignedIn(true);
      setMadeNewKey(false);
      setAccountIdentity({ email: "", name: "" });
      await routeAfterSignIn(identity.pubkey, "identity");
    },
    [continueWithIdentity, queryClient, routeAfterSignIn, showUnsupported],
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
      setSignedIn(true);
      setSelectedPubkey(identity.pubkey);
      setAccountIdentity({
        email: account.email,
        name: readRememberedSignupName(account.email),
      });
      await routeAfterSignIn(account.pubkey, "account-auth");
    },
    [continueWithIdentity, queryClient, routeAfterSignIn, showUnsupported],
  );

  // A link opened (or pasted) while the person is already signed in becomes the
  // invite scene instead of a stray business form or a second sign-in.
  const inviteCode = pendingInvite?.code;
  // biome-ignore lint/correctness/useExhaustiveDependencies: inviteCode re-runs this when a new invite arrives; the invite itself is read from the ref.
  React.useEffect(() => {
    const invite = pendingInviteRef.current;
    if (
      !invite ||
      !signedIn ||
      (page !== "business" && page !== "businesses" && page !== "account-auth")
    )
      return;
    setInviteSnapshot(invite);
    setPage("invite");
  }, [signedIn, inviteCode, page]);

  const openInviteLink = () => setPage("invite-link");
  /** Start (or switch to) the invite a person typed, then sign them in or join. */
  const startInvite = (target: { relayUrl: string; code: string }) => {
    const started = communityOnboarding.start({
      source: "first-community",
      firstCommunityPage: "join",
      relayUrl: target.relayUrl,
      inviteCode: target.code,
    });
    if (!started) {
      return "Another workspace setup is already in progress. Finish it first.";
    }
    setPage(signedIn ? "invite" : "account-auth");
    return null;
  };

  if (page === "invite-link") {
    return (
      <InviteLinkScene
        onBack={() => setPage(signedIn ? "businesses" : "account-auth")}
        onContinue={startInvite}
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
            setPage("business");
          },
        }}
        onUseAnotherAccount={() => {
          setSignedIn(false);
          setPage("account-auth");
        }}
        onUseAnotherInvite={(target) => {
          communityOnboarding.clear();
          return startInvite(target);
        }}
        onUseAnotherLink={() => {
          communityOnboarding.clear();
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
        onHaveInviteLink={pendingInvite ? undefined : openInviteLink}
        onAdvanced={() => {
          setSignedIn(false);
          setPage("identity");
        }}
        onAuthenticated={installAccount}
        standalone
      />
    );
  }

  if (page === "identity") {
    return (
      <AdvancedSignIn
        error={error}
        hasSelectedIdentity={selectedPubkey !== null}
        identityLost={identityLost}
        isPending={isPending}
        onBack={() => {
          setError(null);
          setPage("account-auth");
        }}
        onCreate={() => void createSignIn()}
        onImport={importExistingIdentity}
        onRecovered={loadRecoveredIdentity}
        onStartNewIdentity={() => void replaceLostIdentity()}
      />
    );
  }

  if (page === "businesses") {
    const choices: OnboardingBusinessChoice[] = ownedCommunities.map(
      (community) => ({
        id: community.id,
        name: community.name || community.slug,
        role: "Owner",
        lastVisited: lastVisitedLabel(community.id),
        logoUrl: readOnboardingBusinessProfile(community.id)?.logoUrl ?? null,
      }),
    );
    return (
      <OnboardingScenePresentation
        businessChoices={choices}
        data={{
          name: accountIdentity.name,
          email: "",
          signedInEmail: accountIdentity.email || undefined,
          business: choices[0]?.name ?? "",
          website: "",
          description: "",
        }}
        error={businessListError}
        onCreateBusiness={() => {
          setBusinessBackPage("businesses");
          setPage("business");
        }}
        onHaveInviteLink={openInviteLink}
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
              recordBusinessVisit(selected.id);
              complete(selectedPubkey);
              return;
            }
            setConnectTarget({
              community: selected,
              profile: ownedBusinessProfile(selected),
              origin: "owned",
            });
            setError(null);
            setPage("connect");
          });
        }}
        onSignOut={() => {
          const confirmed = window.confirm(
            "Sign out of Colony on this computer? You can sign in again any time.",
          );
          if (confirmed) void signOut().catch(() => undefined);
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
          setPage(businessBackPage);
        }}
        onCreated={(community, profile) => {
          setConnectTarget({ community, profile, origin: "create" });
          setError(null);
          setPage("connect");
        }}
        onHaveInviteLink={
          pendingInvite || businessBackPage === "businesses"
            ? undefined
            : openInviteLink
        }
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
          recordBusinessVisit(community.id);
          complete(selectedPubkey, {
            // A key made here has no name or photo yet: the profile step
            // follows the business, as it did for new keys before.
            continueToProfile: madeNewKey,
            openAiSettings: destination === "settings",
          });
        }}
      />
    );
  }

  return (
    <NativeUnavailableScreen
      body={unavailableBody(unsupportedCapability ?? "identity-recovery")}
      onBack={() => {
        setUnsupportedCapability(null);
        setPage("identity");
      }}
      testId="machine-onboarding-native-unavailable"
    />
  );
}
