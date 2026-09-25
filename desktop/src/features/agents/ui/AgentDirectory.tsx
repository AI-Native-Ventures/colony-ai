import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Play,
  Search,
  Square,
  Wrench,
} from "lucide-react";

import {
  agentDirectoryStatus,
  agentDirectoryStatusLabel,
  agentHarnessLabel,
  filterManagedAgents,
  type AgentDirectoryFilter,
  type AgentDirectoryPageSize,
} from "@/features/agents/agentDirectoryModel";
import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const FILTER_OPTIONS: Array<{ value: AgentDirectoryFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "working", label: "Working" },
  { value: "idle", label: "Idle" },
  { value: "stopped", label: "Stopped" },
  { value: "needs-connection", label: "Needs connection" },
  { value: "unknown", label: "Unknown" },
  { value: "archived", label: "Archived" },
];

export function AgentDirectory({
  agents,
  archivedPubkeys,
  activePubkeys,
  runtimes,
  isLoading,
  error,
  catalogError,
  archiveError,
  pageSize,
  onPageSizeChange,
  onOpenAgent,
  onEditAgent,
  onStartAgent,
  onStopAgent,
  isActionPending,
}: {
  agents: ManagedAgent[];
  archivedPubkeys: ReadonlySet<string>;
  activePubkeys: ReadonlySet<string>;
  runtimes: readonly AcpRuntimeCatalogEntry[];
  isLoading: boolean;
  error: Error | null;
  catalogError: Error | null;
  archiveError: Error | null;
  pageSize: AgentDirectoryPageSize;
  onPageSizeChange: (size: AgentDirectoryPageSize) => void;
  onOpenAgent: (agent: ManagedAgent) => void;
  onEditAgent: (agent: ManagedAgent) => void;
  onStartAgent: (pubkey: string) => void;
  onStopAgent: (pubkey: string) => void;
  isActionPending: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<AgentDirectoryFilter>("all");
  const [harnessId, setHarnessId] = React.useState("");
  const [page, setPage] = React.useState(0);
  const filtered = React.useMemo(
    () =>
      filterManagedAgents(agents, {
        query,
        status,
        harnessId,
        activePubkeys,
        archivedPubkeys,
        runtimes,
      }),
    [
      activePubkeys,
      agents,
      archivedPubkeys,
      harnessId,
      query,
      runtimes,
      status,
    ],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const firstVisible = filtered.length === 0 ? 0 : page * pageSize + 1;
  const lastVisible = Math.min((page + 1) * pageSize, filtered.length);

  return (
    <section className="space-y-4" data-testid="agent-directory">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="relative min-w-56 flex-1"
          htmlFor="agent-directory-search"
        >
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search agents"
            className="pl-9"
            id="agent-directory-search"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }}
            placeholder="Search agents"
            value={query}
          />
        </label>
        <select
          aria-label="Filter by status"
          className="h-9 rounded-lg border border-input/40 bg-background px-3 text-sm"
          onChange={(event) => {
            setStatus(event.currentTarget.value as AgentDirectoryFilter);
            setPage(0);
          }}
          value={status}
        >
          {FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by harness"
          className="h-9 rounded-lg border border-input/40 bg-background px-3 text-sm"
          onChange={(event) => {
            setHarnessId(event.currentTarget.value);
            setPage(0);
          }}
          value={harnessId}
        >
          <option value="">All harnesses</option>
          {runtimes.map((runtime) => (
            <option key={runtime.id} value={runtime.id}>
              {runtime.label}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows</span>
          <select
            aria-label="Agents per page"
            className="h-9 rounded-lg border border-input/40 bg-background px-2 text-foreground"
            onChange={(event) => {
              onPageSizeChange(
                Number(event.currentTarget.value) as AgentDirectoryPageSize,
              );
              setPage(0);
            }}
            value={pageSize}
          >
            {[10, 20, 30].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {catalogError ? (
        <p
          className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          Runtime catalogue unavailable: {catalogError.message}
        </p>
      ) : null}
      {archiveError ? (
        <p
          className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          Archive status unavailable: {archiveError.message}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading agents" : `${filtered.length} agents`}
          </p>
          <p className="text-2xs text-muted-foreground">
            Showing {firstVisible} to {lastVisible} of {filtered.length}
          </p>
        </div>

        {error ? (
          <p className="px-4 py-6 text-sm text-destructive" role="alert">
            {error.message}
          </p>
        ) : isLoading ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            Loading agents…
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            No agents match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
              <thead className="bg-muted/35 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Harness</th>
                  <th className="px-3 py-3">Provider / model</th>
                  <th className="px-3 py-3">Runs on</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/55">
                {visible.map((agent) => {
                  const agentStatus = agentDirectoryStatus(agent, {
                    activePubkeys,
                    archivedPubkeys,
                    runtimes,
                  });
                  const active = isManagedAgentActive(agent);
                  return (
                    <tr
                      key={agent.pubkey}
                      data-testid={`agent-row-${agent.pubkey}`}
                    >
                      <td className="max-w-64 px-4 py-3">
                        <button
                          className="group flex min-w-0 items-center gap-2 text-left"
                          onClick={() => onOpenAgent(agent)}
                          type="button"
                        >
                          <span className="truncate font-medium text-foreground group-hover:underline">
                            {agent.name || "Unnamed agent"}
                          </span>
                          <ArrowUpRight
                            aria-hidden="true"
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={agentStatus} />
                      </td>
                      <td className="max-w-40 truncate px-3 py-3 text-muted-foreground">
                        {agentHarnessLabel(agent, runtimes)}
                      </td>
                      <td className="max-w-56 px-3 py-3">
                        <span className="block truncate text-foreground">
                          {agent.provider || "Not reported"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {agent.model || "Not reported"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {agent.backend.type === "local"
                          ? "This computer"
                          : "Remote host"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={`Edit ${agent.name}`}
                            disabled={isActionPending}
                            onClick={() => onEditAgent(agent)}
                            size="icon-xs"
                            title="Edit agent"
                            type="button"
                            variant="ghost"
                          >
                            <Wrench />
                          </Button>
                          {active ? (
                            <Button
                              aria-label={`Stop ${agent.name}`}
                              disabled={isActionPending}
                              onClick={() => onStopAgent(agent.pubkey)}
                              size="icon-xs"
                              title="Stop agent"
                              type="button"
                              variant="ghost"
                            >
                              <Square />
                            </Button>
                          ) : (
                            <Button
                              aria-label={`Start ${agent.name}`}
                              disabled={
                                isActionPending || agentStatus === "archived"
                              }
                              onClick={() => onStartAgent(agent.pubkey)}
                              size="icon-xs"
                              title="Start agent"
                              type="button"
                              variant="ghost"
                            >
                              <Play />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && !error && filtered.length > pageSize ? (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2">
            <p className="text-xs text-muted-foreground">
              Page {page + 1} of {pageCount}
            </p>
            <div className="flex gap-1">
              <Button
                aria-label="Previous agent page"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <ArrowLeft />
              </Button>
              <Button
                aria-label="Next agent page"
                disabled={page + 1 >= pageCount}
                onClick={() =>
                  setPage((current) => Math.min(pageCount - 1, current + 1))
                }
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <ArrowRight />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatusBadge({
  status,
}: {
  status: ReturnType<typeof agentDirectoryStatus>;
}) {
  const variant =
    status === "needs-connection"
      ? "warning"
      : status === "working"
        ? "default"
        : "secondary";
  return (
    <Badge className="whitespace-nowrap" variant={variant}>
      {agentDirectoryStatusLabel(status)}
    </Badge>
  );
}
