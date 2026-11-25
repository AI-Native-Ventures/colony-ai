import { AgentRuntimeHeaderStatus } from "@/features/agents/ui/AgentRuntimeHeaderStatus";

import { AgentHomeSwitch } from "./AgentHomeSwitch";
import { useAgentHome } from "./useAgentHome";

/**
 * The agent's slot in the conversation header: the "Working on" switch for an
 * agent this person owns when cloud agents are available (or the agent already
 * works in the cloud), and the runtime line it had before for everything else.
 */
export function AgentHomeHeader({ pubkey }: { pubkey: string }) {
  const model = useAgentHome(pubkey);
  if (!model.show) return <AgentRuntimeHeaderStatus pubkey={pubkey} />;
  return (
    <AgentHomeSwitch
      cloudLabel={model.cloudLabel}
      macLabel={model.macLabel}
      message={model.message}
      name={model.name}
      notCloudReady={model.notCloudReady}
      onChoose={(home) => void model.choose(home)}
      pending={model.pending}
      placement={model.placement}
      status={model.status}
    />
  );
}
