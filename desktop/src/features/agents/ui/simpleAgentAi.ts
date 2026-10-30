import { formatAgentModelLabel } from "../lib/formatAgentModelLabel";
import type { RuntimeConfigSurface } from "@/shared/api/types";
import { providerName } from "./agentPageModel";
import { getProviderEffortConfig } from "./buzzAgentConfig";

const FULL_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "nvidia/nemotron-3-ultra-550b-a55b:free": "Nemotron 3 Ultra 550B A55B",
  "google/gemma-4-31b-it:free": "Gemma 4 31B IT",
  "poolside/laguna-s-2.1:free": "Laguna S 2.1",
  "poolside/laguna-xs-2.1:free": "Laguna XS 2.1",
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-sonnet-4-7": "Claude Sonnet 4.7",
  "claude-sonnet-4-8": "Claude Sonnet 4.8",
  opus: "Claude Opus 5.5",
  "claude-opus": "Claude Opus 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  sonnet: "Claude Sonnet 5.5",
  "claude-sonnet": "Claude Sonnet 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  haiku: "Claude Haiku 5.5",
  "claude-haiku": "Claude Haiku 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "gpt-4o": "GPT-4o",
  "gpt-5.5": "GPT-5.5",
  "gpt-6": "GPT-6",
  "gpt-6-luna": "GPT-6 Luna",
};

function hasKey(
  envVars: Readonly<Record<string, string>>,
  names: readonly string[],
) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return Object.entries(envVars).some(
    ([name, value]) => wanted.has(name.toLowerCase()) && Boolean(value.trim()),
  );
}

export function isClaudeSubscription({
  runtimeId,
  provider,
  envVars = {},
}: {
  runtimeId: string | null | undefined;
  provider: string | null | undefined;
  envVars?: Readonly<Record<string, string>>;
}): boolean {
  const runtime = runtimeId?.trim().toLowerCase();
  const configuredProvider = provider?.trim().toLowerCase();
  return (
    runtime === "claude" &&
    (!configuredProvider || configuredProvider === "anthropic") &&
    !hasKey(envVars, ["ANTHROPIC_API_KEY"])
  );
}

/** Provider labels stay hidden when the harness subscription already names it. */
export function simpleProviderLabel({
  runtimeId,
  provider,
  envVars = {},
}: {
  runtimeId: string | null | undefined;
  provider: string | null | undefined;
  envVars?: Readonly<Record<string, string>>;
}): string | null {
  const runtime = runtimeId?.trim().toLowerCase();
  const configuredProvider = provider?.trim().toLowerCase();
  const impliedProvider =
    runtime === "claude" ? "anthropic" : runtime === "codex" ? "openai" : null;
  const resolvedProvider = configuredProvider || impliedProvider;
  if (!resolvedProvider) return null;

  if (resolvedProvider === "colony-credits") return "Colony free AI";

  if (resolvedProvider === "anthropic" && runtime === "claude") {
    return hasKey(envVars, ["ANTHROPIC_API_KEY"])
      ? providerName(resolvedProvider)
      : null;
  }
  if (resolvedProvider === "openai" && runtime === "codex") {
    return hasKey(envVars, ["OPENAI_API_KEY", "OPENAI_COMPAT_API_KEY"])
      ? providerName(resolvedProvider)
      : null;
  }
  return providerName(resolvedProvider);
}

/** Expand approved short aliases, then use the shared provider-aware registry. */
export function simpleModelLabel(
  model: string | null | undefined,
  provider?: string | null,
) {
  const trimmed = model?.trim();
  if (!trimmed || trimmed.toLowerCase() === "[model]") return "Not reported";
  return (
    FULL_MODEL_ALIASES[trimmed.toLowerCase()] ??
    formatAgentModelLabel(trimmed, provider)
  );
}

/** Resolve model and provider with the same live-config precedence on both AI summaries. */
export function resolveSimpleAgentAi({
  runtimeId,
  config,
  agentModel,
  agentProvider,
  inheritedModel,
  inheritedProvider,
}: {
  runtimeId: string | null | undefined;
  config:
    | Pick<RuntimeConfigSurface, "runtimeId" | "isPreSpawn" | "normalized">
    | undefined;
  agentModel?: string | null;
  agentProvider?: string | null;
  inheritedModel?: string | null;
  inheritedProvider?: string | null;
}) {
  const observed =
    config !== undefined &&
    !config.isPreSpawn &&
    (!runtimeId || config.runtimeId === runtimeId);
  const model =
    (observed ? config.normalized.model?.value : null)?.trim() ||
    agentModel?.trim() ||
    inheritedModel?.trim() ||
    null;
  const provider =
    (observed ? config.normalized.provider?.value : null)?.trim() ||
    agentProvider?.trim() ||
    inheritedProvider?.trim() ||
    null;

  return { observed, model, provider };
}

/** Return a configured effort accepted by the adapter or the shared model manifest. */
export function acceptedEffortLabel(
  effort: string | null | undefined,
  options: readonly { value: string; displayName?: string }[] | undefined,
  fallback?: {
    runtimeId: string | null | undefined;
    provider: string | null | undefined;
    model: string | null | undefined;
  },
) {
  const value = effort?.trim();
  if (!value) return null;

  if (options && options.length > 0) {
    const option = options.find((candidate) => candidate.value === value);
    return option?.displayName?.trim() || option?.value || null;
  }

  if (fallback?.runtimeId === "buzz-agent") {
    const validValues = getProviderEffortConfig(
      fallback.provider ?? "",
      fallback.model ?? undefined,
    ).validValues;
    return validValues.includes(value as (typeof validValues)[number])
      ? value
      : null;
  }

  return null;
}
