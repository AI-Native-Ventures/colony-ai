import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { useCompanyWorkHeadsQuery } from "../hooks";
import type { CompanyWorkStatus } from "../companyWorkModels";
import {
  companyWorkPrimaryButtonClass,
  CompanyWorkListRow,
  CompanyWorkPageHeader,
} from "./CompanyWorkPresentation";

const filters: Array<"all" | CompanyWorkStatus> = [
  "all",
  "active",
  "paused",
  "blocked",
  "done_unverified",
  "done_verified",
  "archived",
];

export function CompanyWorkScreen() {
  const [statusFilter, setStatusFilter] =
    React.useState<(typeof filters)[number]>("all");
  const headsQuery = useCompanyWorkHeadsQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const { goNewCompanyWork } = useAppNavigation();
  const records = headsQuery.data ?? [];
  const visibleRecords = React.useMemo(
    () =>
      records.filter(
        (record) =>
          statusFilter === "all" || record.head.status === statusFilter,
      ),
    [records, statusFilter],
  );
  const people = React.useMemo(
    () => [
      ...new Set(
        records
          .flatMap((record) => [
            record.head.assignedPubkeys[0],
            record.head.requesterPubkey,
          ])
          .filter((pubkey): pubkey is string => Boolean(pubkey)),
      ),
    ],
    [records],
  );
  const profilesQuery = useUsersBatchQuery(people);
  const currentPubkey = identityQuery.data?.pubkey;
  const profiles = profilesQuery.data?.profiles;
  const channels = channelsQuery.data ?? [];

  return (
    <>
      <CompanyWorkPageHeader title="Work" />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="company-work-list"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Work</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
              Commitments from conversations. Each has an owner and a done
              condition.
            </p>
          </div>
          <Button
            className={companyWorkPrimaryButtonClass}
            onClick={() => void goNewCompanyWork()}
          >
            Create work item
          </Button>
        </div>

        <div className="mt-7 max-w-sm">
          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="company-work-status-filter"
          >
            Filter by status
            <select
              className="h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              data-testid="company-work-status-filter"
              id="company-work-status-filter"
              onChange={(event) =>
                setStatusFilter(event.target.value as (typeof filters)[number])
              }
              value={statusFilter}
            >
              {filters.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All work" : status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {headsQuery.isPending || channelsQuery.isPending ? (
          <div
            className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
            role="status"
          >
            Loading work
          </div>
        ) : headsQuery.isError || channelsQuery.isError ? (
          <div className="mt-6 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">Work unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {headsQuery.isError
                ? headsQuery.error.message
                : "Conversations could not be loaded."}
            </p>
            <Button
              className="mt-5"
              onClick={() => {
                void headsQuery.refetch();
                void channelsQuery.refetch();
              }}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : visibleRecords.length > 0 ? (
          <div className="mt-5" data-testid="company-work-rows">
            {visibleRecords.map((record) => {
              const channel = channels.find(
                (candidate) => candidate.id === record.channelId,
              );
              return (
                <CompanyWorkListRow
                  channelLabel={channel?.name ?? record.channelId.slice(0, 8)}
                  key={record.head.workItemId}
                  ownerLabel={resolveUserLabel({
                    currentPubkey,
                    profiles,
                    pubkey: record.head.assignedPubkeys[0] ?? "",
                    preferResolvedSelfLabel: true,
                  })}
                  record={record}
                />
              );
            })}
          </div>
        ) : null}
        {headsQuery.liveError ? (
          <p className="mt-4 text-xs text-muted-foreground" role="status">
            Live updates are reconnecting. The list will refresh when the
            connection is available.
          </p>
        ) : null}
        {profilesQuery.isError || identityQuery.isError ? (
          <p className="mt-4 text-xs text-muted-foreground" role="status">
            Some names are unavailable.
          </p>
        ) : null}
      </main>
    </>
  );
}
