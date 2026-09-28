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
  WorkflowDraft as WorkflowDraftRecord,
  WorkflowPreview,
} from "@/shared/api/types";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { WorkflowUnavailableDialog } from "./WorkflowUnavailableDialog";
import {
  definitionToPlainDraft,
  plainDraftMatchesDefinition,
  plainDraftToDefinition,
  type PlainWorkflowDraft,
} from "./plainWorkflowModel";
import type { WorkflowEditorRoute } from "./WorkflowsScreen";
import {
  BuilderHeader,
  newStepId,
  selectedPubkey,
} from "./PlainWorkflowBuilderParts";
import { PlainWorkflowBuilderScreens } from "./PlainWorkflowBuilderScreens";
import type {
  BuilderScreen,
  EditableStep,
  StepEditor,
} from "./plainWorkflowBuilderTypes";

type PlainWorkflowBuilderProps = {
  channels: Channel[];
  editor: WorkflowEditorRoute;
  onClose: () => void;
};

function newWorkflowId(): string {
  return crypto.randomUUID();
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
  const [stepEditor, setStepEditor] = React.useState<StepEditor>(null);
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

        <PlainWorkflowBuilderScreens
          changeStepOrder={changeStepOrder}
          channels={channels}
          changingStatus={changingStatus}
          confirmReviewed={confirmReviewed}
          currentChannel={currentChannel}
          draft={draft}
          error={error}
          back={back}
          goEditWorkflow={goEditWorkflow}
          handleContinueDescription={handleContinueDescription}
          handlePreview={handlePreview}
          handlePublish={handlePublish}
          handleSaveStep={handleSaveStep}
          handleSaveTiming={handleSaveTiming}
          handleStatusChange={handleStatusChange}
          hasUnpublishedChanges={hasUnpublishedChanges}
          isWorkflowOwner={isWorkflowOwner}
          memberQueryPending={memberQuery.isPending}
          members={members}
          openProfilePanel={(pubkey) => openProfilePanel?.(pubkey)}
          preview={preview}
          previewLoading={previewLoading}
          profiles={profiles}
          publishing={publishing}
          removeIndex={removeIndex}
          removeStep={removeStep}
          runs={runsQuery.data}
          saving={saving}
          screen={screen}
          setConfirmReviewed={setConfirmReviewed}
          setDraft={setDraft}
          setRemoveIndex={setRemoveIndex}
          setScreen={setScreen}
          setStartFromExample={setStartFromExample}
          setStep={setStep}
          setStepEditor={setStepEditor}
          startFromExample={startFromExample}
          stepEditor={stepEditor}
          workflow={workflow}
        />
      </main>
    </div>
  );
}
