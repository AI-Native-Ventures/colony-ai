import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useAllWorkItemHeadsQuery } from "@/features/clients/useBusinessRecords";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  ClientWorkspace,
  RecordMessage,
} from "@/features/clients/ui/ClientWorkspace";
import { CreateWorkDialog } from "@/features/clients/ui/CreateWorkDialog";
import type { WorkItemHead } from "@/features/clients/lib/businessRecords";
import { Button } from "@/shared/ui/button";

type WorkRecord = {
  eventId: string;
  clientName: string;
  ownerNames: string;
  value: WorkItemHead;
};

const BASE_STATUSES = ["active", "review", "blocked", "paused", "complete"];
const MAX_OWNER_PROFILES = 256;

function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

export function WorkScreen({ initialClientId }: { initialClientId?: string }) {
  const workQuery = useAllWorkItemHeadsQuery();
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
  const ownerPubkeys = React.useMemo(
    () =>
      [
        ...new Set(
          (workQuery.data ?? []).flatMap(({ value }) =>
            value.assignedPubkeys.map((pubkey) => pubkey.toLowerCase()),
          ),
        ),
      ]
        .sort()
        .slice(0, MAX_OWNER_PROFILES),
    [workQuery.data],
  );
  const ownerProfilesQuery = useUsersBatchQuery(ownerPubkeys, {
    enabled: workQuery.isSuccess,
  });
  const profiles = ownerProfilesQuery.data?.profiles;
  const records: WorkRecord[] = React.useMemo(
    () =>
      (workQuery.data ?? []).map(({ event, value }) => ({
        eventId: event.id,
        clientName: clientNameById.get(value.clientId) ?? "Client unavailable",
        ownerNames:
          value.assignedPubkeys
            .map((pubkey) => {
              const normalized = pubkey.toLowerCase();
              return (
                profiles?.[normalized]?.displayName?.trim() ||
                shortKey(normalized)
              );
            })
            .join(", ") || "Unassigned",
        value,
      })),
    [clientNameById, profiles, workQuery.data],
  );
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

  return (
    <ClientWorkspace
      action={<Button onClick={() => setCreateOpen(true)}>New work</Button>}
      title="Work"
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
      {workQuery.isPending ? <RecordMessage>Loading work</RecordMessage> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border/70 bg-card p-1">
          <Button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            size="sm"
            variant={view === "list" ? "secondary" : "ghost"}
          >
            List
          </Button>
          <Button
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
            size="sm"
            variant={view === "board" ? "secondary" : "ghost"}
          >
            Board
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>Work status</span>
          <select
            className="h-9 rounded-lg border border-input/40 bg-background px-3 text-sm"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option value="all">All work</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>
      {workQuery.isSuccess && records.length === 0 ? (
        <RecordMessage>
          No work records are available for your client channels.
        </RecordMessage>
      ) : null}
      {filtered.length > 0 && view === "list" ? (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-xs">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-muted-foreground">
                <th className="px-3 py-3 font-medium">Work</th>
                <th className="px-3 py-3 font-medium">Client</th>
                <th className="px-3 py-3 font-medium">Owner</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Deliverables</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ eventId, value, clientName, ownerNames }) => (
                <tr
                  className="border-b border-border/50 last:border-0"
                  key={eventId}
                >
                  <td className="px-3 py-3">
                    <button
                      className="text-left font-medium underline-offset-4 hover:text-primary hover:underline"
                      onClick={() =>
                        void goWorkItem(value.workItemId, value.clientId)
                      }
                      type="button"
                    >
                      {value.title}
                    </button>
                  </td>
                  <td className="px-3 py-3">{clientName}</td>
                  <td className="px-3 py-3">{ownerNames}</td>
                  <td className="px-3 py-3 capitalize">{value.status}</td>
                  <td className="px-3 py-3">{value.deliverables.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {filtered.length > 0 && view === "board" ? (
        <div className="grid min-w-0 gap-3 xl:grid-cols-5">
          {statuses.map((status) => (
            <section
              className="min-w-0 rounded-xl border border-border/70 bg-muted/30 p-3"
              key={status}
            >
              <h2 className="mb-3 flex items-center justify-between text-sm font-semibold capitalize">
                <span>{status}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {
                    filtered.filter((record) => record.value.status === status)
                      .length
                  }
                </span>
              </h2>
              <div className="flex flex-col gap-2">
                {filtered
                  .filter((record) => record.value.status === status)
                  .map(({ eventId, value, clientName, ownerNames }) => (
                    <button
                      className="rounded-lg border border-border/70 bg-card p-3 text-left shadow-xs hover:border-primary/40"
                      key={eventId}
                      onClick={() =>
                        void goWorkItem(value.workItemId, value.clientId)
                      }
                      type="button"
                    >
                      <span className="block text-sm font-medium">
                        {value.title}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {clientName}
                      </span>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {ownerNames} · {value.deliverables.length} deliverables
                      </span>
                    </button>
                  ))}
                {filtered.every((record) => record.value.status !== status) ? (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    No work here.
                  </p>
                ) : null}
              </div>
            </section>
          ))}
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
