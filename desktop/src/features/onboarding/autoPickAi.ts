import type { QueryClient } from "@tanstack/react-query";

import { refreshAcpRuntimes } from "@/features/agents/acpRuntimesQuery";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { colonyCreditsCandidate } from "@/features/credits/creditsGateway";
import {
  readFreeAiAccess,
  type FreeAiAccess,
} from "@/features/credits/freeAiAccess";
import { discoverGitBashPrerequisite } from "@/shared/api/tauri";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import type {
  AcpRuntimeCatalogEntry,
  GitBashPrerequisite,
} from "@/shared/api/types";
import { resolveAgentPrerequisiteReadiness } from "./ui/agentReadiness";
import {
  runOnboardingBusinessConnectionTest,
  runOnboardingConnectionTest,
} from "./ui/onboardingConnectionTest";
import {
  ONBOARDING_SUBSCRIPTION_RUNTIME_IDS,
  runtimeIsReadyForOnboarding,
} from "./ui/onboardingRuntimeSelection";
import { saveVerifiedWelcomeConnection } from "./welcomeConnection";

/**
 * What a person with no saved AI gets when they reach Connect.
 * - own-ai: Claude Code or Codex is installed and signed in. Today's Connect
 *   screen preselects it, so nothing is picked for them.
 * - colony-agent: this account may use the bundled Colony Agent through the
 *   relay gateway with no setup. It is picked and proven with no screen.
 * - connect-screen: today's Connect screen (Start free leads when nothing of
 *   their own is ready).
 */
export type AutoPickDecision = "own-ai" | "colony-agent" | "connect-screen";

export type AutoPickInputs = {
  /** The relay's answer for this account (see readFreeAiAccess). */
  access: FreeAiAccess;
  /** Claude Code or Codex is installed and signed in on this computer. */
  ownAiReady: boolean;
  /** The bundled Colony Agent can run here (installed, Git for Windows met). */
  bundledReady: boolean;
};

/** Pure decision: the order is the brief's rule, own AI first. */
export function decideAutoPick(inputs: AutoPickInputs): AutoPickDecision {
  if (inputs.access !== "free") return "connect-screen";
  if (inputs.ownAiReady) return "own-ai";
  if (!inputs.bundledReady) return "connect-screen";
  return "colony-agent";
}

/** Claude Code or Codex, installed and signed in. */
export function ownAiIsReady(runtimes: readonly AcpRuntimeCatalogEntry[]) {
  return runtimes.some(
    (runtime) =>
      (ONBOARDING_SUBSCRIPTION_RUNTIME_IDS as readonly string[]).includes(
        runtime.id,
      ) && runtimeIsReadyForOnboarding(runtime),
  );
}

/** The bundled agent exists here and its platform prerequisite is met. */
export function bundledAgentIsReady(
  runtimes: readonly AcpRuntimeCatalogEntry[],
  gitBash: GitBashPrerequisite | null | undefined,
) {
  const bundled = runtimes.find((runtime) => runtime.id === "buzz-agent");
  return (
    bundled?.availability === "available" &&
    !!bundled.command &&
    !!bundled.binaryPath &&
    resolveAgentPrerequisiteReadiness("buzz-agent", gitBash).ready
  );
}

const dependencies = {
  access: readFreeAiAccess,
  config: getGlobalAgentConfig,
  runtimes: (queryClient: QueryClient) => refreshAcpRuntimes(queryClient),
  gitBash: () => discoverGitBashPrerequisite().catch(() => undefined),
  prove: runOnboardingConnectionTest,
  proveBusiness: runOnboardingBusinessConnectionTest,
  saveReceipt: saveVerifiedWelcomeConnection,
};

export type AutoPickRequest = {
  queryClient: QueryClient;
  isCurrent: () => boolean;
  /** The business being opened, so Welcome keeps a real reply to show. */
  business?: { name: string; website: string; description: string };
  communityId?: string;
};

/**
 * Pick the bundled Colony Agent for an account the relay says is free, then
 * prove it with a real reply before saving, exactly like a hand-picked route.
 * Resolves true only when the route is proven and saved. Every other outcome
 * (not free, own AI ready, gateway off or unreachable, proof failed) resolves
 * false so the caller shows today's Connect screen. Never throws.
 */
export async function autoPickColonyAgent(
  request: AutoPickRequest,
  deps: typeof dependencies = dependencies,
): Promise<boolean> {
  const { queryClient, isCurrent } = request;
  try {
    const access = await deps.access();
    // Not free, or no gateway: skip the runtime scan, Connect handles it.
    if (access !== "free" || !isCurrent()) return false;
    const [runtimes, gitBash] = await Promise.all([
      deps.runtimes(queryClient),
      deps.gitBash(),
    ]);
    if (!runtimes || !isCurrent()) return false;
    const decision = decideAutoPick({
      access,
      ownAiReady: ownAiIsReady(runtimes),
      bundledReady: bundledAgentIsReady(runtimes, gitBash),
    });
    if (decision !== "colony-agent") return false;
    const candidate = colonyCreditsCandidate(await deps.config());
    if (!isCurrent()) return false;
    const result = request.business
      ? await deps.proveBusiness(candidate, isCurrent, request.business)
      : await deps.prove(candidate, isCurrent);
    if (!isCurrent()) return false;
    if (request.business && request.communityId)
      await deps.saveReceipt(request.communityId, result.config, result.proof);
    if (!isCurrent()) return false;
    queryClient.setQueryData(globalAgentConfigQueryKey, result.config);
    return true;
  } catch (failure) {
    // The gateway can fail for reasons unrelated to the person. Connect is the
    // recovery path, so a failed auto-pick is a quiet fallback, never a block.
    console.warn(
      "Colony Agent could not be picked automatically",
      failure instanceof Error ? failure.message : failure,
    );
    return false;
  }
}
