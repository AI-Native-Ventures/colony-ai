import type { QueryClient } from "@tanstack/react-query";

import { refreshAcpRuntimes } from "@/features/agents/acpRuntimesQuery";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { colonyCreditsCandidate } from "@/features/credits/creditsGateway";
import {
  readFreeAiAccess,
  type FreeAiAccess,
} from "@/features/credits/freeAiAccess";
import {
  discoverGitBashPrerequisite,
  installAcpRuntime,
} from "@/shared/api/tauri";
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

/**
 * A Windows PC with no Git for Windows, where the only thing between the
 * bundled Colony Agent and a working shell is bash. Colony can fetch its own
 * (see the native managed Git), so the pick waits for that instead of sending
 * the person to the Connect screen. Own AI wins, as everywhere else.
 */
export function shellToolsNeeded(
  runtimes: readonly AcpRuntimeCatalogEntry[],
  gitBash: GitBashPrerequisite | null | undefined,
) {
  if (!gitBash || gitBash.available) return false;
  if (ownAiIsReady(runtimes)) return false;
  // Everything but the prerequisite is met: with it the agent can run.
  return bundledAgentIsReady(runtimes, { ...gitBash, available: true });
}

const dependencies = {
  access: (relayUrl?: string) => readFreeAiAccess(undefined, relayUrl),
  config: getGlobalAgentConfig,
  runtimes: (queryClient: QueryClient) => refreshAcpRuntimes(queryClient),
  gitBash: () => discoverGitBashPrerequisite().catch(() => undefined),
  /** Colony's own shell tools, installed as the Colony Agent runtime. */
  installShellTools: () =>
    installAcpRuntime("buzz-agent").then((result) => result.success),
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
  /**
   * The business's relay (`wss://host`). Before the business is opened the app
   * is on its root relay, where the owner has joined nothing, so the free-AI
   * question and the proof turn go to the business itself.
   */
  relayUrl?: string;
  /** True while Colony sets up its own shell tools, so the screen can say so. */
  onShellTools?: (active: boolean) => void;
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
    const access = await deps.access(request.relayUrl);
    // Not free, or no gateway: skip the runtime scan, Connect handles it.
    if (access !== "free" || !isCurrent()) return false;
    const [runtimes, firstGitBash] = await Promise.all([
      deps.runtimes(queryClient),
      deps.gitBash(),
    ]);
    if (!runtimes || !isCurrent()) return false;
    let gitBash = firstGitBash;
    if (shellToolsNeeded(runtimes, gitBash)) {
      request.onShellTools?.(true);
      try {
        // A failed or unsupported setup is not an error here: the check below
        // sees no bash and Connect (with its own Try again) takes over.
        let installed = false;
        try {
          installed = await deps.installShellTools();
        } catch {
          installed = false;
        }
        if (installed && isCurrent()) gitBash = await deps.gitBash();
      } finally {
        request.onShellTools?.(false);
      }
      if (!isCurrent()) return false;
    }
    const decision = decideAutoPick({
      access,
      ownAiReady: ownAiIsReady(runtimes),
      bundledReady: bundledAgentIsReady(runtimes, gitBash),
    });
    if (decision !== "colony-agent") return false;
    const candidate = colonyCreditsCandidate(await deps.config());
    if (!isCurrent()) return false;
    const result = request.business
      ? await deps.proveBusiness(
          candidate,
          isCurrent,
          request.business,
          request.relayUrl,
        )
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
