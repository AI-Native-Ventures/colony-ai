import {
  FREE_LIMIT_CODE,
  FREE_LIMIT_COPY,
  isFreeLimitText,
} from "@/features/agents/lib/friendlyAgentLastError";
import type { GlobalAgentConfig } from "@/shared/api/types";

/** Start free uses Colony's bundled agent and the relay's configured free model. */
export const START_FREE_RUNTIME_ID = "buzz-agent";
export const START_FREE_PROVIDER = "colony-credits";

/** A connection-test failure that keeps the native result's machine code. */
export class OnboardingConnectionError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "OnboardingConnectionError";
    this.code = code;
  }
}

export function buildStartFreeConfig(
  current: GlobalAgentConfig,
  freeModel: string,
): GlobalAgentConfig {
  if (!freeModel.trim().endsWith(":free")) {
    throw new Error("Colony free AI did not return a configured free model.");
  }
  return {
    ...current,
    preferred_runtime: START_FREE_RUNTIME_ID,
    provider: START_FREE_PROVIDER,
    model: freeModel,
  };
}

/** Keep the retired state for a relay that has no configured free route. */
export function startFreeFailureKind(error: unknown): "ended" | "other" {
  return error instanceof OnboardingConnectionError &&
    error.code === "model_unavailable"
    ? "ended"
    : "other";
}

/**
 * What Connect shows for a failed proof turn. A temporary free-route refusal
 * gets one plain sentence, whether the native test coded it or only quoted it.
 */
export function onboardingFailureCopy(error: Error): string {
  const coded =
    error instanceof OnboardingConnectionError &&
    error.code === FREE_LIMIT_CODE;
  return coded || isFreeLimitText(error.message)
    ? FREE_LIMIT_COPY
    : error.message;
}
