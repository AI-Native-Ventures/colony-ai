import * as React from "react";

import { MemberDoingNowSection } from "./MemberDoingNowSection";
import { MemberPositionHistoryPanel } from "./MemberPositionHistoryPanel";
import { TeamPage, TeamPageTitle } from "./TeamPage";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import type { TeamMember } from "../teamModels";

type ProfileSummary = {
  displayName: string | null;
  avatarUrl: string | null;
};

type HumanTab = "overview" | "history";

export function HumanMemberProfile({
  member,
  fullName,
  title,
  reportsTo,
  profile,
  initialTab,
  onBack,
}: {
  member: TeamMember;
  fullName: string;
  title: string;
  reportsTo: string;
  profile: ProfileSummary | undefined;
  initialTab?: HumanTab;
  onBack: () => void;
}) {
  const [tab, setTab] = React.useState<HumanTab>(initialTab ?? "overview");

  React.useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  return (
    <TeamPage title={fullName} testId="company-team-member-profile">
      <button
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onBack}
        type="button"
      >
        Back
      </button>
      <div className="mb-[1.875rem] mt-2">
        <TeamPageTitle>{fullName}</TeamPageTitle>
      </div>
      <div className="mb-8 flex items-center gap-4">
        <UserAvatar
          avatarUrl={profile?.avatarUrl ?? null}
          displayName={fullName}
          fallbackVariant="muted"
          shape="squircle"
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{fullName}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Human · {title || "Member"}
          </p>
        </div>
      </div>
      <div
        aria-label="Member profile"
        className="flex gap-6 border-b border-border"
        role="tablist"
      >
        {(["overview", "history"] as const).map((item) => (
          <button
            aria-controls="company-human-tabpanel"
            aria-selected={tab === item}
            className={`-mb-px border-b-2 px-1 pb-3 text-sm ${tab === item ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
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
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,1fr)]">
              <MemberDoingNowSection memberPubkey={member.pubkey} />
              <section
                className="rounded-lg border border-border p-6"
                data-testid="company-human-role"
              >
                <h2 className="text-base font-semibold">Your role</h2>
                <dl className="mt-5 divide-y divide-border text-sm">
                  <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] gap-4 py-3">
                    <dt className="text-muted-foreground">Title</dt>
                    <dd className="min-w-0 break-words">{title || "Member"}</dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] gap-4 py-3">
                    <dt className="text-muted-foreground">Member type</dt>
                    <dd>Human</dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] gap-4 py-3">
                    <dt className="text-muted-foreground">Reporting line</dt>
                    <dd className="min-w-0 break-words">{reportsTo}</dd>
                  </div>
                </dl>
              </section>
            </div>
            <p className="mt-8 max-w-3xl text-xs text-muted-foreground">
              AI configuration tabs are hidden for human members. Human
              commitments and company history remain available.
            </p>
          </>
        ) : (
          <MemberPositionHistoryPanel memberPubkey={member.pubkey} />
        )}
      </div>
    </TeamPage>
  );
}
