import * as React from "react";
import { ArrowLeft } from "lucide-react";

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
import { PageHeader } from "@/shared/ui/PageHeader";
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
  return (
    <Alert className="mx-auto mt-10 max-w-[46rem]" variant="destructive">
      <AlertTitle>Team unavailable</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
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
    goTeamPause,
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
      <main
        aria-live="polite"
        className="mx-auto w-full max-w-[46rem] px-6 py-12"
        data-testid="company-team-member-loading"
      >
        <p className="text-base font-medium">Loading the latest record</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Actions become available after the shared source responds.
        </p>
      </main>
    );
  }
  if (teamQuery.isError && !teamQuery.data) {
    return (
      <main className="mx-auto w-full max-w-[46rem] px-6 py-8">
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
      </main>
    );
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
        onPause={() => void goTeamPause(member.pubkey)}
        onTerminate={() => void goTeamArchive(member.pubkey)}
        profiles={allProfiles}
        teamData={teamQuery.data as CompanyTeamData}
      />
    );
  }
  const pageTitle =
    mode === "edit"
      ? "Edit role and reporting"
      : mode === "pause"
        ? "Pause employee"
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
    if (!reasonInput.trim()) {
      setErrorMessage("Enter a reason to continue.");
      return;
    }
    setIsStopping(true);
    try {
      const managedAgentResult = managedAgentsQuery.data
        ? { data: managedAgentsQuery.data, error: null }
        : await managedAgentsQuery.refetch();
      if (managedAgentResult.error) throw managedAgentResult.error;
      const managedAgent = managedAgentResult.data?.find(
        (candidate) => candidate.pubkey.toLowerCase() === currentMember.pubkey,
      );
      if (!managedAgent) {
        throw new Error(
          "This employee runtime cannot be stopped from the current device.",
        );
      }
      if (isManagedAgentActive(managedAgent)) {
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
      await mutation.mutateAsync({
        schemaVersion: 1,
        pubkey: currentMember.pubkey,
        action: mode === "pause" ? "pause" : "terminate",
        expectedHeadEventId: currentMember.position.event.id,
        reason: reasonInput.trim(),
      });
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
        profile={allProfiles[member.pubkey]}
        reportsTo={reportsTo || "Company owner"}
        title={title}
      />
    );
  }

  if (mode === "edit") {
    return (
      <main
        className="mx-auto w-full max-w-[46rem] px-6 py-8"
        data-testid="company-team-edit-screen"
      >
        <button
          className="mb-7 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={back}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Back
        </button>
        <PageHeader className="mb-8" title={pageTitle} />
        <form
          className="space-y-5"
          onSubmit={(event) => void savePosition(event)}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="team-member-name">
              Name
            </label>
            <Input id="team-member-name" readOnly value={fullName} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="team-member-title">
              Title
            </label>
            <Input
              id="team-member-title"
              onChange={(event) => setTitleInput(event.target.value)}
              required
              value={titleInput}
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="team-member-manager"
            >
              Reports to
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              id="team-member-manager"
              onChange={(event) => setManagerInput(event.target.value)}
              value={managerInput}
            >
              <option value="">Company owner</option>
              {otherMembers
                .filter(
                  (candidate) =>
                    candidate.pubkey !== member.pubkey &&
                    (candidate.position?.head.status ?? "active") === "active",
                )
                .map((candidate) => {
                  const name =
                    allProfiles[candidate.pubkey]?.displayName?.trim() ||
                    candidate.fallbackName ||
                    truncateNpub(candidate.pubkey);
                  return (
                    <option key={candidate.pubkey} value={candidate.pubkey}>
                      {name} ·{" "}
                      {candidate.kind === "employee" ? "Employee" : "Human"}
                    </option>
                  );
                })}
            </select>
          </div>
          <div className="border-l-2 border-muted bg-muted/40 px-4 py-4 text-sm text-muted-foreground">
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
              disabled={mutation.isPending || !titleInput.trim()}
              type="submit"
            >
              {mutation.isPending ? "Saving" : "Save changes"}
            </Button>
            <Button onClick={back} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </main>
    );
  }

  const isPause = mode === "pause";
  const confirmationTitle = isPause ? "Pause employee" : "Terminate employee";
  return (
    <main
      className="mx-auto w-full max-w-[46rem] px-6 py-8"
      data-testid={`company-team-${mode}-screen`}
    >
      <button
        className="mb-7 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={back}
        type="button"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" /> Back
      </button>
      <PageHeader className="mb-8" title={confirmationTitle} />
      <form
        className="space-y-4"
        onSubmit={(event) => void changeLifecycle(event)}
      >
        <p className="text-sm font-semibold">{fullName}</p>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="team-status-reason">
            Reason
          </label>
          <Textarea
            id="team-status-reason"
            onChange={(event) => setReasonInput(event.target.value)}
            required
            rows={4}
            value={reasonInput}
          />
        </div>
        <div className="border-l-2 border-muted bg-muted/40 px-4 py-4 text-sm text-muted-foreground">
          {isPause
            ? "Work remains visible with a paused reason. The employee can be resumed later."
            : "Active execution stops. Definition, lessons and history are retained for a future reviewed rehire."}
        </div>
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex gap-3 border-t border-border pt-5">
          <Button
            disabled={isStopping || mutation.isPending || !reasonInput.trim()}
            type="submit"
          >
            {isStopping || mutation.isPending
              ? "Saving"
              : isPause
                ? "Pause employee"
                : "Terminate employee"}
          </Button>
          <Button onClick={back} type="button" variant="outline">
            Cancel
          </Button>
        </div>
      </form>
    </main>
  );
}
