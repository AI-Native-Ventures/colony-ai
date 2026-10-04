import { getDefaultPersonaRuntime } from "@/features/agents/lib/resolvePersonaRuntime";
import { requiredCredentialEnvKeys } from "@/features/agents/ui/agentConfigOptions";
import type {
  AcpRuntimeCatalogEntry,
  GlobalAgentConfig,
  GitBashPrerequisite,
} from "@/shared/api/types";

export type AgentReadinessResult =
  | { ready: true; reason: "cli"; runtimeLabel: string }
  | { ready: true; reason: "buzz-agent" }
  | {
      ready: false;
      reason?: "git-bash" | "checking-prerequisites";
      copy?: string;
    };

export const GIT_BASH_REQUIRED_COPY =
  "Install Git for Windows from https://gitforwindows.org/, then open Settings, Agent runtimes to re-check before starting your AI employees.";

/**
 * Determine whether the user has a working agent path configured.
 *
 * CLI path: the preferred Claude or Codex runtime is available and logged in.
 * Provider path: the preferred Colony Agent runtime has provider and
 * model set, plus all required credential env vars for that provider.
 *
 * Returns enough info for the UI to say which path matched, or that neither did.
 */
export function resolveAgentReadiness(
  runtimes: readonly AcpRuntimeCatalogEntry[],
  globalConfig: GlobalAgentConfig,
  scope: "any" | "preferred" = "any",
  gitBashPrerequisite?: GitBashPrerequisite | null,
  verifiedRuntimeId?: string | null,
): AgentReadinessResult {
  // Welcome starts the configured bundled runtime even if another CLI is installed.
  // An unrelated ready CLI cannot waive this runtime's native prerequisite.
  if (globalConfig.preferred_runtime === "buzz-agent") {
    const prerequisite = resolveAgentPrerequisiteReadiness(
      "buzz-agent",
      gitBashPrerequisite,
    );
    if (!prerequisite.ready) return prerequisite;
  }
  if (scope === "preferred" && !globalConfig.preferred_runtime) {
    const legacy = resolveLegacyWelcomeRuntime(
      runtimes,
      globalConfig,
      gitBashPrerequisite,
    );
    return legacy
      ? resolveAgentReadiness(
          runtimes,
          { ...globalConfig, preferred_runtime: legacy.id },
          "preferred",
          gitBashPrerequisite,
        )
      : { ready: false };
  }
  if (scope === "any") {
    for (const runtime of runtimes) {
      if (runtime.id === "buzz-agent" || runtime.id === "goose") continue;
      if (
        runtime.availability === "available" &&
        runtime.authStatus.status === "logged_in"
      ) {
        return { ready: true, reason: "cli", runtimeLabel: runtime.label };
      }
    }
  }

  const preferredRuntime =
    scope === "preferred"
      ? runtimes.find(
          (runtime) => runtime.id === globalConfig.preferred_runtime,
        )
      : runtimes.find((runtime) => runtime.id === "buzz-agent");
  if (preferredRuntime?.availability !== "available") {
    return { ready: false };
  }

  if (
    preferredRuntime.id !== "buzz-agent" &&
    preferredRuntime.id !== "goose" &&
    (preferredRuntime.authStatus.status === "logged_in" ||
      (verifiedRuntimeId === preferredRuntime.id &&
        verifiedRuntimeId === globalConfig.preferred_runtime))
  ) {
    return {
      ready: true,
      reason: "cli",
      runtimeLabel: preferredRuntime.label,
    };
  }

  if (preferredRuntime.id !== "buzz-agent") {
    return { ready: false };
  }

  const prerequisite = resolveAgentPrerequisiteReadiness(
    preferredRuntime.id,
    gitBashPrerequisite,
  );
  if (!prerequisite.ready) return prerequisite;

  const provider = globalConfig.provider?.trim() ?? "";
  const model = globalConfig.model?.trim() ?? "";
  if (provider.length > 0 && model.length > 0) {
    const required = requiredCredentialEnvKeys(preferredRuntime.id, provider);
    const allKeysPresent = required.every(
      (key) => (globalConfig.env_vars[key] ?? "").trim().length > 0,
    );
    if (allKeysPresent) {
      return { ready: true, reason: "buzz-agent" };
    }
  }

  return { ready: false };
}

/** Native null means this platform does not require Git for Windows. */
export function resolveAgentPrerequisiteReadiness(
  runtimeId: string,
  prerequisite: GitBashPrerequisite | null | undefined,
):
  | { ready: true }
  | {
      ready: false;
      reason: "git-bash" | "checking-prerequisites";
      copy: string;
    } {
  if (runtimeId !== "buzz-agent" || prerequisite === null)
    return { ready: true };
  if (prerequisite === undefined) {
    return {
      ready: false,
      reason: "checking-prerequisites",
      copy: "Checking Git for Windows readiness. Open Settings, Agent runtimes if this check fails.",
    };
  }
  return prerequisite.available
    ? { ready: true }
    : { ready: false, reason: "git-bash", copy: GIT_BASH_REQUIRED_COPY };
}

/** Legacy installs choose a ready runtime in the same order used for persona defaults. */
export function resolveLegacyWelcomeRuntime(
  runtimes: readonly AcpRuntimeCatalogEntry[],
  config: GlobalAgentConfig,
  prerequisite?: GitBashPrerequisite | null,
) {
  const ready = runtimes.filter(
    (runtime) =>
      resolveAgentReadiness(
        [runtime],
        { ...config, preferred_runtime: runtime.id },
        "preferred",
        prerequisite,
      ).ready,
  );
  return getDefaultPersonaRuntime(ready);
}
