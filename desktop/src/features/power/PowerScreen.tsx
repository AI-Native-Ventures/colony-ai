import { useCompanyManagedAgentsQuery } from "@/features/agents/useCompanyManagedAgents";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import { agentHarnessLabel } from "@/features/agents/agentDirectoryModel";
import { useCommunities } from "@/features/communities/useCommunities";
import { useColonyCreditsLaunched } from "@/features/credits/useColonyCreditsLaunched";
import { readCredits } from "@/features/credits/accountPayments";
import type {
  AgentUsageSeries,
  AgentUsageSeriesBucket,
} from "@/shared/api/tauriArchive";
import type { ManagedAgent } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";
import { PageHeader } from "@/shared/ui/PageHeader";
import type { UsagePeriodDays } from "./usageBoundaries";
import { useAgentUsageSeries } from "./useAgentUsageSeries";

export type PowerSection = "usage" | "credits";

const POWER_TABS: Array<{ id: PowerSection; label: string }> = [
  { id: "usage", label: "Usage" },
  { id: "credits", label: "Credits" },
];

export function parsePowerSection(
  value: string | null | undefined,
): PowerSection {
  return value === "credits" ? "credits" : "usage";
}

export function PowerScreen({
  section,
  onSectionChange,
}: {
  section: PowerSection;
  onSectionChange: (section: PowerSection) => void;
}) {
  const creditsLaunched = useColonyCreditsLaunched();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? "";
  const creditsQuery = useQuery({
    enabled: Boolean(communityId),
    queryKey: ["account-credits", communityId],
    queryFn: readCredits,
    retry: false,
  });
  const usageQuery = useAgentUsageSeries(30);
  const agentsQuery = useCompanyManagedAgentsQuery();
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const credits = creditsQuery.data
    ? {
        status: "available",
        balanceUsdCents: creditsQuery.data.balanceUsdCents,
      }
    : { status: "unavailable" };
  const agents = agentsQuery.data ?? [];
  const runtimes = runtimesQuery.data ?? [];

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"
      data-testid="power-screen"
    >
      <PageHeader
        title={section === "credits" ? "Colony credits" : "Agent usage"}
      />
      <PowerNavigation section={section} onSectionChange={onSectionChange} />
      {section === "usage" ? (
        <PowerUsage
          agents={agents}
          runtimes={runtimes}
          isLoading={usageQuery.isLoading}
          error={usageQuery.error instanceof Error ? usageQuery.error : null}
          series={usageQuery.data}
        />
      ) : (
        <PowerCredits
          credits={credits}
          creditsLaunched={creditsLaunched}
          isCreditsLoading={creditsQuery.isLoading}
        />
      )}
    </div>
  );
}

function PowerNavigation({
  section,
  onSectionChange,
}: {
  section: PowerSection;
  onSectionChange: (section: PowerSection) => void;
}) {
  return (
    <nav
      aria-label="Power sections"
      className="overflow-x-auto border-b border-border/60"
    >
      <div className="flex min-w-max gap-5">
        {POWER_TABS.map((tab) => (
          <button
            aria-current={section === tab.id ? "page" : undefined}
            className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${section === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            key={tab.id}
            onClick={() => onSectionChange(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function PowerCredits({
  credits,
  creditsLaunched,
  isCreditsLoading,
}: {
  credits: { status: string; balanceUsdCents?: number };
  creditsLaunched: boolean;
  isCreditsLoading: boolean;
}) {
  return (
    <div className="divide-y divide-border/70" data-testid="power-credits">
      <section className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold">Colony credits</h2>
          <p className="text-sm text-muted-foreground">
            Pay for supported agent work
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {!creditsLaunched
            ? "Coming soon"
            : isCreditsLoading
              ? "Loading"
              : credits.status === "available" &&
                  credits.balanceUsdCents !== undefined
                ? moneyFromCents(credits.balanceUsdCents)
                : "Unavailable"}
        </span>
      </section>
    </div>
  );
}

function PowerUsage({
  agents,
  runtimes,
  isLoading,
  error,
  series,
}: {
  agents: ManagedAgent[];
  runtimes: ReturnType<typeof useAcpRuntimesQuery>["data"];
  isLoading: boolean;
  error: Error | null;
  series?: AgentUsageSeries;
}) {
  const [period, setPeriod] = React.useState<UsagePeriodDays>(30);
  const [agentFilter, setAgentFilter] = React.useState("all");
  const usageQuery = useAgentUsageSeries(period);
  const effectiveSeries =
    period === 30 ? (series ?? usageQuery.data) : usageQuery.data;
  const managedByKey = new Map(
    agents.map((agent) => [agent.pubkey.toLowerCase(), agent]),
  );
  const rows = React.useMemo(
    () =>
      (effectiveSeries?.agents ?? []).flatMap((agentUsage) => {
        const agent = managedByKey.get(agentUsage.agentPubkey.toLowerCase());
        const name = agent?.name ?? truncateNpub(agentUsage.agentPubkey);
        if (
          agentFilter !== "all" &&
          agentUsage.agentPubkey.toLowerCase() !== agentFilter
        )
          return [];
        return agentUsage.buckets
          .filter((bucket) => bucket.reportCount > 0)
          .map((bucket) => ({ agentUsage, bucket, agent, name }));
      }),
    [agentFilter, effectiveSeries, managedByKey],
  );

  return (
    <div className="space-y-4" data-testid="power-usage">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Usage by agent"
          className="h-9 rounded-lg border border-input/40 bg-background px-3 text-sm"
          onChange={(event) => setAgentFilter(event.currentTarget.value)}
          value={agentFilter}
        >
          <option value="all">All agents</option>
          {(effectiveSeries?.agents ?? []).map((agentUsage) => {
            const agent = managedByKey.get(
              agentUsage.agentPubkey.toLowerCase(),
            );
            return (
              <option
                key={agentUsage.agentPubkey}
                value={agentUsage.agentPubkey.toLowerCase()}
              >
                {agent?.name ?? truncateNpub(agentUsage.agentPubkey)}
              </option>
            );
          })}
        </select>
        <select
          aria-label="Usage by client"
          className="h-9 rounded-lg border border-input/40 bg-background px-3 text-sm"
          disabled
          value="not-reported"
        >
          <option value="not-reported">Client not reported</option>
        </select>
        <div className="ml-auto inline-flex rounded-lg border border-border/70 p-1">
          {([7, 30] as const).map((days) => (
            <button
              aria-pressed={period === days}
              className={`rounded-md px-3 py-1.5 text-sm ${period === days ? "bg-muted text-foreground" : "text-muted-foreground"}`}
              key={days}
              onClick={() => setPeriod(days)}
              type="button"
            >
              {days} days
            </button>
          ))}
        </div>
      </div>
      {effectiveSeries?.collectionEnabled === false ? (
        <p className="rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          Usage collection is turned off for this archive.
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}
      {usageQuery.error instanceof Error ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {usageQuery.error.message}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
          <thead className="bg-muted/35 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date / work</th>
              <th className="px-3 py-3">Agent</th>
              <th className="px-3 py-3">Client</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-4 py-3 text-right">Recorded cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/55">
            {rows.map(({ agentUsage, bucket, agent, name }) => (
              <UsageRow
                agent={agent}
                agentName={name}
                bucket={bucket}
                harnessLabel={
                  agent
                    ? agentHarnessLabel(agent, runtimes ?? [])
                    : "Not reported"
                }
                key={`${agentUsage.agentPubkey}:${bucket.start}`}
              />
            ))}
          </tbody>
        </table>
        {!isLoading && !usageQuery.isLoading && rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No usage reports are available for this period.
          </p>
        ) : null}
        {isLoading || usageQuery.isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading usage…
          </p>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Agent-reported usage is not an invoice. Subscription usage is not
        converted into a cost unless the provider reports one. Work and client
        links are not available in these reports.
      </p>
    </div>
  );
}

function UsageRow({
  agent,
  agentName,
  bucket,
  harnessLabel,
}: {
  agent?: ManagedAgent;
  agentName: string;
  bucket: AgentUsageSeriesBucket;
  harnessLabel: string;
}) {
  const cost = bucket.usage.estimatedCostUsd;
  const costLabel =
    cost.value === null || cost.incomplete ? "Not reported" : money(cost.value);
  const source =
    harnessLabel === "Not reported" ? "Agent report" : harnessLabel;
  return (
    <tr>
      <td className="px-4 py-3">
        <span className="block">{formatDay(bucket.start)}</span>
        <span className="block text-xs text-muted-foreground">
          {bucket.reportCount} {bucket.reportCount === 1 ? "report" : "reports"}
        </span>
      </td>
      <td className="px-3 py-3 font-medium">{agent?.name ?? agentName}</td>
      <td className="px-3 py-3 text-muted-foreground">Not reported</td>
      <td className="px-3 py-3 text-muted-foreground">{source}</td>
      <td className="px-4 py-3 text-right font-medium">{costLabel}</td>
    </tr>
  );
}

function money(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function moneyFromCents(amountCents: number) {
  return money(amountCents / 100);
}

function formatDay(unixSeconds: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(unixSeconds * 1000),
  );
}
