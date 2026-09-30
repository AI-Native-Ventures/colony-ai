import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquare } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useIsManagedAgent } from "@/features/agent-memory/hooks";
import {
  MemoryRefreshButton,
  MemorySection,
} from "@/features/agent-memory/ui/MemorySection";
import {
  useAcpRuntimesQuery,
  usePersonasQuery,
  useUpdateManagedAgentMutation,
  useUpdatePersonaMutation,
} from "@/features/agents/hooks";
import { runtimeForAgent } from "@/features/agents/agentDirectoryModel";
import { AgentConfigPanel } from "@/features/agents/ui/AgentConfigPanel";
import { AgentInstanceEditDialog } from "@/features/agents/ui/AgentInstanceEditDialog";
import { ModelPicker } from "@/features/agents/ui/ModelPicker";
import { useCompanyWorkHeadsQuery } from "@/features/company-work/hooks";
import { useOpenDmMutation } from "@/features/channels/hooks";
import { fetchSecretBindings } from "@/features/company-secrets/secretBindings";
import { ToolPermissionList } from "@/features/company-permissions/ui/ToolPermissionScreen";
import {
  fetchEmployeeHistory,
  useEmployeeHistoryQuery,
  useRecordEmployeeRevisionMutation,
  type EmployeeConfigSnapshot,
  type EmployeeHistory,
  type EmployeeRevision,
  type EmployeeRevisionAction,
  type PendingEmployeeRevision,
} from "../employeeHistory";
import { CompanyEmployeeProfileActions } from "./CompanyEmployeeProfileActions";
import { EmployeeSalaryPanel } from "@/features/power/EmployeeAllowanceScreens";
import { EmployeeHistoryPanel } from "./EmployeeHistoryPanel";
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
import { Badge } from "@/shared/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Textarea } from "@/shared/ui/textarea";
import { truncateNpub } from "@/shared/lib/pubkey";

type EmployeeTab =
  | "overview"
  | "instructions"
  | "model-runtime"
  | "tools-access"
  | "activity"
  | "salary"
  | "workers"
  | "duties"
  | "lessons"
  | "history";

const TABS: Array<{ id: EmployeeTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
  { id: "model-runtime", label: "Model & runtime" },
  { id: "tools-access", label: "Tools & access" },
  { id: "activity", label: "Activity" },
  { id: "salary", label: "Salary" },
  { id: "workers", label: "Workers" },
  { id: "duties", label: "Duties" },
  { id: "lessons", label: "Lessons" },
  { id: "history", label: "History" },
];

type ProfileSummary = {
  displayName: string | null;
  avatarUrl: string | null;
  ownerPubkey?: string | null;
};

function sameSnapshot(
  first: EmployeeConfigSnapshot,
  second: EmployeeConfigSnapshot,
) {
  return JSON.stringify(first) === JSON.stringify(second);
}

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

function pendingKey(employeePubkey: string) {
  return `company-employee-history-pending:${employeePubkey.toLowerCase()}`;
}

function readPendingRevisions(
  employeePubkey: string,
): PendingEmployeeRevision[] {
  try {
    const raw = localStorage.getItem(pendingKey(employeePubkey));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingEmployeeRevision =>
        typeof item === "object" &&
        item !== null &&
        typeof item.pendingId === "string" &&
        typeof item.actorPubkey === "string" &&
        typeof item.action === "object" &&
        item.action !== null &&
        item.action.employeePubkey === employeePubkey.toLowerCase(),
    );
  } catch {
    return [];
  }
}

function queuePendingRevision(
  employeePubkey: string,
  actorPubkey: string,
  action: EmployeeRevisionAction,
) {
  const current = readPendingRevisions(employeePubkey);
  const next = [
    ...current,
    { pendingId: crypto.randomUUID(), actorPubkey, action },
  ];
  if (next.length > 25) {
    throw new Error(
      "Employee history retry queue is full. Keep this screen open and retry.",
    );
  }
  localStorage.setItem(pendingKey(employeePubkey), JSON.stringify(next));
}

function removePendingRevision(employeePubkey: string, index: number) {
  const pending = readPendingRevisions(employeePubkey);
  pending.splice(index, 1);
  if (pending.length === 0) localStorage.removeItem(pendingKey(employeePubkey));
  else
    localStorage.setItem(pendingKey(employeePubkey), JSON.stringify(pending));
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

function unavailableState(title: string) {
  return (
    <section
      className="rounded-lg border border-border p-5"
      data-testid={`employee-unavailable-${title.toLowerCase()}`}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">Not available yet.</p>
    </section>
  );
}

export function EmployeeProfileScreen({
  member,
  fullName,
  profiles,
  teamData,
  initialTab,
  canManage,
  onBack,
  onEditPosition,
  onOpenMember,
  onPause,
  onTerminate,
  onEditSalary,
}: {
  member: TeamMember;
  fullName: string;
  profiles: Record<string, ProfileSummary>;
  teamData: CompanyTeamData;
  initialTab?: "overview" | "salary";
  canManage: boolean;
  onBack: () => void;
  onEditPosition: () => void;
  onOpenMember: (pubkey: string) => void;
  onPause: () => void;
  onTerminate: () => void;
  onEditSalary: () => void;
}) {
  const agent = member.managedAgent;
  const identity = useIdentityQuery();
  const { goChannel, goCompanyWorkDetail } = useAppNavigation();
  const openDm = useOpenDmMutation();
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const workQuery = useCompanyWorkHeadsQuery(true);
  const employeePubkey = member.pubkey.toLowerCase();
  const queryClient = useQueryClient();
  const historyQuery = useEmployeeHistoryQuery(employeePubkey);
  const recordMutation = useRecordEmployeeRevisionMutation(employeePubkey);
  const updateAgentMutation = useUpdateManagedAgentMutation();
  const updatePersonaMutation = useUpdatePersonaMutation();
  const managedOwner = useIsManagedAgent(employeePubkey);
  const profileQuery = useUsersBatchQuery([employeePubkey]);
  const profile =
    profiles[employeePubkey] ?? profileQuery.data?.profiles[employeePubkey];
  const persona = personasQuery.data?.find(
    (candidate) => candidate.id === agent?.personaId,
  );
  const runtimes = runtimesQuery.data ?? [];
  const snapshot = agent ? employeeSnapshot(agent, persona, runtimes) : null;
  const actorPubkey = identity.data?.pubkey.toLowerCase() ?? "";
  const viewerIsMemoryOwner =
    managedOwner === true ||
    profile?.ownerPubkey?.toLowerCase() === actorPubkey;
  const currentPosition = member.position?.head;
  const actorPosition = teamData.members.find(
    (candidate) => candidate.pubkey === actorPubkey,
  )?.position?.head;
  const actorRole = teamData.relayMembers.find(
    (candidate) => candidate.pubkey.toLowerCase() === actorPubkey,
  )?.role;
  const canUndo =
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
  const status = currentPosition?.status ?? "active";
  const subtitle = [
    currentPosition?.title || "Employee",
    "Employee",
    status,
  ].join(" · ");
  const relaySelf = teamData.relaySelf;
  const secretsQuery = useQuery({
    queryKey: ["company-secret-bindings", relaySelf],
    queryFn: () => fetchSecretBindings(relaySelf),
    enabled: Boolean(relaySelf),
    staleTime: 15_000,
  });
  const [tab, setTab] = React.useState<EmployeeTab>(initialTab ?? "overview");
  const [editInstructions, setEditInstructions] = React.useState(false);
  const [instructionDraft, setInstructionDraft] = React.useState("");
  const [instructionError, setInstructionError] = React.useState<string | null>(
    null,
  );
  const [notice, setNotice] = React.useState<string | null>(null);
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [isOpeningMessage, setIsOpeningMessage] = React.useState(false);
  const [runtimeDialogOpen, setRuntimeDialogOpen] = React.useState(false);
  const [runtimeDialogBefore, setRuntimeDialogBefore] =
    React.useState<EmployeeConfigSnapshot | null>(null);
  const [pendingRevisions, setPendingRevisions] = React.useState<
    PendingEmployeeRevision[]
  >([]);
  const [pendingError, setPendingError] = React.useState<string | null>(null);
  const [configError, setConfigError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setInstructionDraft(snapshot?.instructions ?? "");
    setInstructionError(null);
  }, [snapshot?.instructions]);

  React.useEffect(() => {
    setPendingRevisions(readPendingRevisions(employeePubkey));
  }, [employeePubkey]);

  const canEditInstructions = Boolean(
    canUndo &&
      agent &&
      (agent.personaId === null ||
        (persona && !persona.isBuiltIn && !persona.sourceTeam)),
  );
  const secretBindings = (secretsQuery.data ?? []).filter(
    (record) =>
      record.head.binding.employeePubkey.toLowerCase() === employeePubkey,
  );
  const workRecords = (workQuery.data ?? [])
    .filter(
      (record) =>
        record.head.assignedPubkeys.some(
          (pubkey) => pubkey.toLowerCase() === employeePubkey,
        ) &&
        record.head.status !== "archived" &&
        record.head.status !== "done_verified",
    )
    .sort((first, second) => second.event.created_at - first.event.created_at);
  const currentWorkRecords = workRecords.filter((record) =>
    ["active", "paused", "blocked", "done_unverified"].includes(
      record.head.status,
    ),
  );

  function buildRecordAction(
    before: EmployeeConfigSnapshot,
    after: EmployeeConfigSnapshot,
    history: EmployeeHistory,
  ): EmployeeRevisionAction | null {
    if (sameSnapshot(before, after)) return null;
    if (history.head && !sameSnapshot(history.head.snapshot, before)) {
      throw new Error(
        "The saved configuration does not match the current history head. Refresh the employee profile and retry.",
      );
    }
    return {
      schemaVersion: 1,
      employeePubkey,
      action: "record",
      ...(history.headEvent && history.head
        ? {
            expectedHeadEventId: history.headEvent.id,
            previousRevisionEventId: history.head.revisionEventId,
          }
        : {}),
      before,
      after,
    };
  }

  async function recordOrQueue(action: EmployeeRevisionAction) {
    try {
      await recordMutation.mutateAsync(action);
      setPendingError(null);
      setPendingRevisions(readPendingRevisions(employeePubkey));
    } catch (error) {
      if (!actorPubkey) throw error;
      queuePendingRevision(employeePubkey, actorPubkey, action);
      setPendingRevisions(readPendingRevisions(employeePubkey));
      setPendingError(
        error instanceof Error
          ? error.message
          : "Employee history could not sync.",
      );
      setNotice(
        "The configuration was saved. Its history change is waiting to sync.",
      );
    }
  }

  async function saveInstructions(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agent || !snapshot || !canEditInstructions) return;
    setInstructionError(null);
    setNotice(null);
    try {
      const history = await fetchEmployeeHistory(employeePubkey);
      const after = normalizedSnapshot({
        instructions: instructionDraft,
        provider: snapshot.provider,
        model: snapshot.model,
        runtime: snapshot.runtime,
      });
      const action = buildRecordAction(snapshot, after, history);
      if (!action) {
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
      await recordOrQueue(action);
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

  async function openRuntimeEditor() {
    if (!agent || !snapshot || !canUndo) return;
    setConfigError(null);
    try {
      const history = await fetchEmployeeHistory(employeePubkey);
      if (history.head && !sameSnapshot(history.head.snapshot, snapshot)) {
        throw new Error(
          "The saved configuration does not match the current history head. Refresh the employee profile and retry.",
        );
      }
      setRuntimeDialogBefore(snapshot);
      setRuntimeDialogOpen(true);
    } catch (error) {
      setConfigError(
        error instanceof Error
          ? error.message
          : "Employee configuration could not be loaded.",
      );
    }
  }

  async function recordRuntimeUpdate(updatedAgent: ManagedAgent) {
    if (!runtimeDialogBefore) return;
    const updatedPersona = personasQuery.data?.find(
      (candidate) => candidate.id === updatedAgent.personaId,
    );
    const after = employeeSnapshot(updatedAgent, updatedPersona, runtimes);
    try {
      const history = await fetchEmployeeHistory(employeePubkey);
      const action = buildRecordAction(runtimeDialogBefore, after, history);
      if (action) await recordOrQueue(action);
    } catch (error) {
      setConfigError(
        error instanceof Error
          ? error.message
          : "Configuration history could not be recorded.",
      );
    }
    setRuntimeDialogBefore(null);
  }

  async function recordModelUpdate(change: {
    beforeModel: string | null;
    afterModel: string | null;
  }) {
    if (!agent || !snapshot) return;
    const before = normalizedSnapshot({
      instructions: snapshot.instructions,
      provider: snapshot.provider,
      model: change.beforeModel ?? snapshot.model,
      runtime: snapshot.runtime,
    });
    const after = normalizedSnapshot({
      instructions: snapshot.instructions,
      provider: snapshot.provider,
      model: change.afterModel,
      runtime: snapshot.runtime,
    });
    try {
      const history = await fetchEmployeeHistory(employeePubkey);
      const action = buildRecordAction(before, after, history);
      if (action) await recordOrQueue(action);
    } catch (error) {
      setConfigError(
        error instanceof Error
          ? error.message
          : "Model history could not be recorded.",
      );
    }
  }

  async function retryPendingRevision(index: number) {
    const pending = pendingRevisions[index];
    if (!pending || pending.actorPubkey.toLowerCase() !== actorPubkey) return;
    setPendingError(null);
    try {
      const history = await fetchEmployeeHistory(employeePubkey);
      const latest = history.revisions.at(-1);
      if (
        history.head &&
        latest &&
        history.head.actorPubkey === pending.actorPubkey &&
        sameSnapshot(history.head.snapshot, pending.action.after) &&
        latest.action.action === pending.action.action &&
        latest.action.undoOfEventId === pending.action.undoOfEventId
      ) {
        removePendingRevision(employeePubkey, index);
        setPendingRevisions(readPendingRevisions(employeePubkey));
        return;
      }
      await recordMutation.mutateAsync(pending.action);
      removePendingRevision(employeePubkey, index);
      setPendingRevisions(readPendingRevisions(employeePubkey));
    } catch (error) {
      setPendingError(
        error instanceof Error
          ? error.message
          : "Employee history could not sync.",
      );
    }
  }

  async function applySnapshot(target: EmployeeConfigSnapshot) {
    if (!agent || (!persona && agent.personaId !== null)) {
      throw new Error(
        "The employee configuration is unavailable on this device.",
      );
    }
    if (persona && agent.personaId !== null) {
      await updatePersonaMutation.mutateAsync({
        id: persona.id,
        displayName: persona.displayName,
        ...(persona.avatarUrl ? { avatarUrl: persona.avatarUrl } : {}),
        description: persona.description,
        systemPrompt: target.instructions ?? "",
        runtime: target.runtime ?? "",
        model: target.model ?? "",
        provider: target.provider ?? "",
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
      });
      return;
    }
    const runtimeEntry = target.runtime
      ? runtimes.find((candidate) => candidate.id === target.runtime)
      : null;
    if (target.runtime && !runtimeEntry) {
      throw new Error(
        "The historical runtime is not available in the current runtime catalog.",
      );
    }
    await updateAgentMutation.mutateAsync({
      pubkey: employeePubkey,
      systemPrompt: target.instructions ?? null,
      model: target.model ?? null,
      provider: target.provider ?? null,
      agentCommand: runtimeEntry?.command ?? "",
      harnessOverride: Boolean(runtimeEntry),
    });
  }

  async function applyUndo(target: EmployeeRevision) {
    if (!historyQuery.data?.head || !historyQuery.data.headEvent || !canUndo) {
      throw new Error("Employee history changed. Refresh and try again.");
    }
    const currentHead = historyQuery.data.head;
    const action: EmployeeRevisionAction = {
      schemaVersion: 1,
      employeePubkey,
      action: "undo",
      expectedHeadEventId: historyQuery.data.headEvent.id,
      previousRevisionEventId: currentHead.revisionEventId,
      before: currentHead.snapshot,
      after: target.action.before,
      undoOfEventId: target.event.id,
    };
    await applySnapshot(target.action.before);
    await recordOrQueue(action);
  }

  async function messageEmployee() {
    if (isOpeningMessage) return;
    setMessageError(null);
    setIsOpeningMessage(true);
    try {
      const channel = await openDm.mutateAsync({ pubkeys: [employeePubkey] });
      await goChannel(channel.id);
    } catch (error) {
      setMessageError(
        error instanceof Error
          ? error.message
          : "Could not open a message with this employee.",
      );
    } finally {
      setIsOpeningMessage(false);
    }
  }

  function workContent() {
    if (workQuery.isLoading)
      return (
        <p className="text-sm text-muted-foreground" role="status">
          Loading work
        </p>
      );
    if (workQuery.isError)
      return (
        <p className="text-sm text-destructive" role="alert">
          Work could not be loaded.
        </p>
      );
    if (currentWorkRecords.length === 0)
      return (
        <p className="text-sm text-muted-foreground">No current commitments.</p>
      );
    return (
      <div className="divide-y divide-border rounded-lg border border-border">
        {currentWorkRecords.map((record) => {
          const channelName = workQuery.channelsQuery.data?.find(
            (channel) =>
              channel.id.toLowerCase() === record.channelId.toLowerCase(),
          )?.name;
          return (
            <button
              className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/30"
              data-testid={`employee-work-${record.head.workItemId}`}
              key={record.head.workItemId}
              onClick={() => void goCompanyWorkDetail(record.head.workItemId)}
              type="button"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {record.head.title}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {channelName
                    ? `#${channelName}`
                    : `channel:${record.channelId}`}
                </span>
              </span>
              <Badge
                variant={
                  record.head.status === "blocked" ? "warning" : "outline"
                }
              >
                {record.head.status.replaceAll("_", " ")}
              </Badge>
            </button>
          );
        })}
      </div>
    );
  }

  function instructionsContent() {
    if (editInstructions) {
      return (
        <section
          className="max-w-[46rem]"
          data-testid="employee-instructions-editor"
        >
          <h1 className="mb-9 text-2xl font-semibold tracking-tight">
            Edit instructions
          </h1>
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
        <p className="mt-4 text-xs text-muted-foreground">
          Edits are recorded as revisions in History.
        </p>
      </section>
    );
  }

  if (!agent) {
    return null;
  }

  if (editInstructions) {
    return (
      <main
        className="mx-auto w-full max-w-[72rem] px-6 py-8 xl:px-0"
        data-testid="company-employee-profile"
      >
        <div className="mb-8 text-xs text-muted-foreground">
          Company / Edit instructions
        </div>
        <button
          className="mb-6 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={cancelInstructionEdit}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Back
        </button>
        {instructionsContent()}
      </main>
    );
  }

  const historyNeedsSync = pendingRevisions.length > 0;

  return (
    <main
      className="mx-auto w-full max-w-[72rem] px-6 py-8 xl:px-0"
      data-testid="company-employee-profile"
    >
      <div className="mb-8 text-xs text-muted-foreground">
        Company / {fullName}
      </div>
      <button
        className="mb-6 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" /> Back
      </button>
      <div
        className="mb-9 flex flex-wrap items-center justify-between gap-4"
        data-testid="company-position-header"
      >
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {fullName}
          </h1>
          <p className="mt-8 truncate text-sm text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            disabled={isOpeningMessage}
            onClick={() => void messageEmployee()}
            type="button"
            variant="outline"
          >
            <MessageSquare aria-hidden="true" className="mr-2 size-4" />
            {isOpeningMessage ? "Opening" : "Message"}
          </Button>
        </div>
      </div>
      {status === "paused" ? (
        <Alert className="mb-6" data-testid="company-paused-banner">
          <AlertTitle>Paused · {currentPosition?.reason}</AlertTitle>
          <AlertDescription>
            Existing work stays visible. Resume when the reason is resolved.
          </AlertDescription>
        </Alert>
      ) : null}
      {status === "terminated" ? (
        <Alert className="mb-6" data-testid="company-terminated-banner">
          <AlertTitle>
            Terminated employee · {currentPosition?.reason}
          </AlertTitle>
          <AlertDescription>
            Definition, lessons and history are retained. Rehire requires
            founder review.
          </AlertDescription>
        </Alert>
      ) : null}
      {messageError ? (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {messageError}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {configError ? (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {configError}
        </p>
      ) : null}
      {historyNeedsSync ? (
        <p className="sr-only" data-testid="employee-history-needs-sync">
          History waiting to sync
        </p>
      ) : null}
      <div
        aria-label="Employee profile"
        className="flex gap-5 overflow-x-auto border-b border-border"
        role="tablist"
      >
        {TABS.map((item) => (
          <button
            aria-controls="employee-profile-tabpanel"
            aria-selected={tab === item.id}
            className={`-mb-px shrink-0 border-b-2 px-1 pb-3 text-sm ${tab === item.id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`employee-tab-${item.id}`}
            id={`employee-tab-${item.id}`}
            key={item.id}
            onClick={() => {
              setTab(item.id);
              setEditInstructions(false);
            }}
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
        {tab === "overview" ? (
          <>
            <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
              <section
                aria-labelledby="employee-doing-now-heading"
                data-testid="employee-doing-now"
              >
                <h2
                  className="mb-4 text-base font-semibold"
                  id="employee-doing-now-heading"
                >
                  Doing now
                </h2>
                {workContent()}
              </section>
              <aside
                className="rounded-lg border border-border p-4"
                data-testid="employee-salary-overview-unavailable"
              >
                <h2 className="text-base font-semibold">Weekly salary</h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  Not available yet.
                </p>
              </aside>
            </div>
            <CompanyEmployeeProfileActions
              canManage={canManage}
              employeePubkey={employeePubkey}
              managerName={managerName}
              onEdit={onEditPosition}
              onOpenReport={onOpenMember}
              onPause={onPause}
              onTerminate={onTerminate}
              position={currentPosition}
            />
          </>
        ) : null}
        {tab === "instructions" ? instructionsContent() : null}
        {tab === "model-runtime" ? (
          <section data-testid="employee-model-runtime">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight">
                Model & runtime
              </h2>
              {canUndo ? (
                <Button onClick={() => void openRuntimeEditor()} type="button">
                  Configure runtime
                </Button>
              ) : null}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-lg border border-border p-4">
                <h3 className="mb-3 text-sm font-semibold">Lead model</h3>
                <ModelPicker
                  agent={agent}
                  onModelChanged={recordModelUpdate}
                  readOnly={!canUndo}
                />
              </section>
              <AgentConfigPanel
                advancedMode="flat"
                pubkey={employeePubkey}
                sections={["model", "advanced"]}
              />
            </div>
            <p className="mt-5 border-l-2 border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Takeover can expand execution access only through a recorded
              authorization. This review does not silently enable takeover.
            </p>
            {configError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {configError}
              </p>
            ) : null}
            <AgentInstanceEditDialog
              agent={agent}
              onOpenChange={(open) => {
                setRuntimeDialogOpen(open);
                if (!open) setRuntimeDialogBefore(null);
              }}
              onUpdated={recordRuntimeUpdate}
              open={runtimeDialogOpen}
            />
          </section>
        ) : null}
        {tab === "tools-access" ? (
          <section data-testid="employee-tools-access">
            <h2 className="mb-5 text-lg font-semibold tracking-tight">
              Tools & access
            </h2>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-lg border border-border p-4">
                <h3 className="mb-2 text-sm font-semibold">
                  Tools available to scoped workers
                </h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Lead tools: None by default.
                </p>
                <AgentConfigPanel
                  advancedMode="flat"
                  pubkey={employeePubkey}
                  sections={["mcp"]}
                />
              </section>
              <section
                className="rounded-lg border border-border p-4"
                data-testid="employee-bound-secrets"
              >
                <h3 className="text-sm font-semibold">Bound secrets</h3>
                {secretsQuery.isPending ? (
                  <p
                    className="mt-3 text-sm text-muted-foreground"
                    role="status"
                  >
                    Loading bound secrets
                  </p>
                ) : secretsQuery.isError ? (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    Bound secret metadata could not be loaded.
                  </p>
                ) : secretBindings.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No bound secrets.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-border">
                    {secretBindings.map((record) => (
                      <li className="py-3" key={record.head.binding.bindingId}>
                        <p className="text-sm font-medium">
                          {record.head.binding.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {record.head.binding.toolName} ·{" "}
                          {record.head.binding.storage} storage ·{" "}
                          {record.head.status}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {record.head.binding.allowedUse}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Secret values are never shown here.
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <ToolPermissionList agentPubkey={employeePubkey} />
          </section>
        ) : null}
        {tab === "activity" ? (
          <section data-testid="employee-activity">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">
              Activity
            </h2>
            {workContent()}
          </section>
        ) : null}
        {tab === "salary" ? (
          <EmployeeSalaryPanel
            canManage={canManage}
            employee={member}
            employees={teamData.members}
            onEdit={onEditSalary}
          />
        ) : null}
        {tab === "workers" ? unavailableState("Workers") : null}
        {tab === "duties" ? unavailableState("Duties") : null}
        {tab === "lessons" ? (
          <section data-testid="employee-lessons">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">
              Lessons
            </h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Not available yet.
            </p>
            <div className="border-t border-border pt-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h3 className="text-base font-semibold">Memory</h3>
                <MemoryRefreshButton
                  agentPubkey={employeePubkey}
                  viewerIsOwner={viewerIsMemoryOwner}
                  showLabel
                  variant="outline"
                />
              </div>
              {managedOwner === undefined && profileQuery.isPending ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Loading memory access
                </p>
              ) : viewerIsMemoryOwner ? (
                <MemorySection
                  agentPubkey={employeePubkey}
                  variant="grouped"
                  viewerIsOwner
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Memory is available to the agent owner.
                </p>
              )}
            </div>
          </section>
        ) : null}
        {tab === "history" ? (
          <EmployeeHistoryPanel
            actorPubkey={actorPubkey}
            canUndo={canUndo}
            historyQuery={historyQuery}
            pendingError={pendingError}
            pendingRevisions={pendingRevisions}
            undoPending={
              recordMutation.isPending ||
              updateAgentMutation.isPending ||
              updatePersonaMutation.isPending
            }
            onRetryPending={(index) => void retryPendingRevision(index)}
            onUndo={applyUndo}
          />
        ) : null}
      </div>
    </main>
  );
}
