import type {
  AcpRuntimeCatalogEntry,
  GlobalAgentConfig,
} from "@/shared/api/types";

/** Build a candidate in memory; only a completed connection proof may persist it. */
export function buildOnboardingRuntimeCandidate(
  config: GlobalAgentConfig,
  runtimeId: string,
  runtimes: readonly AcpRuntimeCatalogEntry[],
  selectedModel?: string | null,
): GlobalAgentConfig {
  if (
    !runtimes.some(
      (runtime) =>
        runtime.id === runtimeId && runtime.availability === "available",
    )
  ) {
    throw new Error(
      "Your selected AI runtime is unavailable. Check again or choose another connection.",
    );
  }
  return {
    ...config,
    preferred_runtime: runtimeId,
    ...((config.preferred_runtime ?? "buzz-agent") !== runtimeId
      ? { model: null, provider: null }
      : {}),
    ...(selectedModel === undefined ? {} : { model: selectedModel }),
  };
}
