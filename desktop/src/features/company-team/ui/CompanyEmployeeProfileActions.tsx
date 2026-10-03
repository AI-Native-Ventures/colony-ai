import * as React from "react";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { truncateNpub } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { useCompanyTeamQuery } from "../teamRelay";
import type { MemberPositionHead } from "../teamModels";

export function CompanyEmployeeProfileActions({
  canManage,
  children,
  employeePubkey,
  managerName,
  onEdit,
  onOpenReport,
  onPause,
  onTerminate,
  position,
}: {
  canManage: boolean;
  children?: React.ReactNode;
  employeePubkey: string;
  managerName: string | null;
  onEdit: () => void;
  onOpenReport: (pubkey: string) => void;
  onPause: () => void;
  onTerminate: () => void;
  position: MemberPositionHead | undefined;
}) {
  const companyTeamQuery = useCompanyTeamQuery();
  const directReportMembers = React.useMemo(
    () =>
      (companyTeamQuery.data?.members ?? []).filter(
        (member) =>
          member.position?.head.managerPubkey?.toLowerCase() ===
          employeePubkey.toLowerCase(),
      ),
    [companyTeamQuery.data?.members, employeePubkey],
  );
  const directReportPubkeys = React.useMemo(
    () => directReportMembers.map((member) => member.pubkey),
    [directReportMembers],
  );
  const directReportProfilesQuery = useUsersBatchQuery(directReportPubkeys, {
    enabled: directReportPubkeys.length > 0,
  });
  const directReports = React.useMemo(
    () =>
      directReportMembers.map((member) => ({
        pubkey: member.pubkey,
        displayName:
          directReportProfilesQuery.data?.profiles[
            member.pubkey
          ]?.displayName?.trim() ||
          member.managedAgent?.name ||
          member.fallbackName ||
          truncateNpub(member.pubkey),
        title: member.position?.head.title ?? "",
        kind:
          member.kind === "employee"
            ? ("Employee" as const)
            : ("Human" as const),
      })),
    [directReportMembers, directReportProfilesQuery.data?.profiles],
  );

  return (
    <section
      aria-label="Company employee overview"
      className={
        children
          ? "grid gap-[3.125rem] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
          : "mt-8 grid gap-8 border-t border-border/60 pt-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]"
      }
      data-testid="company-employee-manager-actions"
    >
      <div>
        {children}
        {directReports.length > 0 ? (
          <section
            aria-labelledby="company-employee-direct-reports-heading"
            data-testid="company-employee-direct-reports"
          >
            <h2
              className="mb-4 mt-5 text-base font-semibold"
              id="company-employee-direct-reports-heading"
            >
              Direct reports
            </h2>
            <div className="mt-3 divide-y divide-border/55">
              {directReports.map((report) => (
                <button
                  aria-label={`${report.displayName}, ${report.title} ${report.kind}`}
                  className="min-h-12 w-full py-3 text-left text-xs hover:text-primary"
                  key={report.pubkey}
                  onClick={() => onOpenReport(report.pubkey)}
                  type="button"
                >
                  {report.displayName} · {report.title || report.kind}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section
            className="mt-5"
            data-testid="company-employee-direct-reports"
          >
            <h2 className="mb-4 text-base font-semibold">Direct reports</h2>
            <p className="text-xs text-muted-foreground">No direct reports.</p>
          </section>
        )}
      </div>
      <aside className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-[2.1875rem]">
        <div>
          <h2 className="mb-5 text-base font-semibold">Role and reporting</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {position?.title || "Title not set"}
            <br />
            {managerName ? `Reports to ${managerName}` : "Company founder"}
          </p>
          {canManage ? (
            <Button
              className="rounded-[0.4375rem] mt-3 h-11 w-full text-xs"
              onClick={onEdit}
              type="button"
              variant="outline"
            >
              Edit role and reporting
            </Button>
          ) : null}
        </div>
        <div className="mt-6">
          <h2 className="text-xs font-semibold">Responsibilities</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Plan, delegate, discuss and review. Workers receive scoped execution
            tools.
          </p>
        </div>
        <div className="mt-6">
          <h2 className="text-xs font-semibold">Manager actions</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Assign work, propose hires and raises, pause direct reports. Money
            and sensitive access require an authorized human.
          </p>
          {canManage &&
          (children
            ? position?.status === "active"
            : position?.status !== "terminated") ? (
            <Button
              className="rounded-[0.4375rem] mt-3 h-11 w-full text-xs"
              onClick={onPause}
              type="button"
              variant="outline"
            >
              Pause employee
            </Button>
          ) : null}
          {canManage && position?.status !== "terminated" ? (
            <Button
              className="mt-2 h-11 w-full text-xs text-destructive"
              onClick={onTerminate}
              type="button"
              variant="ghost"
            >
              Terminate employee
            </Button>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
