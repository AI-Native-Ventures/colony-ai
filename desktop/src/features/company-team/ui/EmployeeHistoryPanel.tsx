import * as React from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { truncateNpub } from "@/shared/lib/pubkey";
import type {
  EmployeeConfigSnapshot,
  EmployeeHistory,
  EmployeeRevision,
} from "../employeeHistory";
import type { PendingEmployeeRevision } from "../employeeHistory";

function sameSnapshot(
  first: EmployeeConfigSnapshot,
  second: EmployeeConfigSnapshot,
) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function snapshotFields(snapshot: EmployeeConfigSnapshot) {
  return [
    ["System instructions", snapshot.instructions],
    ["Provider", snapshot.provider],
    ["Model", snapshot.model],
    ["Runtime", snapshot.runtime],
  ] as const;
}

function changedSnapshotFields(
  before: EmployeeConfigSnapshot,
  after: EmployeeConfigSnapshot,
) {
  const beforeFields = snapshotFields(before);
  return snapshotFields(after).filter(([, value], index) => {
    return value !== beforeFields[index]?.[1];
  });
}

export function EmployeeHistoryPanel({
  actorPubkey,
  canUndo,
  historyQuery,
  pendingError,
  pendingRevisions,
  undoPending,
  onRetryPending,
  onUndo,
}: {
  actorPubkey: string;
  canUndo: boolean;
  historyQuery: UseQueryResult<EmployeeHistory, Error>;
  pendingError: string | null;
  pendingRevisions: PendingEmployeeRevision[];
  undoPending: boolean;
  onRetryPending: (index: number) => void;
  onUndo: (revision: EmployeeRevision) => Promise<void>;
}) {
  const [undoRevision, setUndoRevision] =
    React.useState<EmployeeRevision | null>(null);
  const [undoError, setUndoError] = React.useState<string | null>(null);
  const history = historyQuery.data;
  const historyActors = useUsersBatchQuery(
    (history?.revisions ?? []).map((revision) =>
      revision.event.pubkey.toLowerCase(),
    ),
    { enabled: (history?.revisions.length ?? 0) > 0 },
  );

  async function confirmUndo() {
    if (!undoRevision || !canUndo) return;
    setUndoError(null);
    try {
      await onUndo(undoRevision);
      setUndoRevision(null);
    } catch (error) {
      setUndoError(
        error instanceof Error
          ? error.message
          : "The employee configuration could not be restored.",
      );
    }
  }

  if (historyQuery.isLoading)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading employee history
      </p>
    );
  if (historyQuery.isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive" role="alert">
          Employee history could not be loaded: {historyQuery.error.message}
        </p>
        <Button
          onClick={() => void historyQuery.refetch()}
          type="button"
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );

  const revisions = [...(history?.revisions ?? [])].reverse();
  const isBusy = undoPending;
  return (
    <section data-testid="employee-history">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Configuration and lifecycle history
        </h2>
        <Button
          disabled={historyQuery.isFetching}
          onClick={() => void historyQuery.refetch()}
          type="button"
          variant="outline"
        >
          Refresh
        </Button>
      </div>
      {pendingRevisions.map((pending, index) => (
        <Alert className="mb-4" key={pending.pendingId}>
          <AlertTitle>History change waiting to sync</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {pendingError ?? "The configuration is saved on this device."}
            </span>
            {pending.actorPubkey.toLowerCase() === actorPubkey && canUndo ? (
              <Button
                disabled={isBusy}
                onClick={() => onRetryPending(index)}
                size="sm"
                type="button"
                variant="outline"
              >
                Retry history
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ))}
      {revisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No configuration revisions have been recorded yet.
        </p>
      ) : (
        <div className="space-y-4">
          {revisions.map((revision) => {
            const actorPubkey = revision.event.pubkey.toLowerCase();
            const actor =
              historyActors.data?.profiles[actorPubkey]?.displayName?.trim() ||
              truncateNpub(revision.event.pubkey);
            const changed = changedSnapshotFields(
              revision.action.before,
              revision.action.after,
            );
            return (
              <article
                className="rounded-lg border border-border p-4"
                data-testid={`employee-revision-${revision.event.id}`}
                key={revision.event.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {revision.action.action === "undo"
                        ? "Configuration restored"
                        : "Configuration changed"}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(
                        revision.event.created_at * 1_000,
                      ).toLocaleString()}{" "}
                      · {actor}
                    </p>
                  </div>
                  {canUndo &&
                  history?.head?.revisionEventId !== revision.event.id &&
                  !sameSnapshot(
                    revision.action.before,
                    history?.head?.snapshot ?? {},
                  ) ? (
                    <Button
                      onClick={() => {
                        setUndoRevision(revision);
                        setUndoError(null);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Review undo
                    </Button>
                  ) : null}
                </div>
                <dl className="mt-4 space-y-3">
                  {changed.map(([label, afterValue], index) => {
                    const beforeValue = snapshotFields(revision.action.before)[
                      index
                    ]?.[1];
                    return (
                      <div
                        className="grid gap-1 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]"
                        key={label}
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 break-words">
                          <span>{beforeValue || "Not set"}</span>
                          <span
                            aria-hidden="true"
                            className="mx-2 text-muted-foreground"
                          >
                            →
                          </span>
                          <span>{afterValue || "Not set"}</span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                {revision.action.undoOfEventId ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Undo of {revision.action.undoOfEventId}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      <AlertDialog
        open={undoRevision !== null}
        onOpenChange={(open) => {
          if (!open) setUndoRevision(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo configuration change?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new history entry restoring the previous values.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {undoRevision ? (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-sm">
              {snapshotFields(undoRevision.action.before).map(
                ([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                      {value ?? "Not set"}
                    </pre>
                  </div>
                ),
              )}
            </div>
          ) : null}
          {undoError ? (
            <p className="text-sm text-destructive" role="alert">
              {undoError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
            <Button
              disabled={isBusy}
              onClick={() => void confirmUndo()}
              type="button"
            >
              {isBusy ? "Restoring" : "Restore these values"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
