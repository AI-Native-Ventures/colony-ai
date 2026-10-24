import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import type { WorkItemHead } from "@/features/clients/lib/businessRecords";
import { usePeople, type PersonInfo } from "@/features/clients/lib/usePeople";
import {
  latestDeliverable,
  useAllWorkItemHeadsQuery,
  useDeliverableSummaries,
} from "@/features/clients/useBusinessRecords";
import {
  BoardIcon,
  FileIcon,
  formatStatus,
  ListIcon,
  PersonAvatar,
  PlusIcon,
  WorkStatusPill,
} from "@/features/clients/ui/BusinessBits";
import {
  ClientWorkspace,
  RecordMessage,
} from "@/features/clients/ui/ClientWorkspace";
import { CreateWorkDialog } from "@/features/clients/ui/CreateWorkDialog";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";

type WorkRecord = {
  eventId: string;
  clientName: string;
  value: WorkItemHead;
};

const BASE_STATUSES = ["active", "review", "blocked", "paused", "complete"];

/** "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function WorkingBadge({
  clientId,
  pubkey,
}: {
  clientId: string;
  pubkey: string;
}) {
  const state = useAgentWorking(pubkey, clientId);
  if (!state.working) return null;
  return (
    <span className="b3-working">
      <span aria-hidden="true" className="b3-working-dot" />
      Working
    </span>
  );
}

function OwnerCell({
  clientId,
  owners,
  size,
}: {
  clientId: string;
  owners: readonly PersonInfo[];
  size: 26 | 30;
}) {
  const first = owners[0];
  if (!first) return <span className="b3-meta">Unassigned</span>;
  return (
    <span className="b3-owner">
      <PersonAvatar person={first} size={size} />
      <span className="b3-owner-stack">
        {owners.map((owner) => owner.name).join(", ")}
        {first.isAgent ? (
          <WorkingBadge clientId={clientId} pubkey={first.pubkey} />
        ) : null}
      </span>
    </span>
  );
}

export function WorkScreen({ initialClientId }: { initialClientId?: string }) {
  const workQuery = useAllWorkItemHeadsQuery();
  const identityQuery = useIdentityQuery();
  const membership = useMyRelayMembershipQuery();
  const { goWorkItem } = useAppNavigation();
  const [view, setView] = React.useState<"list" | "board">("list");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const clients = workQuery.directoryQuery.data ?? [];
  const clientNameById = React.useMemo(
    () =>
      new Map(clients.map(({ value }) => [value.clientId, value.displayName])),
    [clients],
  );
  const { person } = usePeople(
    (workQuery.data ?? []).flatMap(({ value }) => value.assignedPubkeys),
  );
  const summaries = useDeliverableSummaries(workQuery.data).data;
  /** "Make room for slow mornings · v2", or a count while the title loads. */
  const deliverableLine = (value: WorkItemHead) => {
    const latest = latestDeliverable(value, summaries);
    if (latest?.title) return `${latest.title} · v${latest.version}`;
    const count = value.deliverables.length;
    return `${count} ${count === 1 ? "deliverable" : "deliverables"}`;
  };
  const records: WorkRecord[] = React.useMemo(() => {
    const rank = (status: string) => {
      const index = BASE_STATUSES.indexOf(status);
      return index === -1 ? BASE_STATUSES.length : index;
    };
    return (workQuery.data ?? [])
      .map(({ event, value }) => ({
        eventId: event.id,
        clientName: clientNameById.get(value.clientId) ?? "Client unavailable",
        value,
      }))
      .sort(
        (left, right) => rank(left.value.status) - rank(right.value.status),
      );
  }, [clientNameById, workQuery.data]);
  const statuses = React.useMemo(
    () => [
      ...new Set([
        ...BASE_STATUSES,
        ...records.map((record) => record.value.status),
      ]),
    ],
    [records],
  );
  const filtered =
    statusFilter === "all"
      ? records
      : records.filter((record) => record.value.status === statusFilter);
  const selfPubkey = identityQuery.data?.pubkey.toLowerCase() ?? "";
  const relayRole = membership.data?.role;
  const canReview = relayRole === "owner" || relayRole === "admin";
  const needsMyReview = (value: WorkItemHead) =>
    value.status === "review" &&
    (canReview ||
      value.approverPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === selfPubkey,
      ));
  const clientNames = clients.map(({ value }) => value.displayName);
  const open = (value: WorkItemHead) =>
    void goWorkItem(value.workItemId, value.clientId);

  return (
    <ClientWorkspace
      action={
        <button
          className="b3-btn"
          data-variant="primary"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          <PlusIcon />
          New work
        </button>
      }
      subtitle={
        clientNames.length > 0
          ? `Client work for ${joinNames(clientNames)}`
          : undefined
      }
      title="Work"
      wide
    >
      {workQuery.directoryQuery.isError ? (
        <RecordMessage kind="error">
          Client records could not be loaded.
        </RecordMessage>
      ) : null}
      {workQuery.liveError ? (
        <RecordMessage kind="error">
          Live work updates could not be started.
        </RecordMessage>
      ) : null}
      {workQuery.isError ? (
        <RecordMessage kind="error">
          Work records could not be loaded.
        </RecordMessage>
      ) : null}
      {workQuery.isPending ? (
        <RecordMessage kind="loading">Loading work</RecordMessage>
      ) : null}
      <div className="b3-controls">
        <label className="b3-select-label">
          Work status
          <select
            className="b3-select"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option value="all">All work</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="b3-seg">
          <legend className="b3-sr-only">Layout</legend>
          <button
            aria-pressed={view === "list"}
            className="b3-seg-btn"
            onClick={() => setView("list")}
            type="button"
          >
            <ListIcon />
            List
          </button>
          <button
            aria-pressed={view === "board"}
            className="b3-seg-btn"
            onClick={() => setView("board")}
            type="button"
          >
            <BoardIcon />
            Board
          </button>
        </fieldset>
      </div>
      {workQuery.isSuccess && records.length === 0 ? (
        <RecordMessage>
          No work records are available for your client channels.
        </RecordMessage>
      ) : null}
      {filtered.length > 0 && view === "list" ? (
        <>
          <div className="b3-card b3-work-table-wrap">
            <table className="b3-work-table">
              <caption className="b3-sr-only">
                Client work, all statuses
              </caption>
              <thead>
                <tr>
                  <th scope="col">Work</th>
                  <th scope="col">Client</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                  <th scope="col">Deliverables</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ eventId, value, clientName }) => {
                  const owners = value.assignedPubkeys.map(person);
                  const reviewNeeded = needsMyReview(value);
                  return (
                    <tr
                      data-needs-review={reviewNeeded}
                      key={eventId}
                      onClick={(event) => {
                        if (!(event.target as Element).closest("button")) {
                          open(value);
                        }
                      }}
                    >
                      <td>
                        <button
                          className="b3-work-cell-title"
                          onClick={() => open(value)}
                          type="button"
                        >
                          <span className="b3-work-cell-title-text">
                            {value.title}
                          </span>
                          {reviewNeeded ? (
                            <span className="b3-work-flag">
                              Needs your review
                            </span>
                          ) : null}
                        </button>
                      </td>
                      <td>
                        <span className="b3-chip">{clientName}</span>
                      </td>
                      <td>
                        <OwnerCell
                          clientId={value.clientId}
                          owners={owners}
                          size={30}
                        />
                      </td>
                      <td>
                        <WorkStatusPill
                          label={formatStatus(value.status)}
                          status={value.status}
                        />
                      </td>
                      <td>
                        <span className="b3-deliverable">
                          <span
                            className="b3-deliverable-icon"
                            data-empty={value.deliverables.length === 0}
                          >
                            {value.deliverables.length > 0 ? (
                              <FileIcon />
                            ) : null}
                          </span>
                          <span className="b3-owner-stack">
                            <span className="b3-deliverable-count">
                              {value.deliverables.length}
                            </span>
                            <span className="b3-deliverable-name">
                              {value.deliverables.length === 0
                                ? "None yet"
                                : deliverableLine(value)}
                            </span>
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="b3-work-footer">
            <span>
              {records.length} work {records.length === 1 ? "item" : "items"} ·{" "}
              {
                records.filter((record) => record.value.status === "paused")
                  .length
              }{" "}
              paused ·{" "}
              {
                records.filter((record) => record.value.status === "complete")
                  .length
              }{" "}
              complete
            </span>
          </div>
        </>
      ) : null}
      {filtered.length > 0 && view === "board" ? (
        <div className="b3-board-scroll">
          <div
            className="b3-board"
            style={{
              gridTemplateColumns: `repeat(${statuses.length}, minmax(calc(210 * var(--b3u)), 1fr))`,
              minWidth: `calc(${statuses.length * 210 + (statuses.length - 1) * 14} * var(--b3u))`,
            }}
          >
            {statuses.map((status) => {
              const inColumn = filtered.filter(
                (record) => record.value.status === status,
              );
              return (
                <section
                  aria-labelledby={`work-column-${status}`}
                  className="b3-column"
                  key={status}
                >
                  <h2 className="b3-column-title" id={`work-column-${status}`}>
                    <span
                      className="b3-column-dot"
                      data-ring={!BASE_STATUSES.includes(status)}
                      data-status={status}
                    />
                    {formatStatus(status)}
                    <span className="b3-column-count">{inColumn.length}</span>
                  </h2>
                  {inColumn.map(({ eventId, value, clientName }) => {
                    const owners = value.assignedPubkeys.map(person);
                    const first = owners[0];
                    return (
                      <button
                        className="b3-board-card"
                        key={eventId}
                        onClick={() => open(value)}
                        type="button"
                      >
                        <span className="b3-chip" data-size="sm">
                          {clientName}
                        </span>
                        <span className="b3-board-card-title">
                          {value.title}
                        </span>
                        {value.deliverables.length > 0 ? (
                          <span className="b3-board-card-line">
                            <FileIcon />
                            {deliverableLine(value)}
                          </span>
                        ) : null}
                        {needsMyReview(value) ? (
                          <WorkStatusPill
                            label="Needs your review"
                            size="sm"
                            status="review"
                          />
                        ) : null}
                        <span className="b3-board-card-foot">
                          {first ? (
                            <PersonAvatar person={first} size={26} />
                          ) : null}
                          {owners.map((owner) => owner.name).join(", ") ||
                            "Unassigned"}
                          {first?.isAgent ? (
                            <WorkingBadge
                              clientId={value.clientId}
                              pubkey={first.pubkey}
                            />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                  {inColumn.length === 0 ? (
                    <div className="b3-column-empty">No work here.</div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
      {filtered.length === 0 && records.length > 0 ? (
        <RecordMessage>No work matches this status.</RecordMessage>
      ) : null}
      <CreateWorkDialog
        clients={clients}
        initialClientId={initialClientId}
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
    </ClientWorkspace>
  );
}
