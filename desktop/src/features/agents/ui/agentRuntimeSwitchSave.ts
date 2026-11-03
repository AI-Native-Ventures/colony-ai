import { useActiveAgentTurns } from "@/features/agents/activeAgentTurnsStore";
import {
  beginAgentRuntimeSwitch,
  failAgentRuntimeSwitch,
  finishAgentRuntimeSwitch,
} from "@/features/agents/agentRuntimeSwitchStore";
import type { ManagedAgent, UpdateManagedAgentInput } from "@/shared/api/types";

const restartFailurePrefix =
  "Agent settings were saved, but its runtime failed to restart: ";

/** Wrap the edit-dialog save so a running local agent reports its restart. */
export function useAgentRuntimeSwitchSave<T>(
  agent: ManagedAgent,
  mutateAsync: (input: UpdateManagedAgentInput) => Promise<T>,
  onOpenChange: (open: boolean) => void,
) {
  const activeTurn = useActiveAgentTurns(agent.pubkey).length > 0;

  return async (
    input: UpdateManagedAgentInput,
    target: { runtimeId: string; label: string; model: string | null },
  ): Promise<T | null> => {
    const switchRequested =
      input.agentCommand !== undefined ||
      input.agentArgs !== undefined ||
      input.model !== undefined ||
      input.provider !== undefined;
    const generation =
      switchRequested &&
      agent.backend.type === "local" &&
      agent.status === "running"
        ? beginAgentRuntimeSwitch(agent.pubkey, {
            targetRuntimeId: target.runtimeId,
            targetLabel: target.label,
            targetModel: target.model,
            activeTurn,
          })
        : null;

    try {
      const result = await mutateAsync(input);
      if (generation !== null) {
        finishAgentRuntimeSwitch(agent.pubkey, generation);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      if (generation !== null && message.startsWith(restartFailurePrefix)) {
        failAgentRuntimeSwitch(
          agent.pubkey,
          generation,
          message.slice(restartFailurePrefix.length),
        );
        onOpenChange(false);
        return null;
      }
      if (generation !== null) {
        finishAgentRuntimeSwitch(agent.pubkey, generation);
      }
      throw error;
    }
  };
}
