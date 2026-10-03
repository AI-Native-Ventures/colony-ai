import { invokeTauri } from "@/shared/api/tauri";
import { setGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import type { GlobalAgentConfig } from "@/shared/api/types";

export type OnboardingConnectionProof = {
  reply: string;
  model: string | null;
  startupMs: number;
  totalMs: number;
};

/** A completed nonempty turn is required; configuration/discovery is no proof. */
export async function runOnboardingConnectionTest(
  config: GlobalAgentConfig,
  isCurrent: () => boolean,
  invoke = (next: GlobalAgentConfig) =>
    invokeTauri<OnboardingConnectionProof & { error?: string }>(
      "test_onboarding_connection",
      { config: next },
    ),
  save = setGlobalAgentConfig,
) {
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
  // Pin the negotiated model so starter provisioning runs the tested choice.
  const saved = await save({ ...config, model: proof.model ?? config.model });
  if (!isCurrent()) throw new Error("Connection test cancelled.");
  return { proof, config: saved.config };
}
