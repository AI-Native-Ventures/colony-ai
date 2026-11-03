import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useAcpAuthMethodsQuery,
  useConnectAcpRuntimeMutation,
  useInstallAcpRuntimeMutation,
} from "@/features/agents/hooks";
import { refreshAcpRuntimes } from "@/features/agents/acpRuntimesQuery";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

type RuntimeSetupState = {
  error: Error | null;
  progress: boolean;
  message: string;
  authError: Error | null;
  authProgress: boolean;
  authMessage: string;
};

type PreparedRuntime = {
  agentCommand: string;
  agentArgs: string;
};

export function useAgentRuntimeSetup({
  agentKey,
  agentArgs,
  agentCommand,
  inheritHarness,
  open,
  runtime,
  setAgentArgs,
  setAgentCommand,
}: {
  agentKey: string;
  agentArgs: string;
  agentCommand: string;
  inheritHarness: boolean;
  open: boolean;
  runtime?: AcpRuntimeCatalogEntry;
  setAgentArgs: React.Dispatch<React.SetStateAction<string>>;
  setAgentCommand: React.Dispatch<React.SetStateAction<string>>;
}) {
  const queryClient = useQueryClient();
  const installMutation = useInstallAcpRuntimeMutation();
  const connectMutation = useConnectAcpRuntimeMutation();
  const authMethodsQuery = useAcpAuthMethodsQuery(runtime?.id ?? "", {
    enabled: false,
  });
  const [state, setState] = React.useState<RuntimeSetupState>({
    error: null,
    progress: false,
    message: "",
    authError: null,
    authProgress: false,
    authMessage: "",
  });
  const [waitingForReturn, setWaitingForReturn] = React.useState(false);
  const wasOpen = React.useRef(false);
  const previousAgentKey = React.useRef(agentKey);

  const reset = React.useCallback(() => {
    setState({
      error: null,
      progress: false,
      message: "",
      authError: null,
      authProgress: false,
      authMessage: "",
    });
    setWaitingForReturn(false);
  }, []);

  React.useEffect(() => {
    if (open && (!wasOpen.current || previousAgentKey.current !== agentKey)) {
      reset();
    }
    wasOpen.current = open;
    previousAgentKey.current = agentKey;
  }, [open, agentKey, reset]);

  React.useEffect(() => {
    if (!open || !waitingForReturn) return;

    let refreshInFlight = false;
    const refreshAfterReturning = async () => {
      if (refreshInFlight || document.visibilityState === "hidden") return;
      refreshInFlight = true;
      try {
        await refreshAcpRuntimes(queryClient);
      } finally {
        refreshInFlight = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshAfterReturning();
      }
    };
    window.addEventListener("focus", onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onVisibilityChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [open, waitingForReturn, queryClient]);

  React.useEffect(() => {
    if (waitingForReturn && runtime?.authStatus.status === "logged_in") {
      setWaitingForReturn(false);
      setState((current) => ({
        ...current,
        authMessage: `${runtime.label} sign-in is complete. Save changes to apply this harness.`,
      }));
    }
  }, [runtime, waitingForReturn]);

  const prepareForSave =
    React.useCallback(async (): Promise<PreparedRuntime | null> => {
      setState((current) => ({ ...current, error: null, message: "" }));
      let submittedAgentCommand = agentCommand;
      let submittedAgentArgs = agentArgs;

      try {
        if (runtime && runtime.availability !== "available") {
          if (!runtime.canAutoInstall) {
            throw new Error(
              "Colony cannot set up this harness on this platform. Choose an available harness.",
            );
          }
          setState((current) => ({
            ...current,
            progress: true,
            authError: null,
            authMessage: "",
          }));
          const install = await installMutation.mutateAsync(runtime.id);
          if (!install.success) {
            const detail = install.steps
              .filter((step) => !step.success)
              .map((step) => step.stderr.trim() || step.hint || step.command)
              .filter(Boolean)
              .join("\n");
            throw new Error(
              detail
                ? `${runtime.label} setup failed: ${detail}`
                : `${runtime.label} setup failed without an install error. Retry setup.`,
            );
          }
          const refreshed = await refreshAcpRuntimes(queryClient);
          const installedRuntime = refreshed?.find(
            (candidate) => candidate.id === runtime.id,
          );
          if (
            installedRuntime?.availability !== "available" ||
            !installedRuntime.command
          ) {
            const availability = installedRuntime?.availability ?? "unknown";
            throw new Error(
              `${runtime.label} setup finished, but Colony still reports it as ${availability}. Retry setup or choose another harness.`,
            );
          }
          if (!inheritHarness) {
            submittedAgentCommand = installedRuntime.command;
            submittedAgentArgs = installedRuntime.defaultArgs.join(",");
            setAgentCommand(submittedAgentCommand);
            setAgentArgs(submittedAgentArgs);
          }
          setState((current) => ({ ...current, progress: false }));
          if (
            installedRuntime.loginHint &&
            installedRuntime.authStatus.status !== "logged_in"
          ) {
            setState((current) => ({
              ...current,
              message: `${installedRuntime.label} is ready. Sign in before saving the switch.`,
            }));
            return null;
          }
        }

        if (
          runtime?.availability === "available" &&
          runtime.loginHint &&
          runtime.authStatus.status !== "logged_in"
        ) {
          setState((current) => ({
            ...current,
            message: `Sign in to ${runtime.label} before saving the switch.`,
          }));
          return null;
        }

        return {
          agentCommand: submittedAgentCommand,
          agentArgs: submittedAgentArgs,
        };
      } catch (error) {
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error
              : new Error(`${runtime?.label ?? "Harness"} setup failed.`),
        }));
        return null;
      } finally {
        setState((current) => ({ ...current, progress: false }));
      }
    }, [
      agentArgs,
      agentCommand,
      inheritHarness,
      installMutation,
      queryClient,
      runtime,
      setAgentArgs,
      setAgentCommand,
    ]);

  const signIn = React.useCallback(async () => {
    if (!runtime?.loginHint) return;
    setState((current) => ({
      ...current,
      authError: null,
      authMessage: "",
      authProgress: true,
    }));
    try {
      const authMethods = await authMethodsQuery.refetch();
      if (authMethods.isError) throw authMethods.error;
      const methods = authMethods.data?.methods ?? [];
      const method =
        runtime.id === "codex"
          ? (methods.find((candidate) => candidate.id === "chat-gpt") ??
            methods.find(
              (candidate) => candidate.id === "chat-gpt-device-code",
            ))
          : methods.length === 1
            ? methods[0]
            : (methods.find((candidate) => candidate.type === "terminal") ??
              methods.find((candidate) =>
                /sign[ -]?in|log[ -]?in/i.test(
                  `${candidate.id} ${candidate.name} ${candidate.description ?? ""}`,
                ),
              ));
      if (!method) {
        throw new Error(
          `${runtime.label} did not offer a sign-in method. Restart Colony and try again.`,
        );
      }
      setWaitingForReturn(true);
      await connectMutation.mutateAsync({
        runtimeId: runtime.id,
        methodId: method.id,
      });
      setState((current) => ({
        ...current,
        authMessage: `Complete the ${runtime.label} sign-in prompt, then return to Colony. Colony checks again when you return.`,
      }));
      await refreshAcpRuntimes(queryClient);
    } catch (error) {
      setWaitingForReturn(false);
      setState((current) => ({
        ...current,
        authError:
          error instanceof Error
            ? error
            : new Error(`${runtime.label} sign-in could not start.`),
      }));
    } finally {
      setState((current) => ({ ...current, authProgress: false }));
    }
  }, [authMethodsQuery, connectMutation, queryClient, runtime]);

  const submitLabel = React.useCallback(
    (isSaving: boolean, runtimeLabel?: string) =>
      isSaving
        ? state.progress
          ? `Setting up ${runtimeLabel ?? "harness"}...`
          : "Saving..."
        : state.error
          ? "Try again"
          : "Save changes",
    [state.error, state.progress],
  );

  return { ...state, prepareForSave, reset, signIn, submitLabel };
}

export function AgentRuntimeSetupPanel({
  authMessage,
  authProgress,
  isSaving,
  message,
  onSignIn,
  progress,
  runtime,
}: {
  authMessage: string;
  authProgress: boolean;
  isSaving: boolean;
  message: string;
  onSignIn: () => void;
  progress: boolean;
  runtime?: AcpRuntimeCatalogEntry;
}) {
  return (
    <>
      {progress ? (
        <p
          aria-live="polite"
          className="text-xs text-muted-foreground"
          data-testid="runtime-setup-progress"
          role="status"
        >
          Colony is setting up {runtime?.label ?? "the harness"}.
        </p>
      ) : null}
      {message ? (
        <p aria-live="polite" className="text-xs" role="status">
          {message}
        </p>
      ) : null}
      {runtime?.loginHint && runtime.availability === "available" ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          {runtime.authStatus.status !== "logged_in" ? (
            <>
              <p className="text-xs text-muted-foreground">
                {runtime.label} needs an account sign-in before it can answer.
              </p>
              <Button
                disabled={authProgress || isSaving}
                onClick={onSignIn}
                type="button"
                variant="outline"
              >
                {authProgress
                  ? `Opening ${runtime.label} sign-in...`
                  : `Sign in to ${runtime.label}`}
              </Button>
            </>
          ) : null}
          {authMessage ? (
            <p aria-live="polite" className="text-xs" role="status">
              {authMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
