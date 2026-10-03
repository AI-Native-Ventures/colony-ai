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
import { getIdentity } from "@/shared/api/tauriIdentity";
import { OnboardingScenePresentation } from "./OnboardingScenePresentation";

const ENTERING_CURTAIN_FADE_MS = 500;
const ENTERING_CURTAIN_MAX_WAIT_MS = 8_000;
const CONNECT_STALL_MS = 45_000;
const CONNECT_STALL_MESSAGE =
  "This is taking longer than expected. Check your connection and try again.";

/** Complete community setup without another profile or starter-team gate. */
export function CommunityOnboardingFlow({
  onCancel,
  onConnect,
  onRetryConnect,
}: {
  onCancel: () => void;
  onConnect: () => void;
  onRetryConnect?: () => void;
}) {
  const { transaction, update, clear } = useCommunityOnboarding();
  const queryClient = useQueryClient();
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
      await ensureOnboardingProfile(isCurrent);
      if (!isCurrent()) return;
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
        // entry — it exists for the Home-route fallback, and leaving it would
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
  }, [finish, isPending, queryClient, relayUrl, update, transaction?.id]);

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
      <OnboardingScenePresentation
        scene={error ? "connection-error" : "testing"}
        data={{
          name: "",
          email: "",
          business: transaction.communityName,
          website: "",
          description: "",
          error,
          scoutGuidance: {
            status: error ? "Your turn" : "Working",
            title: error
              ? "Let’s try that again."
              : "Getting your Colony ready.",
            copy: "Your account and business details are saved.",
            pose: error ? "waiting" : "working",
          },
        }}
        onCancelTest={onCancel}
        onNavigate={(scene) => (scene === "testing" ? retry() : onCancel())}
      />
    </div>
  );
}
