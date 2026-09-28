import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import {
  useCompanyWorkHeadsQuery,
  useCompanyWorkMoveReferencesQuery,
} from "../hooks";
import type { CompanyWorkHeadRecord } from "../companyWorkModels";
import { CompanyWorkStatusBadge } from "./CompanyWorkPresentation";

export function CompanyWorkThreadContextPanel({
  channelId,
  threadRootId,
  enabled = true,
}: {
  channelId: string | null;
  threadRootId: string;
  enabled?: boolean;
}) {
  const headsQuery = useCompanyWorkHeadsQuery(enabled);
  const movesQuery = useCompanyWorkMoveReferencesQuery(enabled);
  const identityQuery = useIdentityQuery();
  const { goChannel, goCompanyWorkDetail, goCompanyWorkTracking } =
    useAppNavigation();
  const records = headsQuery.data ?? [];
  const recordsById = new Map(
    records.map((record) => [record.head.workItemId, record]),
  );
  const currentRecords = records.filter(
    (record) =>
      record.channelId.toLowerCase() === channelId?.toLowerCase() &&
      record.head.threadRootEventId?.toLowerCase() ===
        threadRootId.toLowerCase(),
  );
  const moveReferences = (movesQuery.data ?? []).filter(
    (reference) =>
      reference.fromRootId?.toLowerCase() === threadRootId.toLowerCase() &&
      reference.toRootId?.toLowerCase() !== threadRootId.toLowerCase(),
  );
  const referencedRecords = moveReferences.flatMap((reference) => {
    const record = recordsById.get(reference.workItemId);
    return record ? [{ reference, record }] : [];
  });
  const pubkeys = React.useMemo(
    () => [
      ...new Set(
        [
          ...currentRecords.flatMap((record) => [
            ...record.head.assignedPubkeys,
            record.head.requesterPubkey,
          ]),
          ...referencedRecords.flatMap(({ reference, record }) => [
            reference.actorPubkey,
            ...record.head.assignedPubkeys,
          ]),
        ].map((pubkey) => pubkey.toLowerCase()),
      ),
    ],
    [currentRecords, referencedRecords],
  );
  const profilesQuery = useUsersBatchQuery(pubkeys, {
    enabled: pubkeys.length > 0,
  });
  const currentPubkey = identityQuery.data?.pubkey;
  const profiles = profilesQuery.data?.profiles;
  const channels = headsQuery.channelsQuery.data ?? [];
  if (
    !enabled ||
    (!headsQuery.isPending &&
      !headsQuery.isError &&
      !movesQuery.isPending &&
      !movesQuery.isError &&
      currentRecords.length === 0 &&
      referencedRecords.length === 0)
  ) {
    return null;
  }

  return (
    <section
      aria-label="Tracked work"
      className="mx-5 mb-4 rounded-xl border border-border bg-background p-4"
      data-testid="company-work-thread-context"
    >
      <h2 className="text-sm font-semibold">Tracked work</h2>
      {headsQuery.isPending || movesQuery.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Checking linked work
        </p>
      ) : null}
      {headsQuery.isError || movesQuery.isError ? (
        <div className="mt-3 rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">
            {headsQuery.isError
              ? "Tracked work is unavailable."
              : "Moved work references are unavailable."}
          </p>
          <Button
            className="mt-2"
            onClick={() => {
              void headsQuery.refetch();
              void movesQuery.refetch();
            }}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}
      {currentRecords.map((record) => (
        <TrackedWorkCard
          currentPubkey={currentPubkey}
          key={record.head.workItemId}
          onOpen={() =>
            void goCompanyWorkDetail(record.head.workItemId, { replace: true })
          }
          onOpenTimeline={() =>
            void goCompanyWorkTracking("timeline", record.head.workItemId)
          }
          onOpenWatchdog={() =>
            void goCompanyWorkTracking("watchdog", record.head.workItemId)
          }
          profiles={profiles}
          record={record}
        />
      ))}
      {referencedRecords.map(({ reference, record }) => {
        const destinationChannel = channels.find(
          (channel) =>
            channel.id.toLowerCase() === record.channelId.toLowerCase(),
        );
        const actorLabel = resolveUserLabel({
          currentPubkey,
          profiles,
          pubkey: reference.actorPubkey,
          preferResolvedSelfLabel: true,
        });
        return (
          <div
            className="mt-3 rounded-lg border border-border bg-muted/30 p-3"
            data-testid={`company-work-moved-reference-${record.head.workItemId}`}
            key={reference.eventId}
          >
            <p className="text-xs text-muted-foreground">
              {actorLabel} moved this work item to another thread.
            </p>
            <Button
              className="mt-2 h-auto justify-start whitespace-normal p-0 text-left text-sm font-semibold"
              onClick={() => void goCompanyWorkDetail(record.head.workItemId)}
              variant="link"
            >
              {record.head.title}
            </Button>
            {record.head.threadRootEventId ? (
              <Button
                className="mt-1 block h-auto p-0 text-xs text-muted-foreground"
                disabled={!destinationChannel}
                onClick={() =>
                  void goChannel(record.channelId, {
                    messageId: record.head.threadRootEventId,
                    threadRootId: record.head.threadRootEventId,
                  })
                }
                variant="link"
              >
                Open moved thread
                {destinationChannel ? ` in #${destinationChannel.name}` : ""}
              </Button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function TrackedWorkCard({
  currentPubkey,
  onOpen,
  onOpenTimeline,
  onOpenWatchdog,
  profiles,
  record,
}: {
  currentPubkey?: string;
  onOpen: () => void;
  onOpenTimeline: () => void;
  onOpenWatchdog: () => void;
  profiles?: UserProfileLookup;
  record: CompanyWorkHeadRecord;
}) {
  const ownerLabel = resolveUserLabel({
    currentPubkey,
    profiles,
    pubkey: record.head.assignedPubkeys[0] ?? "",
    preferResolvedSelfLabel: true,
  });
  return (
    <div
      className="mt-3 rounded-lg border border-border p-3"
      data-testid={`company-work-current-card-${record.head.workItemId}`}
    >
      <Button
        aria-label={`Open work item ${record.head.title}`}
        className="h-auto justify-start whitespace-normal p-0 text-left text-sm font-semibold"
        onClick={onOpen}
        variant="link"
      >
        {record.head.title}
      </Button>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CompanyWorkStatusBadge status={record.head.status} />
        <span className="text-xs text-muted-foreground">
          Owner: {ownerLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          className="h-auto p-0 text-xs"
          onClick={onOpenTimeline}
          variant="link"
        >
          Full timeline
        </Button>
        <Button
          className="h-auto p-0 text-xs"
          onClick={onOpenWatchdog}
          variant="link"
        >
          Watchdog
        </Button>
      </div>
    </div>
  );
}
