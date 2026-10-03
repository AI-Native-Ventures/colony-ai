import {
  getGlobalAgentConfig,
  setGlobalAgentConfig,
} from "@/shared/api/tauriGlobalAgentConfig";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";

/** Persist the exact Connect selection before starter provisioning reads it. */
export async function saveOnboardingRuntime(
  runtimeId: string,
  runtimes: readonly AcpRuntimeCatalogEntry[],
  read = getGlobalAgentConfig,
  save = setGlobalAgentConfig,
  selectedModel?: string | null,
) {
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
  const config = await read();
  return save({
    ...config,
    preferred_runtime: runtimeId,
    // A model from a different harness cannot be carried into this selection.
    ...(config.preferred_runtime !== runtimeId && runtimeId !== "buzz-agent"
      ? { model: null, provider: null }
      : {}),
    ...(selectedModel === undefined ? {} : { model: selectedModel }),
  });
}
