import { ChevronRight, Plus } from "lucide-react";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  allWorkflowsQueryKey,
  workflowListFocusRefetchPolicy,
} from "@/features/workflows/hooks";
import { WorkflowDeleteDialog } from "@/features/workflows/ui/WorkflowDeleteDialog";
import { WorkflowEditorHost } from "@/features/workflows/ui/WorkflowEditorHost";
import { PlainWorkflowBuilder } from "@/features/workflows/ui/PlainWorkflowBuilder";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  getWorkflowDisplayStatus,
  getWorkflowTriggerSummary,
} from "@/features/workflows/ui/workflowDefinition";
import type { WorkflowEditorRoute } from "@/features/workflows/ui/WorkflowsScreen";
import type { WorkflowEditorPane } from "@/features/workflows/ui/workflowEditorPane";
import type { Channel, Workflow } from "@/shared/api/types";
import {
  deleteWorkflow,
  getChannelsWorkflows,
  triggerWorkflow,
} from "@/shared/api/tauriWorkflows";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/skeleton";

type WorkflowsViewProps = {
  channels: Channel[];
  editor: WorkflowEditorRoute | null;
  onCloseEditor: () => void;
  onCreateWorkflow: (starting: "blank" | "example") => void;
  onDuplicateWorkflow: (workflowId: string) => void;
  onEditWorkflow: (workflowId: string) => void;
  onViewWorkflow: (workflowId: string) => void;
  onEditorPaneChange: (pane: WorkflowEditorPane) => void;
};

type WorkflowWithChannel = {
  workflow: Workflow;
  channelName: string;
};

function WorkflowsListSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading workflows">
      {["first", "second", "third"].map((row) => (
        <div className="space-y-2 border-b border-border px-3 py-5" key={row}>
          <Skeleton className="h-5 w-52" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

function WorkflowStartCard({
  onCreateWorkflow,
}: {
  onCreateWorkflow: (starting: "blank" | "example") => void;
}) {
  return (
    <section className="col-span-full rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Start with a familiar routine
      </span>
      <h2 className="mt-3 text-xl font-semibold">
        A weekly content plan, from brief to approval.
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        A channel agent prepares it, then a person in the channel reviews it.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button onClick={() => onCreateWorkflow("example")}>
          Use this example
        </Button>
        <Button onClick={() => onCreateWorkflow("blank")} variant="outline">
          Start from scratch
        </Button>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        One person doing one recurring job? Set a duty on their profile instead.
      </p>
    </section>
  );
}

export function WorkflowsView({
  channels,
  editor,
  onCloseEditor,
  onCreateWorkflow,
  onDuplicateWorkflow,
  onEditWorkflow,
  onViewWorkflow,
  onEditorPaneChange,
}: WorkflowsViewProps) {
  const [deleteTarget, setDeleteTarget] = React.useState<Workflow | null>(null);
  const queryClient = useQueryClient();
  const membershipQuery = useMyRelayMembershipQuery();
  const canManageWorkflows =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";

  const editorWorkflowId =
    editor && editor.mode !== "create" ? editor.workflowId : null;

  const memberChannels = channels.filter((c) => c.isMember);
  const channelIds = memberChannels.map((c) => c.id).sort();
  const channelIdKey = channelIds.join(",");

  const allWorkflowsQuery = useQuery({
    queryKey: allWorkflowsQueryKey(channelIdKey),
    queryFn: async () => {
      // Single batched relay query for all member channels, then group by the
      // channel_id each workflow carries, replacing the per-channel fanout.
      const channelNameById = new Map(
        memberChannels.map((channel) => [channel.id, channel.name]),
      );
      const workflows = await getChannelsWorkflows(channelIds);
      const results: WorkflowWithChannel[] = [];
      for (const workflow of workflows) {
        results.push({
          workflow,
          channelName: workflow.channelId
            ? (channelNameById.get(workflow.channelId) ?? "")
            : "",
        });
      }
      return results;
    },
    enabled: memberChannels.length > 0,
    ...workflowListFocusRefetchPolicy,
  });

  const allWorkflows = allWorkflowsQuery.data ?? [];

  const triggerMutation = useMutation({
    mutationFn: (workflowId: string) => triggerWorkflow(workflowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "workflow-runs",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (workflowId: string) => deleteWorkflow(workflowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "workflows" ||
          query.queryKey[0] === "workflows-all",
      });
    },
  });

  const triggerOne = triggerMutation.mutate;
  const handleTrigger = React.useCallback(
    (workflowId: string) => triggerOne(workflowId),
    [triggerOne],
  );

  const handleDelete = React.useCallback(
    (workflow: Workflow) => setDeleteTarget(workflow),
    [],
  );

  const deleteOne = deleteMutation.mutateAsync;
  const handleConfirmDelete = React.useCallback(
    async (workflow: Workflow) => {
      try {
        await deleteOne(workflow.id);
        setDeleteTarget(null);
        // Deleting the workflow the editor is pointed at would otherwise leave
        // that editor open on a workflow that no longer exists.
        if (workflow.id === editorWorkflowId) onCloseEditor();
      } catch {
        // React Query stores the error; keep the confirmation and editor open.
      }
    },
    [deleteOne, editorWorkflowId, onCloseEditor],
  );

  const handleView = React.useCallback(
    (workflow: Workflow) => onViewWorkflow(workflow.id),
    [onViewWorkflow],
  );

  const editorWorkflowHint = allWorkflows.find(
    ({ workflow }) => workflow.id === editorWorkflowId,
  )?.workflow;

  if (editor && (editor.advanced !== true || !canManageWorkflows)) {
    return (
      <div
        className="relative flex min-h-0 flex-1 overflow-hidden"
        data-testid="workflows-view"
      >
        <PlainWorkflowBuilder
          channels={memberChannels}
          editor={editor}
          key={
            editor.mode === "create"
              ? editor.mode
              : `${editor.mode}:${editor.workflowId}`
          }
          onClose={onCloseEditor}
        />
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden"
      data-testid="workflows-view"
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-7 sm:px-6 sm:py-8"
        data-scroll-restoration-id="workflows-list"
      >
        <div className="mx-auto w-full max-w-6xl space-y-8 [container-type:inline-size]">
          <PageHeader
            action={
              <Button onClick={() => onCreateWorkflow("blank")}>
                <Plus aria-hidden="true" />
                Create workflow
              </Button>
            }
            title="Workflows"
          />
          <p className="max-w-3xl text-sm text-muted-foreground">
            Bring people and agents together around a repeatable routine.
          </p>

          {allWorkflowsQuery.isLoading ? (
            <WorkflowsListSkeleton />
          ) : allWorkflowsQuery.isError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <p className="text-sm text-red-400">Failed to load workflows</p>
              <Button
                onClick={() => void allWorkflowsQuery.refetch()}
                size="sm"
                variant="outline"
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {allWorkflows.length === 0 ? (
                <WorkflowStartCard onCreateWorkflow={onCreateWorkflow} />
              ) : (
                allWorkflows.map(({ workflow, channelName }) => {
                  const status = getWorkflowDisplayStatus(workflow);
                  const stepCount = Array.isArray(workflow.definition.steps)
                    ? workflow.definition.steps.length
                    : 0;
                  const trigger = getWorkflowTriggerSummary(
                    workflow.definition,
                  );
                  return (
                    <button
                      className="group flex w-full items-center gap-4 border-y border-border px-3 py-5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-6 sm:px-4"
                      data-testid={`workflow-card-${workflow.id}`}
                      key={workflow.id}
                      onClick={() => handleView(workflow)}
                      type="button"
                    >
                      <span className="min-w-0 flex-1">
                        <strong
                          className="block truncate text-base font-semibold"
                          data-testid="workflow-card-name"
                        >
                          {workflow.name}
                        </strong>
                        <span className="mt-2 block text-sm text-muted-foreground">
                          {trigger ?? "Workflow"}
                        </span>
                        <span
                          className="mt-2 block text-xs text-muted-foreground"
                          data-testid="workflow-card-channel"
                        >
                          {stepCount} {stepCount === 1 ? "step" : "steps"}
                          {channelName ? ` · #${channelName}` : ""}
                        </span>
                      </span>
                      <span
                        className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                        data-testid="workflow-card-status"
                      >
                        {status === "active" ? "Active" : "Paused"}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      <WorkflowEditorHost
        channels={memberChannels}
        editor={editor}
        onClose={onCloseEditor}
        onDeleteWorkflow={handleDelete}
        onDuplicateWorkflow={onDuplicateWorkflow}
        onEditWorkflow={onEditWorkflow}
        onEditorPaneChange={onEditorPaneChange}
        onTriggerWorkflow={handleTrigger}
        workflowHint={editorWorkflowHint}
      />

      <WorkflowDeleteDialog
        error={
          deleteMutation.error instanceof Error
            ? deleteMutation.error.message
            : null
        }
        isPending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
        onOpenChange={(open) => {
          if (!open) {
            deleteMutation.reset();
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
        workflow={deleteTarget}
      />
    </div>
  );
}
