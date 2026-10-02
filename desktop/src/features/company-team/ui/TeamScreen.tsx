import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { truncateNpub } from "@/shared/lib/pubkey";
import { Badge } from "@/shared/ui/badge";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/button";
import { useCompanyTeamQuery } from "../teamRelay";
import { buildTeamTreeRows, type TeamMember } from "../teamModels";

type TeamScreenProps = { view: "everyone" | "org" };

function displayName(
  member: TeamMember,
  profiles: Record<string, { displayName: string | null }>,
) {
  return (
    profiles[member.pubkey]?.displayName?.trim() ||
    member.fallbackName?.trim() ||
    truncateNpub(member.pubkey)
  );
}

function memberKindLabel(member: TeamMember) {
  return member.kind === "employee" ? "Employee" : "Human";
}

function memberTitle(member: TeamMember) {
  return member.position?.head.title.trim() ?? "";
}

function memberStatus(member: TeamMember) {
  return member.position?.head.status ?? "active";
}

function statusLabel(member: TeamMember) {
  const status = memberStatus(member);
  return status === "terminated" ? "archived" : status;
}

function TeamTabs({ view }: TeamScreenProps) {
  const { goTeam, goTeamOrg } = useAppNavigation();
  return (
    <div
      aria-label="Team views"
      className="flex gap-6 border-b border-border"
      role="tablist"
    >
      <button
        aria-selected={view === "everyone"}
        className={`-mb-px border-b-2 px-0 pb-3 pt-1 text-sm ${view === "everyone" ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => void goTeam()}
        role="tab"
        type="button"
      >
        Everyone
      </button>
      <button
        aria-selected={view === "org"}
        className={`-mb-px border-b-2 px-0 pb-3 pt-1 text-sm ${view === "org" ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => void goTeamOrg()}
        role="tab"
        type="button"
      >
        Reporting lines
      </button>
    </div>
  );
}

function TeamMemberRow({
  member,
  name,
  managerName,
  depth = 0,
  tree = false,
  tabIndex,
  onTreeFocus,
}: {
  member: TeamMember;
  name: string;
  managerName: string | null;
  depth?: number;
  tree?: boolean;
  tabIndex?: number;
  onTreeFocus?: (pubkey: string) => void;
}) {
  const { goTeamMember } = useAppNavigation();
  const title = memberTitle(member);
  const status = memberStatus(member);
  const reason = member.position?.head.reason;
  const managerDescription = managerName ? `, Reports to ${managerName}` : "";
  const reasonDescription = reason ? `, Reason: ${reason}` : "";
  const accessibleName = `${name}, ${title || "No title"}, ${memberKindLabel(member)}, ${statusLabel(member)}${managerDescription}${reasonDescription}`;
  const rowContents = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        {tree ? (
          <span
            aria-hidden="true"
            className="absolute ml-[-1.5rem] h-9 border-l border-border"
          />
        ) : null}
        <ProfileAvatar
          avatarUrl={null}
          className="size-9 rounded-lg text-xs"
          label={name}
          shape="squircle"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">
            {name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {title ? `${title} · ` : ""}
            {memberKindLabel(member)}
          </span>
          {status === "paused" && reason ? (
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {reason}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-5">
        {managerName ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Reports to {managerName}
          </span>
        ) : member.role === "owner" ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Company owner
          </span>
        ) : null}
        <Badge
          className="rounded-md border-0 bg-emerald-50 px-2 py-1 text-2xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          variant="secondary"
        >
          {statusLabel(member)}
        </Badge>
      </span>
    </>
  );
  const className =
    "group relative flex min-h-[4.5rem] w-full items-center justify-between gap-4 border-b border-border px-2 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const onClick = () => void goTeamMember(member.pubkey);
  if (tree) {
    return (
      <button
        aria-label={accessibleName}
        aria-level={depth + 1}
        className={className}
        data-testid={`company-team-member-${member.pubkey}`}
        onClick={onClick}
        onFocus={() => onTreeFocus?.(member.pubkey)}
        role="treeitem"
        style={{ paddingLeft: `${depth * 2.75 + 0.5}rem` }}
        tabIndex={tabIndex}
        type="button"
      >
        {rowContents}
      </button>
    );
  }
  return (
    <button
      aria-label={accessibleName}
      className={className}
      data-testid={`company-team-member-${member.pubkey}`}
      onClick={onClick}
      type="button"
    >
      {rowContents}
    </button>
  );
}

export function TeamScreen({ view }: TeamScreenProps) {
  const teamQuery = useCompanyTeamQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const { goHireRoles } = useAppNavigation();
  const treeRef = React.useRef<HTMLDivElement>(null);
  const [focusedTreeMember, setFocusedTreeMember] = React.useState<
    string | null
  >(null);
  const members = teamQuery.data?.members ?? [];
  const memberPubkeys = React.useMemo(
    () => members.map((member) => member.pubkey),
    [members],
  );
  const profilesQuery = useUsersBatchQuery(memberPubkeys, {
    enabled: memberPubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
  const canHire =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  let treeRows: ReturnType<typeof buildTeamTreeRows> = [];
  let treeError: string | null = null;
  if (view === "org" && members.length > 0) {
    try {
      treeRows = buildTeamTreeRows(members);
    } catch {
      treeError = "The reporting lines could not be displayed.";
    }
  }

  if (teamQuery.isLoading) {
    return (
      <p
        aria-live="polite"
        className="py-12 text-center text-sm text-muted-foreground"
      >
        Loading Team
      </p>
    );
  }
  if (teamQuery.isError) {
    return (
      <p className="py-12 text-center text-sm text-destructive" role="alert">
        Could not load Team: {teamQuery.error.message}
      </p>
    );
  }
  if (!teamQuery.data?.membershipSnapshotFound) {
    return (
      <p
        className="py-12 text-center text-sm text-muted-foreground"
        role="status"
      >
        Team membership is unavailable for this community.
      </p>
    );
  }

  const memberByPubkey = new Map(
    members.map((member) => [member.pubkey, member]),
  );
  const managerName = (member: TeamMember) => {
    const managerPubkey = member.position?.head.managerPubkey;
    const manager = managerPubkey ? memberByPubkey.get(managerPubkey) : null;
    return manager ? displayName(manager, profiles) : null;
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      ![
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      return;
    }
    const items = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='treeitem']",
      ) ?? [],
    );
    const currentIndex = items.indexOf(event.target as HTMLButtonElement);
    if (currentIndex < 0 || items.length === 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown")
      nextIndex = Math.min(items.length - 1, currentIndex + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (event.key === "ArrowRight") {
      const currentLevel = Number(
        items[currentIndex]?.getAttribute("aria-level") ?? 1,
      );
      const nextLevel = Number(
        items[currentIndex + 1]?.getAttribute("aria-level") ?? 0,
      );
      if (nextLevel === currentLevel + 1) nextIndex = currentIndex + 1;
    }
    if (event.key === "ArrowLeft") {
      const currentLevel = Number(
        items[currentIndex]?.getAttribute("aria-level") ?? 1,
      );
      for (let index = currentIndex - 1; index >= 0; index -= 1) {
        const level = Number(items[index]?.getAttribute("aria-level") ?? 1);
        if (level < currentLevel) {
          nextIndex = index;
          break;
        }
      }
    }
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <main
      className="mx-auto flex w-full max-w-[72rem] flex-col gap-7 px-6 py-10"
      data-testid="company-team-screen"
    >
      <PageHeader
        action={
          canHire ? (
            <Button onClick={() => void goHireRoles()} type="button">
              Hire employee
            </Button>
          ) : undefined
        }
        title="Team"
      />
      <TeamTabs view={view} />
      {treeError ? (
        <p className="py-8 text-center text-sm text-destructive" role="alert">
          {treeError}
        </p>
      ) : view === "org" ? (
        <div
          aria-label="Reporting lines"
          className="relative"
          onKeyDown={handleTreeKeyDown}
          ref={treeRef}
          role="tree"
        >
          {treeRows.map(({ member, depth }, index) => (
            <TeamMemberRow
              depth={depth}
              key={member.pubkey}
              managerName={managerName(member)}
              member={member}
              name={displayName(member, profiles)}
              onTreeFocus={setFocusedTreeMember}
              tabIndex={
                focusedTreeMember
                  ? focusedTreeMember === member.pubkey
                    ? 0
                    : -1
                  : index === 0
                    ? 0
                    : -1
              }
              tree
            />
          ))}
        </div>
      ) : (
        <div data-testid="company-team-list">
          {members.map((member) => (
            <TeamMemberRow
              key={member.pubkey}
              managerName={managerName(member)}
              member={member}
              name={displayName(member, profiles)}
            />
          ))}
        </div>
      )}
      {members.length === 0 ? (
        <p
          className="py-8 text-center text-sm text-muted-foreground"
          role="status"
        >
          No team members found.
        </p>
      ) : null}
      <p className="border-t border-border pt-4 text-xs text-muted-foreground">
        Humans and employees can report to either kind of teammate. Reporting
        lines do not grant spending or credential authority.
      </p>
    </main>
  );
}
