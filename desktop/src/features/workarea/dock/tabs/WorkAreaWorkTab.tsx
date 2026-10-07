import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { isCompanyWorkOverdue } from "@/features/company-work/companyWorkDueDate";
import type { CompanyWorkHeadRecord } from "@/features/company-work/companyWorkModels";
import { useCompanyWorkHeadsQuery } from "@/features/company-work/hooks";
import { CompanyWorkStatusBadge } from "@/features/company-work/ui/CompanyWorkPresentation";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { plainRelayErrorMessage } from "@/shared/lib/relayError";
import { Button } from "@/shared/ui/button";

import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { WorkAreaTabNotice } from "./WorkAreaTabNotice";
import { resolveWorkTabView } from "./workAreaWorkModel";

const TEST_ID = "work-area-work";

/**
 * Work tab: this channel's commitments from the company Work module, read with
 * the same hook, relay query and live subscription the Work screen uses and
 * narrowed to the channel. Nothing here is computed or sampled: every row is a
 * signed work item head the relay returned for this channel.
 */
export function WorkAreaWorkTab({ channelId }: WorkAreaTabPanelProps) {
  const heads = useCompanyWorkHeadsQuery();
  const { channelsQuery } = heads;
  const view = resolveWorkTabView({
    channelId,
    channels: {
      status: channelsQuery.status,
      error: channelsQuery.error,
      data: channelsQuery.data,
    },
    heads: { status: heads.status, error: heads.error, data: heads.data },
  });

  const failedError = view.state === "failed" ? view.error : null;
  React.useEffect(() => {
    // The raw text belongs in the log, never on screen.
    if (failedError !== null) {
      console.warn(
        "[work-area] work could not be loaded",
        failedError instanceof Error
          ? failedError.message
          : String(failedError),
      );
    }
  }, [failedError]);

  const retry = React.useCallback(() => {
    void channelsQuery.refetch();
    void heads.refetch();
  }, [channelsQuery, heads]);

  switch (view.state) {
    case "loading":
      return (
        <WorkAreaTabNotice
          state="loading"
          testId={`${TEST_ID}-state`}
          title="Loading work"
        />
      );
    case "failed":
      return (
        <WorkAreaTabNotice
          body={plainRelayErrorMessage(view.error)}
          onRetry={retry}
          state="failed"
          testId={`${TEST_ID}-state`}
          title="Work could not be loaded"
        />
      );
    case "denied":
      return (
        <WorkAreaTabNotice
          body="Work is listed for the channels you belong to. Join this channel to see its work."
          onRetry={retry}
          state="denied"
          testId={`${TEST_ID}-state`}
          title="You are not in this channel"
        />
      );
    case "unlisted":
      return (
        <WorkAreaTabNotice
          body={
            view.reason === "archived"
              ? "Work in an archived channel is not listed. Restore the channel to see it."
              : "Work is tracked in channels. Direct messages and forums are not listed."
          }
          state="unlisted"
          testId={`${TEST_ID}-state`}
          title="No work is listed here"
        />
      );
    case "empty":
      return (
        <WorkAreaTabNotice
          body="Commitments made in this channel appear here with an owner and a done condition."
          state="empty"
          testId={`${TEST_ID}-state`}
          title="No work in this channel yet"
        />
      );
    case "ready":
      return (
        <WorkList liveError={heads.liveError !== null} records={view.records} />
      );
  }
}

function WorkList({
  records,
  liveError,
}: {
  records: readonly CompanyWorkHeadRecord[];
  liveError: boolean;
}) {
  const { goCompanyWork, goCompanyWorkDetail } = useAppNavigation();
  const identityQuery = useIdentityQuery();
  const owners = React.useMemo(
    () => [
      ...new Set(
        records.flatMap((record) => record.head.assignedPubkeys.slice(0, 1)),
      ),
    ],
    [records],
  );
  const profilesQuery = useUsersBatchQuery(owners);
  const currentPubkey = identityQuery.data?.pubkey;
  const profiles = profilesQuery.data?.profiles;
  // Read the clock once per list, not once per row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list reads the clock again.
  const now = React.useMemo(() => Date.now(), [records]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={TEST_ID}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <strong
          className="font-semibold text-foreground"
          data-testid={`${TEST_ID}-count`}
        >
          {records.length} commitment{records.length === 1 ? "" : "s"}
        </strong>
        <Button
          className="h-7 px-2 text-xs"
          data-testid={`${TEST_ID}-open-all`}
          onClick={() => void goCompanyWork()}
          size="sm"
          type="button"
          variant="ghost"
        >
          Open all work
        </Button>
      </div>
      <ul
        aria-label="Work in this channel"
        className="min-h-0 flex-1 overflow-auto"
        data-testid={`${TEST_ID}-rows`}
      >
        {records.map((record) => {
          const ownerLabel = resolveUserLabel({
            currentPubkey,
            profiles,
            pubkey: record.head.assignedPubkeys[0] ?? "",
            preferResolvedSelfLabel: true,
          });
          const overdue = isCompanyWorkOverdue(
            record.head.dueAt,
            record.head.status,
            now,
          );
          return (
            <li key={record.head.workItemId}>
              <button
                aria-label={`Open work item ${record.head.title}`}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`${TEST_ID}-row-${record.head.workItemId}`}
                onClick={() => void goCompanyWorkDetail(record.head.workItemId)}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {record.head.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {record.head.assignedPubkeys.length > 0
                      ? ownerLabel
                      : "No owner"}
                    {overdue ? " · Overdue" : ""}
                  </span>
                </span>
                <CompanyWorkStatusBadge status={record.head.status} />
                <span
                  aria-hidden="true"
                  className="text-sm text-muted-foreground"
                >
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {liveError ? (
        <p
          className="border-t border-border px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          Live updates are reconnecting. The list refreshes when the connection
          is back.
        </p>
      ) : null}
    </div>
  );
}
