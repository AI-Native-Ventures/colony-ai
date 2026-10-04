import { listen } from "@tauri-apps/api/event";
import { invokeTauri } from "@/shared/api/tauri";
import { setGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import type { GlobalAgentConfig } from "@/shared/api/types";

export type OnboardingConnectionProof = {
  reply: string;
  model: string | null;
  startupMs: number;
  totalMs: number;
  spawnMs?: number;
  initializeMs?: number;
  sessionMs?: number;
  firstTokenMs?: number | null;
};

export type OnboardingConnectionProgress = "starting" | "waiting" | "saving";
const progressListeners = new Set<
  (phase: OnboardingConnectionProgress) => void
>();
/** Subscribe to actual adapter startup and the verified configuration commit. */
export function subscribeOnboardingConnectionProgress(
  listener: (phase: OnboardingConnectionProgress) => void,
) {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}
function reportProgress(phase: OnboardingConnectionProgress) {
  for (const listener of progressListeners) listener(phase);
}

let activeRequestId: string | null = null;

/** Cancel the native process tree for the active attempt, without changing proof types. */
export async function cancelOnboardingConnectionTest() {
  const requestId = activeRequestId;
  if (requestId) {
    activeRequestId = null;
    await invokeTauri("cancel_onboarding_connection_test", { requestId });
  }
}

async function invokeConnection(
  config: GlobalAgentConfig,
  business?: { name: string; website: string; description: string },
) {
  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  let unlisten = () => {};
  try {
    unlisten = await listen<{ requestId: string; phase: string }>(
      "onboarding-connection-progress",
      ({ payload }) => {
        if (
          payload.requestId === requestId &&
          activeRequestId === requestId &&
          payload.phase === "waiting"
        )
          reportProgress("waiting");
      },
    );
    if (activeRequestId !== requestId)
      throw new Error("Connection test cancelled.");
    return await invokeTauri<OnboardingConnectionProof & { error?: string }>(
      "test_onboarding_connection",
      { config, requestId, business },
    );
  } finally {
    unlisten();
    if (activeRequestId === requestId) activeRequestId = null;
  }
}

/** A completed nonempty turn is required; configuration/discovery is no proof. */
export async function runOnboardingConnectionTest(
  config: GlobalAgentConfig,
  isCurrent: () => boolean,
  invoke = invokeConnection,
  save = setGlobalAgentConfig,
) {
  reportProgress("starting");
  const proof = await invoke(config);
  if (!isCurrent()) throw new Error("Connection test cancelled.");
  if (proof.error) throw new Error(proof.error);
  if (typeof proof.reply !== "string" || !proof.reply.trim()) {
    throw new Error(
      "Your agent returned no reply. Check sign-in and usage, then try again.",
    );
  }
  if (proof.model !== null && typeof proof.model !== "string") {
    throw new Error("The harness did not report a valid model. Check again.");
  }
  console.info("colony-onboarding timing", {
    spawnMs: proof.spawnMs,
    initializeMs: proof.initializeMs,
    sessionMs: proof.sessionMs,
    firstTokenMs: proof.firstTokenMs,
    totalMs: proof.totalMs,
  });
  // Default remains unset. Adapter catalog ids are display proof, not global defaults.
  reportProgress("saving");
  const saved = await save(config);
  if (!isCurrent()) throw new Error("Connection test cancelled.");
  return { proof, config: saved.config };
}

/** Run the same proof turn with business facts so its real reply can introduce Scout in Welcome. */
export function runOnboardingBusinessConnectionTest(
  config: GlobalAgentConfig,
  isCurrent: () => boolean,
  business: { name: string; website: string; description: string },
) {
  return runOnboardingConnectionTest(config, isCurrent, (candidate) =>
    invokeConnection(candidate, business),
  );
}
