import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as React from "react";

import {
  useAcpAuthMethodsQuery,
  useAcpRuntimesQueryForced,
  useConnectAcpRuntimeMutation,
  useGitBashPrerequisiteQuery,
  useInstallAcpRuntimeMutation,
} from "@/features/agents/hooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import {
  checkClaudeSubscription,
  getAiSubscriptions,
  type AiSubscription,
} from "@/shared/api/aiSubscriptions";
import type {
  AcpRuntimeCatalogEntry,
  GitBashPrerequisite,
  GlobalAgentConfig,
} from "@/shared/api/types";
import { getInstallErrorMessage } from "@/shared/lib/installError";
import { resolveAgentPrerequisiteReadiness } from "./agentReadiness";
import { AllowanceMeter, RuntimeBox, RuntimeRow } from "./ConnectChoice";
import { FirstRunButton, FirstRunError } from "./firstRunControls";
import {
  harnessDetectionStatus,
  harnessInstallLabel,
} from "./harnessDetectionState";
import {
  getOnboardingSubscriptionRuntimes,
  runtimeIsReadyForOnboarding,
} from "./onboardingRuntimeSelection";
import { getRuntimeDisplayLabel } from "./RuntimeIcon";

/** The status words on a runtime row, from what the detection says. */
function rowStatus(
  runtime: AcpRuntimeCatalogEntry,
  ready: boolean,
  prerequisiteCopy: string | null,
): { text: string; tone?: "ok" | "need" } {
  if (prerequisiteCopy) return { text: prerequisiteCopy, tone: "need" };
  if (ready)
    return {
      text:
        runtime.authStatus.status === "logged_in"
          ? "Installed · signed in"
          : "Ready on this computer",
      tone: "ok",
    };
  return { text: harnessDetectionStatus(runtime, false) };
}

/** The allowance to show: the weekly window when the provider reports one. */
function weeklyWindow(subscription?: AiSubscription) {
  const windows = subscription?.windows ?? [];
  return (
    windows.find((window) => /week/i.test(window.label)) ?? windows[0] ?? null
  );
}

function ConnectedRuntimeRow({
  globalConfig,
  gitBashPrerequisite,
  isFetching,
  onRefresh,
  runtime,
  selected,
  choosable,
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
  choosable: boolean;
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

  const status = rowStatus(
    runtime,
    ready,
    prerequisite.ready ? null : prerequisite.copy,
  );
  const window = ready ? weeklyWindow(subscription) : null;
  const label = getRuntimeDisplayLabel(runtime);
  const installable =
    !ready && runtime.availability !== "available" && runtime.canAutoInstall;
  const guideOnly =
    !ready && runtime.availability !== "available" && !runtime.canAutoInstall;
  const checkable =
    !ready &&
    runtime.availability === "available" &&
    !needsSignIn &&
    (runtime.id === "claude" || runtime.id === "codex");

  const action = (
    <>
      {ready && runtime.id === "claude" && subscription?.source !== "live" ? (
        <FirstRunButton
          disabled={checkingClaude}
          onClick={onClaudeCheck}
          size="small"
        >
          {checkingClaude ? "Checking…" : "Check Claude subscription"}
        </FirstRunButton>
      ) : null}
      {!ready && needsSignIn ? (
        <FirstRunButton
          disabled={connectMutation.isPending || waitingForSignIn}
          onClick={signIn}
          size="small"
        >
          {waitingForSignIn ? "Checking…" : "Sign in"}
        </FirstRunButton>
      ) : null}
      {installable ? (
        <FirstRunButton
          disabled={installMutation.isPending}
          onClick={install}
          size="small"
        >
          {installMutation.isPending
            ? "Updating connection…"
            : actionError
              ? "Retry"
              : harnessInstallLabel(runtime)}
        </FirstRunButton>
      ) : null}
      {guideOnly ? (
        <FirstRunButton
          onClick={() => void openUrl(runtime.installInstructionsUrl)}
          size="small"
        >
          {harnessInstallLabel(runtime)}
        </FirstRunButton>
      ) : null}
      {checkable ? (
        <FirstRunButton
          aria-label={`Check ${label} again`}
          disabled={isFetching}
          onClick={onRefresh}
          size="small"
        >
          Check again
        </FirstRunButton>
      ) : null}
    </>
  );

  return (
    <>
      <RuntimeRow
        action={action}
        allowance={
          window ? (
            <AllowanceMeter
              label={
                /week/i.test(window.label) ? "Weekly allowance" : window.label
              }
              percent={Math.max(0, Math.min(100, window.remainingPercent))}
            />
          ) : undefined
        }
        choosable={choosable}
        id={runtime.id}
        name={label}
        onSelect={onSelect}
        ready={ready}
        selected={selected}
        status={status.text}
        statusTone={status.tone}
      />
      {installMutation.isPending ? (
        <p className="c3fr-note c3fr-runtime-note" role="status">
          Preparing your connection files may take several minutes. Each package
          update has a two-minute limit.
        </p>
      ) : null}
      {actionError ? <FirstRunError>{actionError}</FirstRunError> : null}
      {connectMutation.error instanceof Error ? (
        <FirstRunError>Sign-in could not be started. Try again.</FirstRunError>
      ) : null}
      {authMethods.error instanceof Error ? (
        <FirstRunError>Sign-in options are unavailable.</FirstRunError>
      ) : null}
      {runtime.availability === "adapter_missing" ? (
        <p className="c3fr-note c3fr-runtime-note">
          {label} is installed. Its connection needs to be set up.
        </p>
      ) : null}
    </>
  );
}

/** The detected Claude Code and Codex rows inside the first Connect card. */
export function ConnectRuntimes({
  selectedRuntimeId,
  onRuntimeSelect,
  onScanningChange,
}: {
  selectedRuntimeId: string | null;
  onRuntimeSelect: (id: string) => void;
  onScanningChange: (scanning: boolean) => void;
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
  const refresh = React.useCallback(() => {
    void gitBashQuery.refetch();
    query.forceRefresh();
    void subscriptions.refetch();
  }, [query.forceRefresh, gitBashQuery.refetch, subscriptions.refetch]);

  const scanning = query.isFetching && runtimes.length === 0;
  React.useEffect(() => {
    onScanningChange(scanning);
  }, [onScanningChange, scanning]);

  React.useEffect(() => {
    if (!selectedRuntimeId && runtimes.length > 0)
      onRuntimeSelect(signedInRuntime?.id ?? runtimes[0].id);
  }, [runtimes, signedInRuntime, selectedRuntimeId, onRuntimeSelect]);

  return (
    <>
      {scanning ? (
        <div
          className="c3fr-runtimes c3fr-runtimes-wait"
          data-testid="onboarding-runtime-loading"
          role="status"
        >
          <span aria-hidden="true" className="c3fr-spinner" />
          Checking your installed apps…
        </div>
      ) : null}
      {query.error instanceof Error ? (
        <FirstRunError>
          We couldn’t check this computer. Your other connection options are
          still available.
        </FirstRunError>
      ) : null}
      {runtimes.length > 0 ? (
        <RuntimeBox>
          {runtimes.map((runtime) => (
            <ConnectedRuntimeRow
              checkingClaude={checkingClaude}
              choosable={ready.length > 1}
              gitBashPrerequisite={gitBashPrerequisite}
              globalConfig={globalConfig}
              isFetching={
                query.isFetching || subscriptions.isFetching || checkingClaude
              }
              key={runtime.id}
              onClaudeCheck={() => void checkClaude()}
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
            />
          ))}
        </RuntimeBox>
      ) : null}
      {claudeCheckError ? (
        <FirstRunError>{claudeCheckError}</FirstRunError>
      ) : null}
      {!query.isFetching && !query.error && runtimes.length === 0 ? (
        <p className="c3fr-note" data-testid="onboarding-acp-empty">
          Claude Code and Codex are not available. Choose Colony Agent or Start
          free.
        </p>
      ) : null}
    </>
  );
}
