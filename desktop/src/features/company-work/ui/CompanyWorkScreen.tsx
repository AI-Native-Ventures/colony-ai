import * as React from "react";
import { Diamond } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useGoalHeadsQuery } from "@/features/goals/goalRelay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { truncateNpub } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { useCompanyWorkHeadsQuery } from "../hooks";
import {
  clearCompanyWorkFilter,
  emptyCompanyWorkFilters,
  filterCompanyWorkRecords,
  goalFilterScope,
  type CompanyWorkStatusFilter,
} from "../companyWorkFilters";
import {
  companyWorkPrimaryButtonClass,
  CompanyWorkListRow,
  CompanyWorkPageHeader,
  companyWorkStatusLabel,
} from "./CompanyWorkPresentation";
import {
  CompanyWorkFilterPopover,
  type CompanyWorkFilterOption,
} from "./CompanyWorkFilterPopover";

const statuses: CompanyWorkStatusFilter[] = [
  "all",
  "active",
  "paused",
  "blocked",
  "done_unverified",
  "done_verified",
  "archived",
];

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#eee7f4] px-3 text-xs text-[#76608c] dark:bg-[#403449] dark:text-[#c1a6d8]">
      {label}
      <button
        aria-label={`Clear ${label} filter`}
        className="rounded-sm text-[#76608c] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-[#c1a6d8]"
        onClick={onClear}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
    </span>
  );
}

export function CompanyWorkScreen() {
  const [workFilters, setWorkFilters] = React.useState(emptyCompanyWorkFilters);
  const headsQuery = useCompanyWorkHeadsQuery();
  const channelsQuery = useChannelsQuery();
  const goalsQuery = useGoalHeadsQuery();
  const identityQuery = useIdentityQuery();
  const { goNewCompanyWork } = useAppNavigation();
  const records = headsQuery.data ?? [];
  const goals = goalsQuery.data ?? [];
  const people = React.useMemo(
    () => [
      ...new Set(records.flatMap((record) => record.head.assignedPubkeys)),
    ],
    [records],
  );
  const profilesQuery = useUsersBatchQuery(people);
  const currentPubkey = identityQuery.data?.pubkey;
  const profiles = profilesQuery.data?.profiles;
  const channels = channelsQuery.data ?? [];
  const visibleRecords = React.useMemo(
    () => filterCompanyWorkRecords(records, workFilters, goals),
    [goals, records, workFilters],
  );

  const ownerOptions = React.useMemo<CompanyWorkFilterOption[]>(() => {
    const owners = people
      .map((pubkey) => {
        const label = resolveUserLabel({
          currentPubkey,
          profiles,
          pubkey,
          preferResolvedSelfLabel: true,
        });
        const isAgent = Boolean(profiles?.[pubkey.toLowerCase()]?.isAgent);
        const group = isAgent ? "AI employees" : "People";
        return {
          id: pubkey.toLowerCase(),
          label,
          group,
          searchTerms: `${pubkey} ${isAgent ? "AI employee agent" : "person"}`,
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    return [
      { id: "", label: "Anyone", group: "" },
      ...owners.filter((owner) => owner.group === "People"),
      ...owners.filter((owner) => owner.group === "AI employees"),
    ];
  }, [currentPubkey, people, profiles]);

  const goalOptions = React.useMemo<CompanyWorkFilterOption[]>(() => {
    const liveGoals = goals.filter(
      (record) => record.head.goal && record.head.status !== "deleted",
    );
    return [
      { id: "", label: "Any goal", group: "" },
      ...liveGoals
        .map((record) => {
          const goalId = record.head.goalId;
          const descendants = goalFilterScope(goalId, liveGoals);
          const title = record.head.goal?.title ?? record.head.title;
          const isArchived = record.head.status === "archived";
          return {
            id: goalId,
            label: title,
            description:
              descendants && descendants.size > 1
                ? "Includes sub-goals"
                : isArchived
                  ? "Archived"
                  : undefined,
            searchTerms: `${goalId} ${record.head.status}`,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
    ];
  }, [goals]);

  const selectedOwner = ownerOptions.find(
    (option) => option.id === workFilters.ownerPubkey,
  );
  const selectedGoal = goalOptions.find(
    (option) => option.id === workFilters.goalId,
  );
  const selectedGoalScope = goalFilterScope(workFilters.goalId, goals);
  const selectedGoalHasDescendants = (selectedGoalScope?.size ?? 0) > 1;
  const anyFilterActive =
    workFilters.status !== "all" ||
    workFilters.ownerPubkey !== null ||
    workFilters.goalId !== null;

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

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <label className="flex h-11 items-center gap-3 rounded-lg border border-input/40 bg-background px-4 text-sm">
            <span className="text-muted-foreground">Status</span>
            <select
              aria-label="Status"
              className="min-w-24 bg-transparent text-sm font-medium text-foreground focus-visible:outline-none"
              data-testid="company-work-status-filter"
              onChange={(event) =>
                setWorkFilters((current) => ({
                  ...current,
                  status: event.target.value as CompanyWorkStatusFilter,
                }))
              }
              value={workFilters.status}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === "all"
                    ? "All statuses"
                    : companyWorkStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <CompanyWorkFilterPopover
            emptyLabel="Anyone"
            label="Owner"
            onChange={(ownerPubkey) =>
              setWorkFilters((current) => ({ ...current, ownerPubkey }))
            }
            options={ownerOptions}
            testId="company-work-owner-filter"
            value={workFilters.ownerPubkey}
          />
          <CompanyWorkFilterPopover
            disabled={goalsQuery.isPending || goalsQuery.isError}
            emptyLabel="Any goal"
            label="Goal"
            onChange={(goalId) =>
              setWorkFilters((current) => ({ ...current, goalId }))
            }
            options={goalOptions}
            testId="company-work-goal-filter"
            unavailableMessage={
              goalsQuery.isError ? "Goals could not be loaded." : undefined
            }
            value={workFilters.goalId}
          />
        </div>

        {anyFilterActive ? (
          <fieldset
            aria-label="Applied work filters"
            className="mt-3 flex flex-wrap items-center gap-2 border-0 p-0"
            data-testid="company-work-filter-chips"
          >
            {workFilters.status !== "all" ? (
              <FilterChip
                label={`Status: ${companyWorkStatusLabel(workFilters.status)}`}
                onClear={() =>
                  setWorkFilters((current) =>
                    clearCompanyWorkFilter(current, "status"),
                  )
                }
              />
            ) : null}
            {workFilters.ownerPubkey ? (
              <FilterChip
                label={`Owner: ${selectedOwner?.label ?? truncateNpub(workFilters.ownerPubkey)}`}
                onClear={() =>
                  setWorkFilters((current) =>
                    clearCompanyWorkFilter(current, "ownerPubkey"),
                  )
                }
              />
            ) : null}
            {workFilters.goalId ? (
              <FilterChip
                label={`Goal: ${selectedGoal?.label ?? workFilters.goalId}${selectedGoalHasDescendants ? " + sub-goals" : ""}`}
                onClear={() =>
                  setWorkFilters((current) =>
                    clearCompanyWorkFilter(current, "goalId"),
                  )
                }
              />
            ) : null}
            <Button
              className="h-10 px-2 text-sm text-foreground"
              data-testid="company-work-clear-all"
              onClick={() => setWorkFilters(emptyCompanyWorkFilters)}
              variant="ghost"
            >
              Clear all
            </Button>
          </fieldset>
        ) : null}

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
        ) : (
          <>
            <div className="mt-7 flex items-center justify-between border-b border-border pb-4 text-xs">
              <strong className="font-semibold text-foreground">
                {visibleRecords.length} commitment
                {visibleRecords.length === 1 ? "" : "s"}
              </strong>
              <span className="text-muted-foreground">
                Owner · Conversation
              </span>
            </div>
            {visibleRecords.length > 0 ? (
              <div data-testid="company-work-rows">
                {visibleRecords.map((record) => {
                  const channel = channels.find(
                    (candidate) => candidate.id === record.channelId,
                  );
                  return (
                    <CompanyWorkListRow
                      channelLabel={
                        channel?.name ?? record.channelId.slice(0, 8)
                      }
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
            ) : (
              <div
                className="flex min-h-[420px] flex-col items-center justify-center text-center"
                data-testid="company-work-empty-filtered"
              >
                <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[#eee7f4] text-[#76608c] dark:bg-[#403449] dark:text-[#c1a6d8]">
                  <Diamond aria-hidden="true" className="size-6" />
                </span>
                <h2 className="text-base font-semibold">
                  No work matches these filters
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  Try another owner or goal, or clear the filters to see all
                  commitments.
                </p>
                {anyFilterActive ? (
                  <Button
                    className={`${companyWorkPrimaryButtonClass} mt-7`}
                    onClick={() => setWorkFilters(emptyCompanyWorkFilters)}
                    variant="default"
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            )}
          </>
        )}
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
