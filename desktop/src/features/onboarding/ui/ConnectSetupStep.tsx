import * as React from "react";
import { OnboardingRuntimeModel } from "./OnboardingRuntimeModel";
import { useQueryClient } from "@tanstack/react-query";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import {
  runOnboardingConnectionTest,
  type OnboardingConnectionProof,
} from "./onboardingConnectionTest";
import { saveOnboardingRuntime } from "./saveOnboardingRuntime";
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
import {
  resolveAgentPrerequisiteReadiness,
  resolveAgentReadiness,
} from "./agentReadiness";
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
import {
  getVisibleOnboardingRuntimes,
  runtimeIsReadyForOnboarding,
} from "./onboardingRuntimeSelection";
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
  if (runtimeIsReadyForOnboarding(runtime, globalConfig, gitBashPrerequisite))
    return runtime.id === "buzz-agent" ? "Configured" : "Signed in";
  if (runtime.id === "buzz-agent") return "No AI connected yet";
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
  globalConfig,
  gitBashPrerequisite,
  onRefresh,
  runtime,
  selected,
  onSelect,
}: {
  globalConfig: GlobalAgentConfig;
  gitBashPrerequisite: GitBashPrerequisite | null | undefined;
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

  let status = "Not installed";
  if (ready)
    status =
      runtime.id === "buzz-agent"
        ? "Configured on this computer"
        : "Signed in on this computer";
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
  else if (runtime.id === "buzz-agent") status = "No AI connected yet";
  else if (runtime.availability === "available") status = "Installed";

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
      </button>
      <div className="runtime-actions">
        {ready ? (
          <span className="provider-status is-connected">
            {runtime.id === "buzz-agent" ? "Configured" : "Signed in"}
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
              globalConfig={globalConfig}
              gitBashPrerequisite={gitBashPrerequisite}
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
          ? `${getRuntimeDisplayLabel(selectedRuntime)} can be tested on this computer.`
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
    },
    [],
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
  const keyScene =
    connectionScene === "api-key" || connectionScene === "openrouter-unlinked";
  const aiReady = resolveAgentReadiness(
    runtimes.data ?? [],
    {
      ...globalConfig,
      preferred_runtime: keyScene ? "buzz-agent" : selectedRuntimeId,
    },
    "preferred",
    gitBashPrerequisite,
  ).ready;

  const continueWithRuntime = async () => {
    if (!aiReady) {
      onContinue();
      return;
    }
    const attempt = ++generation.current;
    const isCurrent = () => generation.current === attempt;
    setSaving(true);
    setSaveError(null);
    setProof(null);
    setTestState("testing");
    try {
      const runtimeId = keyScene ? "buzz-agent" : selectedRuntimeId;
      if (!runtimeId) throw new Error("Choose an AI harness before testing.");
      const saved = await saveOnboardingRuntime(
        runtimeId,
        runtimes.data ?? [],
        undefined,
        undefined,
        keyScene ? undefined : selectedModel,
      );
      if (!isCurrent()) return;
      queryClient.setQueryData(globalAgentConfigQueryKey, saved.config);
      const result = await runOnboardingConnectionTest(saved.config, isCurrent);
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
        scene={testState}
        data={{
          ...data,
          connectionReply: proof?.reply,
          effectiveModel: proof?.model,
          error: saveError,
        }}
        onNavigate={(scene) => {
          if (scene === "workspace" && proof) {
            onContinue();
            return;
          }
          if (scene === "testing") {
            void continueWithRuntime();
            return;
          }
          generation.current += 1;
          setSaving(false);
          setProof(null);
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
          ) : connectionScene === "api-key" ||
            connectionScene === "openrouter-unlinked" ? (
            <AiKeyConnectionPanel
              key={connectionScene}
              openRouter={connectionScene === "openrouter-unlinked"}
            />
          ) : (
            <CreditsComingSoon />
          )}
          {connectionScene === "connect" && aiReady && selectedRuntime ? (
            <OnboardingRuntimeModel
              key={selectedRuntimeId}
              runtime={selectedRuntime}
              config={globalConfig}
              model={selectedModel}
              onChange={setSelectedModel}
            />
          ) : null}
          {saveError && connectionScene !== "connect" ? (
            <p role="alert">{saveError}</p>
          ) : null}
          {!aiReady ? (
            <div className="power-notice">
              <p>
                No working AI connection yet. AI employees will not reply until
                you connect an AI in Settings &gt; Agents &gt; Defaults.
              </p>
              <button
                className="link"
                type="button"
                onClick={() => onContinue("settings")}
              >
                Open AI settings
              </button>
            </div>
          ) : null}
          <div className="power-cta">
            <button
              className="primary full"
              disabled={saving}
              onClick={() => void continueWithRuntime()}
              type="button"
            >
              {aiReady ? "Connect" : "Open my Colony"}
            </button>
            {!aiReady ? (
              <p>Continue without AI. You can connect it later.</p>
            ) : null}
          </div>
        </>
      }
      data={
        keyScene
          ? {
              ...data,
              harnessLabel: bundled
                ? getRuntimeDisplayLabel(bundled)
                : "Colony AI",
              harnessStatus: bundled
                ? getRuntimeHeaderStatus(
                    bundled,
                    globalConfig,
                    gitBashPrerequisite,
                  )
                : "No AI connected yet",
            }
          : data
      }
      harnessMark={
        keyScene && bundled ? (
          <RuntimeIcon className="harness-mark-runtime" runtime={bundled} />
        ) : (
          harnessHeader.mark
        )
      }
      onNavigate={onBack}
      onSelectConnection={onSelectConnection}
      scene={connectionScene}
    />
  );
}
