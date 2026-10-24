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
import { clockTime, onDayLabel } from "@/features/clients/lib/formatWhen";
import { useLatestChannelMessage } from "@/features/clients/lib/useLatestChannelMessage";
import { usePeople } from "@/features/clients/lib/usePeople";
import { WorkDeliverableCard } from "@/features/clients/ui/WorkDeliverableCard";
import {
  PersonAvatar,
  PlusIcon,
  workStatusLabel,
  WorkStatusPill,
} from "@/features/clients/ui/BusinessBits";
import { StateButton } from "@/features/clients/ui/BusinessStates";
import { BusinessTrail } from "@/features/clients/ui/BusinessTrail";
import {
  ClientWorkspace,
  RecordMessage,
} from "@/features/clients/ui/ClientWorkspace";
import { useIdentityQuery } from "@/shared/api/hooks";
import { signRelayEvent } from "@/shared/api/tauri";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import { toast } from "sonner";
import { WorkDetailDialogs } from "@/features/clients/ui/WorkDetailDialogs";

/** "today, 14:05" or "on 21 Oct, 14:05". */
function sinceLabel(seconds: number): string {
  return `${onDayLabel(seconds)}, ${clockTime(seconds)}`;
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

  const latestMessage = useLatestChannelMessage(head ? exactClientId : null);
  const { person } = usePeople([
    ...(head?.assignedPubkeys ?? []),
    ...(head?.approverPubkeys ?? []),
    ...versions.map((record) => record.event.pubkey),
    ...approvals.map((record) => record.event.pubkey),
    ...(latestMessage.data ? [latestMessage.data.pubkey] : []),
  ]);
  const personName = (pubkey: string) =>
    memberByPubkey.get(pubkey.toLowerCase())?.displayName ??
    person(pubkey).name;

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
        <RecordMessage kind="loading">Loading work</RecordMessage>
      </ClientWorkspace>
    );
  }
  if (globalLookupError) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This work record could not be resolved to one client.
        </RecordMessage>
        <StateButton onClick={() => void goWork()}>All work</StateButton>
      </ClientWorkspace>
    );
  }
  if (!normalizedClientId && globalWorkQuery.isError) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          Work records could not be loaded.
        </RecordMessage>
        <StateButton onClick={() => void globalWorkQuery.refetch()}>
          Retry
        </StateButton>
      </ClientWorkspace>
    );
  }
  if (!exactClientId && globalWorkQuery.isSuccess) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This work item was not found in your client channels.
        </RecordMessage>
        <StateButton onClick={() => void goWork()}>All work</StateButton>
      </ClientWorkspace>
    );
  }
  if (clientRecords.channelsQuery.isSuccess && !clientRecords.channel) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This client is unavailable to the current identity in this business.
        </RecordMessage>
        <StateButton onClick={() => void goWork()}>All work</StateButton>
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
        <RecordMessage kind="loading">Loading work item</RecordMessage>
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
        <StateButton onClick={() => void goWork()}>All work</StateButton>
      </ClientWorkspace>
    );
  }
  if (!headRecord || !head) {
    return (
      <ClientWorkspace title="Work">
        <RecordMessage kind="error">
          This work item was not found in the selected client channel.
        </RecordMessage>
        <StateButton onClick={() => void goWork(clientHead.clientId)}>
          All work for this client
        </StateButton>
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
  const ownerPubkey = head.assignedPubkeys[0] ?? null;
  const ownerName = ownerPubkey ? personName(ownerPubkey) : null;
  const channelName = clientRecords.channel?.name ?? clientHead.displayName;
  const sinceSeconds = headRecord.event.created_at;
  const canReopen =
    (head.status === "review" || head.status === "complete") &&
    isAdmin &&
    clientIsActive &&
    !workIsArchived;

  return (
    <ClientWorkspace
      header={
        <div className="b3-work-head">
          <div className="b3-work-head-copy">
            <div className="b3-chip-row">
              <WorkStatusPill status={head.status} />
              <span className="b3-chip">{clientHead.displayName}</span>
            </div>
            <h1 className="b3-title" data-tight="true">
              {head.title}
            </h1>
          </div>
          <div className="b3-work-actions">
            <button
              className="b3-btn"
              data-size="md"
              onClick={() => void goWork(clientHead.clientId)}
              type="button"
            >
              All work
            </button>
            {clientIsActive && clientRecords.channel ? (
              <button
                className="b3-btn"
                data-size="md"
                disabled={isSharingWork || !identityQuery.isSuccess}
                onClick={() => void shareWorkInClientChannel()}
                type="button"
              >
                Share in client channel
              </button>
            ) : null}
            {isAdmin && clientIsActive && !workIsArchived && !workIsComplete ? (
              <button
                className="b3-btn"
                data-size="md"
                data-variant="primary"
                onClick={() => setEditOpen(true)}
                type="button"
              >
                Edit work
              </button>
            ) : null}
          </div>
        </div>
      }
      title={head.title}
      variant="work-detail"
    >
      <BusinessTrail
        crumbs={[
          { label: "Company" },
          { label: "Work", onClick: () => void goWork() },
          { label: head.title },
        ]}
      />
      {submitMutation.isError ? (
        <RecordMessage kind="error">
          <span className="b3-grow">{submitMutation.error.message}</span>
          <button
            className="b3-btn"
            data-size="action"
            disabled={submitMutation.isPending || !submitMutation.variables}
            onClick={retrySameUpdate}
            type="button"
          >
            Retry same update
          </button>
          {isBusinessRecordCommandRejection(submitMutation.error) ? (
            <button
              className="b3-btn"
              data-size="action"
              disabled={submitMutation.isPending}
              onClick={() => void reloadLatest()}
              type="button"
            >
              Reload latest
            </button>
          ) : null}
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
        <RecordMessage kind="loading">Loading client access</RecordMessage>
      ) : null}
      <div className="b3-work-body">
        <div className="b3-work-main">
          <section aria-labelledby="work-brief" className="b3-card b3-panel">
            <h2 className="b3-panel-title" id="work-brief">
              Brief
            </h2>
            <dl className="b3-brief-grid">
              <div className="b3-fact">
                <dt>Client</dt>
                <dd>
                  <button
                    onClick={() => void goClient(clientHead.clientId)}
                    type="button"
                  >
                    {clientHead.displayName}
                  </button>
                </dd>
              </div>
              <div className="b3-fact">
                <dt>Status</dt>
                <dd>{workStatusLabel(head.status)}</dd>
              </div>
              <div className="b3-fact">
                <dt>Owner</dt>
                <dd data-person={ownerPubkey ? "true" : undefined}>
                  {ownerPubkey ? (
                    <PersonAvatar person={person(ownerPubkey)} size={26} />
                  ) : null}
                  {head.assignedPubkeys.map(personName).join(", ") ||
                    "No owner assigned"}
                </dd>
              </div>
              <div className="b3-fact">
                <dt>Client reviewers</dt>
                <dd>
                  {head.approverPubkeys.map(personName).join(", ") ||
                    "No reviewer assigned"}
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="work-deliverables"
            className="b3-card b3-deliverables"
          >
            <div className="b3-deliverables-head">
              <h2 className="b3-panel-title" id="work-deliverables">
                Deliverables
              </h2>
              <span className="b3-deliverables-count">
                {head.deliverables.length}
              </span>
              {canMutateWork && !editingDisabled ? (
                <button
                  className="b3-btn"
                  onClick={() => {
                    setVersionTitle("");
                    setVersionContent("");
                    setVersionDraft({
                      deliverableId: null,
                      newDeliverableId: crypto.randomUUID(),
                    });
                  }}
                  type="button"
                >
                  <PlusIcon size={15} />
                  Add deliverable
                </button>
              ) : null}
            </div>
            {deliverableQuery.isPending ? (
              <div className="b3-deliverable-card">
                <RecordMessage kind="loading">
                  Loading deliverables
                </RecordMessage>
              </div>
            ) : null}
            {deliverableQuery.isError ? (
              <div className="b3-deliverable-card">
                <RecordMessage kind="error">
                  Deliverable history could not be loaded.
                </RecordMessage>
              </div>
            ) : null}
            {currentDeliverableRecords.length === 0 ? (
              <div className="b3-deliverable-card">
                <RecordMessage>
                  No deliverables are attached to this work item.
                </RecordMessage>
              </div>
            ) : null}
            {currentDeliverableRecords.map(
              ({ pointer, versionRecord, versionApprovals }) => (
                <WorkDeliverableCard
                  allVersions={versions
                    .filter(
                      (record) =>
                        record.value.deliverableId === pointer.deliverableId,
                    )
                    .sort(
                      (left, right) => right.value.version - left.value.version,
                    )}
                  approvals={approvals}
                  canMutateWork={canMutateWork}
                  canReview={Boolean(
                    isApprover &&
                      clientIsActive &&
                      !workIsArchived &&
                      versionRecord,
                  )}
                  editingDisabled={editingDisabled}
                  key={pointer.deliverableId}
                  onNewVersion={(target, body) => {
                    setVersionTitle(body?.title ?? "");
                    setVersionContent(body?.content ?? "");
                    setVersionDraft({
                      deliverableId: target.deliverableId,
                      newDeliverableId: null,
                    });
                  }}
                  onReview={(target, version, nextDecision) => {
                    setApprovalNote("");
                    setApprovalDraft({
                      pointer: target,
                      version,
                      decision: nextDecision,
                    });
                  }}
                  person={person}
                  personName={personName}
                  pointer={pointer}
                  versionApprovals={versionApprovals}
                  versionRecord={versionRecord}
                />
              ),
            )}
          </section>
        </div>

        <aside aria-label="Work actions" className="b3-work-side">
          <section
            aria-labelledby="work-forward"
            className="b3-card b3-panel"
            data-size="side"
          >
            <h2 className="b3-panel-title" id="work-forward">
              Move the work forward
            </h2>
            {workIsArchived ? (
              <RecordMessage>
                This work item is archived and read-only.
              </RecordMessage>
            ) : (
              <>
                {head.status === "review" ? (
                  <p className="b3-forward-help">
                    In review since {sinceLabel(sinceSeconds)}. Approve the
                    latest version or ask {ownerName ?? "the owner"} for
                    changes.
                  </p>
                ) : null}
                {head.status === "complete" ? (
                  isAdmin && clientIsActive ? null : (
                    <RecordMessage>
                      Completion evidence is not recorded here.
                    </RecordMessage>
                  )
                ) : (
                  <button
                    className="b3-wide-btn"
                    disabled={
                      !canMutateWork ||
                      head.status === "review" ||
                      !hasCurrentOutput ||
                      editingDisabled
                    }
                    onClick={() => updateStatus("review")}
                    type="button"
                  >
                    Request review
                  </button>
                )}
                <div className="b3-forward-grid">
                  {head.status === "complete" ? null : head.status ===
                    "paused" ? (
                    <button
                      className="b3-wide-btn"
                      disabled={!canMutateWork || editingDisabled}
                      onClick={() => updateStatus("active")}
                      type="button"
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      className="b3-wide-btn"
                      disabled={!canMutateWork || editingDisabled}
                      onClick={() => updateStatus("paused")}
                      type="button"
                    >
                      Pause
                    </button>
                  )}
                  {canReopen ? (
                    <button
                      className="b3-wide-btn"
                      disabled={editingDisabled}
                      onClick={() => updateStatus("active")}
                      type="button"
                    >
                      Reopen
                    </button>
                  ) : null}
                </div>
                {head.status !== "complete" && !hasCurrentOutput ? (
                  <p className="b3-fine">
                    Add a deliverable before requesting review.
                  </p>
                ) : null}
                {head.status !== "complete" && !isAdmin && !isAssigned ? (
                  <RecordMessage>
                    Only an assigned person or client channel admin can update
                    this work item.
                  </RecordMessage>
                ) : null}
                {head.status !== "complete" &&
                head.approverPubkeys.length === 0 ? (
                  <RecordMessage>
                    No client reviewer is assigned to this work item.
                  </RecordMessage>
                ) : null}
              </>
            )}
          </section>

          <section
            aria-labelledby="work-conversation"
            className="b3-card b3-panel"
            data-size="side"
          >
            <h2 className="b3-panel-title" id="work-conversation">
              Conversation
            </h2>
            {latestMessage.data ? (
              <div className="b3-conversation">
                <PersonAvatar
                  person={person(latestMessage.data.pubkey)}
                  size={32}
                />
                <span className="b3-conversation-copy">
                  <span className="b3-conversation-text">
                    {latestMessage.data.content}
                  </span>
                  <span className="b3-conversation-meta">
                    {personName(latestMessage.data.pubkey)} · #{channelName} ·{" "}
                    {clockTime(latestMessage.data.createdAt)}
                  </span>
                </span>
              </div>
            ) : null}
            <button
              className="b3-wide-btn"
              onClick={() => void goChannel(clientHead.clientId)}
              type="button"
            >
              Open #{channelName}
            </button>
          </section>
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
