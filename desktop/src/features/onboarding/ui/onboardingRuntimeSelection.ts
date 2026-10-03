import { resolveAgentReadiness } from "./agentReadiness";
import type {
  GlobalAgentConfig,
  AcpRuntimeCatalogEntry,
  GitBashPrerequisite,
} from "@/shared/api/types";

export const ONBOARDING_RUNTIME_ORDER = [
  "claude",
  "codex",
  "goose",
  "buzz-agent",
  "cursor",
  "devin",
  "omp",
  "grok",
  "opencode",
  "kimi",
  "amp",
  "hermes",
  "openclaw",
];

const VISIBLE_ONBOARDING_RUNTIME_IDS = new Set<string>(
  ONBOARDING_RUNTIME_ORDER,
);

export function runtimeIsVisibleInOnboarding(runtimeId: string) {
  return VISIBLE_ONBOARDING_RUNTIME_IDS.has(runtimeId);
}

/** Bundled readiness requires provider credentials and native prerequisites. */
export function runtimeIsReadyForOnboarding(
  runtime: AcpRuntimeCatalogEntry,
  globalConfig?: GlobalAgentConfig,
  gitBashPrerequisite?: GitBashPrerequisite | null,
) {
  if (!runtime.command || !runtime.binaryPath) return false;
  // Only the bundled agent is judged by provider, model and credentials. Goose
  // sign-in is unprobed, so provider config alone cannot make it ready (launch
  // decision recorded in desktop/src/features/agents/AGENTS.md).
  if (runtime.id === "buzz-agent") {
    return (
      globalConfig !== undefined &&
      resolveAgentReadiness(
        [runtime],
        {
          ...globalConfig,
          ...(globalConfig.preferred_runtime &&
          globalConfig.preferred_runtime !== runtime.id
            ? { provider: null, model: null }
            : {}),
          preferred_runtime: runtime.id,
        },
        "preferred",
        gitBashPrerequisite,
      ).ready
    );
  }
  return (
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_in"
  );
}

export function getVisibleOnboardingRuntimes(
  runtimes: readonly AcpRuntimeCatalogEntry[],
) {
  return runtimes
    .filter((runtime) => runtimeIsVisibleInOnboarding(runtime.id))
    .sort(
      (left, right) =>
        ONBOARDING_RUNTIME_ORDER.indexOf(left.id) -
        ONBOARDING_RUNTIME_ORDER.indexOf(right.id),
    );
}

/** Return configured, authenticated runtimes that can run on this computer. */
export function getReadyOnboardingRuntimes(
  runtimes: readonly AcpRuntimeCatalogEntry[],
  globalConfig?: GlobalAgentConfig,
  gitBashPrerequisite?: GitBashPrerequisite | null,
) {
  return getVisibleOnboardingRuntimes(runtimes).filter((runtime) =>
    runtimeIsReadyForOnboarding(runtime, globalConfig, gitBashPrerequisite),
  );
}
