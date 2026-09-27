import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  useAcpAuthMethodsQuery,
  useAcpRuntimesQueryForced,
  useConnectAcpRuntimeMutation,
  useInstallAcpRuntimeMutation,
} from "@/features/agents/hooks";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { getInstallErrorMessage } from "@/shared/lib/installError";
import { Button } from "@/shared/ui/button";
import type { OnboardingBusinessProfile } from "./BusinessSetupStep";
import {
  OnboardingScenePresentation,
  type OnboardingSceneData,
} from "./OnboardingScenePresentation";
import type { OnboardingSceneId } from "./onboardingScenes";
import {
  getVisibleOnboardingRuntimes,
  runtimeIsReadyForOnboarding,
} from "./onboardingRuntimeSelection";
import { getRuntimeDisplayLabel, RuntimeIcon } from "./RuntimeIcon";
import {
  unavailableCreditsOnboardingApi,
  type CreditsSnapshot,
} from "./creditsOnboardingApi";

type ConnectSetupStepProps = {
  business: OnboardingBusinessProfile;
  communityId: string;
  error?: string | null;
  onBack: () => void;
  onContinue: () => void;
};

type HarnessHeader = {
  label: string;
  status: string;
  mark: React.ReactNode;
};

function getRuntimeHeaderStatus(runtime: AcpRuntimeCatalogEntry) {
  if (runtimeIsReadyForOnboarding(runtime)) return "Ready";
  if (
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_out"
  )
    return "Sign-in needed";
  if (
    runtime.availability === "available" &&
    runtime.authStatus.status === "unknown"
  )
    return "Checking status";
  if (runtime.availability === "available") return "Installed";
  return "Not available";
}

function RuntimeOption({
  onRefresh,
  runtime,
  selected,
  onSelect,
}: {
  onRefresh: () => void;
  runtime: AcpRuntimeCatalogEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const installMutation = useInstallAcpRuntimeMutation();
  const connectMutation = useConnectAcpRuntimeMutation();
  const needsSignIn =
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_out";
  const authMethods = useAcpAuthMethodsQuery(runtime.id, {
    enabled: needsSignIn,
  });
  const ready = runtimeIsReadyForOnboarding(runtime);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [waitingForSignIn, setWaitingForSignIn] = React.useState(false);

  React.useEffect(() => {
    if (!waitingForSignIn || !ready) return;
    setWaitingForSignIn(false);
    setActionError(null);
  }, [ready, waitingForSignIn]);

  const install = () => {
    setActionError(null);
    installMutation.mutate(runtime.id, {
      onSuccess: (result) => {
        if (!result.success) setActionError(getInstallErrorMessage(result));
        else void onRefresh();
      },
      onError: (error) => {
        setActionError(
          error instanceof Error ? error.message : "Install failed.",
        );
      },
    });
  };

  const signIn = () => {
    const method = authMethods.data?.methods[0];
    if (!method) {
      void authMethods.refetch();
      return;
    }
    setActionError(null);
    setWaitingForSignIn(true);
    connectMutation.mutate(
      { methodId: method.id, runtimeId: runtime.id },
      {
        onSuccess: () => void onRefresh(),
        onError: (error) => {
          setWaitingForSignIn(false);
          setActionError(
            error instanceof Error ? error.message : "Sign-in failed.",
          );
        },
      },
    );
  };

  let status = "Not installed";
  if (ready) status = "Ready on this computer";
  else if (
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_out"
  )
    status = "Sign-in needed";
  else if (
    runtime.availability === "available" &&
    runtime.authStatus.status === "unknown"
  )
    status = "Checking status";
  else if (runtime.availability === "available") status = "Installed";

  return (
    <div
      className={`subscription-card ${selected ? "selected" : ""}`}
      data-testid={`onboarding-connect-runtime-${runtime.id}`}
    >
      <button
        aria-pressed={selected}
        className="runtime-select"
        onClick={onSelect}
        type="button"
      >
        <span className="provider-top">
          <RuntimeIcon className="runtime-provider-icon" runtime={runtime} />
          <strong>{getRuntimeDisplayLabel(runtime)}</strong>
          <span className="selection-dot" />
        </span>
        <span className="provider-account">{status}</span>
      </button>
      <div className="runtime-actions">
        {ready ? (
          <span className="provider-status is-connected">Ready</span>
        ) : null}
        {!ready && needsSignIn ? (
          <Button
            className="runtime-action"
            disabled={connectMutation.isPending || waitingForSignIn}
            onClick={signIn}
            type="button"
            variant="outline"
          >
            {waitingForSignIn ? "Checking…" : "Sign in"}
          </Button>
        ) : null}
        {!ready &&
        runtime.availability === "available" &&
        runtime.canAutoInstall ? (
          <Button
            className="runtime-action"
            disabled={installMutation.isPending}
            onClick={install}
            type="button"
            variant="outline"
          >
            {installMutation.isPending ? "Installing…" : "Install"}
          </Button>
        ) : null}
        {!ready &&
        runtime.availability !== "available" &&
        !runtime.canAutoInstall ? (
          <Button
            className="runtime-action"
            onClick={() => void openUrl(runtime.installInstructionsUrl)}
            type="button"
            variant="outline"
          >
            Install
          </Button>
        ) : null}
      </div>
      {actionError ? (
        <p className="runtime-action-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {connectMutation.error instanceof Error ? (
        <p className="runtime-action-error" role="alert">
          Sign-in could not be started. Try again.
        </p>
      ) : null}
      {authMethods.error instanceof Error ? (
        <p className="runtime-action-error" role="alert">
          Sign-in options are unavailable.
        </p>
      ) : null}
    </div>
  );
}

function RuntimeConnectionPanel({
  error,
  onHarnessHeaderChange,
  onContinue,
}: {
  error?: string | null;
  onHarnessHeaderChange: (header: HarnessHeader) => void;
  onContinue: () => void;
}) {
  const query = useAcpRuntimesQueryForced();
  const runtimes = getVisibleOnboardingRuntimes(query.data ?? []);
  const ready = runtimes.filter(runtimeIsReadyForOnboarding);
  const [selectedRuntimeId, setSelectedRuntimeId] = React.useState<
    string | null
  >(null);
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.id === selectedRuntimeId,
  );
  const refresh = React.useCallback(
    () => query.forceRefresh(),
    [query.forceRefresh],
  );

  React.useEffect(() => {
    if (!selectedRuntimeId && runtimes.length > 0)
      setSelectedRuntimeId(runtimes[0].id);
  }, [runtimes, selectedRuntimeId]);

  React.useEffect(() => {
    const header: HarnessHeader = selectedRuntime
      ? {
          label: getRuntimeDisplayLabel(selectedRuntime),
          status: getRuntimeHeaderStatus(selectedRuntime),
          mark: (
            <RuntimeIcon
              className="harness-mark-runtime"
              runtime={selectedRuntime}
            />
          ),
        }
      : query.error instanceof Error
        ? { label: "Unavailable", status: "Check again", mark: null }
        : query.isFetching
          ? { label: "Finding harnesses", status: "Checking", mark: null }
          : {
              label: "No supported harness",
              status: "Unavailable",
              mark: null,
            };
    onHarnessHeaderChange(header);
  }, [onHarnessHeaderChange, query.error, query.isFetching, selectedRuntime]);

  return (
    <>
      {error ? (
        <div className="power-notice is-error" role="alert">
          <svg aria-hidden="true" className="icon">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6m0 3v.1" />
          </svg>
          <p>{error}</p>
        </div>
      ) : null}
      <div className="section-heading">
        <h3>On this computer</h3>
        <button className="link" onClick={() => void refresh()} type="button">
          <svg aria-hidden="true" className="icon">
            <path d="M20 11a8 8 0 1 0 2 5" />
            <path d="M20 4v7h-7" />
          </svg>
          Check again
        </button>
      </div>
      {query.isFetching && runtimes.length === 0 ? (
        <div
          className="discovery-wait"
          data-testid="onboarding-runtime-loading"
          role="status"
        >
          <span className="spinner" />
          <h3>Finding your AI apps.</h3>
          <p>Checking installations and signed-in accounts.</p>
        </div>
      ) : null}
      {query.error instanceof Error ? (
        <div className="power-notice is-error" role="alert">
          <svg aria-hidden="true" className="icon">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6m0 3v.1" />
          </svg>
          <p>
            We couldn’t check this computer. Your other connection options are
            still available.
          </p>
        </div>
      ) : null}
      {runtimes.length > 0 ? (
        <fieldset
          className="subscription-cards"
          id="onboarding-runtime-list"
          tabIndex={-1}
        >
          <legend className="sr-only">Detected AI apps</legend>
          {runtimes.map((runtime) => (
            <RuntimeOption
              key={runtime.id}
              onRefresh={refresh}
              onSelect={() => setSelectedRuntimeId(runtime.id)}
              runtime={runtime}
              selected={selectedRuntimeId === runtime.id}
            />
          ))}
        </fieldset>
      ) : null}
      {!query.isFetching && !query.error && runtimes.length === 0 ? (
        <div className="power-empty" data-testid="onboarding-acp-empty">
          <h3>No supported harnesses are available.</h3>
          <p>You can continue and connect a harness later.</p>
        </div>
      ) : null}
      <p className="power-caption">
        {selectedRuntime && runtimeIsReadyForOnboarding(selectedRuntime)
          ? `${getRuntimeDisplayLabel(selectedRuntime)} is ready on this computer.`
          : ready.length > 0
            ? "Choose a ready harness to continue."
            : "You can connect an AI harness later."}
      </p>
      <div className="power-cta">
        <button className="primary full" onClick={onContinue} type="button">
          Open my Colony
          <svg aria-hidden="true" className="icon">
            <path d="M4 12h15m-6-6 6 6-6 6" />
          </svg>
        </button>
      </div>
    </>
  );
}

export function ConnectSetupStep({
  business,
  communityId,
  error,
  onBack,
  onContinue,
}: ConnectSetupStepProps) {
  const [connectionScene, setConnectionScene] = React.useState<
    | "connect"
    | "funding"
    | "credits-price-error"
    | "openrouter-unlinked"
    | "api-key"
  >("connect");
  const [creditsSnapshot, setCreditsSnapshot] = React.useState<CreditsSnapshot>(
    {
      status: "unavailable",
      reason: "contract-not-available",
    },
  );
  const [harnessHeader, setHarnessHeader] = React.useState<HarnessHeader>({
    label: "Finding harnesses",
    status: "Checking",
    mark: null,
  });
  const creditsGeneration = React.useRef(0);
  const loadCredits = React.useCallback(async () => {
    const generation = ++creditsGeneration.current;
    setConnectionScene("funding");
    setCreditsSnapshot({ status: "loading" });
    try {
      const snapshot = await unavailableCreditsOnboardingApi.read(communityId);
      if (generation !== creditsGeneration.current) return;
      setCreditsSnapshot(snapshot);
      setConnectionScene(
        snapshot.status === "unavailable" ? "credits-price-error" : "funding",
      );
    } catch {
      if (generation !== creditsGeneration.current) return;
      setCreditsSnapshot({ status: "unavailable", reason: "request-failed" });
      setConnectionScene("credits-price-error");
    }
  }, [communityId]);
  React.useEffect(
    () => () => {
      creditsGeneration.current += 1;
    },
    [],
  );
  const handleHarnessHeaderChange = React.useCallback(
    (header: HarnessHeader) => {
      setHarnessHeader((current) =>
        current.label === header.label && current.status === header.status
          ? current
          : header,
      );
    },
    [],
  );
  const data: OnboardingSceneData = {
    name: "",
    email: "",
    business: business.name,
    website: business.website,
    description: business.description,
    logoUrl: business.logoUrl,
    harnessLabel: harnessHeader.label,
    harnessStatus: harnessHeader.status,
    creditsSnapshot,
  };
  const onSelectConnection = React.useCallback(
    (scene: OnboardingSceneId) => {
      if (
        scene === "connect" ||
        scene === "credits-price-error" ||
        scene === "openrouter-unlinked" ||
        scene === "api-key"
      ) {
        setConnectionScene(scene);
        if (scene === "credits-price-error") {
          void loadCredits();
        } else {
          creditsGeneration.current += 1;
        }
      }
    },
    [loadCredits],
  );

  return (
    <OnboardingScenePresentation
      connectionContentOverride={
        connectionScene === "connect" ? (
          <RuntimeConnectionPanel
            error={error}
            onHarnessHeaderChange={handleHarnessHeaderChange}
            onContinue={onContinue}
          />
        ) : undefined
      }
      data={data}
      harnessMark={harnessHeader.mark}
      onNavigate={onBack}
      onSelectConnection={onSelectConnection}
      onCreditsRetry={() => void loadCredits()}
      scene={connectionScene}
    />
  );
}
