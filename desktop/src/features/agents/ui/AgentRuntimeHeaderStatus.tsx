import { useAcpRuntimesQuery, useManagedAgentsQuery } from "../hooks";
import { useAgentRuntimeSwitchStatus } from "../agentRuntimeSwitchStore";
import { simpleModelLabel } from "./simpleAgentAi";
import { AgentRuntimeSwitchNotice } from "./AgentRuntimeSwitchNotice";

export function AgentRuntimeHeaderStatus({ pubkey }: { pubkey: string }) {
  const agentsQuery = useManagedAgentsQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const switching = useAgentRuntimeSwitchStatus(pubkey);
  const agent = agentsQuery.data?.find(
    (candidate) => candidate.pubkey.toLowerCase() === pubkey.toLowerCase(),
  );

  if (switching) {
    return <AgentRuntimeSwitchNotice compact pubkey={pubkey} />;
  }

  const isLocal = agent?.backend.type === "local";
  const isRunning = isLocal && agent?.status === "running";
  const runtime = isRunning
    ? runtimesQuery.data?.find(
        (candidate) => candidate.id === agent.runningRuntimeId,
      )
    : undefined;
  const label =
    !agent || !isLocal
      ? "Runtime not reported"
      : !isRunning
        ? "Not running"
        : (runtime?.label ?? "Runtime not reported");
  const model = isRunning ? simpleModelLabel(agent.runningModel) : null;

  return (
    <span
      className="c3c-subtitle"
      data-testid="chat-header-agent-runtime"
      title={model ? `${label} · ${model}` : label}
    >
      {model && model !== "Not reported" ? `${label} · ${model}` : label}
    </span>
  );
}
