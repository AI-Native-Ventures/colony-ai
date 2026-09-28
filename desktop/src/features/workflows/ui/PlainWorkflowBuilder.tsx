import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  Pause,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { stringify as yamlStringify } from "yaml";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  useWorkflowQuery,
  useWorkflowRunsQuery,
  workflowQueryKey,
} from "@/features/workflows/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  getWorkflowDraft,
  previewWorkflow,
  publishWorkflowDraft,
  saveWorkflowDraft,
  setWorkflowStatus,
} from "@/shared/api/tauriWorkflows";
import type {
  Channel,
  ChannelMember,
  WorkflowDraft as WorkflowDraftRecord,
  WorkflowPreview,
  WorkflowRun,
} from "@/shared/api/types";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/cn";
import { WorkflowUnavailableDialog } from "./WorkflowUnavailableDialog";
import {
  definitionToPlainDraft,
  plainDraftMatchesDefinition,
  plainDraftToDefinition,
  plainScheduleDescription,
  type PlainAgentStep,
  type PlainApprovalStep,
  type PlainWorkflowDraft,
  type PlainWorkflowStep,
} from "./plainWorkflowModel";
import type { WorkflowEditorRoute } from "./WorkflowsScreen";

type PlainWorkflowBuilderProps = {
  channels: Channel[];
  editor: WorkflowEditorRoute;
  onClose: () => void;
};

type BuilderScreen =
  | "describe"
  | "timing"
  | "steps"
  | "step"
  | "remove"
  | "preview"
  | "review"
  | "detail"
  | "pause"
  | "unsupported";

type EditableStep = PlainWorkflowStep;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function newWorkflowId(): string {
  return crypto.randomUUID();
}

function newStepId(): string {
  return `step_${crypto.randomUUID().replaceAll("-", "")}`;
}

function emptyDraft(workflowId: string, channelId: string): PlainWorkflowDraft {
  return {
    workflowId,
    channelId,
    name: "",
    description: "",
    schedule: { frequency: "weekly", day: 1, time: "08:00" },
    steps: [],
  };
}

function isAdminRole(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

function workflowDraftQueryKey(workflowId: string) {
  return ["workflow-draft", workflowId] as const;
}

function memberLabel(
  member: ChannelMember,
  profiles: Record<string, { displayName: string | null }> | undefined,
) {
  return (
    member.displayName?.trim() ||
    profiles?.[member.pubkey.toLowerCase()]?.displayName?.trim() ||
    `${member.pubkey.slice(0, 8)}…`
  );
}

function memberRoleLabel(member: ChannelMember): string {
  return member.isAgent ? "AI agent" : "Human";
}

function getCandidates(members: ChannelMember[], kind: EditableStep["kind"]) {
  return members.filter((member) =>
    kind === "agent" ? member.isAgent : !member.isAgent,
  );
}

function selectedPubkey(step: EditableStep): string {
  return step.kind === "agent" ? step.assigneePubkey : step.reviewerPubkey;
}

function withSelectedPubkey(step: EditableStep, pubkey: string): EditableStep {
  return step.kind === "agent"
    ? { ...step, assigneePubkey: pubkey }
    : { ...step, reviewerPubkey: pubkey };
}

function ProfileChip({
  member,
  profiles,
  onOpen,
}: {
  member: ChannelMember | undefined;
  profiles: Record<string, { displayName: string | null }> | undefined;
  onOpen: (pubkey: string) => void;
}) {
  if (!member) {
    return (
      <span className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
        Person unavailable in this channel
      </span>
    );
  }
  const label = memberLabel(member, profiles);
  return (
    <button
      aria-label={`View ${label} profile`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(member.pubkey)}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
          member.isAgent
            ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
            : "bg-primary/10 text-primary",
        )}
      >
        {label.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">
        {memberRoleLabel(member)}
      </span>
    </button>
  );
}

function BuilderHeader({
  title,
  description,
  onBack,
  onClose,
  canManage,
  onAdvanced,
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  onClose: () => void;
  canManage: boolean;
  onAdvanced: () => void;
}) {
  return (
    <header className="border-b border-border/70 px-5 py-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Button
              aria-label="Back to workflows"
              className="-ml-2 h-8 px-2"
              onClick={onBack ?? onClose}
              size="sm"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            <span aria-hidden="true">/</span>
            <span>Workflows</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <Button
            className="shrink-0"
            onClick={onAdvanced}
            size="sm"
            variant="outline"
          >
            <WorkflowIcon aria-hidden="true" />
            Advanced editor
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const generatedId = React.useId();
  const id = children.props.id ?? generatedId;
  return (
    <div className="block space-y-2 text-sm font-medium text-foreground">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
    </div>
  );
}

function DetailStep({
  index,
  step,
  members,
  profiles,
  onOpenProfile,
}: {
  index: number;
  step: PlainWorkflowStep;
  members: ChannelMember[];
  profiles: Record<string, { displayName: string | null }> | undefined;
  onOpenProfile: (pubkey: string) => void;
}) {
  const member = members.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() ===
      (step.kind === "agent"
        ? step.assigneePubkey
        : step.reviewerPubkey
      ).toLowerCase(),
  );
  return (
    <li className="flex gap-4 border-b border-border/70 py-5 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {step.kind === "agent" ? "Prepare something" : "Ask for approval"}
          </span>
        </div>
        <h2 className="text-base font-semibold text-foreground">
          {step.title ||
            (step.kind === "agent" ? "Prepare a result" : "Review this step")}
        </h2>
        <ProfileChip
          member={member}
          onOpen={onOpenProfile}
          profiles={profiles}
        />
        <p className="text-sm leading-6 text-muted-foreground">
          {step.kind === "agent" ? step.instruction : step.message}
        </p>
        {step.kind === "agent" && step.expectedResult ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Ready when: {step.expectedResult}
          </p>
        ) : null}
        {step.kind === "approval" ? (
          <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            The run waits for this person’s approval.
          </p>
        ) : null}
      </div>
    </li>
  );
}

function RunHistory({ runs }: { runs: WorkflowRun[] | undefined }) {
  if (!runs?.length) {
    return (
      <div className="rounded-xl border border-border/70 px-5 py-6">
        <h2 className="text-base font-semibold">Run history</h2>
        <p className="mt-2 text-sm text-muted-foreground">No runs yet.</p>
      </div>
    );
  }
  return (
    <section aria-labelledby="workflow-run-history-title">
      <h2
        className="mb-3 text-base font-semibold"
        id="workflow-run-history-title"
      >
        Run history
      </h2>
      <ul className="divide-y divide-border rounded-xl border border-border/70">
        {runs.map((run) => (
          <li
            className="flex items-center justify-between gap-4 px-4 py-3"
            key={run.id}
          >
            <span className="text-sm text-foreground">
              {run.status.replaceAll("_", " ")}
            </span>
            <time
              className="text-xs text-muted-foreground"
              dateTime={
                run.createdAt
                  ? new Date(run.createdAt * 1000).toISOString()
                  : undefined
              }
            >
              {run.createdAt
                ? new Intl.DateTimeFormat("en-ZA", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(run.createdAt * 1000))
                : ""}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlainWorkflowBuilder({
  channels,
  editor,
  onClose,
}: PlainWorkflowBuilderProps) {
  const queryClient = useQueryClient();
  const membershipQuery = useMyRelayMembershipQuery();
  const identityQuery = useIdentityQuery();
  const canManage = isAdminRole(membershipQuery.data?.role);
  const initialChannelId =
    editor.mode === "create"
      ? (editor.initialChannelId ?? channels[0]?.id ?? "")
      : "";
  const [createdWorkflowId] = React.useState(newWorkflowId);
  const workflowId =
    editor.mode === "create" ? createdWorkflowId : editor.workflowId;
  const [screen, setScreen] = React.useState<BuilderScreen>(() =>
    editor.mode === "create"
      ? "describe"
      : editor.mode === "duplicate"
        ? "unsupported"
        : editor.mode === "detail"
          ? "detail"
          : "steps",
  );
  const [draft, setDraft] = React.useState<PlainWorkflowDraft>(() => {
    const initialDraft = emptyDraft(workflowId, initialChannelId);
    if (editor.mode === "create" && editor.starting === "example") {
      initialDraft.name = "Weekly content plan";
      initialDraft.description =
        "Prepare the weekly content plan, then request approval.";
    }
    return initialDraft;
  });
  const [startFromExample, setStartFromExample] = React.useState(
    editor.mode === "create" && editor.starting === "example",
  );
  const [stepEditor, setStepEditor] = React.useState<{
    step: EditableStep;
    index: number | null;
  } | null>(null);
  const [removeIndex, setRemoveIndex] = React.useState<number | null>(null);
  const [preview, setPreview] = React.useState<WorkflowPreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [changingStatus, setChangingStatus] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmReviewed, setConfirmReviewed] = React.useState(false);
  const [draftRevision, setDraftRevision] = React.useState<string | null>(null);
  const initialized = React.useRef(
    editor.mode === "create" || editor.mode === "duplicate",
  );
  const workflowQuery = useWorkflowQuery(
    editor.mode === "create" ? null : workflowId,
  );
  const draftQuery = useQuery({
    enabled: editor.mode !== "create",
    queryKey: workflowDraftQueryKey(workflowId),
    queryFn: () => getWorkflowDraft(workflowId),
    staleTime: 30_000,
  });
  const workflow = workflowQuery.data;
  const isWorkflowOwner =
    workflow?.ownerPubkey?.toLowerCase() ===
    identityQuery.data?.pubkey?.toLowerCase();
  const memberQuery = useChannelMembersQuery(draft.channelId || null);
  const members = memberQuery.data ?? [];
  const pubkeys = React.useMemo(
    () => members.map((member) => member.pubkey),
    [members],
  );
  const profilesQuery = useUsersBatchQuery(pubkeys);
  const profiles = profilesQuery.data?.profiles;
  const { openProfilePanel } = useProfilePanel();
  const { goAdvancedWorkflow, goEditWorkflow, goWorkflow } = useAppNavigation();
  const runsQuery = useWorkflowRunsQuery(
    screen === "detail" && editor.mode !== "create" ? workflowId : null,
  );

  React.useEffect(() => {
    if (initialized.current || editor.mode === "create") return;
    if (workflowQuery.isPending || draftQuery.isPending) return;
    if (editor.mode === "duplicate" || draftQuery.isError) {
      setScreen("unsupported");
      initialized.current = true;
      return;
    }
    if (!workflow && !draftQuery.data) {
      setScreen("unsupported");
      initialized.current = true;
      return;
    }
    const savedDraftDiffers =
      !workflow ||
      (draftQuery.data !== null &&
        JSON.stringify(draftQuery.data?.definition) !==
          JSON.stringify(workflow.definition));
    const sourceDefinition = savedDraftDiffers
      ? draftQuery.data?.definition
      : workflow?.definition;
    const mapping = definitionToPlainDraft(sourceDefinition, {
      allowEmptySteps: savedDraftDiffers,
    });
    if (mapping.supported) {
      setDraft({
        workflowId,
        channelId: savedDraftDiffers
          ? (draftQuery.data?.channelId ??
            workflow?.channelId ??
            initialChannelId)
          : (workflow?.channelId ?? initialChannelId),
        ...mapping.draft,
      });
      setDraftRevision(draftQuery.data?.revision ?? null);
      setScreen(editor.mode === "detail" ? "detail" : "steps");
    } else {
      setScreen("unsupported");
    }
    initialized.current = true;
  }, [
    draftQuery.data,
    draftQuery.isError,
    draftQuery.isPending,
    editor.mode,
    initialChannelId,
    workflow,
    workflowId,
    workflowQuery.isPending,
  ]);

  const setStep = React.useCallback((updated: EditableStep) => {
    setStepEditor((current) =>
      current ? { ...current, step: updated } : current,
    );
  }, []);

  const saveDraft = React.useCallback(
    async (nextDraft: PlainWorkflowDraft) => {
      const definition = plainDraftToDefinition(nextDraft, {
        allowEmptySteps: true,
      });
      if (!nextDraft.channelId)
        throw new Error("Choose where updates should appear.");
      setSaving(true);
      setError(null);
      try {
        const saved = await saveWorkflowDraft(
          nextDraft.workflowId,
          nextDraft.channelId,
          yamlStringify(definition),
          draftRevision ?? undefined,
        );
        setDraft(nextDraft);
        setDraftRevision(saved.revision);
        queryClient.setQueryData<WorkflowDraftRecord>(
          workflowDraftQueryKey(nextDraft.workflowId),
          saved,
        );
        void queryClient.invalidateQueries({
          queryKey: workflowQueryKey(nextDraft.workflowId),
        });
        void queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "workflows" ||
            query.queryKey[0] === "workflows-all",
        });
        return saved;
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : "Could not save this workflow draft.";
        setError(`${message} Your changes are still here. Try again.`);
        throw saveError;
      } finally {
        setSaving(false);
      }
    },
    [draftRevision, queryClient],
  );

  const openExample = React.useCallback(() => {
    setError(null);
    if (memberQuery.isPending) {
      setError("Loading channel people. Try again in a moment.");
      return;
    }
    const agent = members.find((member) => member.isAgent);
    const reviewer = members.find((member) => !member.isAgent);
    if (!agent || !reviewer) {
      setError(
        "Choose a channel with an agent and a human member to use this example.",
      );
      return;
    }
    const channel = channels.find(
      (candidate) => candidate.id === draft.channelId,
    );
    const channelName = channel?.name ?? "this channel";
    setDraft({
      ...draft,
      steps: [
        {
          id: newStepId(),
          kind: "agent",
          title: "Prepare next week’s content plan",
          assigneePubkey: agent.pubkey,
          instruction: `Prepare the weekly content plan for #${channelName}, with captions and proposed posting dates.`,
          expectedResult: "A draft content plan ready for review.",
        },
        {
          id: newStepId(),
          kind: "approval",
          title: "Review the content plan",
          reviewerPubkey: reviewer.pubkey,
          message: "Review the content plan and approve it before sharing.",
        },
      ],
    });
    setScreen("steps");
  }, [channels, draft, memberQuery.isPending, members]);

  const handleContinueDescription = React.useCallback(() => {
    setError(null);
    if (!draft.name.trim()) {
      setError("Give this workflow a name.");
      return;
    }
    if (!draft.description.trim()) {
      setError("Describe the routine.");
      return;
    }
    if (editor.mode === "create" && startFromExample) {
      openExample();
    } else if (editor.mode === "create") {
      setDraft({ ...draft, steps: [] });
      setScreen("steps");
    } else {
      void saveDraft(draft)
        .then(() => setScreen("steps"))
        .catch(() => {});
    }
  }, [draft, editor.mode, openExample, saveDraft, startFromExample]);

  const handleSaveTiming = React.useCallback(async () => {
    setError(null);
    if (!draft.channelId) {
      setError("Choose where updates should appear.");
      return;
    }
    if (draft.steps.length === 0) {
      setScreen("steps");
      return;
    }
    let saved: WorkflowDraftRecord;
    try {
      saved = await saveDraft(draft);
    } catch {
      return;
    }
    setScreen("steps");
    if (editor.mode === "create")
      void goEditWorkflow(saved.id, { replace: true });
  }, [draft, editor.mode, goEditWorkflow, saveDraft]);

  const handleSaveStep = React.useCallback(async () => {
    if (!stepEditor) return;
    setError(null);
    const step = stepEditor.step;
    const assignee = members.find(
      (member) =>
        member.pubkey.toLowerCase() === selectedPubkey(step).toLowerCase(),
    );
    if (!assignee || assignee.isAgent !== (step.kind === "agent")) {
      setError(
        step.kind === "agent"
          ? "Choose an agent in this channel."
          : "Choose a human member in this channel.",
      );
      return;
    }
    if (step.kind === "agent" && !step.instruction.trim()) {
      setError("Describe what the agent should do.");
      return;
    }
    if (step.kind === "approval" && !step.message.trim()) {
      setError("Describe what the reviewer should approve.");
      return;
    }
    const nextSteps = [...draft.steps];
    if (stepEditor.index === null) nextSteps.push(step);
    else nextSteps[stepEditor.index] = step;
    const nextDraft = { ...draft, steps: nextSteps };
    try {
      const saved = await saveDraft(nextDraft);
      setStepEditor(null);
      setScreen("steps");
      if (editor.mode === "create")
        void goEditWorkflow(saved.id, { replace: true });
    } catch {
      // saveDraft keeps the edited values in the open step form.
    }
  }, [draft, editor.mode, goEditWorkflow, members, saveDraft, stepEditor]);

  const changeStepOrder = React.useCallback(
    async (index: number, offset: -1 | 1) => {
      const nextIndex = index + offset;
      if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
      const steps = [...draft.steps];
      [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
      const nextDraft = { ...draft, steps };
      setDraft(nextDraft);
      try {
        await saveDraft(nextDraft);
      } catch {
        // Keep the reordered steps in the editor so the save can be retried.
      }
    },
    [draft, saveDraft],
  );

  const removeStep = React.useCallback(
    async (index: number) => {
      const steps = draft.steps.filter(
        (_step, currentIndex) => currentIndex !== index,
      );
      const nextDraft = { ...draft, steps };
      setDraft(nextDraft);
      try {
        const saved = await saveDraft(nextDraft);
        setRemoveIndex(null);
        setScreen("steps");
        if (editor.mode === "create")
          void goEditWorkflow(saved.id, { replace: true });
      } catch {
        // Keep the removed step out of the editor so the save can be retried.
      }
    },
    [draft, editor.mode, goEditWorkflow, saveDraft],
  );

  const handlePreview = React.useCallback(async () => {
    setError(null);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const definition = plainDraftToDefinition(draft);
      const saved = await saveDraft(draft);
      setDraftRevision(saved.revision);
      const result = await previewWorkflow(yamlStringify(definition));
      if (!result.preview || result.sideEffects) {
        throw new Error("The preview did not confirm that it was dry.");
      }
      setPreview(result);
      setScreen("preview");
    } catch (previewError) {
      if (
        !(
          previewError instanceof Error &&
          previewError.message.endsWith("Try again.")
        )
      ) {
        setError(
          previewError instanceof Error
            ? previewError.message
            : "Could not preview this workflow.",
        );
      }
    } finally {
      setPreviewLoading(false);
    }
  }, [draft, saveDraft]);

  const handlePublish = React.useCallback(async () => {
    if (!confirmReviewed) {
      setError("Confirm that you have reviewed the people, timing and steps.");
      return;
    }
    if (memberQuery.isPending) {
      setError("Loading channel people. Try again in a moment.");
      return;
    }
    const channelMemberKeys = new Set(
      members.map((member) => member.pubkey.toLowerCase()),
    );
    const invalidAssignee = draft.steps.some((step) => {
      const pubkey =
        step.kind === "agent" ? step.assigneePubkey : step.reviewerPubkey;
      return !channelMemberKeys.has(pubkey.toLowerCase());
    });
    if (invalidAssignee) {
      setError(
        "Choose people and agents who belong to the selected channel before turning it on.",
      );
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      let draftDiffers = false;
      if (workflow && draftRevision) {
        draftDiffers = !plainDraftMatchesDefinition(draft, workflow.definition);
      }
      if (workflow && workflow.status !== "active" && !draftDiffers) {
        await setWorkflowStatus(workflowId, "active");
        await queryClient.invalidateQueries({
          queryKey: workflowQueryKey(workflowId),
        });
        void queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "workflows" ||
            query.queryKey[0] === "workflows-all",
        });
        setScreen("detail");
        void goWorkflow(workflowId, {
          replace: editor.mode === "create",
        });
        return;
      }
      const savedDraft = draftRevision
        ? { revision: draftRevision }
        : await saveDraft(draft);
      const published = await publishWorkflowDraft(
        workflowId,
        savedDraft.revision,
        workflow?.revision,
      );
      if (workflow && workflow.status !== "active") {
        try {
          await setWorkflowStatus(workflowId, "active");
        } catch (statusError) {
          queryClient.setQueryData(workflowQueryKey(workflowId), {
            ...published.workflow,
            status: "disabled",
          });
          setError(
            `The draft was published, but the workflow remains paused: ${statusError instanceof Error ? statusError.message : "status update failed"}`,
          );
          void queryClient.invalidateQueries({
            predicate: (query) =>
              query.queryKey[0] === "workflows" ||
              query.queryKey[0] === "workflows-all",
          });
          return;
        }
      }
      queryClient.setQueryData(
        workflowQueryKey(workflowId),
        published.workflow,
      );
      queryClient.setQueryData(
        workflowDraftQueryKey(workflowId),
        draftRevision ? draftQuery.data : null,
      );
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "workflows" ||
          query.queryKey[0] === "workflows-all",
      });
      void goWorkflow(workflowId, {
        replace: editor.mode === "create",
      });
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? `${publishError.message} Your draft is still here.`
          : "Could not publish this workflow. Your draft is still here.",
      );
    } finally {
      setPublishing(false);
    }
  }, [
    confirmReviewed,
    draft,
    draftQuery.data,
    draftRevision,
    editor.mode,
    goWorkflow,
    memberQuery.isPending,
    members,
    queryClient,
    saveDraft,
    workflow,
    workflowId,
  ]);

  const handleStatusChange = React.useCallback(async () => {
    if (!workflow) return;
    setChangingStatus(true);
    setError(null);
    try {
      await setWorkflowStatus(
        workflow.id,
        workflow.status === "active" ? "paused" : "active",
      );
      await queryClient.invalidateQueries({
        queryKey: workflowQueryKey(workflow.id),
      });
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "workflows" ||
          query.queryKey[0] === "workflows-all",
      });
      setScreen("detail");
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not change workflow status.",
      );
    } finally {
      setChangingStatus(false);
    }
  }, [queryClient, workflow]);

  const openAdvanced = React.useCallback(() => {
    if (!canManage || editor.mode === "create" || !workflow) return;
    void goAdvancedWorkflow(workflowId);
  }, [canManage, editor.mode, goAdvancedWorkflow, workflow, workflowId]);

  const currentChannel = channels.find(
    (channel) => channel.id === draft.channelId,
  );
  const canOpenAdvanced =
    canManage && editor.mode !== "create" && Boolean(workflow);
  const activeDefinition = workflow?.definition;
  const draftDiffersFromActive = React.useMemo(() => {
    if (!workflow || !draftRevision) return false;
    return !plainDraftMatchesDefinition(draft, activeDefinition);
  }, [activeDefinition, draft, draftRevision, workflow]);
  const hasUnpublishedChanges = Boolean(draftDiffersFromActive);

  if (
    editor.mode !== "create" &&
    (workflowQuery.isPending || draftQuery.isPending)
  ) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="plain-workflow-builder"
      >
        <BuilderHeader
          canManage={canOpenAdvanced}
          onAdvanced={openAdvanced}
          onClose={onClose}
          title="Loading workflow"
        />
        <div
          className="mx-auto w-full max-w-5xl space-y-4 px-5 py-8 sm:px-8"
          role="status"
        >
          <span className="sr-only">Loading workflow</span>
          <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (
    editor.mode !== "create" &&
    !workflowQuery.isPending &&
    !draftQuery.isPending &&
    (draftQuery.isError || (!workflow && draftQuery.data === null))
  ) {
    return (
      <WorkflowUnavailableDialog
        loading={false}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onRetry={() =>
          void (draftQuery.isError
            ? draftQuery.refetch()
            : workflowQuery.refetch())
        }
        open
      />
    );
  }

  if (screen === "unsupported") {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="plain-workflow-builder"
      >
        <BuilderHeader
          canManage={canOpenAdvanced}
          onAdvanced={openAdvanced}
          onClose={onClose}
          title={workflow?.name ?? "Workflow unavailable"}
        />
      </div>
    );
  }

  const back = () => {
    setError(null);
    if (screen === "describe" || screen === "detail") onClose();
    else if (screen === "timing") setScreen("steps");
    else if (screen === "step" || screen === "remove") {
      setStepEditor(null);
      setRemoveIndex(null);
      setScreen("steps");
    } else if (screen === "preview") setScreen("steps");
    else if (screen === "review") setScreen("preview");
    else if (screen === "pause") setScreen("detail");
    else setScreen("detail");
  };

  const headerTitle =
    screen === "describe"
      ? "What would you like to happen?"
      : screen === "timing"
        ? "When should it happen?"
        : screen === "step"
          ? stepEditor?.index === null
            ? "Add a step"
            : "Edit this step"
          : screen === "remove"
            ? "Remove this step?"
            : screen === "preview"
              ? "Walk through a sample run"
              : screen === "review"
                ? workflow
                  ? "Review your changes"
                  : "Ready to turn it on?"
                : screen === "pause"
                  ? "Pause this workflow?"
                  : (workflow?.name ?? draft.name ?? "Workflow steps");

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="plain-workflow-builder"
    >
      <BuilderHeader
        canManage={canOpenAdvanced}
        onAdvanced={openAdvanced}
        onBack={back}
        onClose={onClose}
        title={headerTitle}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-7 sm:px-8 sm:py-9">
        {error ? (
          <div
            className="mb-5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {screen === "describe" ? (
          <section className="max-w-3xl space-y-5">
            <Field label="Give this workflow a name">
              <Input
                autoFocus
                autoCapitalize="off"
                data-testid="plain-workflow-name"
                maxLength={100}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                value={draft.name}
              />
            </Field>
            <Field label="Describe the routine">
              <Textarea
                className="min-h-28"
                data-testid="plain-workflow-description"
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="Include when it happens, who is involved and what a good result looks like."
                value={draft.description}
              />
            </Field>
            <p className="text-sm leading-6 text-muted-foreground">
              You can build the steps yourself or adapt the content-plan
              example.
            </p>
            <Field label="Start with">
              <select
                aria-label="Start with"
                className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                onChange={(event) =>
                  setStartFromExample(event.target.value === "example")
                }
                value={startFromExample ? "example" : "blank"}
              >
                <option value="example">Weekly content-plan example</option>
                <option value="blank">My own steps</option>
              </select>
            </Field>
            <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
              <Button
                disabled={saving || memberQuery.isPending}
                onClick={handleContinueDescription}
              >
                Continue
              </Button>
              <Button onClick={back} variant="outline">
                Cancel
              </Button>
            </div>
          </section>
        ) : null}

        {screen === "timing" ? (
          <section className="max-w-3xl space-y-6">
            <Field label="Start">
              <select
                aria-label="Start"
                className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    schedule: {
                      ...draft.schedule,
                      frequency: event.target
                        .value as PlainWorkflowDraft["schedule"]["frequency"],
                    },
                  })
                }
                value={draft.schedule.frequency}
              >
                <option value="weekly">Every week</option>
                <option value="daily">Every day</option>
                <option value="manual">When I start it</option>
              </select>
            </Field>
            {draft.schedule.frequency === "weekly" ? (
              <Field label="Day">
                <select
                  aria-label="Day for weekly routines"
                  className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      schedule: {
                        ...draft.schedule,
                        day: Number(event.target.value),
                      },
                    })
                  }
                  value={draft.schedule.day}
                >
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {draft.schedule.frequency !== "manual" ? (
              <Field label="Time">
                <Input
                  aria-label="Time"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      schedule: { ...draft.schedule, time: event.target.value },
                    })
                  }
                  type="time"
                  value={draft.schedule.time}
                />
              </Field>
            ) : null}
            <p className="text-sm leading-6 text-muted-foreground">
              Johannesburg time (SAST). Manual workflows start only when you
              choose to run them.
            </p>
            <Field label="Where should updates appear?">
              <select
                aria-label="Where should updates appear?"
                className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                onChange={(event) =>
                  setDraft({ ...draft, channelId: event.target.value })
                }
                value={draft.channelId}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </Field>
            {channels.length === 0 ? (
              <p className="text-sm text-destructive" role="alert">
                Join a channel before creating a workflow.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
              <Button
                disabled={!draft.channelId || saving || memberQuery.isPending}
                onClick={() => void handleSaveTiming()}
              >
                {saving ? "Saving…" : "Save timing"}
              </Button>
              <Button onClick={back} variant="outline">
                Cancel
              </Button>
            </div>
          </section>
        ) : null}

        {screen === "steps" ? (
          <section className="space-y-6">
            {hasUnpublishedChanges ? (
              <div
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"
                role="status"
              >
                You have unpublished changes. The active version stays in place
                until you review and publish this draft.
              </div>
            ) : null}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{draft.name}</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {draft.description}
                </p>
                <div className="mt-4 rounded-lg border border-border/70 px-4 py-3">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    When it starts
                  </span>
                  <span className="mt-1 block text-sm font-medium">
                    {plainScheduleDescription(draft.schedule)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setScreen("describe")} variant="outline">
                  Edit name & description
                </Button>
                <Button onClick={() => setScreen("timing")} variant="outline">
                  Change timing & updates
                </Button>
              </div>
            </div>
            {draft.steps.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
                <h2 className="text-base font-semibold">
                  Build your workflow steps
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add an agent preparation step or ask a person to approve a
                  result.
                </p>
              </div>
            ) : (
              <ol className="divide-y divide-border rounded-xl border border-border/70 bg-card px-4 sm:px-6">
                {draft.steps.map((step, index) => (
                  <li className="flex gap-4 py-5" key={step.id}>
                    <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {step.kind === "agent"
                              ? "Prepare something"
                              : "Ask for approval"}
                          </span>
                          <h2 className="mt-1 text-base font-semibold">
                            {step.title ||
                              (step.kind === "agent"
                                ? "Prepare a result"
                                : "Review this step")}
                          </h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            aria-label={`Edit step ${index + 1}`}
                            onClick={() => {
                              setStepEditor({
                                step: structuredClone(step) as EditableStep,
                                index,
                              });
                              setScreen("step");
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            Edit
                          </Button>
                          <Button
                            aria-label={`Move step ${index + 1} up`}
                            disabled={index === 0 || saving}
                            onClick={() => void changeStepOrder(index, -1)}
                            size="icon"
                            variant="ghost"
                          >
                            <ArrowUp aria-hidden="true" />
                          </Button>
                          <Button
                            aria-label={`Move step ${index + 1} down`}
                            disabled={
                              index === draft.steps.length - 1 || saving
                            }
                            onClick={() => void changeStepOrder(index, 1)}
                            size="icon"
                            variant="ghost"
                          >
                            <ArrowDown aria-hidden="true" />
                          </Button>
                          <Button
                            aria-label={`Remove step ${index + 1}`}
                            disabled={saving}
                            onClick={() => {
                              setRemoveIndex(index);
                              setScreen("remove");
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" />
                            Remove
                          </Button>
                        </div>
                      </div>
                      <span className="block text-sm text-muted-foreground">
                        {step.kind === "agent"
                          ? "Runs this step"
                          : "Reviews this step"}
                      </span>
                      <ProfileChip
                        member={members.find(
                          (member) =>
                            member.pubkey.toLowerCase() ===
                            (step.kind === "agent"
                              ? step.assigneePubkey
                              : step.reviewerPubkey
                            ).toLowerCase(),
                        )}
                        onOpen={(pubkey) => openProfilePanel?.(pubkey)}
                        profiles={profiles}
                      />
                      <p className="text-sm leading-6 text-muted-foreground">
                        {step.kind === "agent"
                          ? step.instruction
                          : step.message}
                      </p>
                      {step.kind === "agent" && step.expectedResult ? (
                        <p className="text-sm text-muted-foreground">
                          Ready when: {step.expectedResult}
                        </p>
                      ) : null}
                      {step.kind === "approval" ? (
                        <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                          The run waits here for approval.
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={memberQuery.isPending || saving}
                onClick={() => {
                  const kind = members.some((member) => member.isAgent)
                    ? "agent"
                    : "approval";
                  const candidate = getCandidates(members, kind)[0];
                  const step: EditableStep =
                    kind === "agent"
                      ? {
                          id: newStepId(),
                          kind,
                          title: "",
                          assigneePubkey: candidate?.pubkey ?? "",
                          instruction: "",
                          expectedResult: "",
                        }
                      : {
                          id: newStepId(),
                          kind,
                          title: "",
                          reviewerPubkey: candidate?.pubkey ?? "",
                          message: "",
                        };
                  setStepEditor({ step, index: null });
                  setScreen("step");
                }}
              >
                <Plus aria-hidden="true" />
                Add a step
              </Button>
              {draft.steps.length > 0 ? (
                <Button
                  disabled={saving || previewLoading}
                  onClick={() => void handlePreview()}
                  variant="outline"
                >
                  <Eye aria-hidden="true" />
                  Preview a sample run
                </Button>
              ) : null}
            </div>
            {draft.steps.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-5">
                <p className="text-sm text-muted-foreground">
                  Updates go to{" "}
                  <strong className="font-medium text-foreground">
                    #{currentChannel?.name ?? "channel unavailable"}
                  </strong>
                  . A failed step stops the run.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {screen === "remove" && removeIndex !== null ? (
          <section className="max-w-3xl space-y-5">
            <div className="rounded-xl border border-border p-5">
              <h2 className="text-base font-semibold">
                {draft.steps[removeIndex]?.title || "Step"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Only the draft changes. You can add a step again before
                activating.
              </p>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
              <Button
                disabled={saving}
                onClick={() => void removeStep(removeIndex)}
                variant="destructive"
              >
                {saving ? "Removing…" : "Remove step"}
              </Button>
              <Button disabled={saving} onClick={back} variant="outline">
                Keep step
              </Button>
            </div>
          </section>
        ) : null}

        {screen === "step" && stepEditor ? (
          <section className="max-w-3xl space-y-5">
            <Field label="What kind of step?">
              <select
                aria-label="What kind of step?"
                className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                onChange={(event) => {
                  const kind = event.target.value as EditableStep["kind"];
                  const candidate = getCandidates(members, kind)[0];
                  setStep(
                    kind === "agent"
                      ? {
                          id: stepEditor.step.id,
                          kind,
                          title: stepEditor.step.title,
                          assigneePubkey: candidate?.pubkey ?? "",
                          instruction: "",
                          expectedResult: "",
                        }
                      : {
                          id: stepEditor.step.id,
                          kind,
                          title: stepEditor.step.title,
                          reviewerPubkey: candidate?.pubkey ?? "",
                          message: "",
                        },
                  );
                }}
                value={stepEditor.step.kind}
              >
                <option value="agent">Prepare something</option>
                <option value="approval">Ask for approval</option>
              </select>
            </Field>
            <Field label="Step name">
              <Input
                autoCapitalize="off"
                onChange={(event) =>
                  setStep({ ...stepEditor.step, title: event.target.value })
                }
                value={stepEditor.step.title}
              />
            </Field>
            <Field label="Who is responsible?">
              <select
                aria-label="Who is responsible?"
                className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                onChange={(event) =>
                  setStep(
                    withSelectedPubkey(stepEditor.step, event.target.value),
                  )
                }
                value={selectedPubkey(stepEditor.step)}
              >
                <option value="">Choose a person</option>
                {getCandidates(members, stepEditor.step.kind).map((member) => (
                  <option key={member.pubkey} value={member.pubkey}>
                    {memberLabel(member, profiles)}
                  </option>
                ))}
              </select>
            </Field>
            <ProfileChip
              member={members.find(
                (member) =>
                  member.pubkey.toLowerCase() ===
                  selectedPubkey(stepEditor.step).toLowerCase(),
              )}
              onOpen={(pubkey) => openProfilePanel?.(pubkey)}
              profiles={profiles}
            />
            {stepEditor.step.kind === "agent" ? (
              <>
                <Field label="What should they do?">
                  <Textarea
                    className="min-h-24"
                    onChange={(event) =>
                      setStep({
                        ...(stepEditor.step as PlainAgentStep),
                        instruction: event.target.value,
                      })
                    }
                    value={stepEditor.step.instruction}
                  />
                </Field>
                <Field label="What should be ready when they finish?">
                  <Textarea
                    className="min-h-20"
                    onChange={(event) =>
                      setStep({
                        ...(stepEditor.step as PlainAgentStep),
                        expectedResult: event.target.value,
                      })
                    }
                    value={stepEditor.step.expectedResult}
                  />
                </Field>
              </>
            ) : (
              <Field label="What should the reviewer approve?">
                <Textarea
                  className="min-h-24"
                  onChange={(event) =>
                    setStep({
                      ...(stepEditor.step as PlainApprovalStep),
                      message: event.target.value,
                    })
                  }
                  value={stepEditor.step.message}
                />
              </Field>
            )}
            <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
              <Button
                disabled={saving || memberQuery.isPending}
                onClick={() => void handleSaveStep()}
              >
                {saving ? "Saving…" : "Save step"}
              </Button>
              <Button onClick={back} variant="outline">
                Cancel
              </Button>
            </div>
          </section>
        ) : null}

        {screen === "preview" ? (
          <section className="space-y-5" data-testid="workflow-preview">
            <div
              className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm"
              role="status"
            >
              Preview only. No messages, approvals, agent requests or webhooks
              are sent.
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {plainScheduleDescription(draft.schedule)}. Review what each step
              would do before activation.
            </p>
            {previewLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                Preparing preview…
              </p>
            ) : null}
            {preview?.steps.map((step, index) => (
              <article
                className="rounded-xl border border-border/70 bg-card p-5"
                key={step.stepId}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">
                      {draft.steps[index]?.title || `Step ${index + 1}`}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {step.action}
                    </p>
                    <ul className="mt-4 space-y-2 border-l border-border pl-4 text-sm">
                      {step.paths.map((path) => (
                        <li className="text-muted-foreground" key={path}>
                          {path}
                        </li>
                      ))}
                    </ul>
                    {step.note ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {step.note}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
            <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
              <Button
                onClick={() => {
                  setConfirmReviewed(false);
                  setScreen("review");
                }}
              >
                Review activation
              </Button>
              <Button onClick={() => setScreen("steps")} variant="outline">
                Edit steps
              </Button>
            </div>
          </section>
        ) : null}

        {screen === "review" ? (
          <section
            className="max-w-4xl space-y-5"
            data-testid="workflow-activation-review"
          >
            <div className="rounded-xl border border-border/70 bg-card p-5 sm:p-6">
              <h2 className="text-lg font-semibold">{draft.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {draft.description}
              </p>
              <p className="mt-3 text-sm font-medium">
                {plainScheduleDescription(draft.schedule)} · #
                {currentChannel?.name ?? "channel unavailable"}
              </p>
              <ol className="mt-4 divide-y divide-border">
                {draft.steps.map((step, index) => (
                  <DetailStep
                    index={index}
                    key={step.id}
                    members={members}
                    onOpenProfile={(pubkey) => openProfilePanel?.(pubkey)}
                    profiles={profiles}
                    step={step}
                  />
                ))}
              </ol>
            </div>
            {draft.steps.some((step) => step.kind === "approval") ? (
              <div className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-sm">
                Approval always comes first. The run waits for the named
                reviewer.
              </div>
            ) : null}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-4 text-sm">
              <input
                checked={confirmReviewed}
                className="mt-0.5 size-4 accent-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setConfirmReviewed(event.target.checked)}
                type="checkbox"
              />
              <span>I have reviewed the steps, people and schedule.</span>
            </label>
            <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
              <Button
                disabled={publishing || !confirmReviewed}
                onClick={() => void handlePublish()}
              >
                {publishing
                  ? "Publishing…"
                  : workflow
                    ? "Save and turn on"
                    : "Turn on workflow"}
              </Button>
              <Button onClick={() => setScreen("steps")} variant="outline">
                Edit steps
              </Button>
            </div>
          </section>
        ) : null}

        {screen === "detail" && workflow ? (
          <section className="space-y-7" data-testid="plain-workflow-detail">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  workflow.status === "active"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {workflow.status === "active" ? "Active" : "Paused"}
              </span>
              <span className="text-sm text-muted-foreground">
                {plainScheduleDescription(draft.schedule)}
              </span>
            </div>
            <div>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {draft.description}
              </p>
              <p className="mt-3 text-sm">
                Updates go to{" "}
                <strong>
                  #{currentChannel?.name ?? "channel unavailable"}
                </strong>
              </p>
            </div>
            {hasUnpublishedChanges ? (
              <div
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"
                role="status"
              >
                An unpublished draft exists. The active version is still running
                until you review and publish the changes.
              </div>
            ) : null}
            <ol className="divide-y divide-border rounded-xl border border-border/70 bg-card px-4 sm:px-6">
              {draft.steps.map((step, index) => (
                <DetailStep
                  index={index}
                  key={step.id}
                  members={members}
                  onOpenProfile={(pubkey) => openProfilePanel?.(pubkey)}
                  profiles={profiles}
                  step={step}
                />
              ))}
            </ol>
            <RunHistory runs={runsQuery.data} />
            <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
              {isWorkflowOwner ? (
                <Button
                  onClick={() => void goEditWorkflow(workflow.id)}
                  variant="outline"
                >
                  Edit workflow
                </Button>
              ) : null}
              {isWorkflowOwner && workflow.status === "active" ? (
                <Button onClick={() => setScreen("pause")} variant="outline">
                  <Pause aria-hidden="true" />
                  Pause
                </Button>
              ) : null}
              {isWorkflowOwner && workflow.status !== "active" ? (
                <Button
                  onClick={() => {
                    setConfirmReviewed(false);
                    setScreen("review");
                  }}
                >
                  Review & turn on
                </Button>
              ) : null}
              {!isWorkflowOwner ? (
                <p className="self-center text-sm text-muted-foreground">
                  Only the workflow owner can save or publish a draft.
                </p>
              ) : null}
              <Button onClick={() => void handlePreview()} variant="ghost">
                <Eye aria-hidden="true" />
                Preview a sample run
              </Button>
            </div>
          </section>
        ) : null}

        {screen === "pause" ? (
          <section className="max-w-2xl space-y-5">
            <div className="rounded-xl border border-border p-5">
              <h2 className="text-base font-semibold">{workflow?.name}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                No new runs will start. Any run already in progress would remain
                visible for a separate decision.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={changingStatus}
                onClick={() => void handleStatusChange()}
              >
                {changingStatus ? "Pausing…" : "Pause workflow"}
              </Button>
              <Button onClick={() => setScreen("detail")} variant="outline">
                Keep running
              </Button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
