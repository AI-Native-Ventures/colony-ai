import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { SidebarRelayConnectionCompactCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import { useRelayConnection } from "@/shared/api/useRelayConnection";
import { useReconnectRelay } from "@/shared/api/useReconnectRelay";
import { isRelayUnreachableError } from "@/shared/lib/relayError";
import { FirstRunLink } from "./firstRunControls";
import type { ProfileStepActions, ProfileStepState } from "./types";

type ProfileStepProps = {
  actions: ProfileStepActions;
  state: ProfileStepState;
};

const ONBOARDING_CONNECTIVITY_SUCCESS_AUTO_DISMISS_MS = 2_500;

function OnboardingRelayConnectionErrorCard({
  isSaving,
  message,
}: {
  isSaving: boolean;
  message: string;
}) {
  const {
    isPending: isReconnectPending,
    isWaitingOnReconnectHook,
    reconnect,
  } = useReconnectRelay();
  // Track whether a reconnect attempt was ever initiated from this card so we
  // don't call markSuccess() on a "connected" state that pre-dates any click.
  const hadActiveReconnectRef = React.useRef(false);
  const relayConnectionState = useRelayConnection();
  const [dismissedErrorMessage, setDismissedErrorMessage] = React.useState<
    string | null
  >(null);
  const [isReconnectActionPending, setIsReconnectActionPending] =
    React.useState(false);
  const [hasSuccess, setHasSuccess] = React.useState(false);
  const reconnectActionPendingRef = React.useRef(false);
  const successTimeoutRef = React.useRef<number | null>(null);
  const wasSavingRef = React.useRef(isSaving);
  const isActionPending = isReconnectActionPending || isReconnectPending;

  React.useEffect(() => {
    return () => {
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (isSaving && !wasSavingRef.current) {
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
      setDismissedErrorMessage(null);
      setHasSuccess(false);
    }
    wasSavingRef.current = isSaving;
  }, [isSaving]);

  const markSuccess = React.useCallback(() => {
    setHasSuccess(true);
    if (successTimeoutRef.current !== null) {
      window.clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = window.setTimeout(() => {
      successTimeoutRef.current = null;
      setDismissedErrorMessage(message);
    }, ONBOARDING_CONNECTIVITY_SUCCESS_AUTO_DISMISS_MS);
  }, [message]);

  // Observe real relay connection state. When this card initiated a reconnect
  // attempt (phase-3 path: reconnect() returns false) and the relay later
  // becomes connected, mark success. Guard: only fire when we actually
  // started a reconnect so a pre-existing connected state doesn't trigger it.
  React.useEffect(() => {
    if (relayConnectionState === "connected" && hadActiveReconnectRef.current) {
      hadActiveReconnectRef.current = false;
      markSuccess();
    }
  }, [relayConnectionState, markSuccess]);

  const runConnectivityAction = React.useCallback(
    (runAction: () => Promise<boolean | undefined>) => {
      if (reconnectActionPendingRef.current) {
        return;
      }

      hadActiveReconnectRef.current = true;
      reconnectActionPendingRef.current = true;
      setIsReconnectActionPending(true);
      setHasSuccess(false);
      void Promise.resolve()
        .then(runAction)
        .then((didReconnect) => {
          if (didReconnect !== false) {
            // Synchronous success (phase 1) — clear the ref and mark success
            // immediately. The connection-state effect won't fire because the
            // ref was just cleared.
            hadActiveReconnectRef.current = false;
            markSuccess();
          }
          // didReconnect === false means phase 3 is active; the
          // connection-state effect will call markSuccess() when the relay
          // becomes connected.
        })
        .catch((error) => {
          hadActiveReconnectRef.current = false;
          const detail = error instanceof Error ? error.message : String(error);
          toast.error(`Could not reconnect to the relay. ${detail}`);
        })
        .finally(() => {
          reconnectActionPendingRef.current = false;
          setIsReconnectActionPending(false);
        });
    },
    [markSuccess],
  );

  const handleReconnectRelay = React.useCallback(() => {
    runConnectivityAction(reconnect);
  }, [reconnect, runConnectivityAction]);

  if (dismissedErrorMessage === message) {
    return null;
  }

  return createPortal(
    <div className="fixed bottom-4 left-4 z-50 w-[calc(100vw-2rem)] text-left sm:bottom-6 sm:left-6 sm:w-[22rem]">
      <SidebarRelayConnectionCompactCard
        actionTestId="onboarding-reconnect-relay"
        dismissClassName="pointer-events-auto [&>span]:opacity-100"
        isActionDisabled={isActionPending}
        isConnected={hasSuccess}
        isReconnectPending={isActionPending}
        isWaitingOnReconnectHook={isWaitingOnReconnectHook}
        onDismiss={() => setDismissedErrorMessage(message)}
        onReconnect={handleReconnectRelay}
        surface="secondary"
        testId="onboarding-relay-reconnect-card"
      />
    </div>,
    document.body,
  );
}

export function ErrorBanner({
  isSaving,
  message,
}: {
  isSaving: boolean;
  message: string | null;
}) {
  if (!message) {
    return null;
  }

  if (isRelayUnreachableError(message)) {
    return (
      <OnboardingRelayConnectionErrorCard
        isSaving={isSaving}
        key={message}
        message={message}
      />
    );
  }

  return (
    <p className="c3fr-error" role="alert">
      {message}
    </p>
  );
}

/** Step 1 of 2: the name people and agents will see. */
export function ProfileStep({ actions, state }: ProfileStepProps) {
  const { advanceWithoutSaving, skipForNow, submit, updateDisplayName } =
    actions;
  const { isReadyToSubmit, isSaving, name, saveRecovery } = state;
  const displayNameDraft = name.draftValue;
  const canSubmit =
    displayNameDraft.trim().length > 0 && isReadyToSubmit && !isSaving;
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      aria-labelledby="op-name-title"
      className="c3fr-profile-card"
      data-testid="onboarding-page-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) submit();
      }}
    >
      <span className="c3fr-eyebrow c3fr-eyebrow-accent">Step 1 of 2</span>
      <div className="c3fr-head">
        <h2
          className="c3fr-title c3fr-title-profile"
          id="op-name-title"
          tabIndex={-1}
        >
          What should we call you?
        </h2>
        <p className="c3fr-lede c3fr-lede-card">
          Pick the name people and agents will see in Colony. You can change it
          anytime.
        </p>
      </div>
      <div className="c3fr-field-group">
        <label className="c3fr-label" htmlFor="onboarding-display-name">
          Name
        </label>
        <input
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          className="c3fr-input"
          data-testid="onboarding-display-name"
          disabled={isSaving}
          id="onboarding-display-name"
          onChange={(event) => updateDisplayName(event.target.value)}
          placeholder="Enter your name"
          ref={inputRef}
          spellCheck={false}
          value={displayNameDraft}
        />
      </div>
      {saveRecovery.errorMessage ? (
        <ErrorBanner isSaving={isSaving} message={saveRecovery.errorMessage} />
      ) : null}
      <div className="c3fr-profile-actions">
        <button
          className="c3fr-pane-primary"
          data-testid="onboarding-next"
          disabled={!canSubmit}
          type="submit"
        >
          {isSaving ? "Saving…" : "Continue"}
        </button>
        <FirstRunLink
          className="c3fr-profile-skip"
          data-testid="onboarding-skip"
          disabled={isSaving}
          onClick={skipForNow}
        >
          Skip for now
        </FirstRunLink>
        {saveRecovery.canAdvanceWithoutSaving ? (
          <FirstRunLink
            className="c3fr-profile-skip"
            data-testid="onboarding-next-without-saving"
            onClick={advanceWithoutSaving}
          >
            Continue without saving
          </FirstRunLink>
        ) : null}
      </div>
    </form>
  );
}
