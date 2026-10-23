import * as React from "react";
import { useManagedAgentRuntimesQuery } from "../managedAgentRuntimeHooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { usePersonasQuery, useRelayAgentsQuery } from "../hooks";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";

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
import { AgentStatusChip } from "./AgentStatusChip";
import { providerName } from "./agentPageModel";
import "./agentsColony3.css";

const FILTER_OPTIONS: Array<{ value: AgentDirectoryFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "working", label: "Working" },
  { value: "idle", label: "Ready" },
  { value: "stopped", label: "Offline" },
  { value: "needs-connection", label: "Needs attention" },
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

function MessageIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M4.5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h10A2.5 2.5 0 0 1 19.5 7v7a2.5 2.5 0 0 1-2.5 2.5H8z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="17"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
      width="17"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

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
  onPageSizeChange?: (size: AgentDirectoryPageSize) => void;
  onOpenAgent: (agent: ManagedAgent) => void;
  onMessageAgent: (pubkey: string) => void;
}) {
  const runtimeQuery = useManagedAgentRuntimesQuery();
  const relayAgentsQuery = useRelayAgentsQuery();
  const teamQuery = useCompanyTeamQuery();
  const { activeCommunity } = useCommunities();
  const statusInput = React.useMemo(
    () => ({
      activePubkeys,
      archivedPubkeys,
      runtimes,
      runtimeStatuses: runtimeQuery.data ?? [],
      relayUrl: activeCommunity?.relayUrl,
      runtimeQueryFailed: runtimeQuery.isError,
      relayAgents: relayAgentsQuery.data,
    }),
    [
      activePubkeys,
      archivedPubkeys,
      runtimes,
      runtimeQuery.data,
      runtimeQuery.isError,
      relayAgentsQuery.data,
      activeCommunity?.relayUrl,
    ],
  );
  const positionTitles = React.useMemo(() => {
    const titles = new Map<string, string>();
    for (const member of teamQuery.data?.members ?? []) {
      const title = member.position?.head.title.trim();
      if (title) titles.set(member.pubkey.toLowerCase(), title);
    }
    return titles;
  }, [teamQuery.data?.members]);
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
        ...statusInput,
        agentRoles: rolesByPubkey,
      }),
    [agents, harnessId, query, rolesByPubkey, status, statusInput],
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
      const leftStatus = agentDirectoryStatus(left, statusInput);
      const rightStatus = agentDirectoryStatus(right, statusInput);
      return (
        STATUS_SORT_ORDER[leftStatus] - STATUS_SORT_ORDER[rightStatus] ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      );
    });
  }, [filtered, sort, statusInput]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <section
      className="agents-c3 flex flex-col gap-[22px]"
      data-testid="agent-directory"
    >
      <div className="agents-c3-filters" role="search">
        <label className="agents-c3-search" htmlFor="agent-directory-search">
          <SearchGlyph />
          <input
            aria-label="Search agents"
            id="agent-directory-search"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }}
            placeholder="Find an agent, role or model…"
            type="search"
            value={query}
          />
        </label>
        <select
          aria-label="Filter by status"
          className="agents-c3-select"
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
          className="agents-c3-select"
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
        <select
          aria-label="Sort agents"
          className="agents-c3-select"
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
        <p className="agents-c3-notice" role="status">
          Runtime catalogue unavailable: {catalogError.message}
        </p>
      ) : null}
      {archiveError ? (
        <p className="agents-c3-notice" role="status">
          Archive status unavailable: {archiveError.message}
        </p>
      ) : null}

      <div
        className="agents-c3-tablewrap"
        data-testid="agent-directory-table-scroll"
      >
        {error ? (
          <p className="agents-c3-empty" role="alert">
            {error.message}
          </p>
        ) : isLoading ? (
          <p className="agents-c3-empty">Loading agents…</p>
        ) : visible.length === 0 ? (
          <p className="agents-c3-empty">No agents match these filters.</p>
        ) : (
          <table aria-label="Agents" className="agents-c3-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">Agent</th>
                <th role="columnheader">Status</th>
                <th role="columnheader">Harness</th>
                <th role="columnheader">Provider / model</th>
                <th role="columnheader">Runs on</th>
                <th className="agents-c3-sr" role="columnheader">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {visible.map((agent) => {
                const agentStatus = agentDirectoryStatus(agent, statusInput);
                const archived = agentStatus === "archived";
                return (
                  <tr
                    data-archived={archived ? "true" : undefined}
                    data-testid={`managed-agent-${agent.pubkey}`}
                    key={agent.pubkey}
                    role="row"
                  >
                    <td role="cell">
                      <AgentIdentityButton
                        agent={agent}
                        onOpenAgent={onOpenAgent}
                        onRoleLoaded={onRoleLoaded}
                        positionTitle={positionTitles.get(
                          agent.pubkey.toLowerCase(),
                        )}
                      />
                    </td>
                    <td role="cell">
                      <AgentStatusChip
                        label={
                          runtimeQuery.isLoading && !archived
                            ? "Loading"
                            : agentDirectoryStatusLabel(agentStatus)
                        }
                      />
                    </td>
                    {archived ? (
                      <>
                        <td role="cell">
                          <span className="agents-c3-cell-text" data-muted="true">
                            Not reported
                          </span>
                        </td>
                        <td role="cell">
                          <span className="agents-c3-cell-text" data-muted="true">
                            Not reported
                          </span>
                        </td>
                        <td role="cell">
                          <span className="agents-c3-cell-text" data-muted="true">
                            Not reported
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td role="cell">
                          <AgentHarnessCell agent={agent} runtimes={runtimes} />
                        </td>
                        <td role="cell">
                          <span className="agents-c3-cell-stack">
                            <span>
                              {agent.provider
                                ? providerName(agent.provider)
                                : "Not reported"}
                            </span>
                            <span>{agent.model || "Not reported"}</span>
                          </span>
                        </td>
                        <td role="cell">
                          {agent.backend.type === "local" ? (
                            <span className="agents-c3-cell-text">
                              This Mac
                            </span>
                          ) : (
                            <span className="agents-c3-cell-stack">
                              <span>Provider-hosted</span>
                              <span>Not managed here</span>
                            </span>
                          )}
                        </td>
                      </>
                    )}
                    <td role="cell">
                      <div className="agents-c3-row-actions">
                        {archived ? null : (
                          <button
                            aria-label={`Message ${agent.name}`}
                            className="agents-c3-icon-btn"
                            onClick={() => onMessageAgent(agent.pubkey)}
                            title="Message agent"
                            type="button"
                          >
                            <MessageIcon />
                          </button>
                        )}
                        <button
                          aria-label={`Open ${agent.name}`}
                          className="agents-c3-icon-btn"
                          onClick={() => onOpenAgent(agent)}
                          title="Open agent"
                          type="button"
                        >
                          <ChevronIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="agents-c3-foot">
        <span>
          {filtered.length} {filtered.length === 1 ? "agent" : "agents"} shown
        </span>
        <label>
          Rows
          <select
            aria-label="Rows per page"
            className="agents-c3-select"
            data-size="sm"
            onChange={(event) => {
              setPage(0);
              onPageSizeChange?.(
                Number(event.currentTarget.value) as AgentDirectoryPageSize,
              );
            }}
            value={pageSize}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
        </label>
        <span>
          Page {page + 1} of {pageCount}
        </span>
        {pageCount > 1 ? (
          <span className="agents-c3-pager">
            <button
              aria-label="Previous agent page"
              className="agents-c3-icon-btn"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="18"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.4"
                viewBox="0 0 24 24"
                width="18"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button
              aria-label="Next agent page"
              className="agents-c3-icon-btn"
              disabled={page + 1 >= pageCount}
              onClick={() =>
                setPage((current) => Math.min(pageCount - 1, current + 1))
              }
              type="button"
            >
              <ChevronIcon />
            </button>
          </span>
        ) : null}
      </div>
    </section>
  );
}

function AgentIdentityButton({
  agent,
  onOpenAgent,
  onRoleLoaded,
  positionTitle,
}: {
  agent: ManagedAgent;
  onOpenAgent: (agent: ManagedAgent) => void;
  onRoleLoaded: (pubkey: string, role: string | null) => void;
  positionTitle?: string;
}) {
  const profileQuery = useUserProfileQuery(agent.pubkey);
  const personasQuery = usePersonasQuery();
  const persona = personasQuery.data?.find(
    (entry) => entry.id === agent.personaId,
  );
  const role =
    profileQuery.data?.jobTitle?.trim() ||
    positionTitle ||
    profileQuery.data?.about?.trim() ||
    persona?.description?.trim();
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
      className="agents-c3-ident"
      onClick={() => onOpenAgent(agent)}
      type="button"
    >
      <EmployeeAvatar
        name={agent.name}
        profile={profileQuery.data?.avatarUrl}
        instance={agent.avatarUrl}
        definition={persona?.avatarUrl}
        personaId={agent.personaId}
        className="agents-c3-avatar"
        testId={`agent-directory-avatar-${agent.pubkey}`}
      />
      <span className="agents-c3-ident-text">
        <span className="agents-c3-ident-name">
          {agent.name || "Unnamed agent"}
        </span>
        {role ? <span className="agents-c3-ident-role">{role}</span> : null}
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
  return (
    <span className="agents-c3-harness">
      {runtime ? (
        <RuntimeIcon className="size-[1.0625rem] shrink-0" runtime={runtime} />
      ) : null}
      <span className="truncate">{agentHarnessLabel(agent, runtimes)}</span>
    </span>
  );
}
