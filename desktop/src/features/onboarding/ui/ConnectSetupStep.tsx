import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import {
  useGitBashPrerequisiteQuery,
  useAcpRuntimesQueryForced,
} from "@/features/agents/hooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import { discoverAgentModels } from "@/shared/api/agentModels";
import { installAcpRuntime } from "@/shared/api/tauri";
import type {
  GlobalAgentConfig,
  AcpRuntimeCatalogEntry,
} from "@/shared/api/types";
import { OpenRouterConnectionPanel } from "@/shared/ui/OpenRouterConnectionPanel";
import { saveVerifiedWelcomeConnection } from "../welcomeConnection";
import { resolveAgentPrerequisiteReadiness } from "./agentReadiness";
import type { OnboardingBusinessProfile } from "./BusinessSetupStep";
import {
  ConnectCard,
  ConnectChip,
  ConnectChoices,
  type ConnectChoiceId,
} from "./ConnectChoice";
import { ConnectRuntimes } from "./ConnectRuntimes";
import {
  FirstRunButton,
  FirstRunError,
  FirstRunLink,
} from "./firstRunControls";
import { FirstRunHead } from "./FirstRunFrame";
import {
  cancelOnboardingConnectionTest,
  runOnboardingBusinessConnectionTest,
  subscribeOnboardingConnectionProgress,
  type OnboardingConnectionProgress,
  type OnboardingConnectionProof,
} from "./onboardingConnectionTest";
import type { OnboardingSceneId } from "./onboardingScenes";
import {
  OnboardingScenePresentation,
  type OnboardingSceneData,
} from "./OnboardingScenePresentation";
import { runtimeIsReadyForOnboarding } from "./onboardingRuntimeSelection";
import { buildOnboardingRuntimeCandidate } from "./saveOnboardingRuntime";
import { thisComputer } from "./OnboardingResultScenes";
import { getRuntimeDisplayLabel, RuntimeIcon } from "./RuntimeIcon";
import {
  buildStartFreeConfig,
  START_FREE_RUNTIME_ID,
  startFreeFailureKind,
} from "./startFree";
import { StartFreePanel, type StartFreeState } from "./StartFreePanel";

/** An explicit candidate that bypasses the selected-runtime path. */
type CandidateOverride = {
  config: GlobalAgentConfig;
  runtimeId: string;
  /** Fresh catalog after an install, before React re-renders the query. */
  runtimes?: readonly AcpRuntimeCatalogEntry[];
};

type ConnectSetupStepProps = {
  business: OnboardingBusinessProfile;
  communityId: string;
  error?: string | null;
  onBack: () => void;
  onContinue: (destination?: "settings") => void;
};

/**
 * Connect your AI: three ways to run Scout (Claude Code or Codex, Colony Agent,
 * Start free) and one "Test the connection" button. Every path ends in the real
 * first-reply test, and the connection is saved only once Scout has replied.
 */
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
  // The last explicit candidate (Start free), reused by Try again.
  const lastOverride = React.useRef<CandidateOverride | undefined>(undefined);
  const [choice, setChoice] = React.useState<ConnectChoiceId>("own");
  const choseByHand = React.useRef(false);
  const [scanning, setScanning] = React.useState(true);
  const [freeState, setFreeState] = React.useState<StartFreeState>("idle");
  const [freeHint, setFreeHint] = React.useState<string | null>(null);
  const [freeReason, setFreeReason] = React.useState<string | null>(null);
  const [freeCanRetry, setFreeCanRetry] = React.useState(true);
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
  const [openRouterReady, setOpenRouterReady] = React.useState(false);
  const [openRouterScene, setOpenRouterScene] =
    React.useState<OnboardingSceneId>("openrouter-unlinked");
  const data: OnboardingSceneData = {
    name: "",
    email: "",
    business: business.name,
    website: business.website,
    description: business.description,
    logoUrl: business.logoUrl,
  };

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
  const colonyPath = choice === "colony";
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
    colonyPath &&
    globalConfig.provider !== "openrouter" &&
    globalConfig.provider !== "colony-credits" &&
    candidateReady;
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
      (globalConfig.preferred_runtime === "claude" ||
        globalConfig.preferred_runtime === "codex")
    ) {
      setSelectedRuntimeId(globalConfig.preferred_runtime);
      setSelectedModel(globalConfig.model);
    }
  }, [globalConfig.preferred_runtime, globalConfig.model, selectedRuntimeId]);
  const testedRuntime = runtimes.data?.find(
    (runtime) => runtime.id === testedRuntimeId,
  );

  // Nothing of the person's own is ready on this computer: lead with the way
  // that needs no setup, unless they already chose.
  const nothingOwnReady =
    !scanning &&
    !runtimes.isFetching &&
    !candidateReady &&
    !(runtimes.data ?? []).some(
      (runtime) =>
        (runtime.id === "claude" || runtime.id === "codex") &&
        runtimeIsReadyForOnboarding(runtime, globalConfig, gitBashPrerequisite),
    );
  React.useEffect(() => {
    if (nothingOwnReady && !choseByHand.current && choice === "own")
      setChoice("free");
  }, [nothingOwnReady, choice]);
  const choose = (next: ConnectChoiceId) => {
    if (freeState === "installing" || saving) return;
    choseByHand.current = true;
    setChoice(next);
    if (next === "free") setFreeState("idle");
    if (next !== "colony") {
      // The OpenRouter panel unmounts with the Colony Agent card, so its
      // reported readiness must not survive into the next visit.
      setOpenRouterReady(false);
      setOpenRouterScene("openrouter-unlinked");
    }
  };

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

  const continueWithRuntime = async (candidateOverride?: CandidateOverride) => {
    if (!candidateOverride && !aiReady) {
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
      const runtimeId =
        candidateOverride?.runtimeId ??
        (colonyPath ? "buzz-agent" : selectedRuntimeId);
      if (!runtimeId) throw new Error("Choose an AI app before testing.");
      setTestedRuntimeId(runtimeId);
      lastOverride.current = candidateOverride;
      const candidate = buildOnboardingRuntimeCandidate(
        candidateOverride?.config ?? globalConfig,
        runtimeId,
        candidateOverride?.runtimes ?? runtimes.data ?? [],
        candidateOverride || colonyPath ? undefined : selectedModel,
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
      if (
        candidateOverride?.runtimeId === START_FREE_RUNTIME_ID &&
        startFreeFailureKind(failure) === "ended"
      ) {
        // OpenCode no longer offers the free model: say so on Connect.
        setFreeState("ended");
        setTestState("connect");
        return;
      }
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

  const startFree = async () => {
    // Fence the install like a connection attempt: unmount or a choice change
    // bumps the generation, so a late install result cannot save Start free.
    const attempt = ++generation.current;
    const isCurrent = () => generation.current === attempt;
    setFreeHint(null);
    setFreeReason(null);
    setFreeCanRetry(true);
    setFreeState("installing");
    try {
      const result = await installAcpRuntime(START_FREE_RUNTIME_ID);
      if (!isCurrent()) return;
      if (!result.success) {
        const failed = result.steps.at(-1);
        setFreeHint(failed?.hint ?? null);
        setFreeReason(failed?.stderr.trim().split("\n")[0] || null);
        setFreeCanRetry(failed?.step !== "opencode-unsupported");
        setFreeState("install-failed");
        return;
      }
      const refreshed = await runtimes.refetch();
      if (!isCurrent()) return;
      setFreeState("idle");
      await continueWithRuntime({
        config: buildStartFreeConfig(globalConfig),
        runtimeId: START_FREE_RUNTIME_ID,
        runtimes: refreshed.data,
      });
    } catch (failure) {
      if (!isCurrent()) return;
      setFreeHint(failure instanceof Error ? failure.message : null);
      setFreeState("install-failed");
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
            void continueWithRuntime(lastOverride.current);
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

  const freeInstalling = freeState === "installing";
  const freeProblem = freeState === "install-failed" || freeState === "ended";
  const canTest =
    !saving &&
    !freeInstalling &&
    (choice === "free"
      ? freeState !== "ended" &&
        !(freeState === "install-failed" && !freeCanRetry)
      : aiReady);
  const testLabel =
    choice === "free" && freeState === "install-failed" && freeCanRetry
      ? "Try again"
      : "Test the connection";
  const test = () => {
    if (choice === "free") void startFree();
    else void continueWithRuntime();
  };

  const form = (
    <form
      className="c3fr-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canTest) test();
      }}
      style={{ "--c3fr-gap": 22 } as React.CSSProperties}
    >
      <FirstRunHead
        lede="Your AI. Your models. Your way."
        title="Connect your AI."
      />
      {(saveError ?? error) ? (
        <FirstRunError>{saveError ?? error}</FirstRunError>
      ) : null}
      <ConnectChoices>
        <ConnectCard
          description={`Use a coding agent you already have on ${thisComputer()}.`}
          disabled={freeInstalling}
          id="own"
          onSelect={() => choose("own")}
          selected={choice === "own"}
          tight
          title="Claude Code or Codex"
        >
          <ConnectRuntimes
            onRuntimeSelect={selectRuntime}
            onScanningChange={setScanning}
            selectedRuntimeId={selectedRuntimeId}
          />
        </ConnectCard>
        <ConnectCard
          chips={
            <>
              <ConnectChip>OpenRouter</ConnectChip>
              <ConnectChip>Colony credits · Coming soon</ConnectChip>
            </>
          }
          description="Runs inside Colony. Bring an OpenRouter key, or pay as you go with Colony credits."
          disabled={freeInstalling}
          id="colony"
          onSelect={() => choose("colony")}
          selected={colonyPath}
          testId="onboarding-colony-agent-card"
          title="Colony Agent"
        >
          {colonyPath ? (
            <div
              className="c3fr-choice-body c3fr-openrouter"
              data-testid="onboarding-colony-agent"
            >
              {!bundled && !runtimes.isFetching && !runtimes.error ? (
                <FirstRunError>
                  Colony Agent is not available on this computer. Choose Claude
                  Code or Codex, or Start free.
                </FirstRunError>
              ) : null}
              {!bundledPrerequisite.ready &&
              (bundledPrerequisite.reason === "git-bash" ||
                gitBashQuery.isError) ? (
                bundledPrerequisite.reason === "git-bash" ? (
                  <FirstRunError>{bundledPrerequisite.copy}</FirstRunError>
                ) : (
                  <p className="c3fr-note" role="status">
                    {bundledPrerequisite.copy}
                  </p>
                )
              ) : null}
              {colonyAgentSaved ? (
                <p
                  className="c3fr-note"
                  data-testid="onboarding-colony-agent-saved"
                  role="status"
                >
                  Colony Agent already has an AI connection saved in Settings.
                  Test it to continue.
                </p>
              ) : null}
              <OpenRouterConnectionPanel
                hideTest
                onReadyChange={setOpenRouterReady}
                onStateChange={(state) =>
                  setOpenRouterScene(`openrouter-${state}`)
                }
                onboarding
              />
            </div>
          ) : null}
        </ConnectCard>
        <ConnectCard
          description="Free AI on your computer. No account, no card."
          disabled={freeInstalling}
          id="free"
          onSelect={() => choose("free")}
          selected={choice === "free"}
          title="Start free"
        >
          {choice === "free" ? (
            <div className="c3fr-choice-body">
              <StartFreePanel
                canRetry={freeCanRetry}
                hint={freeHint}
                reason={freeReason}
                state={freeState}
              />
              {freeProblem ? (
                <FirstRunLink
                  data-testid="start-free-use-own"
                  onClick={() => choose("own")}
                >
                  Use your own AI
                </FirstRunLink>
              ) : null}
            </div>
          ) : null}
        </ConnectCard>
      </ConnectChoices>
      <div className="c3fr-actions c3fr-actions-docked">
        <FirstRunButton disabled={saving || freeInstalling} onClick={onBack}>
          Back
        </FirstRunButton>
        <FirstRunButton
          data-testid="onboarding-test-connection"
          disabled={!canTest}
          kind="primary"
          type="submit"
        >
          {testLabel}
        </FirstRunButton>
      </div>
    </form>
  );

  return (
    <OnboardingScenePresentation
      connectionContentOverride={form}
      data={{
        ...data,
        harnessLabel:
          choice === "free"
            ? "OpenCode"
            : colonyPath
              ? "Colony Agent"
              : undefined,
        harnessStatus: scanning && choice === "own" ? "Checking" : undefined,
      }}
      onNavigate={onBack}
      scene={colonyPath ? openRouterScene : "connect"}
    />
  );
}
