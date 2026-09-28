import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { useGoalHeadsQuery } from "@/features/goals/goalRelay";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { useCompanyWorkHeadsQuery, useCompanyWorkHistoryQuery } from "../hooks";
import { projectCompanyWorkTimeline } from "../companyWorkTimeline";
import {
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
  CompanyWorkStatusBadge,
} from "./CompanyWorkPresentation";
import { CompanyWorkThreadContextPanel } from "./CompanyWorkThreadContextPanel";

export type CompanyWorkTrackingScreenKind =
  | "suggestion"
  | "timeline"
  | "panel"
  | "person"
  | "watchdog"
  | "watchdog-saved"
  | "failed"
  | "unavailable"
  | "empty";

type CompanyWorkTrackingScreensProps = {
  channelId?: string;
  resourceId: string;
  screen: CompanyWorkTrackingScreenKind;
  threadRootId?: string;
};

export function CompanyWorkTrackingScreens(
  props: CompanyWorkTrackingScreensProps,
) {
  switch (props.screen) {
    case "person":
      return <CompanyWorkPersonScreen pubkey={props.resourceId} />;
    case "timeline":
      return <CompanyWorkTimelineScreen workItemId={props.resourceId} />;
    case "panel":
      return (
        <CompanyWorkPanelScreen
          channelId={props.channelId}
          threadRootId={props.threadRootId}
        />
      );
    case "suggestion":
      return <SuggestionUnavailableScreen />;
    case "watchdog":
      return <WatchdogUnavailableScreen workItemId={props.resourceId} />;
    case "watchdog-saved":
      return <WatchdogSavedUnavailableScreen />;
    case "failed":
      return (
        <UnavailableScreen
          message="A tracking action failed. Retry it from the work item after checking its current state."
          title="Tracking action failed"
        />
      );
    case "empty":
      return (
        <UnavailableScreen
          message="There are no linked work items in this view."
          title="No tracked work"
        />
      );
    case "unavailable":
      return (
        <UnavailableScreen
          message="Company work tracking is unavailable in this community."
          title="Tracking unavailable"
        />
      );
  }
}

function CompanyWorkPersonScreen({ pubkey }: { pubkey: string }) {
  const headsQuery = useCompanyWorkHeadsQuery();
  const identityQuery = useIdentityQuery();
  const profilesQuery = useUsersBatchQuery([pubkey]);
  const { goCompanyWork, goCompanyWorkDetail, goProfile } = useAppNavigation();
  const normalizedPubkey = pubkey.toLowerCase();
  const records = (headsQuery.data ?? []).filter((record) =>
    record.head.assignedPubkeys.some(
      (assignedPubkey) => assignedPubkey.toLowerCase() === normalizedPubkey,
    ),
  );
  const profiles: UserProfileLookup | undefined = profilesQuery.data?.profiles;
  const personLabel = resolveUserLabel({
    currentPubkey: identityQuery.data?.pubkey,
    profiles,
    pubkey: normalizedPubkey,
    preferResolvedSelfLabel: true,
  });

  if (headsQuery.channelsQuery.isPending || headsQuery.isPending) {
    return <LoadingScreen title="Loading commitments" />;
  }
  if (headsQuery.channelsQuery.isError || headsQuery.isError) {
    return (
      <UnavailableScreen
        message={errorMessage(
          headsQuery.channelsQuery.isError
            ? headsQuery.channelsQuery.error
            : headsQuery.error,
        )}
        onRetry={() => {
          void headsQuery.channelsQuery.refetch();
          void headsQuery.refetch();
        }}
        title="Commitments are unavailable"
      />
    );
  }

  return (
    <>
      <CompanyWorkPageHeader title="Work" />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
        <h1 className="text-2xl font-bold tracking-tight">
          {personLabel}’s commitments
        </h1>
        <section
          aria-label={`${personLabel}’s commitments`}
          className="mt-7 rounded-xl border border-border p-6"
          data-testid="company-work-person-commitments"
        >
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No current commitments for {personLabel}.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {records.map((record) => {
                const channel = headsQuery.channelsQuery.data?.find(
                  (candidate) => candidate.id === record.channelId,
                );
                return (
                  <li
                    className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0"
                    data-testid={`company-work-person-row-${record.head.workItemId}`}
                    key={record.head.workItemId}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                    >
                      {personLabel.slice(0, 1).toUpperCase()}
                    </span>
                    <Button
                      className="h-auto min-w-0 flex-1 justify-start whitespace-normal p-0 text-left font-semibold"
                      onClick={() =>
                        void goCompanyWorkDetail(record.head.workItemId)
                      }
                      variant="link"
                    >
                      {record.head.title}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {channel
                        ? `#${channel.name}`
                        : "Conversation unavailable"}
                    </span>
                    <CompanyWorkStatusBadge status={record.head.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <Button
          className="mt-5"
          onClick={() => void goProfile(normalizedPubkey)}
          variant="outline"
        >
          Open {personLabel}’s profile
        </Button>
      </main>
    </>
  );
}

function CompanyWorkTimelineScreen({ workItemId }: { workItemId: string }) {
  const headsQuery = useCompanyWorkHeadsQuery();
  const goalsQuery = useGoalHeadsQuery();
  const identityQuery = useIdentityQuery();
  const channelsQuery = useChannelsQuery();
  const { goCompanyWorkDetail, goCompanyWorkTracking, goChannel } =
    useAppNavigation();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  const historyQuery = useCompanyWorkHistoryQuery(
    record?.channelId ?? null,
    record?.head.workItemId ?? null,
    Boolean(record),
  );
  const history = historyQuery.data ?? [];
  const timeline = React.useMemo(
    () => projectCompanyWorkTimeline(history),
    [history],
  );
  const pubkeys = React.useMemo(
    () => [
      ...new Set(
        [
          ...(record?.head.assignedPubkeys ?? []),
          ...history.map((entry) => entry.event.pubkey),
        ].map((value) => value.toLowerCase()),
      ),
    ],
    [history, record],
  );
  const profilesQuery = useUsersBatchQuery(pubkeys, {
    enabled: pubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles;
  const currentPubkey = identityQuery.data?.pubkey;
  const ownerPubkey = record?.head.assignedPubkeys[0];
  const ownerLabel = ownerPubkey
    ? resolveUserLabel({ currentPubkey, profiles, pubkey: ownerPubkey })
    : "Unassigned";
  const linkedGoal = record?.head.goalId
    ? goalsQuery.data?.find(
        (candidate) => candidate.head.goalId === record.head.goalId,
      )
    : undefined;
  const channel = channelsQuery.data?.find(
    (candidate) => candidate.id === record?.channelId,
  );
  const rootId = record?.head.threadRootEventId ?? record?.head.sourceEventId;

  if (
    channelsQuery.isPending ||
    headsQuery.channelsQuery.isPending ||
    headsQuery.isPending ||
    (record && historyQuery.isPending)
  ) {
    return <LoadingScreen title="Loading work activity" />;
  }
  if (
    channelsQuery.isError ||
    headsQuery.channelsQuery.isError ||
    headsQuery.isError ||
    historyQuery.isError
  ) {
    const error = channelsQuery.isError
      ? channelsQuery.error
      : headsQuery.channelsQuery.isError
        ? headsQuery.channelsQuery.error
        : headsQuery.isError
          ? headsQuery.error
          : historyQuery.error;
    return (
      <UnavailableScreen
        message={errorMessage(error)}
        onRetry={() => {
          void headsQuery.refetch();
          void headsQuery.channelsQuery.refetch();
          void channelsQuery.refetch();
          void historyQuery.refetch();
        }}
        title="Work activity is unavailable"
      />
    );
  }
  if (!record) {
    return (
      <UnavailableScreen
        message="This work item is not available in the current community."
        title="Work item unavailable"
      />
    );
  }

  return (
    <>
      <CompanyWorkPageHeader title={record.head.title} />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {record.head.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">Activity</p>
          </div>
          <CompanyWorkStatusBadge status={record.head.status} />
        </div>
        <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]">
          <section
            aria-label="Work activity"
            className="rounded-xl border border-border p-6"
            data-testid="company-work-full-timeline"
          >
            <h2 className="text-base font-semibold">Activity</h2>
            {timeline.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No work activity is available yet.
              </p>
            ) : (
              <ol className="mt-5 space-y-1">
                {timeline.map((entry) => (
                  <li
                    className="relative border-l border-border pb-5 pl-5 last:pb-0 before:absolute before:-left-[3px] before:top-1.5 before:size-1.5 before:rounded-full before:bg-primary"
                    key={entry.eventId}
                  >
                    <time
                      className="block text-2xs text-muted-foreground"
                      dateTime={new Date(entry.createdAt * 1000).toISOString()}
                    >
                      {new Date(entry.createdAt * 1000).toLocaleString()}
                    </time>
                    <strong className="mt-1 block text-sm font-semibold">
                      {resolveUserLabel({
                        currentPubkey,
                        profiles,
                        pubkey: entry.actorPubkey,
                        preferResolvedSelfLabel: true,
                      })}{" "}
                      {entry.label}
                    </strong>
                    {entry.reason ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {entry.reason}
                      </p>
                    ) : null}
                    {entry.evidence ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {entry.evidence}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <aside className="rounded-xl border border-border p-6">
            <h2 className="text-base font-semibold">Work context</h2>
            <dl className="mt-4 divide-y divide-border text-sm">
              <ContextRow label="Owner" value={ownerLabel} />
              <ContextRow
                label="Goal"
                value={linkedGoal?.head.title ?? "No linked goal"}
              />
              <ContextRow
                label="Status"
                value={record.head.status.replaceAll("_", " ")}
              />
            </dl>
            <div className="mt-5 grid gap-2">
              <Button
                disabled={!channel || !rootId}
                onClick={() =>
                  channel && rootId
                    ? void goChannel(record.channelId, {
                        messageId: rootId,
                        threadRootId: record.head.threadRootEventId ?? null,
                      })
                    : undefined
                }
                variant="outline"
              >
                Open discussion
              </Button>
              <Button
                onClick={() =>
                  void goCompanyWorkTracking("watchdog", workItemId)
                }
                variant="outline"
              >
                Watchdog settings
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function CompanyWorkPanelScreen({
  channelId,
  threadRootId,
}: {
  channelId?: string;
  threadRootId?: string;
}) {
  const headsQuery = useCompanyWorkHeadsQuery(
    Boolean(channelId && threadRootId),
  );
  const { goCompanyWork } = useAppNavigation();
  const records = (headsQuery.data ?? []).filter(
    (record) =>
      record.channelId.toLowerCase() === channelId?.toLowerCase() &&
      record.head.threadRootEventId?.toLowerCase() ===
        threadRootId?.toLowerCase(),
  );

  if (!channelId || !threadRootId) {
    return (
      <UnavailableScreen
        message="Open this view from a conversation thread."
        title="Thread context unavailable"
      />
    );
  }
  if (headsQuery.channelsQuery.isPending || headsQuery.isPending)
    return <LoadingScreen title="Loading tracked work" />;
  if (headsQuery.channelsQuery.isError || headsQuery.isError) {
    return (
      <UnavailableScreen
        message={errorMessage(
          headsQuery.channelsQuery.isError
            ? headsQuery.channelsQuery.error
            : headsQuery.error,
        )}
        onRetry={() => {
          void headsQuery.channelsQuery.refetch();
          void headsQuery.refetch();
        }}
        title="Tracked work is unavailable"
      />
    );
  }
  return (
    <>
      <CompanyWorkPageHeader title="Tracked work" />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
        <h1 className="text-2xl font-bold tracking-tight">Tracked work</h1>
        {records.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            No current work items are linked to this thread.
          </p>
        ) : (
          <CompanyWorkThreadContextPanel
            channelId={channelId}
            threadRootId={threadRootId}
          />
        )}
      </main>
    </>
  );
}

function SuggestionUnavailableScreen() {
  return (
    <UnavailableScreen
      message="Commitment suggestions are unavailable because this community does not provide validated suggestions. Messages never create work automatically."
      title="Suggestions unavailable"
    />
  );
}

function WatchdogUnavailableScreen({ workItemId }: { workItemId: string }) {
  const headsQuery = useCompanyWorkHeadsQuery();
  const { goCompanyWork, goCompanyWorkDetail } = useAppNavigation();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  if (headsQuery.channelsQuery.isPending || headsQuery.isPending)
    return <LoadingScreen title="Loading watchdog settings" />;
  if (headsQuery.channelsQuery.isError || headsQuery.isError) {
    return (
      <UnavailableScreen
        message={errorMessage(
          headsQuery.channelsQuery.isError
            ? headsQuery.channelsQuery.error
            : headsQuery.error,
        )}
        onRetry={() => {
          void headsQuery.channelsQuery.refetch();
          void headsQuery.refetch();
        }}
        title="Watchdog settings unavailable"
      />
    );
  }
  if (!record) {
    return (
      <UnavailableScreen
        message="This work item is not available in the current community."
        title="Watchdog settings unavailable"
      />
    );
  }
  return (
    <>
      <CompanyWorkPageHeader title={record.head.title} />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Keep work from going quiet
        </h1>
        <section className="mt-7 rounded-xl border border-border p-6">
          <p className="text-sm font-semibold">Watchdog is off</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Business settings and scheduled check-in delivery are unavailable.
            No interval is selected or saved.
          </p>
          <Button className="mt-5" disabled variant="default">
            Save changes
          </Button>
        </section>
        <Button
          className="mt-4"
          onClick={() => void goCompanyWork()}
          variant="link"
        >
          Back to work
        </Button>
      </main>
    </>
  );
}

function WatchdogSavedUnavailableScreen() {
  return (
    <UnavailableScreen
      message="No watchdog settings were saved. The watchdog remains off until company-scoped settings and scheduled delivery are available."
      title="Watchdog settings were not saved"
    />
  );
}

function LoadingScreen({ title }: { title: string }) {
  return (
    <>
      <CompanyWorkPageHeader title="Work" />
      <div
        className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
        role="status"
      >
        {title}
      </div>
    </>
  );
}

function UnavailableScreen({
  message,
  onRetry,
  title,
}: {
  message: string;
  onRetry?: () => void;
  title: string;
}) {
  const { goCompanyWork } = useAppNavigation();
  return (
    <>
      <CompanyWorkPageHeader title="Work" />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <section className="mt-7 rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">{message}</p>
          {onRetry ? (
            <Button className="mt-5" onClick={onRetry} variant="outline">
              Try again
            </Button>
          ) : null}
        </section>
      </main>
    </>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
