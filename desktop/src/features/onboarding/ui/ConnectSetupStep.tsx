import { discoverAgentModels } from "@/shared/api/agentModels";
import { OpenRouterConnectionPanel } from "@/shared/ui/OpenRouterConnectionPanel";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import {
  runOnboardingConnectionTest,
  cancelOnboardingConnectionTest,
  subscribeOnboardingConnectionProgress,
  type OnboardingConnectionProgress,
  type OnboardingConnectionProof,
} from "./onboardingConnectionTest";
import { buildOnboardingRuntimeCandidate } from "./saveOnboardingRuntime";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  useAcpAuthMethodsQuery,
  useAcpRuntimesQueryForced,
  useGitBashPrerequisiteQuery,
  useConnectAcpRuntimeMutation,
  useInstallAcpRuntimeMutation,
} from "@/features/agents/hooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import {
  AiKeyConnectionPanel,
  CreditsComingSoon,
} from "./AiKeyConnectionPanel";
import { resolveAgentPrerequisiteReadiness } from "./agentReadiness";
import type {
  GlobalAgentConfig,
  AcpRuntimeCatalogEntry,
  GitBashPrerequisite,
} from "@/shared/api/types";
import { getInstallErrorMessage } from "@/shared/lib/installError";
import { Button } from "@/shared/ui/button";
import type { OnboardingBusinessProfile } from "./BusinessSetupStep";
import {
  OnboardingScenePresentation,
  type OnboardingSceneData,
} from "./OnboardingScenePresentation";
import type { OnboardingSceneId } from "./onboardingScenes";
import { scoutGuidance } from "./scoutGuidance";
import {
  getVisibleOnboardingRuntimes,
  runtimeIsReadyForOnboarding,
} from "./onboardingRuntimeSelection";
import {
  harnessDetectionStatus,
  harnessInstallLabel,
} from "./harnessDetectionState";
import { getRuntimeDisplayLabel, RuntimeIcon } from "./RuntimeIcon";

type ConnectSetupStepProps = {
  business: OnboardingBusinessProfile;
  communityId: string;
  error?: string | null;
  onBack: () => void;
  onContinue: (destination?: "settings") => void;
};

type HarnessHeader = {
  label: string;
  status: string;
  mark: React.ReactNode;
};

function getRuntimeHeaderStatus(
  runtime: AcpRuntimeCatalogEntry,
  globalConfig: GlobalAgentConfig,
  gitBashPrerequisite: GitBashPrerequisite | null | undefined,
) {
  const prerequisite = resolveAgentPrerequisiteReadiness(
    runtime.id,
    gitBashPrerequisite,
  );
  if (!prerequisite.ready)
    return prerequisite.reason === "git-bash"
      ? "Git for Windows needed"
      : "Checking prerequisites";
  if (runtime.id === "buzz-agent")
    return runtime.availability === "available" ? "Included" : "Not available";
  if (runtimeIsReadyForOnboarding(runtime, globalConfig, gitBashPrerequisite))
    return runtime.authStatus.status === "logged_in"
      ? "Installed"
      : "Configured";
  return harnessDetectionStatus(runtime, false);
}

function RuntimeOption({
  globalConfig,
  gitBashPrerequisite,
  isFetching,
  onRefresh,
  runtime,
  selected,
  onSelect,
}: {
  globalConfig: GlobalAgentConfig;
  gitBashPrerequisite: GitBashPrerequisite | null | undefined;
  isFetching: boolean;
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
  const prerequisite = resolveAgentPrerequisiteReadiness(
    runtime.id,
    gitBashPrerequisite,
  );
  const ready =
    runtimeIsReadyForOnboarding(runtime, globalConfig, gitBashPrerequisite) &&
    prerequisite.ready;
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

  // Not-ready states use the harness detection taxonomy (install, adapter,
  // sign-in and unprobed authentication are distinct). A ready harness is
  // known to be signed in; the bundled agent is configured by provider, model
  // and credentials, so Connect never implies a sign-in that was not probed.
  let status = harnessDetectionStatus(runtime, false);
  if (ready)
    status =
      runtime.id !== "buzz-agent" && runtime.authStatus.status === "logged_in"
        ? "Installed"
        : "Configured on this computer";
  else if (runtime.id === "buzz-agent") status = "No AI connected yet";

  if (!prerequisite.ready) status = prerequisite.copy;

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
          <RuntimeIcon className="size-8 shrink-0" runtime={runtime} />
          <strong>{getRuntimeDisplayLabel(runtime)}</strong>
          <span className="selection-dot" />
        </span>
        <span className="provider-account">{status}</span>
        {runtime.availability === "adapter_missing" ? (
          <span className="provider-account">
            {getRuntimeDisplayLabel(runtime)} is installed. Its connection
            adapter is missing.
          </span>
        ) : null}
      </button>
      {ready && (runtime.id === "claude" || runtime.id === "codex") ? (
        <p className="usage-unavailable">
          Usage unavailable
          <span>Your allowance may still be available.</span>
        </p>
      ) : null}
      <div className="runtime-actions">
        {ready ? (
          <span className="provider-status is-connected">
            {runtime.authStatus.status === "logged_in"
              ? "Installed"
              : "Configured"}
          </span>
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
        runtime.availability !== "available" &&
        runtime.canAutoInstall ? (
          <Button
            className="runtime-action"
            disabled={installMutation.isPending}
            onClick={install}
            type="button"
            variant="outline"
          >
            {installMutation.isPending
              ? "Installing…"
              : harnessInstallLabel(runtime)}
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
            {harnessInstallLabel(runtime)}
          </Button>
        ) : null}
        {!ready &&
        runtime.id !== "buzz-agent" &&
        runtime.availability === "available" &&
        !needsSignIn ? (
          <>
            {runtime.id === "claude" || runtime.id === "codex" ? (
              <Button
                aria-label={`Check ${getRuntimeDisplayLabel(runtime)} again`}
                className="runtime-action"
                disabled={isFetching}
                onClick={onRefresh}
                type="button"
                variant="outline"
              >
                Check again
              </Button>
            ) : (
              <p className="provider-account">
                Sign-in cannot be checked. Use the setup guide, or choose
                another connection.
              </p>
            )}
            <Button
              aria-label={`Open ${getRuntimeDisplayLabel(runtime)} setup guide`}
              className="runtime-action"
              onClick={() => void openUrl(runtime.installInstructionsUrl)}
              type="button"
              variant="outline"
            >
              Open setup guide
            </Button>
          </>
        ) : null}
      </div>
      {actionError ? (
        <p className="runtime-action-error text-sm" role="alert">
          {actionError}
        </p>
      ) : null}
      {connectMutation.error instanceof Error ? (
        <p className="runtime-action-error text-sm" role="alert">
          Sign-in could not be started. Try again.
        </p>
      ) : null}
      {authMethods.error instanceof Error ? (
        <p className="runtime-action-error text-sm" role="alert">
          Sign-in options are unavailable.
        </p>
      ) : null}
    </div>
  );
}

function RuntimeConnectionPanel({
  error,
  onHarnessHeaderChange,
  selectedRuntimeId,
  onRuntimeSelect,
}: {
  error?: string | null;
  onHarnessHeaderChange: (header: HarnessHeader) => void;
  selectedRuntimeId: string | null;
  onRuntimeSelect: (id: string) => void;
}) {
  const { globalConfig } = useGlobalAgentConfig();
  const query = useAcpRuntimesQueryForced();
  const gitBashQuery = useGitBashPrerequisiteQuery();
  const gitBashPrerequisite = gitBashQuery.isError
    ? undefined
    : gitBashQuery.data;
  const runtimes = getVisibleOnboardingRuntimes(query.data ?? []);
  const ready = runtimes.filter(
    (runtime) =>
      runtimeIsReadyForOnboarding(runtime, globalConfig, gitBashPrerequisite) &&
      resolveAgentPrerequisiteReadiness(runtime.id, gitBashPrerequisite).ready,
  );
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.id === selectedRuntimeId,
  );
  const refresh = React.useCallback(() => {
    void gitBashQuery.refetch();
    query.forceRefresh();
  }, [query.forceRefresh, gitBashQuery.refetch]);

  React.useEffect(() => {
    if (!selectedRuntimeId && runtimes.length > 0)
      onRuntimeSelect(runtimes[0].id);
  }, [runtimes, selectedRuntimeId, onRuntimeSelect]);

  React.useEffect(() => {
    const header: HarnessHeader = selectedRuntime
      ? {
          label: getRuntimeDisplayLabel(selectedRuntime),
          status: getRuntimeHeaderStatus(
            selectedRuntime,
            globalConfig,
            gitBashPrerequisite,
          ),
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
  }, [
    onHarnessHeaderChange,
    query.error,
    query.isFetching,
    selectedRuntime,
    globalConfig,
    gitBashPrerequisite,
  ]);

  return (
    <>
      {error ? (
        <div className="power-notice is-error" role="alert">
          <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6m0 3v.1" />
          </svg>
          <p>{error}</p>
        </div>
      ) : null}
      <div className="section-heading">
        <h3>On this computer</h3>
        <button
          aria-label="Check installed AI apps again"
          className="link"
          disabled={query.isFetching}
          onClick={() => void refresh()}
          type="button"
        >
          <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">
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
          <h3>Checking your installed apps.</h3>
          <p>We’re looking for supported apps on this computer.</p>
        </div>
      ) : null}
      {query.error instanceof Error ? (
        <div className="power-notice is-error" role="alert">
          <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">
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
              globalConfig={globalConfig}
              gitBashPrerequisite={gitBashPrerequisite}
              isFetching={query.isFetching}
              onRefresh={refresh}
              onSelect={() => onRuntimeSelect(runtime.id)}
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
        {selectedRuntime &&
        ready.some((runtime) => runtime.id === selectedRuntime.id)
          ? selectedRuntime.id === "claude" || selectedRuntime.id === "codex"
            ? "Your AI teammates share these allowances with your other usage."
            : `${getRuntimeDisplayLabel(selectedRuntime)} can be tested on this computer.`
          : ready.length > 0
            ? "Choose a signed-in harness to test."
            : "You can connect an AI harness later."}
      </p>
    </>
  );
}

export function ConnectSetupStep({
  business,
  error,
  onBack,
  onContinue,
}: ConnectSetupStepProps) {
  const queryClient = useQueryClient();
  const [selectedRuntimeId, setSelectedRuntimeId] = React.useState<
    string | null
  >(null);
  const [saving, setSaving] = React.useState(false);
  const [selectedModel, setSelectedModel] = React.useState<
    string | null | undefined
  >(undefined);
  const selectRuntime = React.useCallback((id: string) => {
    setSelectedRuntimeId(id);
    setSelectedModel(undefined);
  }, []);
  const [proof, setProof] = React.useState<OnboardingConnectionProof | null>(
    null,
  );
  const [testState, setTestState] = React.useState<
    "connect" | "testing" | "connected" | "connection-error"
  >("connect");
  const generation = React.useRef(0);
  React.useEffect(
    () => () => {
      generation.current += 1;
      void cancelOnboardingConnectionTest().catch(console.warn);
    },
    [],
  );
  const [connectionPhase, setConnectionPhase] =
    React.useState<OnboardingConnectionProgress>("starting");
  React.useEffect(
    () => subscribeOnboardingConnectionProgress(setConnectionPhase),
    [],
  );
  const [testedRuntimeId, setTestedRuntimeId] = React.useState<string | null>(
    null,
  );
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [connectionScene, setConnectionScene] = React.useState<
    | "connect"
    | "funding"
    | "credits-price-error"
    | "openrouter-unlinked"
    | "api-key"
  >("connect");
  const [harnessHeader, setHarnessHeader] = React.useState<HarnessHeader>({
    label: "Finding harnesses",
    status: "Checking",
    mark: null,
  });
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
  };
  const onSelectConnection = React.useCallback((scene: OnboardingSceneId) => {
    if (
      scene === "connect" ||
      scene === "credits-price-error" ||
      scene === "openrouter-unlinked" ||
      scene === "api-key"
    ) {
      setConnectionScene(scene);
    }
  }, []);

  const { globalConfig } = useGlobalAgentConfig();
  const gitBashQuery = useGitBashPrerequisiteQuery();
  const gitBashPrerequisite = gitBashQuery.isError
    ? undefined
    : gitBashQuery.data;
  const runtimes = useAcpRuntimesQueryForced();
  const selectedRuntime = runtimes.data?.find(
    (runtime) => runtime.id === selectedRuntimeId,
  );
  const bundled = runtimes.data?.find((runtime) => runtime.id === "buzz-agent");
  const [byokChecked, setByokChecked] = React.useState(false);
  const [openRouterReady, setOpenRouterReady] = React.useState(false);
  const [openRouterScene, setOpenRouterScene] =
    React.useState<OnboardingSceneId>("openrouter-unlinked");
  const keyScene =
    connectionScene === "api-key" || connectionScene === "openrouter-unlinked";
  const candidateRuntime = keyScene ? bundled : selectedRuntime;
  const aiReady =
    (connectionScene === "api-key"
      ? byokChecked
      : connectionScene === "openrouter-unlinked"
        ? openRouterReady && globalConfig.provider === "openrouter"
        : true) &&
    !!candidateRuntime &&
    runtimeIsReadyForOnboarding(
      candidateRuntime,
      globalConfig,
      gitBashPrerequisite,
    ) &&
    resolveAgentPrerequisiteReadiness(candidateRuntime.id, gitBashPrerequisite)
      .ready;
  React.useEffect(() => {
    if (!selectedRuntimeId && globalConfig.preferred_runtime) {
      setSelectedRuntimeId(globalConfig.preferred_runtime);
      setSelectedModel(globalConfig.model);
    }
  }, [globalConfig.preferred_runtime, globalConfig.model, selectedRuntimeId]);
  const testedRuntime = runtimes.data?.find(
    (runtime) => runtime.id === testedRuntimeId,
  );

  const proofModels = useQuery({
    queryKey: ["onboarding-proof-models", testedRuntime?.id, proof?.model],
    enabled: !!proof?.model && !!testedRuntime?.command,
    queryFn: () => {
      if (!testedRuntime?.command)
        throw new Error("Harness model catalog is unavailable.");
      return discoverAgentModels({
        agentCommand: testedRuntime.command,
        agentArgs: testedRuntime.defaultArgs,
        envVars: globalConfig.env_vars,
      });
    },
  });
  const proofModelLabel =
    proofModels.data?.models.find((model) => model.id === proof?.model)?.name ||
    proof?.model;

  const continueWithRuntime = async () => {
    if (!aiReady || connectionScene === "credits-price-error") {
      return;
    }
    const attempt = ++generation.current;
    const isCurrent = () => generation.current === attempt;
    setSaving(true);
    setSaveError(null);
    setProof(null);
    setConnectionPhase("starting");
    setTestState("testing");
    try {
      const runtimeId = keyScene ? "buzz-agent" : selectedRuntimeId;
      if (!runtimeId) throw new Error("Choose an AI harness before testing.");
      setTestedRuntimeId(runtimeId);
      const candidate = buildOnboardingRuntimeCandidate(
        globalConfig,
        runtimeId,
        runtimes.data ?? [],
        keyScene ? undefined : selectedModel,
      );
      const result = await runOnboardingConnectionTest(candidate, isCurrent);
      if (!isCurrent()) return;
      queryClient.setQueryData(globalAgentConfigQueryKey, result.config);
      setProof(result.proof);
      setTestState("connected");
    } catch (failure) {
      if (!isCurrent()) return;
      setSaveError(
        failure instanceof Error
          ? failure.message
          : "Your agent could not reply. Check sign-in and usage, then try again.",
      );
      setTestState("connection-error");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  if (testState !== "connect") {
    return (
      <OnboardingScenePresentation
        onCancelTest={() => {
          if (connectionPhase === "saving") return;
          generation.current += 1;
          void cancelOnboardingConnectionTest().catch(console.warn);
          setSaving(false);
          setProof(null);
          setTestState("connect");
        }}
        scene={testState}
        data={{
          ...data,
          harnessLabel: testedRuntime
            ? getRuntimeDisplayLabel(testedRuntime)
            : "Colony AI",
          connectionPhase,
          connectionReply: proof?.reply,
          effectiveModel: proofModelLabel,
          error: saveError,
        }}
        harnessMark={
          testedRuntime ? (
            <RuntimeIcon
              className="harness-mark-runtime"
              runtime={testedRuntime}
            />
          ) : null
        }
        onNavigate={(scene) => {
          if (scene === "workspace" && proof) {
            onContinue();
            return;
          }
          if (scene === "testing") {
            void continueWithRuntime();
            return;
          }
          if (testState === "testing" && connectionPhase === "saving") return;
          generation.current += 1;
          void cancelOnboardingConnectionTest().catch(console.warn);
          setSaving(false);
          setProof(null);
          setSaveError(null);
          setTestState("connect");
        }}
      />
    );
  }

  return (
    <OnboardingScenePresentation
      connectionContentOverride={
        <>
          {connectionScene === "connect" ? (
            <RuntimeConnectionPanel
              error={saveError ?? error}
              onHarnessHeaderChange={handleHarnessHeaderChange}
              selectedRuntimeId={selectedRuntimeId}
              onRuntimeSelect={selectRuntime}
            />
          ) : connectionScene === "openrouter-unlinked" ? (
            <OpenRouterConnectionPanel
              onboarding
              onTestConnection={() => void continueWithRuntime()}
              testDisabled={!aiReady || saving}
              onReadyChange={setOpenRouterReady}
              onStateChange={(state) =>
                setOpenRouterScene(`openrouter-${state}`)
              }
            />
          ) : connectionScene === "api-key" ? (
            <AiKeyConnectionPanel
              key={connectionScene}
              onCheckedChange={setByokChecked}
            />
          ) : (
            <CreditsComingSoon />
          )}
          {saveError && connectionScene !== "connect" ? (
            <p role="alert">{saveError}</p>
          ) : null}
          {connectionScene !== "openrouter-unlinked" &&
          (connectionScene === "connect" ||
            connectionScene === "credits-price-error" ||
            aiReady) ? (
            <div className="power-cta">
              <button
                className="primary full"
                disabled={
                  saving ||
                  !aiReady ||
                  connectionScene === "credits-price-error"
                }
                onClick={() => void continueWithRuntime()}
                type="button"
              >
                {connectionScene === "connect" && selectedRuntime
                  ? `Connect ${getRuntimeDisplayLabel(selectedRuntime)}`
                  : "Connect"}{" "}
                <span aria-hidden="true">→</span>
              </button>
              {aiReady && connectionScene === "connect" ? (
                <p>Sign-in stays with the provider.</p>
              ) : null}
              {!aiReady || connectionScene === "credits-price-error" ? (
                <button
                  className="back"
                  type="button"
                  onClick={() => onContinue()}
                >
                  Skip for now
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      }
      data={{
        ...data,
        ...(connectionScene === "credits-price-error"
          ? { scoutGuidance: scoutGuidance("connect") }
          : {}),
        ...(keyScene
          ? {
              harnessLabel: "Colony Agent",
              harnessStatus: bundled
                ? getRuntimeHeaderStatus(
                    bundled,
                    globalConfig,
                    gitBashPrerequisite,
                  )
                : "Unavailable",
            }
          : {}),
      }}
      harnessMark={keyScene ? undefined : harnessHeader.mark}
      onNavigate={onBack}
      onSelectConnection={onSelectConnection}
      scene={
        connectionScene === "openrouter-unlinked"
          ? openRouterScene
          : connectionScene
      }
    />
  );
}
