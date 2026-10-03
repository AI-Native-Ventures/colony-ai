import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  isManagedAgentActive,
  stopManagedAgentWithRules,
} from "@/features/agents/lib/managedAgentControlActions";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
  useStopManagedAgentMutation,
} from "@/features/agents/hooks";
import { clearActiveTurnsForAgentOnStop } from "@/features/agents/managedAgentRuntimeHooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { truncateNpub } from "@/shared/lib/pubkey";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { TeamPage, TeamPageTitle } from "./TeamPage";
import { Textarea } from "@/shared/ui/textarea";
import {
  useCompanyTeamQuery,
  useMemberPositionActionMutation,
} from "../teamRelay";
import type { MemberPositionActionKind } from "../teamModels";
import type { CompanyTeamData } from "../teamRelay";
import { EmployeeProfileScreen } from "./EmployeeProfileScreen";
import { HumanMemberProfile } from "./HumanMemberProfile";
import { EmployeeAllowanceEditScreen } from "@/features/power/EmployeeAllowanceScreens";

export type TeamMemberScreenMode = "detail" | "edit" | "pause" | "archive";

function AppError({ children }: { children: React.ReactNode }) {
  const { goTeam } = useAppNavigation();
  return (
    <TeamPage title="Team">
      <Button variant="ghost" onClick={() => void goTeam()}>
        <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
      </Button>
      <Alert className="mt-6 max-w-[46rem]" variant="destructive">
        <AlertTitle>Team unavailable</AlertTitle>
        <AlertDescription>{children}</AlertDescription>
      </Alert>
    </TeamPage>
  );
}

export function TeamMemberScreen({
  memberPubkey,
  mode,
  initialTab,
  salaryPanel,
}: {
  memberPubkey: string;
  mode: TeamMemberScreenMode;
  initialTab?: "overview" | "history";
  salaryPanel?: "salary" | "salary-edit";
}) {
  const teamQuery = useCompanyTeamQuery();
  const identity = useIdentityQuery();
  const {
    goTeam,
    goTeamArchive,
    goTeamEdit,
    goTeamMember,
    goTeamMemberSalary,
    goTeamSalaryEdit,
  } = useAppNavigation();
  const mutation = useMemberPositionActionMutation();
  const member = teamQuery.data?.members.find(
    (candidate) => candidate.pubkey === memberPubkey.toLowerCase(),
  );
  const memberProfiles = useUsersBatchQuery(member ? [member.pubkey] : [], {
    enabled: Boolean(member),
  });
  const otherMembers = teamQuery.data?.members ?? [];
  const descendants = new Set([memberPubkey.toLowerCase()]);
  for (let round = 0; round < otherMembers.length; round += 1) {
    const previousSize = descendants.size;
    for (const candidate of otherMembers) {
      if (
        candidate.position?.head.managerPubkey &&
        descendants.has(candidate.position.head.managerPubkey)
      )
        descendants.add(candidate.pubkey);
    }
    if (descendants.size === previousSize) break;
  }
  const otherProfiles = useUsersBatchQuery(
    otherMembers.map((candidate) => candidate.pubkey),
    { enabled: otherMembers.length > 0 },
  );
  const allProfiles =
    otherProfiles.data?.profiles ?? memberProfiles.data?.profiles ?? {};
  const fullName = member
    ? allProfiles[member.pubkey]?.displayName?.trim() ||
      member.fallbackName?.trim() ||
      truncateNpub(member.pubkey)
    : truncateNpub(memberPubkey);
  const role = teamQuery.data?.relayMembers.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() === identity.data?.pubkey.toLowerCase(),
  )?.role;
  const canManage = role === "owner" || role === "admin";
  const title = member?.position?.head.title ?? "";
  const managerPubkey = member?.position?.head.managerPubkey ?? "";
  const reportsTo = managerPubkey
    ? allProfiles[managerPubkey]?.displayName?.trim() ||
      teamQuery.data?.members.find(
        (candidate) => candidate.pubkey === managerPubkey,
      )?.fallbackName ||
      truncateNpub(managerPubkey)
    : member?.role === "owner"
      ? "Company owner"
      : "";
  const [titleInput, setTitleInput] = React.useState("");
  const [managerInput, setManagerInput] = React.useState("");
  const [reasonInput, setReasonInput] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isStopping, setIsStopping] = React.useState(false);
  const initializedForm = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (mode !== "edit" || !member) return;
    const headId = member.position?.event.id ?? "new-position";
    const key = `${member.pubkey}:${headId}`;
    if (initializedForm.current === key) return;
    initializedForm.current = key;
    setTitleInput(title);
    setManagerInput(managerPubkey);
  }, [managerPubkey, member, mode, title]);

  const managedAgentsQuery = useManagedAgentsQuery({
    enabled: mode === "pause" || mode === "archive",
  });
  const relayAgentsQuery = useRelayAgentsQuery({
    enabled: mode === "pause" || mode === "archive",
  });
  const channelsQuery = useChannelsQuery({
    enabled: mode === "pause" || mode === "archive",
  });
  const stopMutation = useStopManagedAgentMutation();

  if (teamQuery.isLoading && !teamQuery.data) {
    return (
      <TeamPage title="Team" testId="company-team-member-loading">
        <Button variant="ghost" onClick={() => void goTeam()}>
          <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
        </Button>
        <p className="text-base font-medium">Loading the latest record</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Actions become available after the shared source responds.
        </p>
      </TeamPage>
    );
  }
  if (teamQuery.isError && !teamQuery.data) {
    return (
      <TeamPage title="Team">
        <Button variant="ghost" onClick={() => void goTeam()}>
          <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
        </Button>
        <Alert data-testid="company-team-unavailable">
          <AlertTitle>This information could not load</AlertTitle>
          <AlertDescription>
            A connection failure is not an empty record.
          </AlertDescription>
          <Button
            className="mt-3"
            onClick={() => void teamQuery.refetch()}
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </Alert>
      </TeamPage>
    );
  }
  if (!teamQuery.data?.membershipSnapshotFound) {
    return (
      <AppError>Team membership is unavailable for this community.</AppError>
    );
  }
  if (mode === "pause") {
    return <AppError>Pausing employees is unavailable.</AppError>;
  }
  if (!member) {
    return (
      <AppError>This member is not available in the active community.</AppError>
    );
  }
  if (!canManage && mode !== "detail") {
    return (
      <AppError>
        Only a community owner or admin can make this change directly.
      </AppError>
    );
  }
  if (mode !== "detail" && member.kind !== "employee" && mode !== "edit") {
    return <AppError>This action is only available for AI employees.</AppError>;
  }

  if (mode === "detail" && salaryPanel === "salary-edit") {
    if (member.kind !== "employee") {
      return (
        <AppError>This allowance is only available for AI employees.</AppError>
      );
    }
    return (
      <EmployeeAllowanceEditScreen
        canManage={canManage}
        employee={member}
        onBack={() => void goTeamMemberSalary(member.pubkey)}
      />
    );
  }

  const back = () =>
    void (mode === "detail" ? goTeam() : goTeamMember(member.pubkey));
  const currentMember = member;
  if (member.kind === "employee" && mode === "detail") {
    return (
      <EmployeeProfileScreen
        canManage={canManage}
        fullName={fullName}
        member={member}
        initialTab={salaryPanel === "salary" ? "salary" : initialTab}
        onBack={() => void goTeam()}
        onEditSalary={() => void goTeamSalaryEdit(member.pubkey)}
        onEditPosition={() => void goTeamEdit(member.pubkey)}
        onOpenMember={(pubkey) => void goTeamMember(pubkey)}
        onTerminate={() => void goTeamArchive(member.pubkey)}
        profiles={allProfiles}
        teamData={teamQuery.data as CompanyTeamData}
      />
    );
  }
  const pageTitle =
    mode === "edit"
      ? "Edit role and reporting"
      : mode === "archive"
        ? "Terminate employee"
        : fullName;

  async function savePosition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const action: MemberPositionActionKind = "set_position";
    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        pubkey: currentMember.pubkey,
        action,
        ...(currentMember.position
          ? { expectedHeadEventId: currentMember.position.event.id }
          : {}),
        title: titleInput.trim(),
        managerPubkey: managerInput || null,
      });
      await goTeamMember(currentMember.pubkey, { replace: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save changes.",
      );
    }
  }

  async function changeLifecycle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (!currentMember.position) {
      setErrorMessage(
        "Set a title and reporting line before changing employee status.",
      );
      return;
    }
    if (
      currentMember.position.head.status !== "terminated" &&
      !reasonInput.trim()
    ) {
      setErrorMessage("Enter a reason to continue.");
      return;
    }
    setIsStopping(true);
    try {
      if (currentMember.position.head.status !== "terminated") {
        await mutation.mutateAsync({
          schemaVersion: 1,
          pubkey: currentMember.pubkey,
          action: "terminate",
          expectedHeadEventId: currentMember.position.event.id,
          reason: reasonInput.trim(),
        });
      }
      const managedAgentResult = managedAgentsQuery.data
        ? { data: managedAgentsQuery.data, error: null }
        : await managedAgentsQuery.refetch();
      if (managedAgentResult.error) throw managedAgentResult.error;
      const managedAgent = managedAgentResult.data?.find(
        (candidate) => candidate.pubkey.toLowerCase() === currentMember.pubkey,
      );
      if (managedAgent && isManagedAgentActive(managedAgent)) {
        const channels =
          channelsQuery.data ?? (await channelsQuery.refetch()).data ?? [];
        const relayAgents =
          relayAgentsQuery.data ??
          (await relayAgentsQuery.refetch()).data ??
          [];
        const result = await stopManagedAgentWithRules({
          agent: managedAgent,
          channels,
          relayAgents,
          stopManagedAgent: stopMutation.mutateAsync,
        });
        if (result.noticeMessage) throw new Error(result.noticeMessage);
        clearActiveTurnsForAgentOnStop(currentMember.pubkey);
      }
      const refreshed = await teamQuery.refetch();
      if (refreshed.error) throw refreshed.error;
      await goTeamMember(currentMember.pubkey, { replace: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update employee status.",
      );
    } finally {
      setIsStopping(false);
    }
  }

  if (mode === "detail") {
    return (
      <HumanMemberProfile
        fullName={fullName}
        initialTab={initialTab}
        member={member}
        onBack={() => void goTeam()}
        canManage={canManage}
        onEdit={() => void goTeamEdit(member.pubkey)}
        onOpenMember={(pubkey) => void goTeamMember(pubkey)}
        directReports={otherMembers
          .filter(
            (candidate) =>
              candidate.position?.head.managerPubkey === member.pubkey,
          )
          .map((candidate) => ({
            pubkey: candidate.pubkey,
            name:
              allProfiles[candidate.pubkey]?.displayName?.trim() ||
              candidate.fallbackName ||
              truncateNpub(candidate.pubkey),
            title: candidate.position?.head.title || "",
          }))}
        reportsTo={reportsTo}
        title={title || (member.role === "owner" ? "Founder" : "")}
      />
    );
  }

  if (mode === "edit") {
    return (
      <TeamPage title={pageTitle} testId="company-team-edit-screen">
        <button
          className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={back}
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
        </button>
        <div className="mb-[1.875rem] mt-2">
          <TeamPageTitle>{pageTitle}</TeamPageTitle>
        </div>
        <form
          className="max-w-[46.25rem] space-y-5"
          onSubmit={(event) => void savePosition(event)}
        >
          <div className="space-y-2">
            <label className="text-xs font-semibold" htmlFor="team-member-name">
              Name
            </label>
            <Input
              className="rounded-company-control h-11 text-compact"
              id="team-member-name"
              readOnly
              value={fullName}
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-xs font-semibold"
              htmlFor="team-member-title"
            >
              Title
            </label>
            <Input
              className="rounded-company-control h-11 text-compact"
              id="team-member-title"
              onChange={(event) => setTitleInput(event.target.value)}
              required
              value={titleInput}
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-xs font-semibold"
              htmlFor="team-member-manager"
            >
              Reports to
            </label>
            <select
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-compact"
              id="team-member-manager"
              onChange={(event) => setManagerInput(event.target.value)}
              value={managerInput}
            >
              <option value="">Company owner</option>
              {managerInput &&
              !otherMembers.some(
                (candidate) => candidate.pubkey === managerInput,
              ) ? (
                <option value={managerInput} disabled>
                  {truncateNpub(managerInput)} · unavailable
                </option>
              ) : null}
              {otherMembers
                .filter(
                  (candidate) =>
                    candidate.pubkey === managerInput ||
                    (!descendants.has(candidate.pubkey) &&
                      (candidate.position?.head.status ??
                        (candidate.kind === "human" ? "active" : "unknown")) ===
                        "active"),
                )
                .map((candidate) => {
                  const name =
                    allProfiles[candidate.pubkey]?.displayName?.trim() ||
                    candidate.fallbackName ||
                    truncateNpub(candidate.pubkey);
                  return (
                    <option
                      key={candidate.pubkey}
                      value={candidate.pubkey}
                      disabled={
                        descendants.has(candidate.pubkey) ||
                        (candidate.position?.head.status ??
                          (candidate.kind === "human"
                            ? "active"
                            : "unknown")) !== "active"
                      }
                    >
                      {name} ·{" "}
                      {candidate.kind === "employee" ? "Employee" : "Human"}
                      {candidate.position?.head.status &&
                      candidate.position.head.status !== "active"
                        ? `, ${candidate.position.head.status}`
                        : ""}
                    </option>
                  );
                })}
            </select>
          </div>
          <div className="border-l-2 border-border bg-muted px-4 py-3 text-xs">
            This changes reporting responsibilities only. It does not grant
            spending, secret access or administrative permissions.
          </div>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex gap-3 border-t border-border pt-5">
            <Button
              className="rounded-company-control h-11 bg-colony-info text-xs shadow-none"
              disabled={mutation.isPending || !titleInput.trim()}
              type="submit"
            >
              {mutation.isPending ? "Saving" : "Save changes"}
            </Button>
            <Button
              className="rounded-company-control h-11 text-xs"
              onClick={back}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </form>
      </TeamPage>
    );
  }

  const confirmationTitle = "Terminate employee";
  return (
    <TeamPage title={confirmationTitle} testId={`company-team-${mode}-screen`}>
      <button
        className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={back}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
      </button>
      <div className="mb-[1.875rem] mt-2">
        <TeamPageTitle>{confirmationTitle}</TeamPageTitle>
      </div>
      <form
        className="max-w-[46.25rem] space-y-5"
        onSubmit={(event) => void changeLifecycle(event)}
      >
        <p className="text-sm font-semibold">{fullName}</p>
        <div className="space-y-2">
          <label className="text-xs font-semibold" htmlFor="team-status-reason">
            Reason
          </label>
          <Textarea
            className="text-compact"
            id="team-status-reason"
            onChange={(event) => setReasonInput(event.target.value)}
            required={currentMember.position?.head.status !== "terminated"}
            rows={3}
            value={reasonInput}
          />
        </div>
        <div className="border-l-2 border-border bg-muted px-4 py-3 text-xs">
          Active execution stops. This cannot be undone from this screen.
          Definition, lessons and history are retained. Review rehire is
          available from the terminated employee profile.
        </div>
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex gap-3 border-t border-border pt-5">
          <Button
            className="rounded-company-control h-11 bg-colony-info text-xs shadow-none"
            disabled={
              isStopping ||
              mutation.isPending ||
              (currentMember.position?.head.status !== "terminated" &&
                !reasonInput.trim())
            }
            type="submit"
          >
            {isStopping || mutation.isPending
              ? "Saving"
              : currentMember.position?.head.status === "terminated"
                ? "Retry stopping runtime"
                : "Terminate employee"}
          </Button>
          <Button
            className="rounded-company-control h-11 text-xs"
            onClick={back}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </form>
    </TeamPage>
  );
}
