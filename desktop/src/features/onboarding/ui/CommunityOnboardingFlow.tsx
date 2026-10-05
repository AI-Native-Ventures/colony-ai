import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  markCommunityOnboardingComplete,
  useCommunityOnboarding,
} from "../communityOnboarding";
import { initializeStarterChannels } from "../hooks";
import { useClaimInvite } from "../useClaimInvite";
import { ensureOnboardingProfile } from "../onboardingProfile";
import {
  takePendingWelcomeChannelForDirectEntry,
  WELCOME_SURFACE_READY_EVENT,
} from "../welcome";
import { importIdentity } from "@/shared/api/tauriIdentity";
import { getChannels } from "@/shared/api/tauriChannels";
import { useCommunities } from "@/features/communities/useCommunities";
import { isTerminalInviteMessage } from "../inviteFailure";
import { pickMemberLandingChannel } from "../memberLanding";
import { InviteClaimFailed } from "./InviteClaimFailed";
import { relayClient } from "@/shared/api/relayClient";
import { MembershipDenied } from "./MembershipDenied";
import { getMyRelayMembershipLookup } from "@/shared/api/relayMembers";
import { getIdentity } from "@/shared/api/tauriIdentity";
import { OnboardingScenePresentation } from "./OnboardingScenePresentation";

const ENTERING_CURTAIN_FADE_MS = 500;
const ENTERING_CURTAIN_MAX_WAIT_MS = 8_000;
const CONNECT_STALL_MS = 45_000;
const CONNECT_STALL_MESSAGE =
  "This is taking longer than expected. Check your connection and try again.";

/** Complete community setup without another profile or starter-team gate. */
export function CommunityOnboardingFlow({
  onConnect,
  onRetryConnect,
  onChangeCommunity,
  onIdentityRecovered,
}: {
  onConnect: () => void;
  onRetryConnect?: () => void;
  onChangeCommunity: () => void;
  onIdentityRecovered: (pubkey: string) => void;
}) {
  const { transaction, update, clear } = useCommunityOnboarding();
  const { communities } = useCommunities();
  const queryClient = useQueryClient();
  const [pubkey, setPubkey] = React.useState("");
  React.useEffect(() => {
    let active = true;
    void getIdentity()
      .then((identity) => {
        if (active) setPubkey(identity.pubkey);
      })
      .catch(() => {
        /* Entry retries identity lookup before provisioning. */
      });
    return () => {
      active = false;
    };
  }, []);
  const [isPending, setIsPending] = React.useState(false);
  const started = React.useRef<string | null>(null);
  const liveTransaction = React.useRef(transaction);
  liveTransaction.current = transaction;
  useClaimInvite();
  React.useEffect(() => {
    if (transaction?.stage === "connecting") onConnect();
  }, [onConnect, transaction?.stage]);
  const isEnteringStage = transaction?.stage === "entering";
  React.useEffect(() => {
    if (!isEnteringStage) return;
    let fadeTimer: number | null = null;
    const beginFade = () => {
      if (fadeTimer !== null) return;
      fadeTimer = window.setTimeout(clear, ENTERING_CURTAIN_FADE_MS);
    };
    window.addEventListener(WELCOME_SURFACE_READY_EVENT, beginFade);
    const safetyTimer = window.setTimeout(
      beginFade,
      ENTERING_CURTAIN_MAX_WAIT_MS,
    );
    return () => {
      window.removeEventListener(WELCOME_SURFACE_READY_EVENT, beginFade);
      window.clearTimeout(safetyTimer);
      if (fadeTimer !== null) window.clearTimeout(fadeTimer);
    };
  }, [clear, isEnteringStage]);
  const stage = transaction?.stage;
  const id = transaction?.id;
  const error = transaction?.error;
  React.useEffect(() => {
    if (!id || error || (stage !== "claiming" && stage !== "connecting"))
      return;
    const timer = window.setTimeout(
      () => update({ error: CONNECT_STALL_MESSAGE }, id),
      CONNECT_STALL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [id, error, stage, update]);
  const relayUrl = transaction?.relayUrl;
  const finish = React.useCallback(async () => {
    if (!relayUrl) return;
    const identity = await getIdentity();
    markCommunityOnboardingComplete(identity.pubkey, relayUrl);
    clear();
  }, [clear, relayUrl]);
  const finalize = React.useCallback(async () => {
    if (isPending || !relayUrl) return;
    const transactionId = transaction?.id;
    const isCurrent = () => liveTransaction.current?.id === transactionId;
    setIsPending(true);
    update({ stage: "finalizing", error: undefined });
    try {
      const identity = await getIdentity();
      const { snapshotFound, membership } = await getMyRelayMembershipLookup();
      if (!isCurrent()) return;
      if (snapshotFound && membership === null)
        throw new Error("relay_membership_required");
      await ensureOnboardingProfile(isCurrent);
      if (!isCurrent()) return;
      if (transaction?.inviteCode) {
        // Joined by invite: land in the workspace's shared channels. The
        // private Welcome and business setup belong to the owner.
        const landing = pickMemberLandingChannel(
          (await getChannels(null)).channels ?? [],
        );
        if (!isCurrent()) return;
        if (landing) window.location.hash = `/channels/${landing}`;
        await finish();
        return;
      }
      const result = await initializeStarterChannels(queryClient, {
        focus: true,
        pubkey: identity.pubkey,
        communityScope: relayUrl,
      });
      if (!isCurrent()) return;
      if (!result.ok) throw new Error(result.reason);
      if (result.focusChannelId) {
        // Direct entry: point the router at the Welcome channel *before* the
        // app mounts, so it never lands on Home first. Consume the pending
        // entry. It exists for the Home-route fallback, and leaving it would
        // yank a later Home visit back to Welcome.
        takePendingWelcomeChannelForDirectEntry();
        window.location.hash = `/channels/${result.focusChannelId}`;
        markCommunityOnboardingComplete(identity.pubkey, relayUrl);
        // Keep this screen mounted as a curtain over the loading app; the
        // "entering" stage fades it out once Welcome reports ready.
        update({ stage: "entering", error: undefined });
        return;
      }
      await finish();
    } catch (error) {
      if (!isCurrent()) return;
      update({
        error: error instanceof Error ? error.message : String(error),
      });
      setIsPending(false);
    }
  }, [
    finish,
    isPending,
    queryClient,
    relayUrl,
    update,
    transaction?.id,
    transaction?.inviteCode,
  ]);

  React.useEffect(() => {
    if (
      !id ||
      error ||
      !["profile", "team-intro", "finalizing"].includes(stage ?? "") ||
      started.current === id
    )
      return;
    started.current = id;
    void finalize();
  }, [id, error, stage, finalize]);
  if (!transaction) return null;
  const retry = () => {
    started.current = null;
    if (stage === "claiming" || stage === "connecting") {
      update({
        stage: transaction.inviteCode ? "claiming" : "connecting",
        error: undefined,
      });
      if (stage === "connecting") onRetryConnect?.();
    } else update({ stage: "profile", error: undefined });
  };
  return (
    <div data-testid="community-onboarding-flow">
      {stage === "deferred" ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 rounded-lg border bg-background p-4 text-sm"
        >
          Welcome setup is unfinished.{" "}
          <button type="button" onClick={retry}>
            Retry setup
          </button>
        </div>
      ) : /must be a relay member|not.*member|relay_membership_required|membership.?required|membership.?denied|restricted:|forbidden/i.test(
          error ?? "",
        ) ? (
        <OnboardingScenePresentation
          scene="community-entry-error"
          data={{
            hideProgress: transaction.source !== "first-community",
            name: "",
            email: "",
            business: transaction.communityName,
            website: "",
            description: "",
            error,
            scoutGuidance: {
              status: "Your turn",
              title: "Let’s connect you to your community.",
              copy: "You can use an invitation or choose another community.",
              pose: "waiting",
            },
          }}
          contentOverride={
            <MembershipDenied
              embedded
              activeRelayUrl={transaction.relayUrl}
              pubkey={pubkey}
              onBack={onChangeCommunity}
              onChangeCommunity={onChangeCommunity}
              onRetry={retry}
              onImportKey={async (nsec) => {
                const identity = await importIdentity(nsec);
                onIdentityRecovered(identity.pubkey);
                setPubkey(identity.pubkey);
                relayClient.disconnect();
                queryClient.setQueryData(["identity"], identity);
                queryClient.removeQueries({ queryKey: ["profile"] });
                started.current = null;
                update({ stage: "connecting", error: undefined });
                onRetryConnect?.();
              }}
            />
          }
        />
      ) : stage === "claiming" &&
        error &&
        transaction.source !== "membership-recovery" ? (
        <OnboardingScenePresentation
          scene="community-entry-error"
          data={{
            hideProgress: transaction.source !== "first-community",
            name: "",
            email: "",
            business: transaction.communityName,
            website: "",
            description: "",
            scoutGuidance: {
              status: "Your turn",
              title: "Let’s sort out this invite.",
              copy: "Your own workspace is safe. Choose how to carry on.",
              pose: "waiting",
            },
          }}
          contentOverride={
            <InviteClaimFailed
              canRetry={!isTerminalInviteMessage(error)}
              hasWorkspace={communities.length > 0}
              message={error}
              onLeave={clear}
              onRetry={retry}
            />
          }
        />
      ) : (
        <OnboardingScenePresentation
          scene={error ? "community-entry-error" : "community-entry"}
          data={{
            hideProgress: transaction.source !== "first-community",
            name: "",
            email: "",
            business: transaction.communityName,
            website: "",
            description: "",
            error,
            entryCanOpen: stage !== "connecting" && stage !== "claiming",
            scoutGuidance: {
              status: error ? "Your turn" : "Working",
              title: error
                ? "Let’s try that again."
                : "Getting your Colony ready.",
              copy:
                transaction.source === "first-community"
                  ? "Your account and business details are saved."
                  : "Your community connection is saved.",
              pose: error ? "waiting" : "working",
            },
          }}
          onNavigate={(scene) => {
            if (scene === "community-entry") retry();
            else if (stage === "connecting" || stage === "claiming")
              onChangeCommunity();
            else update({ stage: "deferred" });
          }}
        />
      )}
    </div>
  );
}
