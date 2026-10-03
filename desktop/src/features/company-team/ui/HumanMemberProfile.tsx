import * as React from "react";

import { MemberDoingNowSection } from "./MemberDoingNowSection";
import { MemberPositionHistoryPanel } from "./MemberPositionHistoryPanel";
import { TeamPage, TeamPageTitle } from "./TeamPage";
import { Button } from "@/shared/ui/button";
import type { TeamMember } from "../teamModels";

type HumanTab = "overview" | "history";

export function HumanMemberProfile({
  member,
  fullName,
  title,
  reportsTo,
  initialTab,
  onBack,
  canManage,
  onEdit,
  directReports,
  onOpenMember,
}: {
  member: TeamMember;
  fullName: string;
  title: string;
  reportsTo: string;
  initialTab?: HumanTab;
  onBack: () => void;
  canManage: boolean;
  onEdit: () => void;
  directReports: Array<{ pubkey: string; name: string; title: string }>;
  onOpenMember: (pubkey: string) => void;
}) {
  const [tab, setTab] = React.useState<HumanTab>(initialTab ?? "overview");
  React.useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  return (
    <TeamPage title={fullName} testId="company-team-member-profile">
      <button
        className="mb-4 inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onBack}
        type="button"
      >
        <span aria-hidden="true">‹</span> Back
      </button>
      <div className="mb-[1.875rem] mt-2">
        <TeamPageTitle>{fullName}</TeamPageTitle>
      </div>
      <p className="mb-6 text-compact text-muted-foreground">
        {title || "Member"} · Human · active
      </p>
      <div
        aria-label="Member profile"
        className="flex gap-6 border-b border-border"
        role="tablist"
      >
        {(["overview", "history"] as const).map((item) => (
          <button
            aria-controls="company-human-tabpanel"
            aria-selected={tab === item}
            className={`-mb-px border-b-2 px-0 py-2.5 text-xs ${tab === item ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`company-human-tab-${item}`}
            id={`company-human-tab-${item}`}
            key={item}
            onClick={() => setTab(item)}
            role="tab"
            type="button"
          >
            {item === "overview" ? "Overview" : "History"}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`company-human-tab-${tab}`}
        className="min-h-80 py-6"
        data-testid="company-human-tabpanel"
        id="company-human-tabpanel"
        role="tabpanel"
      >
        {tab === "overview" ? (
          <div className="grid gap-[3.125rem] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div>
              <MemberDoingNowSection memberPubkey={member.pubkey} />
              <section className="mt-5">
                <h2 className="mb-4 text-base font-semibold">Direct reports</h2>
                {directReports.length ? (
                  <div className="divide-y divide-border">
                    {directReports.map((report) => (
                      <button
                        className="min-h-12 w-full px-3 py-3 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={report.pubkey}
                        onClick={() => onOpenMember(report.pubkey)}
                        type="button"
                      >
                        {report.name} · {report.title || "Member"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No direct reports.
                  </p>
                )}
              </section>
            </div>
            <section
              className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-[2.1875rem]"
              data-testid="company-human-role"
            >
              <h2 className="mb-5 text-base font-semibold">
                Role and reporting
              </h2>
              <p className="text-xs text-muted-foreground">
                {title || "Member"}
                <br />
                {reportsTo === "Company owner"
                  ? "Company founder"
                  : `Reports to ${reportsTo}`}
              </p>
              {canManage ? (
                <Button
                  className="mt-3 h-11 w-full rounded-[0.4375rem] text-xs"
                  onClick={onEdit}
                  type="button"
                  variant="outline"
                >
                  Edit role and reporting
                </Button>
              ) : null}
              <h3 className="mb-4 mt-6 text-sm font-semibold">
                Responsibilities
              </h3>
              <p className="text-xs text-muted-foreground">
                Contribute, discuss, own commitments and review outcomes.
              </p>
              <h3 className="mb-4 mt-6 text-sm font-semibold">
                Manager actions
              </h3>
              <p className="text-xs text-muted-foreground">
                Assign work, propose hires and raises, pause direct reports.
                Money and sensitive access require an authorized human.
              </p>
            </section>
          </div>
        ) : (
          <MemberPositionHistoryPanel memberPubkey={member.pubkey} />
        )}
      </div>
    </TeamPage>
  );
}
