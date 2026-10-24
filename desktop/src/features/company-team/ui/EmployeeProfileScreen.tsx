import { EmployeeRehireReview } from "./EmployeeRehireReview";
import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";

import {
  useAcpRuntimesQuery,
  usePersonasQuery,
  useUpdateManagedAgentMutation,
  useUpdatePersonaMutation,
} from "@/features/agents/hooks";
import { runtimeForAgent } from "@/features/agents/agentDirectoryModel";
import { AgentInstanceEditDialog } from "@/features/agents/ui/AgentInstanceEditDialog";
import { CompanyEmployeeProfileActions } from "./CompanyEmployeeProfileActions";
import type { CompanyTeamData } from "../teamRelay";
import type { TeamMember } from "../teamModels";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import type {
  AgentPersona,
  ManagedAgent,
  UpdatePersonaInput,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { TeamPage, TeamPageTitle, handleTeamTabKeys } from "./TeamPage";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { EmployeeRuntimeSummary } from "./EmployeeRuntimeSummary";
import { useEmployeeRuntime } from "../useEmployeeRuntime";
import { Textarea } from "@/shared/ui/textarea";
import { truncateNpub } from "@/shared/lib/pubkey";

type EmployeeConfigSnapshot = {
  instructions?: string;
  provider?: string;
  model?: string;
  runtime?: string;
};

type EmployeeTab = "overview" | "instructions" | "model-runtime";

const TABS: Array<{ id: EmployeeTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
  { id: "model-runtime", label: "Model & runtime" },
];

type ProfileSummary = {
  displayName: string | null;
  avatarUrl: string | null;
  ownerPubkey?: string | null;
};

function normalizedSnapshot(input: {
  instructions: string | null | undefined;
  provider: string | null | undefined;
  model: string | null | undefined;
  runtime: string | null | undefined;
}): EmployeeConfigSnapshot {
  return {
    ...(input.instructions !== null && input.instructions !== undefined
      ? { instructions: input.instructions }
      : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
  };
}

function employeeSnapshot(
  agent: ManagedAgent,
  persona: AgentPersona | undefined,
  runtimes: ReturnType<typeof useAcpRuntimesQuery>["data"],
): EmployeeConfigSnapshot {
  const runtime = runtimeForAgent(agent, runtimes ?? []);
  return normalizedSnapshot({
    instructions: agent.systemPrompt ?? persona?.systemPrompt,
    provider: agent.provider ?? persona?.provider,
    model: agent.model ?? persona?.model,
    runtime: agent.runtime ?? persona?.runtime ?? runtime?.id,
  });
}

function displayName(
  summary: ProfileSummary | undefined,
  fallback: string | null,
  pubkey: string,
) {
  return (
    summary?.displayName?.trim() || fallback?.trim() || truncateNpub(pubkey)
  );
}

export function EmployeeProfileScreen({
  member,
  fullName,
  profiles,
  teamData,
  canManage,
  onBack,
  onEditPosition,
  onOpenMember,
  onTerminate,
}: {
  member: TeamMember;
  fullName: string;
  profiles: Record<string, ProfileSummary>;
  teamData: CompanyTeamData;
  canManage: boolean;
  onBack: () => void;
  onEditPosition: () => void;
  onOpenMember: (pubkey: string) => void;
  onTerminate: () => void;
}) {
  const [reviewRehire, setReviewRehire] = React.useState(false);
  const agent = member.managedAgent;
  const identity = useIdentityQuery();
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const employeePubkey = member.pubkey.toLowerCase();
  const queryClient = useQueryClient();
  const updateAgentMutation = useUpdateManagedAgentMutation();
  const updatePersonaMutation = useUpdatePersonaMutation();
  const profileQuery = useUsersBatchQuery([employeePubkey]);
  const profile =
    profiles[employeePubkey] ?? profileQuery.data?.profiles[employeePubkey];
  const persona = personasQuery.data?.find(
    (candidate) => candidate.id === agent?.personaId,
  );
  const runtimes = runtimesQuery.data ?? [];
  const snapshot = agent ? employeeSnapshot(agent, persona, runtimes) : null;
  const actorPubkey = identity.data?.pubkey.toLowerCase() ?? "";
  const currentPosition = member.position?.head;
  const actorPosition = teamData.members.find(
    (candidate) => candidate.pubkey === actorPubkey,
  )?.position?.head;
  const actorRole = teamData.relayMembers.find(
    (candidate) => candidate.pubkey.toLowerCase() === actorPubkey,
  )?.role;
  const canEdit =
    actorRole === "owner" ||
    actorRole === "admin" ||
    (actorPosition?.kind === "human" &&
      actorPosition.status === "active" &&
      currentPosition?.managerPubkey?.toLowerCase() === actorPubkey);
  const managerPubkey = currentPosition?.managerPubkey?.toLowerCase();
  const managerMember = managerPubkey
    ? teamData.members.find((candidate) => candidate.pubkey === managerPubkey)
    : undefined;
  const managerName = managerPubkey
    ? displayName(
        profiles[managerPubkey],
        managerMember?.fallbackName ?? null,
        managerPubkey,
      )
    : null;
  const status = currentPosition?.status;
  const employeeRuntime = useEmployeeRuntime(member);
  const subtitle = [currentPosition?.title, "Employee", employeeRuntime.label]
    .filter(Boolean)
    .join(" · ");
  const [tab, setTab] = React.useState<EmployeeTab>("overview");
  const [editInstructions, setEditInstructions] = React.useState(false);
  const [instructionDraft, setInstructionDraft] = React.useState("");
  const [instructionError, setInstructionError] = React.useState<string | null>(
    null,
  );
  const [runtimeDialogOpen, setRuntimeDialogOpen] = React.useState(false);

  React.useEffect(() => {
    setInstructionDraft(snapshot?.instructions ?? "");
    setInstructionError(null);
  }, [snapshot?.instructions]);

  const canEditInstructions = Boolean(
    canEdit &&
      agent &&
      (agent.personaId === null ||
        (persona && !persona.isBuiltIn && !persona.sourceTeam)),
  );

  async function saveInstructions(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agent || !snapshot || !canEditInstructions) return;
    setInstructionError(null);
    try {
      if (instructionDraft === (snapshot.instructions ?? "")) {
        setEditInstructions(false);
        return;
      }
      if (persona && agent.personaId !== null) {
        const input: UpdatePersonaInput = {
          id: persona.id,
          displayName: persona.displayName,
          ...(persona.avatarUrl ? { avatarUrl: persona.avatarUrl } : {}),
          description: persona.description,
          systemPrompt: instructionDraft,
          ...(persona.runtime !== null ? { runtime: persona.runtime } : {}),
          ...(persona.model !== null ? { model: persona.model } : {}),
          ...(persona.provider !== null ? { provider: persona.provider } : {}),
          namePool: persona.namePool,
          envVars: persona.envVars,
          behavior: {
            ...(persona.respondTo ? { respondTo: persona.respondTo } : {}),
            respondToAllowlist: persona.respondToAllowlist,
            ...(persona.parallelism !== null
              ? { parallelism: persona.parallelism }
              : {}),
            ...(persona.sessionPolicy
              ? { sessionPolicy: persona.sessionPolicy }
              : {}),
          },
        };
        await updatePersonaMutation.mutateAsync(input);
      } else {
        await updateAgentMutation.mutateAsync({
          pubkey: employeePubkey,
          systemPrompt: instructionDraft,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["company-team"] });
      setEditInstructions(false);
    } catch (error) {
      setInstructionError(
        error instanceof Error
          ? error.message
          : "Instructions could not be saved.",
      );
    }
  }

  function cancelInstructionEdit() {
    setInstructionDraft(snapshot?.instructions ?? "");
    setEditInstructions(false);
  }

  function instructionsContent() {
    if (editInstructions) {
      return (
        <section
          className="max-w-[46rem]"
          data-testid="employee-instructions-editor"
        >
          <div className="mb-9 mt-2">
            <TeamPageTitle>Edit instructions</TeamPageTitle>
          </div>
          <form
            className="space-y-0"
            onSubmit={(event) => void saveInstructions(event)}
          >
            <label
              className="block space-y-3 text-sm font-medium"
              htmlFor="employee-system-instructions"
            >
              <span>System instructions</span>
              <Textarea
                id="employee-system-instructions"
                className="min-h-[5.25rem] text-sm leading-6"
                data-testid="employee-system-instructions"
                maxLength={20_000}
                onChange={(event) =>
                  setInstructionDraft(event.currentTarget.value)
                }
                value={instructionDraft}
              />
            </label>
            {instructionError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {instructionError}
              </p>
            ) : null}
            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-border pt-5">
              <Button
                disabled={
                  !canEditInstructions ||
                  updateAgentMutation.isPending ||
                  updatePersonaMutation.isPending
                }
                type="submit"
              >
                {updateAgentMutation.isPending ||
                updatePersonaMutation.isPending
                  ? "Saving"
                  : "Save changes"}
              </Button>
              <Button
                onClick={cancelInstructionEdit}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </form>
        </section>
      );
    }
    return (
      <section data-testid="employee-instructions">
        <div className="mb-0">
          <h2 className="text-lg font-semibold tracking-tight">
            System instructions
          </h2>
        </div>
        <div className="rounded-lg border border-border p-4">
          {snapshot?.instructions ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {snapshot.instructions}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No custom instructions.
            </p>
          )}
        </div>
        {canEditInstructions ? (
          <Button
            className="mt-3 h-10 w-full"
            onClick={() => setEditInstructions(true)}
            type="button"
          >
            Edit instructions
          </Button>
        ) : null}
      </section>
    );
  }

  if (reviewRehire && currentPosition && member.position && canManage) {
    return (
      <EmployeeRehireReview
        position={currentPosition}
        headEventId={member.position.event.id}
        managerName={managerName}
        fullName={fullName}
        onBack={() => setReviewRehire(false)}
      />
    );
  }

  if (!agent) {
    const positionStatus = currentPosition?.status;
    return (
      <TeamPage title={fullName} testId="company-position-unlinked">
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
        </Button>
        <div className="mb-8 text-xs text-muted-foreground">
          Company position
        </div>
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">
          Company position
        </h1>
        <div className="mb-8 flex items-center gap-4">
          <EmployeeAvatar
            name={fullName}
            profile={profile?.avatarUrl}
            definition={persona?.avatarUrl}
            testId="employee-header-avatar"
          />
          <div className="min-w-0">
            <p className="truncate text-base font-medium">{fullName}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Company position · No managed agent on this device
            </p>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,1fr)]">
          <section
            className="rounded-lg border border-border p-6"
            data-testid="company-position-record"
          >
            <h2 className="text-base font-semibold">Company record</h2>
            <dl className="mt-5 divide-y divide-border text-sm">
              <div className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(0,1fr)] gap-4 py-3">
                <dt className="text-muted-foreground">Title</dt>
                <dd className="min-w-0 break-words">
                  {currentPosition?.title ?? ""}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(0,1fr)] gap-4 py-3">
                <dt className="text-muted-foreground">Reports to</dt>
                <dd className="min-w-0 break-words">
                  {managerName ?? "Reporting line not set"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(0,1fr)] gap-4 py-3">
                <dt className="text-muted-foreground">Runtime status</dt>
                <dd>
                  {employeeRuntime.label}
                  {positionStatus !== "active" && currentPosition?.reason
                    ? ` · ${currentPosition.reason}`
                    : ""}
                </dd>
              </div>
            </dl>
          </section>
          <aside className="rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">Runtime not linked here</h2>
            {canManage ? (
              <div className="mt-3 space-y-3">
                <Button variant="outline" onClick={onEditPosition}>
                  Edit role and reporting
                </Button>
                {currentPosition && positionStatus !== "terminated" ? (
                  <Button variant="ghost" onClick={onTerminate}>
                    Terminate employee
                  </Button>
                ) : null}
                {positionStatus === "terminated" && currentPosition ? (
                  <Button
                    className="mt-3 h-11 rounded-company-control bg-colony-info text-xs shadow-none"
                    onClick={() => setReviewRehire(true)}
                  >
                    Review rehire
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-5 rounded-lg border-l-2 border-primary bg-muted/40 px-4 py-4">
              <p className="text-sm font-medium">
                This is not a deleted employee
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The position can exist without a local agent. Instructions,
                model and tools cannot be configured on this device yet.
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button disabled type="button">
                Connect a managed agent
              </Button>
            </div>
          </aside>
        </div>
      </TeamPage>
    );
  }

  if (editInstructions) {
    return (
      <TeamPage title="Edit instructions" testId="company-employee-profile">
        <button
          className="mb-4 inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
          onClick={cancelInstructionEdit}
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
        </button>
        {instructionsContent()}
      </TeamPage>
    );
  }

  return (
    <TeamPage title={fullName} testId="company-employee-profile">
      <button
        className="mb-4 inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
      </button>
      <div
        className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-4"
        data-testid="company-position-header"
      >
        <div className="flex min-w-0 items-center gap-4">
          <EmployeeAvatar
            name={fullName}
            profile={profile?.avatarUrl}
            instance={agent.avatarUrl}
            definition={persona?.avatarUrl}
            personaId={agent.personaId}
            className="size-12 shrink-0"
            testId="employee-header-avatar"
          />
          <div className="min-w-0">
            <TeamPageTitle>{fullName}</TeamPageTitle>
            <p className="mt-[1.875rem] truncate text-compact text-muted-foreground">
              {subtitle}
            </p>
          </div>
        </div>
      </div>
      <div
        aria-label="Employee profile"
        className="flex gap-6 overflow-x-auto border-b border-border"
        role="tablist"
      >
        {TABS.map((item) => (
          <button
            aria-controls="employee-profile-tabpanel"
            aria-selected={tab === item.id}
            className={`-mb-px shrink-0 border-b-2 px-0 py-2.5 text-xs ${tab === item.id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`employee-tab-${item.id}`}
            id={`employee-tab-${item.id}`}
            key={item.id}
            onClick={() => {
              setTab(item.id);
              setEditInstructions(false);
            }}
            tabIndex={tab === item.id ? 0 : -1}
            onKeyDown={handleTeamTabKeys}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`employee-tab-${tab}`}
        className="min-h-80 py-6"
        data-testid="employee-profile-tabpanel"
        id="employee-profile-tabpanel"
        role="tabpanel"
      >
        {tab === "overview" &&
        (status === "paused" || status === "terminated") ? (
          <section
            aria-label={
              status === "paused" ? "Paused employee" : "Terminated employee"
            }
            className="mb-5 border-l-2 border-border bg-muted p-[0.9375rem] text-xs"
            data-testid={
              status === "paused"
                ? "company-paused-banner"
                : "company-terminated-banner"
            }
          >
            <strong>
              {status === "paused" ? "Paused" : "Terminated employee"} ·{" "}
              {currentPosition?.reason}
            </strong>
            <p className="mt-1.5 text-muted-foreground">
              {status === "paused"
                ? "Existing work and history stay visible. Pausing employees is unavailable."
                : "Definition, lessons and history are retained. Rehire requires founder review."}
            </p>
            {status === "terminated" && canManage && currentPosition ? (
              <Button
                className="mt-3 h-11 rounded-company-control bg-colony-info text-xs shadow-none"
                onClick={() => setReviewRehire(true)}
              >
                Review rehire
              </Button>
            ) : null}
            {status === "terminated" &&
            canManage &&
            isManagedAgentActive(agent) ? (
              <Button variant="outline" className="mt-3" onClick={onTerminate}>
                Retry stopping runtime
              </Button>
            ) : null}
          </section>
        ) : null}
        {tab === "overview" ? (
          <CompanyEmployeeProfileActions
            canManage={canManage}
            employeePubkey={employeePubkey}
            managerName={managerName}
            onEdit={onEditPosition}
            onOpenReport={onOpenMember}
            onTerminate={onTerminate}
            position={currentPosition}
            profilePage
          />
        ) : null}
        {tab === "instructions" ? instructionsContent() : null}
        {tab === "model-runtime" ? (
          <section data-testid="employee-model-runtime">
            <h2 className="sr-only">Model & runtime</h2>
            <EmployeeRuntimeSummary agent={agent} />
            {canEdit ? (
              <Button
                className="mt-5 h-auto min-h-10 rounded-md bg-colony-info px-[0.9375rem] py-[0.6875rem] text-xs shadow-none hover:bg-colony-info/90"
                onClick={() => setRuntimeDialogOpen(true)}
                type="button"
              >
                Configure runtime
              </Button>
            ) : null}
            <AgentInstanceEditDialog
              agent={agent}
              onOpenChange={setRuntimeDialogOpen}
              open={runtimeDialogOpen}
            />
          </section>
        ) : null}
      </div>
    </TeamPage>
  );
}
