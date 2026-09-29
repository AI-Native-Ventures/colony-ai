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
import type { MemberPositionActionKind, TeamMember } from "../teamModels";
import type { CompanyTeamData } from "../teamRelay";
import { EmployeeProfileScreen } from "./EmployeeProfileScreen";

export type TeamMemberScreenMode = "detail" | "edit" | "pause" | "archive";

function statusLabel(member: TeamMember) {
  const status = member.position?.head.status ?? "active";
  return status === "terminated" ? "archived" : status;
}

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
}: {
  memberPubkey: string;
  mode: TeamMemberScreenMode;
}) {
  const teamQuery = useCompanyTeamQuery();
  const identity = useIdentityQuery();
  const { goTeam, goTeamArchive, goTeamEdit, goTeamMember, goTeamPause } =
    useAppNavigation();
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
  const directReports = React.useMemo(
    () =>
      member
        ? otherMembers
            .filter(
              (candidate) =>
                candidate.position?.head.managerPubkey?.toLowerCase() ===
                member.pubkey.toLowerCase(),
            )
            .map((candidate) => ({
              pubkey: candidate.pubkey,
              name:
                allProfiles[candidate.pubkey]?.displayName?.trim() ||
                candidate.fallbackName?.trim() ||
                truncateNpub(candidate.pubkey),
              title:
                candidate.position?.head.title ||
                (candidate.kind === "employee" ? "Employee" : "Human"),
            }))
        : [],
    [allProfiles, member, otherMembers],
  );
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

  if (teamQuery.isLoading) {
    return (
      <p
        aria-live="polite"
        className="py-12 text-center text-sm text-muted-foreground"
      >
        Loading Team member
      </p>
    );
  }
  if (teamQuery.isError) {
    return <AppError>{teamQuery.error.message}</AppError>;
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

  const back = () =>
    void (mode === "detail" ? goTeam() : goTeamMember(member.pubkey));
  const currentMember = member;
  if (member.kind === "employee" && mode === "detail") {
    return (
      <EmployeeProfileScreen
        canManage={canManage}
        fullName={fullName}
        member={member}
        onBack={() => void goTeam()}
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
    const status = statusLabel(member);
    return (
      <main
        className="mx-auto w-full max-w-[72rem] px-6 py-8"
        data-testid="company-team-member-profile"
      >
        <button
          className="mb-7 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={back}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Back
        </button>
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <PageHeader
              description={`${title || ""}${title ? " · " : ""}Human · ${status}`}
              title={fullName}
            />
          </div>
        </div>
        {status === "paused" ? (
          <Alert className="mb-6">
            <AlertTitle>Paused · {member.position?.head.reason}</AlertTitle>
            <AlertDescription>
              Work remains visible with a paused reason. The employee can be
              resumed later.
            </AlertDescription>
          </Alert>
        ) : null}
        <div
          aria-label="Member profile"
          className="flex gap-6 border-b border-border"
          role="tablist"
        >
          <button
            aria-selected="true"
            className="-mb-px border-b-2 border-primary pb-3 text-sm font-semibold"
            role="tab"
            type="button"
          >
            Overview
          </button>
          <button
            aria-selected="false"
            className="-mb-px border-b-2 border-transparent pb-3 text-sm text-muted-foreground"
            role="tab"
            type="button"
            disabled
          >
            History
          </button>
        </div>
        <div className="grid gap-10 py-6 md:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
          <section
            aria-labelledby="team-direct-reports-heading"
            data-testid="company-human-direct-reports"
          >
            <h2
              className="mb-5 text-base font-semibold"
              id="team-direct-reports-heading"
            >
              Direct reports
            </h2>
            {directReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No direct reports.
              </p>
            ) : (
              directReports.map((report) => (
                <button
                  aria-label={`${report.name} · ${report.title}`}
                  className="block min-h-12 w-full border-b border-border px-3 py-4 text-left text-sm hover:bg-muted/40"
                  data-testid={`company-human-report-${report.pubkey}`}
                  key={report.pubkey}
                  onClick={() => void goTeamMember(report.pubkey)}
                  type="button"
                >
                  {report.name} · {report.title}
                </button>
              ))
            )}
          </section>
          <aside className="border-l border-border pl-8">
            <h2 className="mb-4 text-base font-semibold">Role and reporting</h2>
            <p className="mb-5 text-sm text-muted-foreground">
              {title}
              <br />
              {reportsTo ? `Reports to ${reportsTo}` : "Company founder"}
            </p>
            {canManage ? (
              <Button
                className="w-full"
                onClick={() => void goTeamEdit(member.pubkey)}
                type="button"
                variant="outline"
              >
                Edit role and reporting
              </Button>
            ) : null}
            <div className="mt-6">
              <h2 className="text-sm font-semibold">Responsibilities</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Contribute, discuss, own commitments and review outcomes.
              </p>
            </div>
            <div className="mt-6">
              <h2 className="text-sm font-semibold">Manager actions</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Assign work, propose hires and raises, pause direct reports.
                Money and sensitive access require an authorized human.
              </p>
            </div>
          </aside>
        </div>
      </main>
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
