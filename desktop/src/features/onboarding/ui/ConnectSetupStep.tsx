import {
  getAiSubscriptions,
  checkClaudeSubscription,
  type AiSubscription,
} from "@/shared/api/aiSubscriptions";
import { SubscriptionAllowance } from "./SubscriptionAllowance";
import { saveVerifiedWelcomeConnection } from "../welcomeConnection";
import { discoverAgentModels } from "@/shared/api/agentModels";
import { OpenRouterConnectionPanel } from "@/shared/ui/OpenRouterConnectionPanel";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import {
  runOnboardingBusinessConnectionTest,
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
import { ColonyCreditsOption } from "./ColonyCreditsOption";
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
import {
  getOnboardingSubscriptionRuntimes,
  runtimeIsOnboardingSubscription,
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
  subscription,
  onClaudeCheck,
  checkingClaude,
}: {
  globalConfig: GlobalAgentConfig;
  gitBashPrerequisite: GitBashPrerequisite | null | undefined;
  isFetching: boolean;
  onRefresh: () => void;
  runtime: AcpRuntimeCatalogEntry;
  selected: boolean;
  onSelect: () => void;
  subscription?: AiSubscription;
  onClaudeCheck: () => void;
  checkingClaude: boolean;
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
        if (!result.success) {
          const detail =
            result.steps.find((step) => !step.success)?.stderr ?? "";
          setActionError(
            runtime.id === "codex" || runtime.id === "claude"
              ? detail.includes("EACCES") || detail.includes("permission")
                ? "Connection update could not write its files. Check app permissions, then retry."
                : detail.includes("ceiling") || detail.includes("timed out")
                  ? "Connection update timed out. Check your internet connection, then retry."
                  : "Connection update failed. Check your internet connection, then retry."
              : getInstallErrorMessage(result),
          );
        } else void onRefresh();
      },
      onError: () => {
        setActionError(
          "Connection update could not finish. Check your internet connection, then retry.",
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
          <span
            className={`provider-monogram ${runtime.id === "claude" ? "claude" : runtime.id === "codex" ? "codex" : ""}`}
          >
            <RuntimeIcon className="size-6 shrink-0" runtime={runtime} />
          </span>
          <strong>{getRuntimeDisplayLabel(runtime)}</strong>
          <span className="selection-dot" />
        </span>
        <span className="provider-account">{status}</span>
        {runtime.availability === "adapter_missing" ? (
          <span className="provider-account">
            {getRuntimeDisplayLabel(runtime)} is installed. Its connection needs
            to be set up.
          </span>
        ) : null}
      </button>
      {runtime.id === "claude" || runtime.id === "codex" ? (
        <SubscriptionAllowance subscription={subscription} />
      ) : null}
      {runtime.id === "claude" && subscription?.source !== "live" ? (
        <Button
          className="runtime-action"
          disabled={checkingClaude}
          onClick={onClaudeCheck}
          type="button"
          variant="outline"
        >
          {checkingClaude ? "Checking…" : "Check Claude subscription"}
        </Button>
      ) : null}
      {/* A ready card states Installed once, in its account line above. */}
      <div className="runtime-actions">
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
              ? "Updating connection…"
              : actionError
                ? "Retry"
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
      {installMutation.isPending ? (
        <p className="provider-account" role="status">
          Preparing your connection files may take several minutes. Each package
          update has a two-minute limit.
        </p>
      ) : null}
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
  const subscriptions = useQuery({
    queryKey: ["ai-subscriptions"],
    queryFn: getAiSubscriptions,
    retry: false,
    staleTime: 30_000,
  });
  const queryClient = useQueryClient();
  const [checkingClaude, setCheckingClaude] = React.useState(false);
  const [claudeCheckError, setClaudeCheckError] = React.useState<string | null>(
    null,
  );
  const checkClaude = async () => {
    if (checkingClaude) return;
    setCheckingClaude(true);
    setClaudeCheckError(null);
    try {
      await queryClient.cancelQueries({ queryKey: ["ai-subscriptions"] });
      const result = await checkClaudeSubscription();
      queryClient.setQueryData<AiSubscription[]>(
        ["ai-subscriptions"],
        (current) => [
          ...(current ?? []).filter((item) => item.id !== "claude"),
          result,
        ],
      );
    } catch {
      setClaudeCheckError(
        "Claude subscription could not be checked. Try again.",
      );
    } finally {
      setCheckingClaude(false);
    }
  };
  const gitBashQuery = useGitBashPrerequisiteQuery();
  const gitBashPrerequisite = gitBashQuery.isError
    ? undefined
    : gitBashQuery.data;
  const runtimes = getOnboardingSubscriptionRuntimes(query.data ?? []);
  const ready = runtimes.filter(
    (runtime) =>
      runtimeIsReadyForOnboarding(runtime, globalConfig, gitBashPrerequisite) &&
      resolveAgentPrerequisiteReadiness(runtime.id, gitBashPrerequisite).ready,
  );
  const signedInRuntime = runtimes.find(
    (runtime) =>
      ready.includes(runtime) ||
      subscriptions.data?.some(
        (item) => item.id === runtime.id && item.signedIn === true && item.plan,
      ),
  );
  const renderRuntime = (runtime: AcpRuntimeCatalogEntry) => (
    <RuntimeOption
      key={runtime.id}
      globalConfig={globalConfig}
      gitBashPrerequisite={gitBashPrerequisite}
      isFetching={
        query.isFetching || subscriptions.isFetching || checkingClaude
      }
      onRefresh={refresh}
      onSelect={() => onRuntimeSelect(runtime.id)}
      runtime={runtime}
      selected={selectedRuntimeId === runtime.id}
      subscription={
        subscriptions.data?.find((item) => item.id === runtime.id) ??
        (subscriptions.isError
          ? {
              id: runtime.id === "claude" ? "claude" : "codex",
              signedIn: null,
              source: "unavailable",
              plan: null,
              windows: [],
              message: "Subscription could not be checked. Try again.",
            }
          : undefined)
      }
      onClaudeCheck={() => void checkClaude()}
      checkingClaude={checkingClaude}
    />
  );
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.id === selectedRuntimeId,
  );
  const refresh = React.useCallback(() => {
    void gitBashQuery.refetch();
    query.forceRefresh();
    void subscriptions.refetch();
  }, [query.forceRefresh, gitBashQuery.refetch, subscriptions.refetch]);

  React.useEffect(() => {
    if (!selectedRuntimeId && runtimes.length > 0)
      onRuntimeSelect(signedInRuntime?.id ?? runtimes[0].id);
  }, [runtimes, signedInRuntime, selectedRuntimeId, onRuntimeSelect]);

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
          ? { label: "Finding AI apps", status: "Checking", mark: null }
          : {
              label: "No supported AI app",
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
          disabled={
            query.isFetching || subscriptions.isFetching || checkingClaude
          }
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
          {runtimes.map(renderRuntime)}
        </fieldset>
      ) : null}
      {claudeCheckError ? (
        <p role="alert" className="runtime-action-error text-sm">
          {claudeCheckError}
        </p>
      ) : null}
      {!query.isFetching && !query.error && runtimes.length === 0 ? (
        <div className="power-empty" data-testid="onboarding-acp-empty">
          <h3>Claude Code and Codex are not available.</h3>
          <p>Choose Colony Agent, or continue and connect an AI app later.</p>
        </div>
      ) : null}
      <p className="power-caption">
        {selectedRuntime &&
        ready.some((runtime) => runtime.id === selectedRuntime.id)
          ? selectedRuntime.id === "claude" || selectedRuntime.id === "codex"
            ? "Your AI teammates share these allowances with your other usage."
            : `${getRuntimeDisplayLabel(selectedRuntime)} can be tested on this computer.`
          : ready.length > 0
            ? "Choose a signed-in AI app to test."
            : "You can connect an AI app later."}
      </p>
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
  // Two onboarding paths: the person's own Claude Code or Codex subscription
  // ("connect"), or Colony Agent powered by OpenRouter or Colony credits.
  const [connectionScene, setConnectionScene] = React.useState<
    "connect" | "colony"
  >("connect");
  const [harnessHeader, setHarnessHeader] = React.useState<HarnessHeader>({
    label: "Finding AI apps",
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
  const [openRouterReady, setOpenRouterReady] = React.useState(false);
  const [openRouterScene, setOpenRouterScene] =
    React.useState<OnboardingSceneId>("openrouter-unlinked");
  const onSelectConnection = React.useCallback((scene: OnboardingSceneId) => {
    const next =
      scene === "connect" || scene.startsWith("subscription")
        ? "connect"
        : "colony";
    if (next === "connect") {
      // The OpenRouter panel unmounts with the Colony Agent path, so its
      // reported readiness must not survive into the next visit.
      setOpenRouterReady(false);
      setOpenRouterScene("openrouter-unlinked");
    }
    setConnectionScene(next);
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
  const colonyPath = connectionScene === "colony";
  const candidateRuntime = colonyPath ? bundled : selectedRuntime;
  const candidateReady =
    !!candidateRuntime &&
    runtimeIsReadyForOnboarding(
      candidateRuntime,
      globalConfig,
      gitBashPrerequisite,
    ) &&
    resolveAgentPrerequisiteReadiness(candidateRuntime.id, gitBashPrerequisite)
      .ready;
  // The OpenRouter panel tests only an OpenRouter-backed Colony Agent, never
  // another provider's saved connection.
  const openRouterTestReady =
    openRouterReady && globalConfig.provider === "openrouter" && candidateReady;
  // Colony Agent can already run on another provider's key saved in
  // Settings > Agents. Onboarding no longer edits keys, but it still lets that
  // saved setup prove itself with a reply. OpenRouter setups belong to the
  // OpenRouter panel.
  const colonyAgentSaved =
    colonyPath && globalConfig.provider !== "openrouter" && candidateReady;
  const aiReady = colonyPath
    ? openRouterTestReady || colonyAgentSaved
    : candidateReady;
  const bundledPrerequisite = resolveAgentPrerequisiteReadiness(
    "buzz-agent",
    gitBashPrerequisite,
  );
  React.useEffect(() => {
    if (
      !selectedRuntimeId &&
      globalConfig.preferred_runtime &&
      runtimeIsOnboardingSubscription(globalConfig.preferred_runtime)
    ) {
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
    if (!aiReady) {
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
      const runtimeId = colonyPath ? "buzz-agent" : selectedRuntimeId;
      if (!runtimeId) throw new Error("Choose an AI app before testing.");
      setTestedRuntimeId(runtimeId);
      const candidate = buildOnboardingRuntimeCandidate(
        globalConfig,
        runtimeId,
        runtimes.data ?? [],
        colonyPath ? undefined : selectedModel,
      );
      const result = await runOnboardingBusinessConnectionTest(
        candidate,
        isCurrent,
        {
          name: business.name,
          website: business.website,
          description: business.description,
        },
      );
      if (!isCurrent()) return;
      await saveVerifiedWelcomeConnection(
        communityId,
        result.config,
        result.proof,
      );
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
          ) : (
            <div
              className="colony-agent-power"
              data-testid="onboarding-colony-agent"
            >
              {!bundled && !runtimes.isFetching && !runtimes.error ? (
                <div className="power-notice is-error" role="alert">
                  <p>
                    Colony Agent is not available on this computer. Choose
                    Claude Code or Codex, or skip for now.
                  </p>
                </div>
              ) : null}
              {!bundledPrerequisite.ready &&
              (bundledPrerequisite.reason === "git-bash" ||
                gitBashQuery.isError) ? (
                <div
                  className={`power-notice ${bundledPrerequisite.reason === "git-bash" ? "is-error" : ""}`}
                  role={
                    bundledPrerequisite.reason === "git-bash"
                      ? "alert"
                      : "status"
                  }
                >
                  <p>{bundledPrerequisite.copy}</p>
                </div>
              ) : null}
              {colonyAgentSaved ? (
                <div
                  className="colony-agent-saved"
                  data-testid="onboarding-colony-agent-saved"
                >
                  <div className="power-notice" role="status">
                    <p>
                      Colony Agent already has an AI connection saved in
                      Settings. Test it to continue.
                    </p>
                  </div>
                  <button
                    className="primary full"
                    disabled={saving}
                    onClick={() => void continueWithRuntime()}
                    type="button"
                  >
                    Test Colony Agent <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : null}
              <OpenRouterConnectionPanel
                onboarding
                onTestConnection={() => void continueWithRuntime()}
                testDisabled={!openRouterTestReady || saving}
                onReadyChange={setOpenRouterReady}
                onStateChange={(state) =>
                  setOpenRouterScene(`openrouter-${state}`)
                }
              />
              <ColonyCreditsOption />
            </div>
          )}
          {saveError && colonyPath ? <p role="alert">{saveError}</p> : null}
          {colonyPath ? (
            <div className="colony-agent-skip">
              <button
                className="back"
                type="button"
                onClick={() => onContinue()}
              >
                Skip for now
              </button>
            </div>
          ) : (
            <div className="power-cta">
              <button
                className="primary full"
                disabled={saving || !aiReady}
                onClick={() => void continueWithRuntime()}
                type="button"
              >
                {selectedRuntime
                  ? `Connect ${getRuntimeDisplayLabel(selectedRuntime)}`
                  : "Connect"}{" "}
                <span aria-hidden="true">→</span>
              </button>
              {aiReady ? <p>Sign-in stays with the provider.</p> : null}
              {/* Both paths keep Skip for now, ready or not, so nobody is held
                  on Connect without an AI app. */}
              <button
                className="back"
                type="button"
                onClick={() => onContinue()}
              >
                Skip for now
              </button>
            </div>
          )}
        </>
      }
      data={{
        ...data,
        ...(colonyPath
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
      harnessMark={colonyPath ? undefined : harnessHeader.mark}
      onNavigate={onBack}
      onSelectConnection={onSelectConnection}
      scene={colonyPath ? openRouterScene : "connect"}
    />
  );
}
