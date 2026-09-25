import * as React from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CreditCard,
  History,
  TrendingUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  useAcpRuntimesQuery,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import { agentHarnessLabel } from "@/features/agents/agentDirectoryModel";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  unavailableCreditsOnboardingApi,
  type CreditsOnboardingApi,
} from "@/features/onboarding/ui/creditsOnboardingApi";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import type {
  AgentUsageSeries,
  AgentUsageSeriesBucket,
} from "@/shared/api/tauriArchive";
import type { ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { PageHeader, SectionHeader } from "@/shared/ui/PageHeader";
import type { UsagePeriodDays } from "./usageBoundaries";
import { useAgentUsageSeries } from "./useAgentUsageSeries";

export type PowerSection = "overview" | "usage" | "history" | "checkout";

const POWER_TABS: Array<{ id: PowerSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "usage", label: "Usage" },
  { id: "history", label: "Billing history" },
];

export function parsePowerSection(
  value: string | null | undefined,
): PowerSection {
  return value === "usage" || value === "history" || value === "checkout"
    ? value
    : "overview";
}

export function PowerScreen({
  section,
  onSectionChange,
}: {
  section: PowerSection;
  onSectionChange: (section: PowerSection) => void;
}) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? "";
  const creditApi: CreditsOnboardingApi = unavailableCreditsOnboardingApi;
  const creditsQuery = useQuery({
    enabled: Boolean(communityId),
    queryKey: ["colony-credits", communityId],
    queryFn: () => creditApi.read(communityId),
    retry: false,
  });
  const usageQuery = useAgentUsageSeries(30);
  const agentsQuery = useManagedAgentsQuery();
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const { goSupervision } = useAppNavigation();
  const credits = creditsQuery.data ?? {
    status: "unavailable" as const,
    reason: "contract-not-available" as const,
  };
  const agents = agentsQuery.data ?? [];
  const runtimes = runtimesQuery.data ?? [];
  const configuredHarnessCount = new Set(
    agents
      .map(
        (agent) =>
          runtimes.find(
            (runtime) =>
              runtime.id === agent.runtime ||
              runtime.command === agent.agentCommand,
          )?.id,
      )
      .filter(Boolean),
  ).size;

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"
      data-testid="power-screen"
    >
      {section === "checkout" ? (
        <CheckoutScreen
          creditsUnavailable={credits.status === "unavailable"}
          onBack={() => onSectionChange("overview")}
        />
      ) : (
        <>
          <PageHeader
            action={
              section === "history" ? (
                <Button
                  onClick={() => onSectionChange("checkout")}
                  size="sm"
                  type="button"
                >
                  <CreditCard />
                  Add credits
                </Button>
              ) : null
            }
            description="Agent usage and credit availability."
            title={
              section === "usage"
                ? "Agent usage"
                : section === "history"
                  ? "Billing history"
                  : "Power & usage"
            }
          />
          <PowerNavigation
            section={section}
            onSectionChange={onSectionChange}
          />
          {section === "overview" ? (
            <PowerOverview
              credits={credits}
              configuredHarnessCount={configuredHarnessCount}
              isAgentLoading={agentsQuery.isLoading}
              isRuntimeLoading={runtimesQuery.isLoading}
              agents={agents}
              runtimes={runtimes}
              usage={usageQuery.data}
              isUsageLoading={usageQuery.isLoading}
              usageError={
                usageQuery.error instanceof Error ? usageQuery.error : null
              }
              onAddCredits={() => onSectionChange("checkout")}
              onOpenUsage={() => onSectionChange("usage")}
              onOpenSupervision={() => void goSupervision()}
            />
          ) : section === "usage" ? (
            <PowerUsage
              agents={agents}
              runtimes={runtimes}
              isLoading={usageQuery.isLoading}
              error={
                usageQuery.error instanceof Error ? usageQuery.error : null
              }
              series={usageQuery.data}
            />
          ) : (
            <BillingHistory
              creditsUnavailable={credits.status === "unavailable"}
              onAddCredits={() => onSectionChange("checkout")}
            />
          )}
        </>
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

function PowerOverview({
  credits,
  configuredHarnessCount,
  isAgentLoading,
  isRuntimeLoading,
  agents,
  runtimes,
  usage,
  isUsageLoading,
  usageError,
  onAddCredits,
  onOpenUsage,
  onOpenSupervision,
}: {
  credits: { status: string; balanceUsdCents?: number };
  configuredHarnessCount: number;
  isAgentLoading: boolean;
  isRuntimeLoading: boolean;
  agents: ManagedAgent[];
  runtimes: ReturnType<typeof useAcpRuntimesQuery>["data"];
  usage?: AgentUsageSeries;
  isUsageLoading: boolean;
  usageError: Error | null;
  onAddCredits: () => void;
  onOpenUsage: () => void;
  onOpenSupervision: () => void;
}) {
  const creditBalance =
    credits.status === "available" && credits.balanceUsdCents !== undefined
      ? moneyFromCents(credits.balanceUsdCents)
      : "Unavailable";
  const reportedCost = sumReportedCost(usage);
  const knownRuntimeIds = new Set(
    (runtimes ?? []).map((runtime) => runtime.id),
  );
  const agentHarnesses = agents
    .map((agent) => ({
      agent,
      label: agentHarnessLabel(agent, runtimes ?? []),
    }))
    .filter(
      ({ agent }) =>
        knownRuntimeIds.has(agent.runtime ?? "") ||
        agentHarnessLabel(agent, runtimes ?? []) !== "Not reported",
    );
  const uniqueHarnesses = new Map<
    string,
    { label: string; count: number; runtimeId: string | null }
  >();
  for (const { agent, label } of agentHarnesses) {
    const key = agent.runtime ?? label;
    const current = uniqueHarnesses.get(key);
    uniqueHarnesses.set(key, {
      label,
      count: (current?.count ?? 0) + 1,
      runtimeId: agent.runtime,
    });
  }

  return (
    <div className="space-y-6" data-testid="power-overview">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Colony credits"
          value={creditBalance}
          detail="Balance unavailable"
        />
        <MetricCard
          label="Reported usage · 30 days"
          value={isUsageLoading ? "Loading" : reportedCost}
          detail="Provider-reported cost only"
        />
        <MetricCard
          label="Monthly cap"
          value="Unavailable"
          detail="No cap service is connected"
        />
        <MetricCard
          label="Configured harnesses"
          value={
            isAgentLoading || isRuntimeLoading
              ? "Loading"
              : String(configuredHarnessCount)
          }
          detail="From the runtime catalogue"
        />
      </div>

      {credits.status === "unavailable" ? <PriceUnavailableNotice /> : null}
      {usageError ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {usageError.message}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-4">
          <SectionHeader title="Keep work moving" />
          <ActionRow
            title="Colony credits"
            detail="Review a credit purchase before payment."
            action={
              <Button onClick={onAddCredits} size="sm" type="button">
                Add credits
              </Button>
            }
          />
          <ActionRow
            title="Monthly spending cap"
            detail="Pause new credit-funded work at the limit."
            action={
              <Button disabled size="sm" type="button" variant="outline">
                Unavailable
              </Button>
            }
          />
        </section>
        <section className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-4">
          <SectionHeader title="Where usage comes from" />
          {runtimes === undefined ? (
            <p className="text-sm text-muted-foreground">
              Loading runtime catalogue…
            </p>
          ) : uniqueHarnesses.size > 0 ? (
            [...uniqueHarnesses.entries()].map(([id, row]) => {
              const runtime = runtimes.find(
                (candidate) => candidate.id === row.runtimeId,
              );
              return (
                <ActionRow
                  key={id}
                  title={row.label}
                  detail={`${row.count} configured ${row.count === 1 ? "agent" : "agents"} · ${runtime ? authStatusLabel(runtime.authStatus.status) : "Authentication unknown"}`}
                  action={<Badge variant="secondary">Harness</Badge>}
                />
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              No configured harnesses were reported.
            </p>
          )}
          <p className="border-t border-border/55 pt-3 text-sm text-muted-foreground">
            Harness authentication is separate from provider funding. A reported
            usage cost is not an invoice or account balance.
          </p>
        </section>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onOpenUsage} size="sm" type="button" variant="outline">
          <TrendingUp />
          Review usage
          <ArrowUpRight />
        </Button>
        <Button
          onClick={onOpenSupervision}
          size="sm"
          type="button"
          variant="ghost"
        >
          Inspect agent activity
          <ArrowUpRight />
        </Button>
      </div>
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
        const name = agent?.name ?? `${agentUsage.agentPubkey.slice(0, 8)}…`;
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
                {agent?.name ?? agentUsage.agentPubkey.slice(0, 8)}
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

function BillingHistory({
  creditsUnavailable,
  onAddCredits,
}: {
  creditsUnavailable: boolean;
  onAddCredits: () => void;
}) {
  return (
    <section className="space-y-4" data-testid="power-history">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <History aria-hidden="true" className="size-4" />
        <span>Credit purchases and payment records</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/35 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Reference</th>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Credits</th>
              <th className="px-3 py-3">State</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {creditsUnavailable ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                  colSpan={5}
                >
                  Billing history is unavailable while the payment service is
                  disconnected.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button onClick={onAddCredits} size="sm" type="button">
          Add credits
        </Button>
      </div>
    </section>
  );
}

function CheckoutScreen({
  creditsUnavailable,
  onBack,
}: {
  creditsUnavailable: boolean;
  onBack: () => void;
}) {
  return (
    <div
      className="mx-auto w-full max-w-3xl space-y-6"
      data-testid="power-checkout"
    >
      <Button onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeft />
        Power & usage
      </Button>
      <PageHeader
        description="Review a credit purchase before payment."
        title="Add credits"
      />
      <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-5">
        <SectionHeader title="Choose an amount" />
        <div className="min-h-16 rounded-lg border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
          {creditsUnavailable
            ? "Current prices are unavailable. Your balance has not changed."
            : "Choose an amount to review."}
        </div>
        <div className="flex justify-end">
          <Button disabled size="sm" type="button">
            Choose amount
          </Button>
        </div>
      </section>
    </div>
  );
}

function PriceUnavailableNotice() {
  return (
    <div
      className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm"
      role="status"
    >
      Current prices are unavailable. Your balance has not changed.
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="min-h-28 rounded-xl border border-border/70 bg-background/70 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}

function ActionRow({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 border-t border-border/55 py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function sumReportedCost(series: AgentUsageSeries | undefined) {
  if (!series || series.agents.length === 0) return "Not reported";
  let sum = 0;
  let found = false;
  let unknown = false;
  for (const agent of series.agents) {
    const cost = agent.usage.estimatedCostUsd;
    if (cost.value === null) {
      unknown = true;
      continue;
    }
    found = true;
    sum += cost.value;
    unknown ||= cost.incomplete || agent.hasUnknownUsage;
  }
  if (!found) return "Not reported";
  return `${money(sum)}${unknown ? " + unknown" : ""}`;
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

function authStatusLabel(status: string) {
  switch (status) {
    case "logged_in":
      return "Harness account signed in";
    case "logged_out":
      return "Harness sign-in needed";
    case "config_invalid":
      return "Harness configuration issue";
    case "not_applicable":
      return "Harness account not checked";
    default:
      return "Harness account status unknown";
  }
}
