import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAcpRuntimesQuery,
  useGitBashPrerequisiteQuery,
} from "@/features/agents/hooks";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { EMPTY_GLOBAL_CONFIG } from "@/features/agents/ui/AgentConfigFields";
import {
  getGlobalAgentConfig,
  setGlobalAgentConfig,
} from "@/shared/api/tauriGlobalAgentConfig";
import { invokeTauri } from "@/shared/api/tauri";
import type { GlobalAgentConfig } from "@/shared/api/types";
import { resolveAgentPrerequisiteReadiness } from "./agentReadiness";
import { Glyph } from "./OnboardingScenePrimitives";

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

/** Approved BYOK fields; provider testing and persistence use the native contract. */
export function AiKeyConnectionPanel({
  onCheckedChange,
}: {
  onCheckedChange?: (checked: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const runtimes = useAcpRuntimesQuery();
  const gitBash = useGitBashPrerequisiteQuery();
  const prerequisite = resolveAgentPrerequisiteReadiness(
    "buzz-agent",
    gitBash.isError ? undefined : gitBash.data,
  );
  const runtime = runtimes.data?.find(
    (candidate) => candidate.id === "buzz-agent",
  );
  const [config, setConfig] =
    React.useState<GlobalAgentConfig>(EMPTY_GLOBAL_CONFIG);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [showKey, setShowKey] = React.useState(false);
  const [result, setResult] = React.useState<ConnectionResult | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const generation = React.useRef(0);
  React.useEffect(() => {
    const current = ++generation.current;
    getGlobalAgentConfig()
      .then((loaded) => {
        if (current !== generation.current) return;
        setConfig({
          ...loaded,
          preferred_runtime: "buzz-agent",
          provider:
            loaded.provider === "openai" || loaded.provider === "openai-compat"
              ? "openai"
              : "anthropic",
        });
      })
      .catch(() => {
        if (current === generation.current) setLoadError(true);
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, []);
  const provider = config.provider === "openai" ? "OpenAI" : "Anthropic";
  const keyName =
    config.provider === "openai"
      ? "OPENAI_COMPAT_API_KEY"
      : "ANTHROPIC_API_KEY";
  const key = config.env_vars[keyName] ?? "";
  const changeConfig = (next: GlobalAgentConfig) => {
    generation.current++;
    setConfig(next);
    setPending(false);
    setResult(null);
    setSaved(false);
    onCheckedChange?.(false);
    setSaveError(null);
  };
  const checkKey = async () => {
    const current = ++generation.current;
    const snapshot = {
      ...config,
      env_vars: { ...config.env_vars, [keyName]: key.trim() },
    };
    setPending(true);
    setSaveError(null);
    try {
      if (result !== "connected") {
        const response = await invokeTauri<ConnectionResult>(
          "test_ai_connection",
          { config: snapshot },
        );
        if (current !== generation.current) return;
        const outcome = Object.hasOwn(AI_CONNECTION_MESSAGES, response)
          ? response
          : "provider-failure";
        setResult(outcome);
        if (outcome !== "connected") return;
      }
      if (current !== generation.current) return;
      try {
        const response = await setGlobalAgentConfig(snapshot);
        if (current !== generation.current) return;
        queryClient.setQueryData(globalAgentConfigQueryKey, response.config);
        setSaved(true);
        onCheckedChange?.(true);
        if (response.failed_restart_count > 0)
          setSaveError(
            "AI defaults saved, but an existing employee could not restart. Retry its restart from Agents.",
          );
      } catch {
        if (current === generation.current)
          setSaveError(
            "Could not save your AI defaults. Your key check passed. Check key to try saving again.",
          );
      }
    } catch {
      if (current === generation.current) setResult("network-failure");
    } finally {
      if (current === generation.current) setPending(false);
    }
  };
  return (
    <>
      <div className="section-heading">
        <h3>Connect directly to a provider</h3>
      </div>
      <div className="key-fields">
        <div className="field">
          <label htmlFor="key-provider">Provider</label>
          <select
            id="key-provider"
            disabled={pending || loading}
            value={config.provider ?? "anthropic"}
            onChange={(event) =>
              changeConfig({ ...config, provider: event.target.value })
            }
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="provider-key">API key</label>
          <div className="input-wrap">
            <input
              autoComplete="off"
              id="provider-key"
              data-testid="onboarding-provider-key"
              disabled={loading}
              type={showKey ? "text" : "password"}
              placeholder="Paste your provider’s key"
              value={key}
              onChange={(event) =>
                changeConfig({
                  ...config,
                  env_vars: {
                    ...config.env_vars,
                    [keyName]: event.target.value,
                  },
                })
              }
            />
            <button
              type="button"
              aria-label={showKey ? "Hide API key" : "Show API key"}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </div>
      </div>
      <p className="power-caption">
        Usage is billed by {provider}, separately from any subscription.
      </p>
      {loadError ? (
        <div className="power-notice is-error" role="alert">
          <p>
            AI settings could not load. Return to Subscriptions and check again.
          </p>
        </div>
      ) : null}
      {!loading && !prerequisite.ready ? (
        <p role={prerequisite.reason === "git-bash" ? "alert" : "status"}>
          {prerequisite.copy}
        </p>
      ) : null}
      {result && result !== "connected" ? (
        <div className="power-notice is-error" role="alert">
          <Glyph name="alert" />
          <p>{AI_CONNECTION_MESSAGES[result]}</p>
        </div>
      ) : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
      {saved ? (
        <p role="status">AI connected and saved as your default.</p>
      ) : null}
      <button
        className="primary full"
        type="button"
        disabled={
          pending ||
          loading ||
          loadError ||
          !runtime ||
          !key.trim() ||
          !prerequisite.ready ||
          saved
        }
        onClick={() => void checkKey()}
      >
        {pending ? "Checking key" : "Check key"} <Glyph name="arrow" />
      </button>
    </>
  );
}

export function CreditsComingSoon() {
  return (
    <div className="power-empty" data-testid="onboarding-credits-coming-soon">
      <h3>Coming soon</h3>
      <p>
        Colony credits cannot power AI employees yet. Connect an installed AI
        tool or your OpenRouter account to get started.
      </p>
    </div>
  );
}
