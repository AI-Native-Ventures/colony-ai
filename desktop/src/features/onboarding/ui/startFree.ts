import {
  FREE_LIMIT_CODE,
  FREE_LIMIT_COPY,
  isFreeLimitText,
} from "@/features/agents/lib/friendlyAgentLastError";
import type { GlobalAgentConfig } from "@/shared/api/types";

/** Start free runs Colony's own OpenCode on OpenCode's free model. */
export const START_FREE_RUNTIME_ID = "opencode";
export const START_FREE_PROVIDER = "opencode-free";
export const START_FREE_MODEL = "opencode/deepseek-v4.1-flash-free";

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
): GlobalAgentConfig {
  return {
    ...current,
    preferred_runtime: START_FREE_RUNTIME_ID,
    provider: START_FREE_PROVIDER,
    model: START_FREE_MODEL,
  };
}

/** "ended" means OpenCode no longer offers the free model. */
export function startFreeFailureKind(error: unknown): "ended" | "other" {
  return error instanceof OnboardingConnectionError &&
    error.code === "model_unavailable"
    ? "ended"
    : "other";
}

/**
 * What Connect shows for a failed proof turn. OpenCode's free quota running out
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
