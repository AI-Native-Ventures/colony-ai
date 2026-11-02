import { Button } from "@/shared/ui/button";
import { useStartManagedAgentMutation } from "../hooks";
import {
  beginAgentRuntimeSwitch,
  failAgentRuntimeSwitch,
  finishAgentRuntimeSwitch,
  useAgentRuntimeSwitchStatus,
} from "../agentRuntimeSwitchStore";

export function AgentRuntimeSwitchNotice({
  compact = false,
  pubkey,
}: {
  compact?: boolean;
  pubkey: string;
}) {
  const status = useAgentRuntimeSwitchStatus(pubkey);
  const startMutation = useStartManagedAgentMutation();
  if (!status) return null;
  const retryTarget = {
    targetRuntimeId: status.targetRuntimeId,
    targetLabel: status.targetLabel,
    targetModel: status.targetModel,
    activeTurn: status.activeTurn,
  };

  async function retry() {
    const generation = beginAgentRuntimeSwitch(pubkey, retryTarget);
    try {
      await startMutation.mutateAsync(pubkey);
      finishAgentRuntimeSwitch(pubkey, generation);
    } catch (error) {
      failAgentRuntimeSwitch(
        pubkey,
        generation,
        error instanceof Error ? error.message : "The runtime could not start.",
      );
    }
  }

  const content =
    status.phase === "switching" ? (
      <>
        <span>Switching to {status.targetLabel}...</span>
        {status.activeTurn ? (
          <span>
            The current turn will stop. Queued mentions will remain queued.
          </span>
        ) : null}
      </>
    ) : (
      <>
        <span>
          Could not switch to {status.targetLabel}: {status.error}
        </span>
        <Button
          disabled={startMutation.isPending}
          onClick={() => void retry()}
          size="sm"
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </>
    );

  return (
    <div
      aria-live={status.phase === "failed" ? "assertive" : "polite"}
      className={
        compact
          ? "inline-flex flex-wrap items-center gap-2 text-xs"
          : "agents-c3-banner flex flex-wrap items-center gap-2"
      }
      data-testid="agent-runtime-switch-notice"
      role={status.phase === "failed" ? "alert" : "status"}
    >
      {content}
    </div>
  );
}
