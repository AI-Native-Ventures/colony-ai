import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  MessageSquare,
  Search,
} from "lucide-react";

import {
  agentDirectoryStatus,
  agentDirectoryStatusLabel,
  agentHarnessLabel,
  filterManagedAgents,
  type AgentDirectoryFilter,
  type AgentDirectoryPageSize,
} from "@/features/agents/agentDirectoryModel";
import { runtimeForAgent } from "@/features/agents/agentDirectoryModel";
import { RuntimeIcon } from "@/features/onboarding/ui/RuntimeIcon";
import { useUserProfileQuery } from "@/features/profile/hooks";
import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const FILTER_OPTIONS: Array<{ value: AgentDirectoryFilter; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "working", label: "Working" },
  { value: "idle", label: "Idle" },
  { value: "stopped", label: "Stopped" },
  { value: "needs-connection", label: "Needs connection" },
  { value: "unknown", label: "Unknown" },
  { value: "archived", label: "Archived" },
];

const STATUS_SORT_ORDER: Record<
  ReturnType<typeof agentDirectoryStatus>,
  number
> = {
  working: 0,
  idle: 1,
  stopped: 2,
  "needs-connection": 3,
  unknown: 4,
  archived: 5,
};

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
  onOpenAgent,
  onMessageAgent,
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
  onOpenAgent: (agent: ManagedAgent) => void;
  onMessageAgent: (pubkey: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<AgentDirectoryFilter>("all");
  const [harnessId, setHarnessId] = React.useState("");
  const [sort, setSort] = React.useState<"name" | "status">("name");
  const [page, setPage] = React.useState(0);
  const [rolesByPubkey, setRolesByPubkey] = React.useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const onRoleLoaded = React.useCallback(
    (pubkey: string, role: string | null) => {
      const key = pubkey.toLowerCase();
      setRolesByPubkey((current) => {
        const nextRole = role?.trim() || null;
        if ((current.get(key) ?? null) === nextRole) return current;
        const next = new Map(current);
        if (nextRole) next.set(key, nextRole);
        else next.delete(key);
        return next;
      });
    },
    [],
  );
  const filtered = React.useMemo(
    () =>
      filterManagedAgents(agents, {
        query,
        status,
        harnessId,
        activePubkeys,
        archivedPubkeys,
        runtimes,
        agentRoles: rolesByPubkey,
      }),
    [
      activePubkeys,
      agents,
      archivedPubkeys,
      harnessId,
      query,
      rolesByPubkey,
      runtimes,
      status,
    ],
  );
  const sorted = React.useMemo(() => {
    const result = [...filtered];
    if (sort === "name") {
      return result.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
        }),
      );
    }
    return result.sort((left, right) => {
      const leftStatus = agentDirectoryStatus(left, {
        activePubkeys,
        archivedPubkeys,
        runtimes,
      });
      const rightStatus = agentDirectoryStatus(right, {
        activePubkeys,
        archivedPubkeys,
        runtimes,
      });
      return (
        STATUS_SORT_ORDER[leftStatus] - STATUS_SORT_ORDER[rightStatus] ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      );
    });
  }, [activePubkeys, archivedPubkeys, filtered, runtimes, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      data-testid="agent-directory"
    >
      <div className="flex flex-wrap items-center gap-2.5 px-7 py-3">
        <label
          className="relative min-w-56 max-w-[28.75rem] flex-1"
          htmlFor="agent-directory-search"
        >
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search agents"
            className="rounded-[7px] pl-9 text-xs md:text-xs"
            id="agent-directory-search"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }}
            placeholder="Find an agent, role or model…"
            value={query}
          />
        </label>
        <select
          aria-label="Filter by status"
          className="h-[2.3125rem] rounded-[7px] border border-input/40 bg-background pl-2.5 pr-7 text-xs"
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
          className="h-[2.3125rem] rounded-[7px] border border-input/40 bg-background pl-2.5 pr-7 text-xs"
          onChange={(event) => {
            setHarnessId(event.currentTarget.value);
            setPage(0);
          }}
          value={harnessId}
        >
          <option value="">All Harnesses</option>
          {runtimes.map((runtime) => (
            <option key={runtime.id} value={runtime.id}>
              {runtime.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort agents"
          className="h-[2.3125rem] rounded-[7px] border border-input/40 bg-background pl-2.5 pr-7 text-xs"
          onChange={(event) =>
            setSort(event.currentTarget.value as "name" | "status")
          }
          value={sort}
        >
          <option value="name">Name A–Z</option>
          <option value="status">Status</option>
        </select>
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

      <div
        className="min-h-0 flex-1 overflow-auto px-8"
        data-testid="agent-directory-table-scroll"
      >
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
            <table className="w-full min-w-[58rem] table-fixed border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-background text-2xs font-medium text-muted-foreground">
                <tr>
                  <th className="h-[2.125rem] w-[24%] px-0">Agent</th>
                  <th className="h-[2.125rem] w-[13%] px-0">Status</th>
                  <th className="h-[2.125rem] w-[17%] px-0">Harness</th>
                  <th className="h-[2.125rem] w-[23%] px-0">
                    Provider / model
                  </th>
                  <th className="h-[2.125rem] w-[17%] px-0">Runs on</th>
                  <th className="h-[2.125rem] w-[6%] px-0 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/55">
                {visible.map((agent) => {
                  const agentStatus = agentDirectoryStatus(agent, {
                    activePubkeys,
                    archivedPubkeys,
                    runtimes,
                  });
                  return (
                    <tr
                      key={agent.pubkey}
                      className="h-12"
                      data-testid={`agent-row-${agent.pubkey}`}
                    >
                      <td className="truncate px-0 py-1.5">
                        <AgentIdentityButton
                          agent={agent}
                          onOpenAgent={onOpenAgent}
                          onRoleLoaded={onRoleLoaded}
                        />
                      </td>
                      <td className="py-1.5 pl-0 pr-3">
                        <StatusBadge status={agentStatus} />
                      </td>
                      <td className="truncate py-1.5 pl-0 pr-3 text-muted-foreground">
                        <AgentHarnessCell agent={agent} runtimes={runtimes} />
                      </td>
                      <td className="py-1.5 pl-0 pr-3">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {agent.provider || "Not reported"}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {agent.model || "Not reported"}
                        </span>
                      </td>
                      <td className="py-1.5 pl-0 pr-3">
                        <span className="block truncate text-foreground">
                          {agent.backend.type === "local"
                            ? "This Mac"
                            : agent.backend.id || "Not reported"}
                        </span>
                        {agent.backend.type === "provider" ? (
                          <span className="mt-0.5 block truncate text-2xs leading-tight text-muted-foreground">
                            Not managed here
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pl-0 pr-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={`Message ${agent.name}`}
                            className="size-7"
                            onClick={() => onMessageAgent(agent.pubkey)}
                            size="icon-xs"
                            title="Message agent"
                            type="button"
                            variant="ghost"
                          >
                            <MessageSquare className="size-3.5" />
                          </Button>
                          <Button
                            aria-label={`Open ${agent.name}`}
                            className="size-7"
                            onClick={() => onOpenAgent(agent)}
                            size="icon-xs"
                            title="Open agent"
                            type="button"
                            variant="ghost"
                          >
                            <ChevronRight className="size-3.5" />
                          </Button>
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
      <footer className="flex shrink-0 border-t border-border/60 px-7 py-3 text-2xs text-muted-foreground">
        <span>
          {filtered.length} {filtered.length === 1 ? "agent" : "agents"} shown
        </span>
      </footer>
    </section>
  );
}

function StatusBadge({
  status,
}: {
  status: ReturnType<typeof agentDirectoryStatus>;
}) {
  const colorClass =
    status === "needs-connection"
      ? "border-[#ead3da] bg-[#fbf0f2] text-[#a04f64] dark:border-[#674653] dark:bg-[#442f37] dark:text-[#e8a6b8]"
      : status === "idle"
        ? "border-[#dce9df] bg-[#edf4ef] text-[#507d69] dark:border-[#3c5445] dark:bg-[#25392e] dark:text-[#9ebda8]"
        : status === "working"
          ? "border-[#e0e8f2] bg-[#eef3fa] text-[#637fa7] dark:border-[#3a4a62] dark:bg-[#2b3547] dark:text-[#adbfdf]"
          : "border-border bg-muted text-muted-foreground";
  return (
    <Badge
      className={`whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-2xs font-medium normal-case tracking-normal ${colorClass}`}
      variant="outline"
    >
      {agentDirectoryStatusLabel(status)}
    </Badge>
  );
}

function AgentIdentityButton({
  agent,
  onOpenAgent,
  onRoleLoaded,
}: {
  agent: ManagedAgent;
  onOpenAgent: (agent: ManagedAgent) => void;
  onRoleLoaded: (pubkey: string, role: string | null) => void;
}) {
  const profileQuery = useUserProfileQuery(agent.pubkey);
  const role = profileQuery.data?.about?.trim();
  const refreshedSummaryProfile = React.useRef(false);
  React.useEffect(() => {
    if (
      profileQuery.data?.hasProfileEvent === false &&
      !refreshedSummaryProfile.current
    ) {
      refreshedSummaryProfile.current = true;
      void profileQuery.refetch();
    }
  }, [profileQuery.data, profileQuery.refetch]);
  React.useEffect(() => {
    if (profileQuery.data) {
      onRoleLoaded(agent.pubkey, role || null);
    }
  }, [agent.pubkey, onRoleLoaded, profileQuery.data, role]);
  return (
    <button
      aria-label={`Open ${agent.name} profile`}
      className="group flex min-w-0 items-center gap-3 text-left"
      onClick={() => onOpenAgent(agent)}
      type="button"
    >
      {agent.avatarUrl ? (
        <img
          alt=""
          className="size-7 shrink-0 rounded-lg object-cover"
          src={agent.avatarUrl}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground"
        >
          {(agent.name || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight text-foreground group-hover:underline">
          {agent.name || "Unnamed agent"}
        </span>
        {role ? (
          <span className="mt-0.5 block truncate text-2xs leading-tight text-muted-foreground">
            {role}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function AgentHarnessCell({
  agent,
  runtimes,
}: {
  agent: ManagedAgent;
  runtimes: readonly AcpRuntimeCatalogEntry[];
}) {
  const runtime = runtimeForAgent(agent, runtimes);
  return runtime ? (
    <span className="inline-flex min-w-0 items-center gap-2">
      <RuntimeIcon className="size-5 shrink-0" runtime={runtime} />
      <span className="truncate text-xs">
        {agentHarnessLabel(agent, runtimes)}
      </span>
    </span>
  ) : (
    <span className="text-xs">{agentHarnessLabel(agent, runtimes)}</span>
  );
}
