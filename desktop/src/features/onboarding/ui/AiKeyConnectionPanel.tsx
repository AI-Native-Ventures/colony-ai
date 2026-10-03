import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAcpRuntimesQuery,
  useGitBashPrerequisiteQuery,
} from "@/features/agents/hooks";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import {
  AgentConfigFields,
  EMPTY_GLOBAL_CONFIG,
} from "@/features/agents/ui/AgentConfigFields";
import {
  getGlobalAgentConfig,
  setGlobalAgentConfig,
} from "@/shared/api/tauriGlobalAgentConfig";
import { invokeTauri } from "@/shared/api/tauri";
import type { GlobalAgentConfig } from "@/shared/api/types";
import {
  resolveAgentPrerequisiteReadiness,
  resolveAgentReadiness,
} from "./agentReadiness";

export const AI_CONNECTION_MESSAGES = {
  connected: "Connection works. Save this AI as your default to continue.",
  "key-rejected":
    "The provider rejected this key or denied access (401/403). Check the key and its permissions.",
  "insufficient-balance":
    "Your provider account has no credits or insufficient balance (402). Add funds with your provider, then test again.",
  "network-failure":
    "Could not reach your provider. Check your internet connection and provider address, then test again.",
  "unknown-model":
    "This model was not found. Choose another model or check its model ID.",
  "missing-configuration":
    "Choose a provider and model, and enter the required key before testing.",
  "unsupported-provider":
    "Connection testing is not available for this provider yet. Use Anthropic, OpenAI, OpenRouter, or DeepSeek, or configure it in Settings > Agents > Defaults.",
  "provider-failure":
    "The provider could not complete the test. Check the model and provider settings, then try again.",
} as const;

type ConnectionResult = keyof typeof AI_CONNECTION_MESSAGES;

function normalizeConnectionConfig(
  config: GlobalAgentConfig,
): GlobalAgentConfig {
  const env_vars = { ...config.env_vars };
  for (const name of [
    "ANTHROPIC_API_KEY",
    "OPENAI_COMPAT_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
  ]) {
    if (env_vars[name] !== undefined) env_vars[name] = env_vars[name].trim();
  }
  return { ...config, model: config.model?.trim() ?? null, env_vars };
}

export function AiKeyConnectionPanel({ openRouter }: { openRouter: boolean }) {
  const queryClient = useQueryClient();
  const runtimes = useAcpRuntimesQuery();
  const gitBashQuery = useGitBashPrerequisiteQuery();
  const gitBashPrerequisite = gitBashQuery.isError
    ? undefined
    : gitBashQuery.data;
  const prerequisite = resolveAgentPrerequisiteReadiness(
    "buzz-agent",
    gitBashPrerequisite,
  );
  const runtime = runtimes.data?.find(
    (candidate) => candidate.id === "buzz-agent",
  );
  const [config, setConfig] =
    React.useState<GlobalAgentConfig>(EMPTY_GLOBAL_CONFIG);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [valid, setValid] = React.useState(false);
  const [customProvider, setCustomProvider] = React.useState(false);
  const [customModel, setCustomModel] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<ConnectionResult | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const generation = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    getGlobalAgentConfig()
      .then((loaded) => {
        if (cancelled) return;
        setConfig(
          normalizeConnectionConfig({
            ...loaded,
            preferred_runtime: "buzz-agent",
            ...(openRouter
              ? {
                  provider: "openrouter",
                  model: loaded.provider === "openrouter" ? loaded.model : null,
                }
              : {}),
          }),
        );
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [openRouter]);

  const changeConfig = (next: GlobalAgentConfig) => {
    generation.current += 1;
    setPending(false);
    setConfig(normalizeConnectionConfig(next));
    setResult(null);
    setSaved(false);
    setSaveError(null);
  };

  const testConnection = async () => {
    const currentGeneration = ++generation.current;
    setPending(true);
    setResult(null);
    setSaved(false);
    setSaveError(null);
    try {
      const response = await invokeTauri<ConnectionResult>(
        "test_ai_connection",
        { config },
      );
      if (generation.current !== currentGeneration) return;
      setResult(
        Object.hasOwn(AI_CONNECTION_MESSAGES, response)
          ? response
          : "provider-failure",
      );
    } catch {
      if (generation.current === currentGeneration)
        setResult("network-failure");
    } finally {
      if (generation.current === currentGeneration) setPending(false);
    }
  };

  const save = async () => {
    const currentGeneration = ++generation.current;
    setPending(true);
    setSaveError(null);
    try {
      const response = await setGlobalAgentConfig(config);
      queryClient.setQueryData(globalAgentConfigQueryKey, response.config);
      if (generation.current !== currentGeneration) return;
      setConfig(response.config);
      setSaved(true);
      if (response.failed_restart_count > 0)
        setSaveError(
          "AI defaults saved, but an existing employee could not restart. Retry its restart from Agents.",
        );
    } catch {
      if (generation.current === currentGeneration)
        setSaveError(
          "Could not save your AI defaults. Your connection test passed. Try saving again.",
        );
    } finally {
      if (generation.current === currentGeneration) setPending(false);
    }
  };

  return (
    <>
      <div className="section-heading">
        <h3>
          {openRouter
            ? "Your OpenRouter account"
            : "Connect directly to a provider"}
        </h3>
      </div>
      <p className="power-caption">
        {openRouter
          ? "Browser sign-in is not available. Paste your OpenRouter API key and choose a model."
          : "Paste your provider API key and choose a model."}{" "}
        Usage is billed by your provider. Testing makes a small model request
        and may use provider credits.
      </p>
      {loading || runtimes.isLoading ? (
        <p role="status">Loading AI settings...</p>
      ) : loadError || !runtime ? (
        <p role="alert">
          AI settings could not load. Return to Subscriptions and check again,
          or connect in Settings &gt; Agents &gt; Defaults.
        </p>
      ) : (
        <fieldset disabled={pending} className="min-w-0 border-0 p-0">
          <legend className="sr-only">Provider connection settings</legend>
          <AgentConfigFields
            bakedEnv={[]}
            config={config}
            selectedRuntime={runtime}
            disclosure="full"
            isCustomModelEditing={customModel}
            isCustomProvider={customProvider}
            onConfigChange={changeConfig}
            onCustomModelEditingChange={setCustomModel}
            onIsCustomProviderChange={setCustomProvider}
            onValidityChange={setValid}
            useCustomSelect
          />
        </fieldset>
      )}
      {!loading && !runtimes.isLoading && !prerequisite.ready ? (
        <p role={prerequisite.reason === "git-bash" ? "alert" : "status"}>
          {prerequisite.copy}
        </p>
      ) : null}
      {result ? (
        <p role={result === "connected" ? "status" : "alert"}>
          {saved
            ? "AI connected and saved as your default."
            : AI_CONNECTION_MESSAGES[result]}
        </p>
      ) : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
      <div className="power-cta">
        <button
          className="secondary full"
          disabled={
            pending ||
            loading ||
            loadError ||
            !valid ||
            !runtime ||
            !resolveAgentReadiness(
              [runtime],
              config,
              "preferred",
              gitBashPrerequisite,
            ).ready
          }
          onClick={() => void testConnection()}
          type="button"
        >
          {pending ? "Working..." : "Test connection"}
        </button>
        <button
          className="primary full"
          disabled={
            pending || result !== "connected" || saved || !prerequisite.ready
          }
          onClick={() => void save()}
          type="button"
        >
          Save AI default
        </button>
      </div>
    </>
  );
}

export function CreditsComingSoon() {
  return (
    <div className="power-empty" data-testid="onboarding-credits-coming-soon">
      <h3>Coming soon</h3>
      <p>
        Colony credits cannot power AI employees yet. Connect your own provider
        key or an installed AI tool to get started.
      </p>
    </div>
  );
}
