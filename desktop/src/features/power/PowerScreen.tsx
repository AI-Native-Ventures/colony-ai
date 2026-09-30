import * as React from "react";
import { ArrowLeft, CreditCard, History } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import type { TeamMember } from "@/features/company-team/teamModels";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import type {
  AgentUsageSeries,
  AgentUsageSeriesBucket,
} from "@/shared/api/tauriArchive";
import type { ManagedAgent } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { PageHeader, SectionHeader } from "@/shared/ui/PageHeader";
import type { UsagePeriodDays } from "./usageBoundaries";
import { useAgentUsageSeries } from "./useAgentUsageSeries";
import {
  AiSpendEmployeeScreen,
  AiSpendOverview,
  ExternalAiCostDetail,
  ExternalAiCostEditor,
  ExternalAiCostRemoveConfirmation,
  type PowerEmployee,
} from "./AiSpendScreens";
import {
  useAiSpendHeadsQuery,
  useEmployeeAllowanceHeadsQuery,
  useSyncAgentTurnSpendRecords,
} from "./spendRelay";

export type PowerPanel =
  | "employee"
  | "new-cost"
  | "edit-cost"
  | "source"
  | "remove-cost";

export type PowerSection =
  | "overview"
  | "usage"
  | "connections"
  | "history"
  | "checkout";

const POWER_TABS: Array<{ id: PowerSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "usage", label: "Usage" },
  { id: "connections", label: "Connections" },
  { id: "history", label: "Billing history" },
];

export function parsePowerSection(
  value: string | null | undefined,
): PowerSection {
  return value === "usage" ||
    value === "connections" ||
    value === "history" ||
    value === "checkout"
    ? value
    : "overview";
}

export function PowerScreen({
  section,
  panel,
  employeePubkey,
  recordId,
  onSectionChange,
  onOpenEmployee,
  onOpenNewCost,
  onOpenCost,
  onEditCost,
  onRemoveCost,
  onClosePanel,
}: {
  section: PowerSection;
  panel?: PowerPanel;
  employeePubkey?: string;
  recordId?: string;
  onSectionChange: (section: PowerSection) => void;
  onOpenEmployee: (pubkey: string) => void;
  onOpenNewCost: () => void;
  onOpenCost: (recordId: string) => void;
  onEditCost: (recordId: string) => void;
  onRemoveCost: (recordId: string) => void;
  onClosePanel: () => void;
}) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? "";
  const { goSettings } = useAppNavigation();
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
  const spendEnabled = section === "overview" || panel !== undefined;
  const teamQuery = useCompanyTeamQuery(spendEnabled);
  const identityQuery = useIdentityQuery();
  const employees = (teamQuery.data?.members ?? []).filter(
    (member): member is TeamMember => member.kind === "employee",
  );
  const activeEmployees = employees.filter(
    (employee) => employee.position?.head.status !== "terminated",
  );
  const profilesQuery = useUsersBatchQuery(
    employees.map((member) => member.pubkey),
    { enabled: spendEnabled && employees.length > 0 },
  );
  const allowancesQuery = useEmployeeAllowanceHeadsQuery(spendEnabled);
  const spendQuery = useAiSpendHeadsQuery(spendEnabled);
  const sync = useSyncAgentTurnSpendRecords(
    employees,
    spendQuery,
    spendEnabled,
  );
  const credits = creditsQuery.data ?? {
    status: "unavailable" as const,
    reason: "contract-not-available" as const,
  };
  const agents = agentsQuery.data ?? [];
  const runtimes = runtimesQuery.data ?? [];
  const profileRecords = profilesQuery.data?.profiles ?? {};
  const powerEmployees: PowerEmployee[] = employees.map((member) => ({
    member,
    name:
      profileRecords[member.pubkey]?.displayName?.trim() ||
      member.fallbackName?.trim() ||
      truncateNpub(member.pubkey),
    title:
      member.position?.head.title ||
      (member.kind === "employee" ? "Employee" : "Human"),
  }));
  const allowanceRecords = allowancesQuery.data?.records ?? [];
  const spendRecords = spendQuery.data?.records ?? [];
  const selfPubkey = identityQuery.data?.pubkey.toLowerCase();
  const currentRole = teamQuery.data?.relayMembers.find(
    (member) => member.pubkey.toLowerCase() === selfPubkey,
  )?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";
  const spendError =
    (teamQuery.error instanceof Error ? teamQuery.error : null) ??
    (profilesQuery.error instanceof Error ? profilesQuery.error : null) ??
    (allowancesQuery.error instanceof Error ? allowancesQuery.error : null) ??
    (spendQuery.error instanceof Error ? spendQuery.error : null) ??
    sync.error;
  const spendLoading =
    teamQuery.isLoading ||
    profilesQuery.isLoading ||
    allowancesQuery.isLoading ||
    spendQuery.isLoading;
  const selectedEmployee = powerEmployees.find(
    (item) =>
      item.member.pubkey.toLowerCase() === employeePubkey?.toLowerCase(),
  );
  const selectedAllowance = allowanceRecords.find(
    (item) =>
      item.head.employeePubkey.toLowerCase() ===
      selectedEmployee?.member.pubkey.toLowerCase(),
  );
  const selectedCost = spendRecords.find(
    (item) => item.head.recordId === recordId,
  );
  const showCostEditor =
    (panel === "new-cost" && (teamQuery.isLoading || canManage)) ||
    (panel === "edit-cost" &&
      (teamQuery.isLoading ||
        (canManage && (spendQuery.isLoading || selectedCost !== undefined))));
  const showCostRemoval =
    panel === "remove-cost" && (teamQuery.isLoading || canManage);
  const showSpendPanel =
    (panel === "employee" && selectedEmployee !== undefined) ||
    panel === "source" ||
    showCostRemoval ||
    showCostEditor;

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"
      data-testid="power-screen"
    >
      {showSpendPanel && panel === "employee" && selectedEmployee ? (
        <AiSpendEmployeeScreen
          allowance={selectedAllowance}
          employee={selectedEmployee}
          onBack={onClosePanel}
          records={spendRecords}
        />
      ) : showSpendPanel && panel === "source" ? (
        <ExternalAiCostDetail
          canManage={canManage}
          onBack={onClosePanel}
          onEdit={() => recordId && onEditCost(recordId)}
          onRemove={() => recordId && onRemoveCost(recordId)}
          record={selectedCost}
        />
      ) : showSpendPanel && panel === "remove-cost" ? (
        teamQuery.isLoading ? (
          <p
            className="py-12 text-center text-sm text-muted-foreground"
            role="status"
          >
            Loading cost record
          </p>
        ) : (
          <ExternalAiCostRemoveConfirmation
            canManage={canManage}
            onCancel={() => (recordId ? onOpenCost(recordId) : onClosePanel())}
            onRemoved={onClosePanel}
            record={selectedCost}
          />
        )
      ) : showSpendPanel && (panel === "new-cost" || panel === "edit-cost") ? (
        teamQuery.isLoading ||
        (panel === "edit-cost" && spendQuery.isLoading) ? (
          <p
            className="py-12 text-center text-sm text-muted-foreground"
            role="status"
          >
            Loading cost record
          </p>
        ) : canManage ? (
          <ExternalAiCostEditor
            canManage={canManage}
            onBack={
              panel === "edit-cost" && recordId
                ? () => onOpenCost(recordId)
                : onClosePanel
            }
            onSaved={
              panel === "edit-cost" && recordId
                ? () => onOpenCost(recordId)
                : onClosePanel
            }
            record={panel === "edit-cost" ? selectedCost : undefined}
          />
        ) : null
      ) : section === "checkout" ? (
        <CheckoutScreen
          creditsUnavailable={credits.status === "unavailable"}
          onBack={() => onSectionChange("overview")}
        />
      ) : (
        <>
          <PageHeader
            action={
              section === "overview" &&
              (canManage || activeEmployees.length > 0) ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {activeEmployees.length > 0 ? (
                    <Button asChild size="sm" type="button" variant="outline">
                      <Link
                        search={{
                          channelId: null,
                          threadRootEventId: null,
                          type: "money",
                        }}
                        to="/asks/new"
                      >
                        Request allowance change
                      </Link>
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button onClick={onOpenNewCost} size="sm" type="button">
                      Record external AI cost
                    </Button>
                  ) : null}
                </div>
              ) : section === "history" ? (
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
            title={
              section === "usage"
                ? "Agent usage"
                : section === "connections"
                  ? "Agent connections"
                  : section === "history"
                    ? "Billing history"
                    : "AI spend & power"
            }
          />
          <PowerNavigation
            section={section}
            onSectionChange={onSectionChange}
          />
          {section === "overview" ? (
            <AiSpendOverview
              allowances={allowanceRecords}
              employees={powerEmployees}
              error={spendError}
              isLoading={spendLoading}
              onOpenCost={onOpenCost}
              onOpenEmployee={onOpenEmployee}
              records={spendRecords}
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
          ) : section === "connections" ? (
            <PowerConnections
              credits={credits}
              isCreditsLoading={creditsQuery.isLoading}
              onManage={() => void goSettings("agents")}
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

function PowerConnections({
  credits,
  isCreditsLoading,
  onManage,
}: {
  credits: { status: string; balanceUsdCents?: number };
  isCreditsLoading: boolean;
  onManage: () => void;
}) {
  return (
    <div className="divide-y divide-border/70" data-testid="power-connections">
      <ConnectionRow
        detail="Harness-reported allowance unavailable"
        onManage={onManage}
        status="Unavailable"
        title="Existing subscriptions"
      />
      <ConnectionRow
        detail="Pay for supported agent work"
        onManage={onManage}
        status={
          isCreditsLoading
            ? "Loading"
            : credits.status === "available" &&
                credits.balanceUsdCents !== undefined
              ? moneyFromCents(credits.balanceUsdCents)
              : "Unavailable"
        }
        title="Colony credits"
      />
      <ConnectionRow
        detail="Provider balance not synced"
        onManage={onManage}
        status="Unavailable"
        title="OpenRouter"
      />
      <ConnectionRow
        detail="Provider key connection status unavailable"
        onManage={onManage}
        status="Unavailable"
        title="Provider keys"
      />
    </div>
  );
}

function ConnectionRow({
  title,
  detail,
  status,
  onManage,
}: {
  title: string;
  detail: string;
  status: string;
  onManage: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 py-5">
      <div className="min-w-0 space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{status}</span>
        <Button onClick={onManage} size="sm" type="button" variant="outline">
          Manage
        </Button>
      </div>
    </section>
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
