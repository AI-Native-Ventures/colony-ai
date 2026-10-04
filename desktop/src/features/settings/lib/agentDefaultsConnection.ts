import type {
  AcpRuntimeCatalogEntry,
  GlobalAgentConfig,
} from "@/shared/api/types";
import type { OpenRouterOutcome } from "@/shared/api/tauriOpenRouter";
import { getGlobalAgentCredentialState } from "@/features/agents/ui/globalAgentCredentialState";

/** Describe only the saved route's reported authentication or credential state. */
export function agentDefaultsConnection(
  config: GlobalAgentConfig,
  runtimes: readonly AcpRuntimeCatalogEntry[],
  openRouter?: OpenRouterOutcome,
) {
  const runtime = runtimes.find(
    (entry) => entry.id === config.preferred_runtime,
  );
  if (!runtime)
    return {
      kind: "unknown",
      label: "Connection not configured",
      detail: "Choose a connection below.",
    };
  if (runtime.availability !== "available")
    return {
      kind: "unavailable",
      label: `${runtime.label} unavailable`,
      detail: "Open Agent runtimes to check installation.",
    };
  // Native auth metadata is the authority for subscription routes. Provider-backed
  // runtimes use credentials instead, including the bundled runtime's n/a auth.
  if (
    !runtime.providerEnvVar &&
    runtime.authStatus.status !== "not_applicable"
  ) {
    if (runtime.authStatus.status === "logged_in")
      return {
        kind: "subscription",
        label: `${runtime.label} subscription connected`,
        detail: config.model || "Default model",
      };
    return {
      kind: "unknown",
      label: `${runtime.label} ${runtime.authStatus.status === "logged_out" ? "needs sign-in" : "connection not confirmed"}`,
      detail: "Open Agent runtimes to check the connection.",
    };
  }
  if (
    config.provider === "openrouter" &&
    openRouter &&
    (openRouter.status === "connected" || openRouter.status === "limit") &&
    (!openRouter.testResult || openRouter.testResult === "connected")
  )
    return {
      kind: "openrouter",
      label: "OpenRouter connected",
      detail:
        openRouter.status === "limit"
          ? "Model allowance used up"
          : openRouter.model,
    };
  const credentials = getGlobalAgentCredentialState({
    bakedEnvKeys: [],
    envVars: config.env_vars,
    provider: config.provider ?? "",
    runtimeFileConfig: null,
    runtimeId: runtime.id,
  });
  if (config.provider && config.model && credentials.credentialsValid)
    return {
      kind: "key",
      label: "Own key configured",
      detail: `${config.provider} · ${config.model}. Connection not tested here.`,
    };
  return {
    kind: "unknown",
    label: "Connection not confirmed",
    detail: "Review your saved connection below.",
  };
}
