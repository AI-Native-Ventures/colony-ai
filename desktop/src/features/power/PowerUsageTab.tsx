import * as React from "react";

import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import { agentHarnessLabel } from "@/features/agents/agentDirectoryModel";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { AgentUsageSeriesBucket } from "@/shared/api/tauriArchive";
import type { ManagedAgent } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";

import { EmployeeAvatar } from "./PowerParts";
import type { UsagePeriodDays } from "./usageBoundaries";
import { useAgentUsageSeries } from "./useAgentUsageSeries";

/**
 * Optional detail a usage report can carry beyond the bucket totals: the work
 * it was for, the client it was for and what paid. Reports that do not carry
 * them read "Not reported".
 */
type ReportDetails = {
  workTitle?: string | null;
  client?: string | null;
  source?: string | null;
};

function detailOf(bucket: AgentUsageSeriesBucket): ReportDetails {
  return bucket as AgentUsageSeriesBucket & ReportDetails;
}

function money(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/** "Today", "Yesterday" or "Mon 19 Oct" for a local-midnight bucket start. */
function dayLabel(unixSeconds: number, now: Date) {
  const day = new Date(unixSeconds * 1000);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (start.getTime() - new Date(day).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(day)
    .replace(",", "");
}

export function PowerUsageTab({ agents }: { agents: ManagedAgent[] }) {
  const [period, setPeriod] = React.useState<UsagePeriodDays>(7);
  const [agentFilter, setAgentFilter] = React.useState("all");
  const usageQuery = useAgentUsageSeries(period);
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const series = usageQuery.data;
  const runtimes = runtimesQuery.data ?? [];
  const pubkeys = React.useMemo(
    () => (series?.agents ?? []).map((agent) => agent.agentPubkey),
    [series],
  );
  const profilesQuery = useUsersBatchQuery(pubkeys, {
    enabled: pubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
  const managedByKey = React.useMemo(
    () => new Map(agents.map((agent) => [agent.pubkey.toLowerCase(), agent])),
    [agents],
  );
  const now = new Date();

  const rows = React.useMemo(() => {
    const list = (series?.agents ?? []).flatMap((agentUsage) => {
      const key = agentUsage.agentPubkey.toLowerCase();
      if (agentFilter !== "all" && key !== agentFilter) return [];
      const agent = managedByKey.get(key);
      const name =
        agent?.name ??
        profiles[key]?.displayName ??
        truncateNpub(agentUsage.agentPubkey);
      return agentUsage.buckets
        .filter((bucket) => bucket.reportCount > 0)
        .map((bucket) => ({
          agent,
          avatarUrl: profiles[key]?.avatarUrl ?? null,
          bucket,
          name,
          pubkey: agentUsage.agentPubkey,
        }));
    });
    // Newest day first; within a day the reports keep the series order.
    return list.sort((left, right) => right.bucket.start - left.bucket.start);
  }, [agentFilter, managedByKey, profiles, series]);

  const loading = usageQuery.isLoading;

  return (
    <div className="pw-stack" data-testid="power-usage">
      <div className="pw-filters">
        <label className="pw-filter">
          Agent
          <select
            aria-label="Usage by agent"
            className="pw-select"
            onChange={(event) => setAgentFilter(event.currentTarget.value)}
            value={agentFilter}
          >
            <option value="all">All employees</option>
            {(series?.agents ?? []).map((agentUsage) => {
              const key = agentUsage.agentPubkey.toLowerCase();
              return (
                <option key={agentUsage.agentPubkey} value={key}>
                  {managedByKey.get(key)?.name ??
                    profiles[key]?.displayName ??
                    truncateNpub(agentUsage.agentPubkey)}
                </option>
              );
            })}
          </select>
        </label>
        <label className="pw-filter">
          Client
          <select
            aria-label="Usage by client"
            className="pw-select"
            disabled
            value="not-reported"
          >
            <option value="not-reported">Client not reported</option>
          </select>
        </label>
        <fieldset className="pw-period">
          <legend className="sr-only">Period</legend>
          {([7, 30] as const).map((days) => (
            <button
              aria-pressed={period === days}
              key={days}
              onClick={() => setPeriod(days)}
              type="button"
            >
              {days} days
            </button>
          ))}
        </fieldset>
      </div>

      {series?.collectionEnabled === false ? (
        <p className="pw-callout">
          Usage collection is turned off for this archive.
        </p>
      ) : null}
      {usageQuery.error instanceof Error ? (
        <p className="pw-alert" role="alert">
          {usageQuery.error.message}
        </p>
      ) : null}

      <div className="pw-table-card">
        <table className="pw-table">
          <thead>
            <tr>
              <th scope="col">Date / work</th>
              <th scope="col">Agent</th>
              <th scope="col">Client</th>
              <th scope="col">Source</th>
              <th scope="col" data-align="end">
                Recorded cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ agent, avatarUrl, bucket, name, pubkey }) => {
              const detail = detailOf(bucket);
              const cost = bucket.usage.estimatedCostUsd;
              const reported = !(cost.value === null || cost.incomplete);
              const harness = agent
                ? agentHarnessLabel(agent, runtimes)
                : "Not reported";
              const source =
                detail.source?.trim() ||
                (harness === "Not reported" ? "Agent report" : harness);
              const reports = `${bucket.reportCount} ${bucket.reportCount === 1 ? "report" : "reports"}`;
              const day = dayLabel(bucket.start, now);
              const title = detail.workTitle?.trim();
              return (
                <tr key={`${name}:${bucket.start}`}>
                  <td>
                    <span className="pw-work">
                      <strong>{title || day}</strong>
                      <span>{title ? `${day} · ${reports}` : reports}</span>
                    </span>
                  </td>
                  <td>
                    <span className="pw-agent">
                      <EmployeeAvatar
                        avatarUrl={avatarUrl}
                        className="pw-agent-avatar"
                        label={name}
                        pubkey={pubkey}
                        role={detail.workTitle}
                      />
                      {name}
                    </span>
                  </td>
                  <td data-muted="true">
                    {detail.client?.trim() || "Not reported"}
                  </td>
                  <td>{source}</td>
                  <td
                    data-align="end"
                    data-muted={reported ? undefined : "true"}
                    data-strong={reported ? "true" : undefined}
                  >
                    {reported && cost.value !== null
                      ? money(cost.value)
                      : "Not reported"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? (
          <p className="pw-empty">
            No usage reports are available for this period.
          </p>
        ) : null}
        {loading ? <p className="pw-empty">Loading usage…</p> : null}
      </div>
      <p className="pw-note">
        Recorded cost shows what each usage report included.
      </p>
    </div>
  );
}
