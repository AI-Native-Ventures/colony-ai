import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";

export type AgentDirectoryStatus =
  | "working"
  | "idle"
  | "stopped"
  | "needs-connection"
  | "unknown"
  | "archived";

export type AgentDirectoryFilter = AgentDirectoryStatus | "all";
export type AgentDirectoryPageSize = 10 | 20 | 30;

export type AgentDirectoryFilterInput = {
  query: string;
  status: AgentDirectoryFilter;
  harnessId: string;
  activePubkeys: ReadonlySet<string>;
  archivedPubkeys: ReadonlySet<string>;
  runtimes: readonly AcpRuntimeCatalogEntry[];
  agentRoles?: ReadonlyMap<string, string>;
};

export function parseAgentDirectoryPageSize(
  value: string | null | undefined,
): AgentDirectoryPageSize {
  if (value === "10") return 10;
  if (value === "20") return 20;
  return 30;
}

export function runtimeForAgent(
  agent: Pick<ManagedAgent, "runtime" | "agentCommand">,
  runtimes: readonly AcpRuntimeCatalogEntry[],
): AcpRuntimeCatalogEntry | undefined {
  return runtimes.find(
    (runtime) =>
      runtime.id === agent.runtime || runtime.command === agent.agentCommand,
  );
}

export function agentDirectoryStatus(
  agent: ManagedAgent,
  input: Pick<
    AgentDirectoryFilterInput,
    "activePubkeys" | "archivedPubkeys" | "runtimes"
  >,
): AgentDirectoryStatus {
  const key = agent.pubkey.toLowerCase();
  if (input.archivedPubkeys.has(key)) return "archived";
  const runtime = runtimeForAgent(agent, input.runtimes);
  if (
    runtime &&
    (runtime.availability !== "available" ||
      runtime.authStatus.status === "logged_out" ||
      runtime.authStatus.status === "config_invalid")
  ) {
    return "needs-connection";
  }
  if (agent.lastErrorCode === -32001) return "needs-connection";
  if (agent.status === "stopped") return "stopped";
  if (agent.status === "not_deployed") return "unknown";
  if (!runtime) return "unknown";
  if (input.activePubkeys.has(key)) return "working";
  return "idle";
}

export function filterManagedAgents(
  agents: readonly ManagedAgent[],
  input: AgentDirectoryFilterInput,
): ManagedAgent[] {
  const query = input.query.trim().toLocaleLowerCase();
  return agents.filter((agent) => {
    const runtime = runtimeForAgent(agent, input.runtimes);
    if (input.harnessId && runtime?.id !== input.harnessId) return false;
    if (
      input.status !== "all" &&
      agentDirectoryStatus(agent, input) !== input.status
    ) {
      return false;
    }
    if (!query) return true;
    const searchable = [
      agent.name,
      agent.model,
      agent.provider,
      agent.runtime,
      runtime?.label,
      runtime?.id,
      input.agentRoles?.get(agent.pubkey.toLowerCase()),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(query);
  });
}

export function agentDirectoryStatusLabel(
  status: AgentDirectoryStatus,
): string {
  switch (status) {
    case "working":
      return "Working";
    case "idle":
      return "Idle";
    case "stopped":
      return "Stopped";
    case "needs-connection":
      return "Needs connection";
    case "unknown":
      return "Unknown";
    case "archived":
      return "Archived";
  }
}

export function agentHarnessLabel(
  agent: Pick<ManagedAgent, "runtime" | "agentCommand">,
  runtimes: readonly AcpRuntimeCatalogEntry[],
): string {
  return runtimeForAgent(agent, runtimes)?.label ?? "Not reported";
}
