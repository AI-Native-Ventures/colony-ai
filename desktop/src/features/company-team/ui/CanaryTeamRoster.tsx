import { ArrowRight, Ellipsis, MessageCircle, Plus, Users } from "lucide-react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useNeedsMeQuery } from "@/features/home/needsMeHooks";
import { truncateNpub } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import type { TeamMember } from "../teamModels";
import { useEmployeeRuntime } from "../useEmployeeRuntime";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { TeamPageTitle } from "./TeamPage";

type Profile = { displayName: string | null; avatarUrl?: string | null };

function nameFor(member: TeamMember, profiles: Record<string, Profile>) {
  return (
    profiles[member.pubkey]?.displayName?.trim() ||
    member.fallbackName?.trim() ||
    truncateNpub(member.pubkey)
  );
}

function CanaryEmployeeRow({
  member,
  name,
  managerName,
  decisions,
}: {
  member: TeamMember;
  name: string;
  managerName: string | null;
  decisions: number | null;
}) {
  const { goTeamMember } = useAppNavigation();
  const runtime = useEmployeeRuntime(member);
  const position = member.position?.head;
  const status =
    position?.status === "paused"
      ? "Paused"
      : position?.status === "terminated"
        ? "Let go"
        : runtime.label;
  const statusDetail =
    position?.status === "paused"
      ? position.reason
      : position?.status === "terminated"
        ? position.reason
        : status === "Working"
          ? "Active now"
          : null;

  return (
    <button
      aria-label={`Open ${name}'s desk, ${position?.title ?? "Employee"}, ${status}`}
      className="colony-canary-roster-row"
      data-testid={`company-team-member-${member.pubkey}`}
      data-employee-status={status.toLowerCase()}
      onClick={() => void goTeamMember(member.pubkey)}
      type="button"
    >
      <span className="colony-canary-roster-identity">
        <EmployeeAvatar
          name={name}
          className="size-12"
          testId={`team-avatar-${member.pubkey}`}
        />
        <span>
          <strong>{name}</strong>
          <small>{position?.title ?? "Employee"}</small>
          {managerName ? <small>Reports to {managerName}</small> : null}
        </span>
      </span>
      <span className="colony-canary-roster-activity">
        <strong>{status}</strong>
        {statusDetail ? (
          <span className="colony-canary-roster-activity-detail">
            {statusDetail}
          </span>
        ) : null}
      </span>
      <span className="colony-canary-roster-action">
        {decisions !== null && decisions > 0 ? (
          <span className="colony-canary-roster-action-detail">
            {decisions} {decisions === 1 ? "decision" : "decisions"} waiting
          </span>
        ) : null}
        <span className="colony-canary-roster-action-link">
          Open desk <ArrowRight aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

/** The approved ant employee roster over the existing signed company records. */
export function CanaryTeamRoster({
  members,
  profiles,
  canHire,
}: {
  members: TeamMember[];
  profiles: Record<string, Profile>;
  canHire: boolean;
}) {
  const { goHireRoles, goTeamOrg } = useAppNavigation();
  const needsMe = useNeedsMeQuery();
  const employees = members.filter((member) => member.kind === "employee");
  const names = new Map(
    members.map((member) => [member.pubkey, nameFor(member, profiles)]),
  );
  const decisionCounts = new Map<string, number>();
  if (!needsMe.isPending && !needsMe.asksError) {
    for (const ask of needsMe.data.asks) {
      const pubkey = ask.head.askerPubkey.toLowerCase();
      decisionCounts.set(pubkey, (decisionCounts.get(pubkey) ?? 0) + 1);
    }
  }
  const totalDecisions =
    !needsMe.isPending && !needsMe.asksError && !needsMe.workflowApprovalsError
      ? needsMe.data.asks.length + needsMe.data.workflowApprovals.length
      : null;

  return (
    <div className="colony-canary-team-roster">
      <div className="colony-canary-team-roster-heading">
        <div>
          <span className="colony-canary-team-eyebrow">Your company</span>
          <TeamPageTitle className="colony-canary-team-title">
            Your team.
          </TeamPageTitle>
        </div>
        <div className="colony-canary-team-roster-controls">
          {canHire ? (
            <Button onClick={() => void goHireRoles()} type="button">
              <Plus aria-hidden="true" /> Hire employee
            </Button>
          ) : null}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Team options"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void goTeamOrg()}>
                <Users aria-hidden="true" /> People and reporting lines
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="colony-canary-team-summary">
        {employees.length} {employees.length === 1 ? "employee" : "employees"}.
        {totalDecisions !== null
          ? ` ${totalDecisions} ${totalDecisions === 1 ? "decision" : "decisions"} waiting on you.`
          : ""}
      </p>
      {employees.length > 0 ? (
        <div
          className="colony-canary-roster-list"
          data-testid="company-team-list"
        >
          {employees.map((member) => (
            <CanaryEmployeeRow
              decisions={
                totalDecisions === null
                  ? null
                  : (decisionCounts.get(member.pubkey) ?? 0)
              }
              key={member.pubkey}
              managerName={
                member.position?.head.managerPubkey
                  ? (names.get(member.position.head.managerPubkey) ?? null)
                  : null
              }
              member={member}
              name={nameFor(member, profiles)}
            />
          ))}
        </div>
      ) : (
        <div className="colony-canary-team-empty" role="status">
          <MessageCircle aria-hidden="true" />
          <p>Your employees will appear here after you hire them.</p>
        </div>
      )}
    </div>
  );
}
