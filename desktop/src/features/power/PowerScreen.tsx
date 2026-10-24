import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCompanyManagedAgentsQuery } from "@/features/agents/useCompanyManagedAgents";
import { useCommunities } from "@/features/communities/useCommunities";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import type { TeamMember } from "@/features/company-team/teamModels";
import { readCredits } from "@/features/credits/accountPayments";
import { useColonyCreditsLaunched } from "@/features/credits/useColonyCreditsLaunched";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { truncateNpub } from "@/shared/lib/pubkey";

import {
  AiSpendEmployeeScreen,
  AiSpendOverview,
  type PowerEmployee,
} from "./AiSpendScreens";
import { PowerBreadcrumb, PowerTabs, type PowerTab } from "./PowerParts";
import { PowerConnections } from "./PowerConnections";
import { PowerUsageTab } from "./PowerUsageTab";
import {
  useAiSpendHeadsQuery,
  useEmployeeAllowanceHeadsQuery,
  useSyncAgentTurnSpendRecords,
} from "./spendRelay";
import "./PowerScreen.css";

export type PowerPanel = "employee";

export type PowerSection = "overview" | "usage" | "connections";

const POWER_TABS: ReadonlyArray<PowerTab<PowerSection>> = [
  { id: "overview", label: "Overview" },
  { id: "usage", label: "Usage" },
  { id: "connections", label: "Connections & billing" },
];

const HEADINGS: Record<PowerSection, { title: string; subtitle: string }> = {
  overview: {
    title: "AI spend & power",
    subtitle: "What your AI employees use, and what pays for it.",
  },
  usage: {
    title: "Agent usage",
    subtitle: "Usage reports from your AI employees’ work.",
  },
  connections: {
    title: "Connections & billing",
    subtitle: "Where your AI employees get their models.",
  },
};

/** Billing history and checkout are not in the lean app; old links land on Connections. */
export function parsePowerSection(
  value: string | null | undefined,
): PowerSection {
  return value === "usage"
    ? "usage"
    : value === "connections" || value === "history" || value === "checkout"
      ? "connections"
      : "overview";
}

function moneyFromCents(amountCents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
}

export function PowerScreen({
  section,
  panel,
  employeePubkey,
  onSectionChange,
  onOpenEmployee,
  onClosePanel,
}: {
  section: PowerSection;
  panel?: PowerPanel;
  employeePubkey?: string;
  onSectionChange: (section: PowerSection) => void;
  onOpenEmployee: (pubkey: string) => void;
  onClosePanel: () => void;
}) {
  const creditsLaunched = useColonyCreditsLaunched();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? "";
  const { goSettings } = useAppNavigation();
  const creditsQuery = useQuery({
    enabled: Boolean(communityId) && creditsLaunched,
    queryKey: ["account-credits", communityId],
    queryFn: readCredits,
    retry: false,
  });
  const agentsQuery = useCompanyManagedAgentsQuery();
  const spendEnabled = section === "overview" || panel !== undefined;
  const teamQuery = useCompanyTeamQuery(spendEnabled);
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
  const profileRecords = profilesQuery.data?.profiles ?? {};
  const powerEmployees: PowerEmployee[] = employees.map((member) => ({
    member,
    avatarUrl: profileRecords[member.pubkey]?.avatarUrl ?? null,
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
  const showEmployee = panel === "employee" && selectedEmployee !== undefined;
  const heading = HEADINGS[section];
  const leaf =
    showEmployee && selectedEmployee
      ? selectedEmployee.name
      : section === "usage"
        ? "Usage"
        : section === "connections"
          ? "Connections & billing"
          : undefined;
  const creditsStatus = creditsQuery.isLoading
    ? "Loading"
    : creditsQuery.data
      ? moneyFromCents(creditsQuery.data.balanceUsdCents)
      : "Unavailable";

  return (
    <div className="pw-screen">
      <div className="pw-scroll">
        <div className="pw-page" data-testid="power-screen">
          <AppTopChromePortal>
            <PowerBreadcrumb leaf={leaf} />
          </AppTopChromePortal>
          {showEmployee && selectedEmployee ? (
            <AiSpendEmployeeScreen
              allowance={selectedAllowance}
              employee={selectedEmployee}
              onBack={onClosePanel}
              records={spendRecords}
            />
          ) : (
            <>
              <div className="pw-heading">
                <div className="pw-heading-title">
                  <h1>{heading.title}</h1>
                  <span>{heading.subtitle}</span>
                </div>
                {section === "overview" && activeEmployees.length > 0 ? (
                  <div className="pw-heading-actions">
                    <Link
                      className="pw-link-button"
                      search={{
                        channelId: null,
                        threadRootEventId: null,
                        type: "money",
                      }}
                      to="/asks/new"
                    >
                      Request allowance change
                    </Link>
                  </div>
                ) : null}
              </div>
              <PowerTabs
                onSelect={onSectionChange}
                selected={section}
                tabs={POWER_TABS}
              />
              {section === "overview" ? (
                <AiSpendOverview
                  allowances={allowanceRecords}
                  employees={powerEmployees}
                  error={spendError}
                  isLoading={spendLoading}
                  onOpenEmployee={onOpenEmployee}
                  records={spendRecords}
                />
              ) : section === "usage" ? (
                <PowerUsageTab agents={agentsQuery.data ?? []} />
              ) : (
                <PowerConnections
                  creditsLaunched={creditsLaunched}
                  creditsStatus={creditsStatus}
                  onManage={() => void goSettings("agents")}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
