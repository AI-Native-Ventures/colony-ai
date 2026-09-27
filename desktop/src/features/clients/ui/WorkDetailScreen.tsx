import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  BUSINESS_RECORD_SCHEMA_VERSION,
  buildDeliverableApprovalTemplate,
  buildDeliverableVersionTemplate,
  buildWorkItemReferenceMessageTemplate,
  buildWorkItemReferenceTag,
  buildWorkItemActionTemplate,
  computeDeliverableDigests,
  isBusinessRecordCommandRejection,
  type DeliverableApproval,
  type DeliverableVersion,
  type DeliverablePointer,
  type EventRecord,
  type WorkItemHead,
} from "@/features/clients/lib/businessRecords";
import {
  findUniqueWorkItem,
  useAllWorkItemHeadsQuery,
  useClientDeliverableEventsQuery,
  useClientRecordsQuery,
  useSubmitBusinessRecordMutation,
} from "@/features/clients/useBusinessRecords";
import {
  ClientWorkspace,
  RecordCard,
  RecordField,
  RecordMessage,
} from "@/features/clients/ui/ClientWorkspace";
import { useIdentityQuery } from "@/shared/api/hooks";
import { truncateNpub, truncatePubkey } from "@/shared/lib/pubkey";
import { signRelayEvent } from "@/shared/api/tauri";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import { toast } from "sonner";
import { WorkDetailDialogs } from "@/features/clients/ui/WorkDetailDialogs";

const WORK_STATUS_LABELS: Record<string, string> = {
  active: "In progress",
  review: "Needs review",
  blocked: "Blocked",
  paused: "Paused",
  complete: "Complete",
  archived: "Archived",
};
const MAX_DELIVERABLE_PREVIEW_CHARS = 12_000;

function displayStatus(status: string): string {
  return WORK_STATUS_LABELS[status] ?? status;
}

function jsonBodyParts(body: unknown): { title: string; content: string } {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    return {
      title: typeof record.title === "string" ? record.title : "",
      content:
        typeof record.content === "string"
          ? record.content
          : JSON.stringify(body, null, 2),
    };
  }
  return { title: "", content: JSON.stringify(body, null, 2) };
}

function eventTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(createdAt * 1_000));
}

function mutationTemplate(
  record: EventRecord<WorkItemHead>,
  updates: Partial<
    Pick<
      WorkItemHead,
      "title" | "status" | "assignedPubkeys" | "approverPubkeys"
    >
  >,
) {
  return buildWorkItemActionTemplate({
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    clientId: record.value.clientId,
    workItemId: record.value.workItemId,
    action: "update",
    expectedHeadEventId: record.event.id,
    head: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: record.value.clientId,
      workItemId: record.value.workItemId,
      title: updates.title ?? record.value.title,
      status: updates.status ?? record.value.status,
      assignedPubkeys: updates.assignedPubkeys ?? record.value.assignedPubkeys,
      approverPubkeys: updates.approverPubkeys ?? record.value.approverPubkeys,
      deliverables: record.value.deliverables,
    },
  });
}

function isWorkItemReferenceMessage(
  event: RelayEvent,
  clientId: string,
  coordinate: string,
): boolean {
  const channelTags = event.tags.filter((tag) => tag[0] === "h");
  const referenceTags = event.tags.filter((tag) => tag[0] === "a");
  const authorTags = event.tags.filter((tag) => tag[0] === "p");
  return (
    event.kind === KIND_STREAM_MESSAGE &&
    event.content === "" &&
    channelTags.length === 1 &&
    channelTags[0]?.[1]?.toLowerCase() === clientId.toLowerCase() &&
    referenceTags.length === 1 &&
    referenceTags[0]?.[1] === coordinate &&
    authorTags.length === 1 &&
    authorTags[0]?.[1]?.toLowerCase() === event.pubkey.toLowerCase()
  );
}

function isExpectedWorkItemReference(
  event: RelayEvent,
  expected: RelayEvent,
  clientId: string,
  coordinate: string,
): boolean {
  return (
    event.id.toLowerCase() === expected.id.toLowerCase() &&
    event.pubkey.toLowerCase() === expected.pubkey.toLowerCase() &&
    isWorkItemReferenceMessage(event, clientId, coordinate)
  );
}

export function WorkDetailScreen({
  clientId,
  workItemId,
}: {
  clientId?: string;
  workItemId: string;
}) {
  const normalizedClientId = clientId?.toLowerCase() ?? null;
  const normalizedWorkItemId = workItemId.toLowerCase();
  const globalWorkQuery = useAllWorkItemHeadsQuery(!normalizedClientId);
  const identityQuery = useIdentityQuery();
  const identityPubkey = identityQuery.data?.pubkey.toLowerCase() ?? "";
  const { activeCommunity } = useCommunities();
  const queryClient = useQueryClient();
  const submitMutation = useSubmitBusinessRecordMutation();
  const { goChannel, goClient, goWork } = useAppNavigation();

  let globalMatch: EventRecord<WorkItemHead> | null = null;
  let globalLookupError: unknown = null;
  if (!normalizedClientId && globalWorkQuery.isSuccess) {
    try {
      globalMatch = findUniqueWorkItem(
        globalWorkQuery.data,
        normalizedWorkItemId,
        null,
      );
    } catch (error) {
      globalLookupError = error;
    }
  }
  const exactClientId =
    normalizedClientId ?? globalMatch?.value.clientId ?? null;
  const clientRecords = useClientRecordsQuery(exactClientId);
  const headRecord = React.useMemo(() => {
    if (!exactClientId || !clientRecords.workItemsQuery.data) return null;
    return findUniqueWorkItem(
      clientRecords.workItemsQuery.data,
      normalizedWorkItemId,
      exactClientId,
    );
  }, [clientRecords.workItemsQuery.data, exactClientId, normalizedWorkItemId]);
  const head = headRecord?.value ?? null;
  const clientRecord = clientRecords.clientQuery.data ?? null;
  const clientHead = clientRecord?.value ?? null;
  const deliverableQuery = useClientDeliverableEventsQuery(
    exactClientId,
    head?.workItemId ?? null,
    Boolean(head),
  );
  const members = clientRecords.membersQuery.data ?? [];
  const memberByPubkey = React.useMemo(
    () =>
      new Map(members.map((member) => [member.pubkey.toLowerCase(), member])),
    [members],
  );
  const isAdmin = members.some(
    (member) =>
      member.pubkey.toLowerCase() === identityPubkey &&
      (member.role === "owner" || member.role === "admin"),
  );
  const isAssigned =
    head?.assignedPubkeys.some(
      (pubkey) => pubkey.toLowerCase() === identityPubkey,
    ) ?? false;
  const isApprover =
    head?.approverPubkeys.some(
      (pubkey) => pubkey.toLowerCase() === identityPubkey,
    ) ?? false;
  const clientIsActive = clientHead?.status === "active";
  const workIsArchived = head?.status === "archived";
  const workIsComplete = head?.status === "complete";
  const canMutateWork = Boolean(
    head &&
      clientIsActive &&
      !workIsArchived &&
      !workIsComplete &&
      (isAdmin || isAssigned),
  );
  const [editOpen, setEditOpen] = React.useState(false);
  const [versionDraft, setVersionDraft] = React.useState<{
    deliverableId: string | null;
    newDeliverableId: string | null;
  } | null>(null);
  const [approvalDraft, setApprovalDraft] = React.useState<{
    pointer: DeliverablePointer;
    version: EventRecord<DeliverableVersion>;
    decision: "approved" | "changes_requested";
  } | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const [editStatus, setEditStatus] = React.useState("active");
  const [editAssignees, setEditAssignees] = React.useState<string[]>([]);
  const [editApprovers, setEditApprovers] = React.useState<string[]>([]);
  const [versionTitle, setVersionTitle] = React.useState("");
  const [versionContent, setVersionContent] = React.useState("");
  const [approvalNote, setApprovalNote] = React.useState("");
  const [isSharingWork, setIsSharingWork] = React.useState(false);
  const pendingWorkShareRef = React.useRef<{
    event: RelayEvent;
    publishAttempted: boolean;
    scopeToken: string;
  } | null>(null);
  const editHead = headRecord?.value;
  const workReferenceTag = headRecord
    ? buildWorkItemReferenceTag(headRecord)
    : null;
  const workShareScopeToken = JSON.stringify([
    activeCommunity?.id ?? null,
    activeCommunity?.relayUrl ?? null,
    identityPubkey,
    exactClientId,
    workReferenceTag?.[1] ?? null,
  ]);
  const currentWorkShareScopeRef = React.useRef(workShareScopeToken);
  currentWorkShareScopeRef.current = workShareScopeToken;

  const versions = React.useMemo(() => {
    if (!deliverableQuery.data) return [];
    return deliverableQuery.data.filter(
      (record): record is EventRecord<DeliverableVersion> =>
        "version" in record.value,
    );
  }, [deliverableQuery.data]);
  const approvals = React.useMemo(() => {
    if (!deliverableQuery.data) return [];
    return deliverableQuery.data.filter(
      (record): record is EventRecord<DeliverableApproval> =>
        "decision" in record.value,
    );
  }, [deliverableQuery.data]);

  React.useEffect(() => {
    if (!editHead || !editOpen) return;
    setEditTitle(editHead.title);
    setEditStatus(editHead.status);
    setEditAssignees([...editHead.assignedPubkeys]);
    setEditApprovers([...editHead.approverPubkeys]);
  }, [editHead, editOpen]);

  const reloadLatest = async () => {
    if (!isBusinessRecordCommandRejection(submitMutation.error)) return;
    submitMutation.discardPending();
    await Promise.all([
      clientRecords.clientQuery.refetch(),
      clientRecords.workItemsQuery.refetch(),
      deliverableQuery.refetch(),
      queryClient.invalidateQueries({
        queryKey: ["business-records"],
      }),
    ]);
  };

  const retrySameUpdate = () => {
    if (submitMutation.variables)
      submitMutation.mutate(submitMutation.variables);
  };

  const shareWorkInClientChannel = async () => {
    if (
      !headRecord ||
      !workReferenceTag ||
      !clientHead ||
      !clientRecords.channel ||
      !identityPubkey ||
      clientRecords.channel.id.toLowerCase() !== clientHead.clientId
    ) {
      return;
    }

    const clientChannelId = clientHead.clientId;
    const coordinate = workReferenceTag[1];
    const scopeToken = currentWorkShareScopeRef.current;
    const isCurrentScope = () =>
      currentWorkShareScopeRef.current === scopeToken;
    setIsSharingWork(true);
    try {
      const existingReferences = await relayClient.fetchEvents({
        kinds: [KIND_STREAM_MESSAGE],
        "#h": [clientChannelId],
        "#a": [coordinate],
        limit: 100,
      });
      if (!isCurrentScope()) return;
      if (
        existingReferences.some((event) =>
          isWorkItemReferenceMessage(event, clientChannelId, coordinate),
        )
      ) {
        pendingWorkShareRef.current = null;
        void goChannel(clientChannelId);
        return;
      }

      let pending = pendingWorkShareRef.current;
      if (!pending || pending.scopeToken !== scopeToken) {
        const template = buildWorkItemReferenceMessageTemplate(
          headRecord,
          identityPubkey,
        );
        const signedEvent = await signRelayEvent(template);
        if (!isCurrentScope()) return;
        if (signedEvent.pubkey.toLowerCase() !== identityPubkey) {
          throw new Error("The signed work reference has a different author.");
        }
        pending = {
          event: signedEvent,
          publishAttempted: false,
          scopeToken,
        };
        pendingWorkShareRef.current = pending;
      }

      if (pending.publishAttempted) {
        const observed = await relayClient.fetchEvents({
          ids: [pending.event.id],
          kinds: [KIND_STREAM_MESSAGE],
          "#h": [clientChannelId],
          limit: 1,
        });
        if (!isCurrentScope()) return;
        if (
          observed.some((event) =>
            isExpectedWorkItemReference(
              event,
              pending.event,
              clientChannelId,
              coordinate,
            ),
          )
        ) {
          pendingWorkShareRef.current = null;
          void goChannel(clientChannelId);
          return;
        }
      }

      if (!isCurrentScope()) return;
      pending.publishAttempted = true;
      pendingWorkShareRef.current = pending;
      try {
        await relayClient.publishEvent(
          pending.event,
          "Timed out sharing this work item.",
          "Failed to share this work item.",
        );
      } catch (publishError) {
        if (!isCurrentScope()) return;
        const observed = await relayClient.fetchEvents({
          ids: [pending.event.id],
          kinds: [KIND_STREAM_MESSAGE],
          "#h": [clientChannelId],
          limit: 1,
        });
        if (!isCurrentScope()) return;
        if (
          observed.some((event) =>
            isExpectedWorkItemReference(
              event,
              pending.event,
              clientChannelId,
              coordinate,
            ),
          )
        ) {
          pendingWorkShareRef.current = null;
          void goChannel(clientChannelId);
          return;
        }
        throw publishError;
      }

      if (!isCurrentScope()) return;
      pendingWorkShareRef.current = null;
      void goChannel(clientChannelId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Work item could not be shared.",
      );
    } finally {
      setIsSharingWork(false);
    }
  };

  const updateStatus = (status: string) => {
    if (!headRecord || !canMutateWork) return;
    submitMutation.mutate(mutationTemplate(headRecord, { status }));
  };

  const saveWorkDetails = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitMutation.isError) {
      retrySameUpdate();
      return;
    }
    if (!headRecord || !head || !isAdmin || !clientIsActive || workIsArchived)
      return;
    const title = editTitle.trim();
    if (!title) return;
    submitMutation.mutate(
      mutationTemplate(headRecord, {
        title,
        status: editStatus,
        assignedPubkeys: [
          ...new Set(editAssignees.map((value) => value.toLowerCase())),
        ].sort(),
        approverPubkeys: [
          ...new Set(editApprovers.map((value) => value.toLowerCase())),
        ].sort(),
      }),
      { onSuccess: () => setEditOpen(false) },
    );
  };

  const saveDeliverableVersion = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitMutation.isError) {
      retrySameUpdate();
      return;
    }
    if (!head || !canMutateWork || !versionDraft) return;
    const title = versionTitle.trim();
    const content = versionContent.trim();
    if (!title || !content) return;
    const previous = versionDraft.deliverableId
      ? (head.deliverables.find(
          (pointer) => pointer.deliverableId === versionDraft.deliverableId,
        ) ?? null)
      : null;
    const previousRecord = previous
      ? (versions.find(
          (record) => record.event.id === previous.versionEventId,
        ) ?? null)
      : null;
    if (previous && !previousRecord) return;
    const body = { title, content };
    const template = buildDeliverableVersionTemplate({
      clientId: head.clientId,
      workItemId: head.workItemId,
      deliverableId:
        previous?.deliverableId ??
        versionDraft.newDeliverableId ??
        crypto.randomUUID(),
      version: previousRecord ? previousRecord.value.version + 1 : 1,
      previousVersionEventId: previous?.versionEventId ?? null,
      mediaDigests: [],
      body,
    });
    submitMutation.mutate(template, {
      onSuccess: () => {
        setVersionDraft(null);
        setVersionTitle("");
        setVersionContent("");
      },
    });
  };

  const recordApproval = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitMutation.isError) {
      retrySameUpdate();
      return;
    }
    if (
      !head ||
      !clientIsActive ||
      workIsArchived ||
      !approvalDraft ||
      !isApprover
    )
      return;
    const note = approvalNote.trim();
    if (approvalDraft.decision === "changes_requested" && !note) return;
    submitMutation.mutate(
      buildDeliverableApprovalTemplate({
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: head.clientId,
        workItemId: head.workItemId,
        deliverableId: approvalDraft.version.value.deliverableId,
        versionEventId: approvalDraft.version.event.id,
        contentDigest: approvalDraft.version.value.contentDigest,
        mediaDigest: computeDeliverableDigests(
          approvalDraft.version.value.body,
          approvalDraft.version.value.mediaDigests,
        ).mediaDigest,
        decision: approvalDraft.decision,
        note: note || null,
      }),
      {
        onSuccess: () => {
          setApprovalDraft(null);
          setApprovalNote("");
        },
      },
    );
  };

  if (!normalizedClientId && globalWorkQuery.isPending) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage>Loading work</RecordMessage>
      </ClientWorkspace>
    );
  }
  if (globalLookupError) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This work record could not be resolved to one client.
        </RecordMessage>
        <Button onClick={() => void goWork()} variant="outline">
          All work
        </Button>
      </ClientWorkspace>
    );
  }
  if (!normalizedClientId && globalWorkQuery.isError) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          Work records could not be loaded.
        </RecordMessage>
        <Button
          onClick={() => void globalWorkQuery.refetch()}
          variant="outline"
        >
          Retry
        </Button>
      </ClientWorkspace>
    );
  }
  if (!exactClientId && globalWorkQuery.isSuccess) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This work item was not found in your client channels.
        </RecordMessage>
        <Button onClick={() => void goWork()} variant="outline">
          All work
        </Button>
      </ClientWorkspace>
    );
  }
  if (clientRecords.channelsQuery.isSuccess && !clientRecords.channel) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This client is unavailable to the current identity in this business.
        </RecordMessage>
        <Button onClick={() => void goWork()} variant="outline">
          All work
        </Button>
      </ClientWorkspace>
    );
  }
  if (
    clientRecords.channelsQuery.isPending ||
    clientRecords.clientQuery.isPending ||
    clientRecords.workItemsQuery.isPending
  ) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage>Loading work item</RecordMessage>
      </ClientWorkspace>
    );
  }
  if (
    clientRecords.liveError ||
    clientRecords.clientQuery.isError ||
    clientRecords.workItemsQuery.isError
  ) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          Work item records could not be loaded for this client.
        </RecordMessage>
      </ClientWorkspace>
    );
  }
  if (!clientHead) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          No client record exists in the selected private channel.
        </RecordMessage>
        <Button onClick={() => void goWork()} variant="outline">
          All work
        </Button>
      </ClientWorkspace>
    );
  }
  if (!headRecord || !head) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This work item was not found in the selected client channel.
        </RecordMessage>
        <Button
          onClick={() => void goWork(clientHead.clientId)}
          variant="outline"
        >
          All work for this client
        </Button>
      </ClientWorkspace>
    );
  }

  const currentDeliverableRecords = head.deliverables.map((pointer) => {
    const versionRecord =
      versions.find((record) => record.event.id === pointer.versionEventId) ??
      null;
    const versionApprovals = approvals
      .filter(
        (record) => record.value.versionEventId === pointer.versionEventId,
      )
      .sort((left, right) => right.event.created_at - left.event.created_at);
    return { pointer, versionRecord, versionApprovals };
  });
  const hasCurrentOutput = head.deliverables.length > 0;
  const editingDisabled = submitMutation.isPending || submitMutation.isError;

  return (
    <ClientWorkspace
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            onClick={() => void goWork(clientHead.clientId)}
            variant="outline"
          >
            All work
          </Button>
          {clientIsActive && clientRecords.channel ? (
            <Button
              disabled={isSharingWork || !identityQuery.isSuccess}
              onClick={() => void shareWorkInClientChannel()}
              variant="outline"
            >
              Share in client channel
            </Button>
          ) : null}
          {isAdmin && clientIsActive && !workIsArchived && !workIsComplete ? (
            <Button onClick={() => setEditOpen(true)} variant="outline">
              Edit work
            </Button>
          ) : null}
        </div>
      }
      title={head.title}
    >
      {submitMutation.isError ? (
        <RecordMessage kind="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{submitMutation.error.message}</span>
            <span className="flex gap-2">
              <Button
                disabled={submitMutation.isPending || !submitMutation.variables}
                onClick={retrySameUpdate}
                size="sm"
                variant="outline"
              >
                Retry same update
              </Button>
              {isBusinessRecordCommandRejection(submitMutation.error) ? (
                <Button
                  disabled={submitMutation.isPending}
                  onClick={() => void reloadLatest()}
                  size="sm"
                  variant="outline"
                >
                  Reload latest
                </Button>
              ) : null}
            </span>
          </div>
        </RecordMessage>
      ) : null}
      {clientRecords.membersQuery.isError ? (
        <RecordMessage kind="error">
          Client channel members could not be loaded.
        </RecordMessage>
      ) : null}
      {!clientIsActive ? (
        <RecordMessage>
          This client is archived. Work stays visible, and work changes are
          unavailable until the client is restored.
        </RecordMessage>
      ) : null}
      {clientRecords.membersQuery.isPending ? (
        <RecordMessage>Loading client access</RecordMessage>
      ) : null}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.85fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <RecordCard title="Brief">
            <dl className="grid gap-5 sm:grid-cols-2">
              <RecordField label="Client">
                <button
                  className="text-left underline-offset-4 hover:text-primary hover:underline"
                  onClick={() => void goClient(clientHead.clientId)}
                  type="button"
                >
                  {clientHead.displayName}
                </button>
              </RecordField>
              <RecordField label="Status">
                {displayStatus(head.status)}
              </RecordField>
              <RecordField label="Owner">
                {head.assignedPubkeys
                  .map(
                    (pubkey) =>
                      memberByPubkey.get(pubkey.toLowerCase())?.displayName ??
                      truncateNpub(pubkey),
                  )
                  .join(", ") || "No owner assigned"}
              </RecordField>
              <RecordField label="Client reviewers">
                {head.approverPubkeys
                  .map(
                    (pubkey) =>
                      memberByPubkey.get(pubkey.toLowerCase())?.displayName ??
                      truncateNpub(pubkey),
                  )
                  .join(", ") || "No reviewer assigned"}
              </RecordField>
            </dl>
          </RecordCard>

          <RecordCard
            action={
              canMutateWork && !editingDisabled ? (
                <Button
                  onClick={() => {
                    setVersionTitle("");
                    setVersionContent("");
                    setVersionDraft({
                      deliverableId: null,
                      newDeliverableId: crypto.randomUUID(),
                    });
                  }}
                  size="sm"
                >
                  Add deliverable
                </Button>
              ) : null
            }
            title="Deliverables"
          >
            {deliverableQuery.isPending ? (
              <RecordMessage>Loading deliverables</RecordMessage>
            ) : null}
            {deliverableQuery.isError ? (
              <RecordMessage kind="error">
                Deliverable history could not be loaded.
              </RecordMessage>
            ) : null}
            {currentDeliverableRecords.length === 0 ? (
              <RecordMessage>
                No deliverables are attached to this work item.
              </RecordMessage>
            ) : null}
            <div className="flex flex-col gap-3">
              {currentDeliverableRecords.map(
                ({ pointer, versionRecord, versionApprovals }) => {
                  const body = versionRecord
                    ? jsonBodyParts(versionRecord.value.body)
                    : null;
                  const currentApproval = versionApprovals[0] ?? null;
                  const canReview = Boolean(
                    isApprover &&
                      clientIsActive &&
                      !workIsArchived &&
                      versionRecord,
                  );
                  return (
                    <article
                      className="rounded-lg border border-border/70 bg-background p-4"
                      key={pointer.deliverableId}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold">
                            {body?.title ||
                              `Deliverable ${truncatePubkey(pointer.deliverableId)}`}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {versionRecord
                              ? `Version ${versionRecord.value.version}`
                              : "Current version unavailable"}
                            {currentApproval
                              ? ` · ${displayStatus(currentApproval.value.decision)}`
                              : " · Review required"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canMutateWork &&
                          versionRecord &&
                          !editingDisabled ? (
                            <Button
                              onClick={() => {
                                setVersionTitle(body?.title ?? "");
                                setVersionContent(body?.content ?? "");
                                setVersionDraft({
                                  deliverableId: pointer.deliverableId,
                                  newDeliverableId: null,
                                });
                              }}
                              size="sm"
                              variant="outline"
                            >
                              New version
                            </Button>
                          ) : null}
                          {canReview && !editingDisabled ? (
                            <>
                              <Button
                                onClick={() => {
                                  if (!versionRecord) return;
                                  setApprovalNote("");
                                  setApprovalDraft({
                                    pointer,
                                    version: versionRecord,
                                    decision: "approved",
                                  });
                                }}
                                size="sm"
                                variant="outline"
                              >
                                Approve version
                              </Button>
                              <Button
                                onClick={() => {
                                  if (!versionRecord) return;
                                  setApprovalNote("");
                                  setApprovalDraft({
                                    pointer,
                                    version: versionRecord,
                                    decision: "changes_requested",
                                  });
                                }}
                                size="sm"
                                variant="outline"
                              >
                                Request changes
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {body?.content ? (
                        <div className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-sm">
                          {body.content.slice(0, MAX_DELIVERABLE_PREVIEW_CHARS)}
                          {body.content.length >
                          MAX_DELIVERABLE_PREVIEW_CHARS ? (
                            <p className="mt-3 text-muted-foreground">
                              Preview truncated. Open the exact version in the
                              client channel for the complete record.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {currentApproval?.value.note ? (
                        <div className="mt-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                          <p className="text-xs text-muted-foreground">
                            Latest review from{" "}
                            {memberByPubkey.get(
                              currentApproval.event.pubkey.toLowerCase(),
                            )?.displayName ??
                              truncateNpub(currentApproval.event.pubkey)}{" "}
                            · {eventTime(currentApproval.event.created_at)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">
                            {currentApproval.value.note}
                          </p>
                        </div>
                      ) : null}
                      <details className="mt-4 border-t border-border/70 pt-3">
                        <summary className="cursor-pointer text-sm text-muted-foreground">
                          Version history
                        </summary>
                        <div className="mt-3 flex flex-col gap-3">
                          {versions
                            .filter(
                              (record) =>
                                record.value.deliverableId ===
                                pointer.deliverableId,
                            )
                            .sort(
                              (left, right) =>
                                right.value.version - left.value.version,
                            )
                            .map((record) => {
                              const versionBody = jsonBodyParts(
                                record.value.body,
                              );
                              const versionReview = approvals
                                .filter(
                                  (approval) =>
                                    approval.value.versionEventId ===
                                    record.event.id,
                                )
                                .sort(
                                  (left, right) =>
                                    right.event.created_at -
                                    left.event.created_at,
                                )[0];
                              return (
                                <div
                                  className="border-l-2 border-border pl-3"
                                  key={record.event.id}
                                >
                                  <p className="text-sm font-medium">
                                    Version {record.value.version}
                                    {record.event.id === pointer.versionEventId
                                      ? " · Current"
                                      : ""}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {eventTime(record.event.created_at)}
                                    {versionReview
                                      ? ` · ${displayStatus(versionReview.value.decision)}`
                                      : " · Review required"}
                                  </p>
                                  {versionBody.title ? (
                                    <p className="mt-1 text-sm">
                                      {versionBody.title}
                                    </p>
                                  ) : null}
                                  {versionReview?.value.note ? (
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                                      {versionReview.value.note}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })}
                          {versions.filter(
                            (record) =>
                              record.value.deliverableId ===
                              pointer.deliverableId,
                          ).length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No version event is available for this pointer.
                            </p>
                          ) : null}
                        </div>
                      </details>
                    </article>
                  );
                },
              )}
            </div>
          </RecordCard>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <RecordCard title="Move the work forward">
            {workIsArchived ? (
              <RecordMessage>
                This work item is archived and read-only.
              </RecordMessage>
            ) : head.status === "complete" ? (
              isAdmin && clientIsActive ? (
                <Button
                  disabled={editingDisabled}
                  onClick={() => updateStatus("active")}
                  variant="outline"
                >
                  Reopen work
                </Button>
              ) : (
                <RecordMessage>
                  Completion evidence is not recorded here.
                </RecordMessage>
              )
            ) : (
              <div className="flex flex-col gap-3">
                <Button
                  disabled={
                    !canMutateWork ||
                    head.status === "review" ||
                    !hasCurrentOutput ||
                    editingDisabled
                  }
                  onClick={() => updateStatus("review")}
                >
                  Request review
                </Button>
                <Button
                  disabled={!canMutateWork || editingDisabled}
                  onClick={() => updateStatus("paused")}
                  variant="outline"
                >
                  Pause work
                </Button>
                {head.status === "paused" ? (
                  <Button
                    disabled={!canMutateWork || editingDisabled}
                    onClick={() => updateStatus("active")}
                    variant="outline"
                  >
                    Resume work
                  </Button>
                ) : null}
                {!hasCurrentOutput ? (
                  <p className="text-sm text-muted-foreground">
                    Add a deliverable before requesting review.
                  </p>
                ) : null}
                {!isAdmin && !isAssigned ? (
                  <RecordMessage>
                    Only an assigned person or client channel admin can update
                    this work item.
                  </RecordMessage>
                ) : null}
                {head.approverPubkeys.length === 0 ? (
                  <RecordMessage>
                    No client reviewer is assigned to this work item.
                  </RecordMessage>
                ) : null}
              </div>
            )}
            <div className="mt-4 border-t border-border/70 pt-4">
              <Button
                onClick={() => void goChannel(clientHead.clientId)}
                variant="link"
              >
                Open client channel
              </Button>
            </div>
          </RecordCard>
        </aside>
      </div>

      <WorkDetailDialogs
        approvalDraft={approvalDraft}
        approvalNote={approvalNote}
        clientDisplayName={clientHead.displayName}
        clientIsActive={clientIsActive}
        editApprovers={editApprovers}
        editAssignees={editAssignees}
        editOpen={editOpen}
        editStatus={editStatus}
        editTitle={editTitle}
        isAdmin={isAdmin}
        isSubmitting={submitMutation.isPending}
        hasSubmitError={submitMutation.isError}
        editingDisabled={editingDisabled}
        head={head}
        members={members}
        onApprovalNoteChange={setApprovalNote}
        onEditApproversChange={setEditApprovers}
        onEditAssigneesChange={setEditAssignees}
        onEditOpenChange={setEditOpen}
        onEditStatusChange={setEditStatus}
        onEditTitleChange={setEditTitle}
        onRecordApproval={recordApproval}
        onSaveDeliverableVersion={saveDeliverableVersion}
        onSaveWorkDetails={saveWorkDetails}
        onVersionContentChange={setVersionContent}
        onVersionDraftChange={setVersionDraft}
        onVersionTitleChange={setVersionTitle}
        onApprovalDraftChange={setApprovalDraft}
        versionContent={versionContent}
        versionDraft={versionDraft}
        versionTitle={versionTitle}
        versions={versions}
      />
    </ClientWorkspace>
  );
}
