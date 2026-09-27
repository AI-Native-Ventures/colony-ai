import * as React from "react";
import { Search } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  canManageCompanyGoals,
  type GoalHeadRecord,
  type GoalStatus,
} from "../goalModels";
import { useGoalHeadsQuery } from "../goalRelay";
import { GoalRouteHeader } from "./GoalRouteHeader";

type GoalFilter = "active" | "archived";

function GoalStatusLabel({ status }: { status: GoalStatus }) {
  const label = status.replaceAll("_", " ");
  const statusClass =
    status === "active" || status === "achieved"
      ? "bg-[#507d69]/[0.12] text-[#507d69] dark:bg-[#92b7a1]/[0.12] dark:text-[#92b7a1]"
      : "bg-[#eee7f4] text-[#76608c] dark:bg-[#403449] dark:text-[#c1a6d8]";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs ${statusClass}`}
    >
      {label}
    </span>
  );
}

function goalDueDate(record: GoalHeadRecord): string {
  return record.head.goal?.dueDate ?? "No due date";
}

function GoalListRow({
  record,
  ownerLabel,
}: {
  record: GoalHeadRecord;
  ownerLabel: string;
}) {
  const { goGoal } = useAppNavigation();
  const goal = record.head.goal;
  if (!goal) return null;

  return (
    <button
      aria-label={`Open goal ${record.head.title}`}
      className="flex w-full items-center gap-4 border-b border-border px-3 py-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`goal-row-${record.head.goalId}`}
      onClick={() => void goGoal(record.head.goalId)}
      type="button"
    >
      <span aria-hidden="true" className="text-xl text-primary">
        ◎
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {record.head.title}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {ownerLabel} · {goalDueDate(record)}
          {goal.parentGoalId ? " · Sub-goal" : ""}
        </span>
      </span>
      <GoalStatusLabel status={record.head.status} />
      <span aria-hidden="true" className="text-lg text-muted-foreground">
        ›
      </span>
    </button>
  );
}

export function GoalsScreen() {
  const goalsQuery = useGoalHeadsQuery();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const { goNewGoal } = useAppNavigation();
  const [filter, setFilter] = React.useState<GoalFilter>("active");
  const [search, setSearch] = React.useState("");
  const goals = goalsQuery.data ?? [];
  const visibleGoals = React.useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return goals
      .filter((record) => record.head.status !== "deleted")
      .filter((record) =>
        filter === "archived"
          ? record.head.status === "archived"
          : record.head.status !== "archived",
      )
      .filter((record) => {
        if (!normalizedSearch) return true;
        return `${record.head.title} ${record.head.goalId}`
          .toLocaleLowerCase()
          .includes(normalizedSearch);
      })
      .sort((left, right) => {
        const leftParent = left.head.goal?.parentGoalId;
        const rightParent = right.head.goal?.parentGoalId;
        if (leftParent !== rightParent) {
          return leftParent ? 1 : -1;
        }
        const leftDueDate = left.head.goal?.dueDate ?? "9999-12-31";
        const rightDueDate = right.head.goal?.dueDate ?? "9999-12-31";
        return (
          leftDueDate.localeCompare(rightDueDate) ||
          left.head.title.localeCompare(right.head.title)
        );
      });
  }, [filter, goals, search]);
  const ownerPubkeys = React.useMemo(
    () => [
      ...new Set(
        visibleGoals.flatMap((record) =>
          record.head.goal ? [record.head.goal.ownerPubkey] : [],
        ),
      ),
    ],
    [visibleGoals],
  );
  const profilesQuery = useUsersBatchQuery(ownerPubkeys);
  const isGoalManager = canManageCompanyGoals(membershipQuery.data?.role);
  const currentPubkey = identityQuery.data?.pubkey;

  if (goalsQuery.isPending) {
    return (
      <>
        <GoalRouteHeader title="Goals" />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goals
        </div>
      </>
    );
  }

  if (goalsQuery.isError) {
    return (
      <>
        <GoalRouteHeader title="Goals unavailable" />
        <section
          aria-labelledby="goals-unavailable-title"
          className="mx-auto w-full max-w-[1230px] px-8 py-8"
        >
          <h1
            className="text-2xl font-semibold tracking-tight"
            id="goals-unavailable-title"
          >
            Goals unavailable
          </h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">
              Goals could not be loaded.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Check your connection and try again.
            </p>
            <Button
              className="mt-5"
              onClick={() => void goalsQuery.refetch()}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </section>
      </>
    );
  }

  const rowList = visibleGoals.map((record) => {
    const ownerLabel = resolveUserLabel({
      currentPubkey,
      profiles: profilesQuery.data?.profiles,
      pubkey: record.head.goal?.ownerPubkey ?? "",
      preferResolvedSelfLabel: true,
    });
    const isSubgoal = Boolean(record.head.goal?.parentGoalId);
    return (
      <div
        className={isSubgoal ? "ml-8 border-l border-border pl-3" : undefined}
        key={record.head.goalId}
      >
        <GoalListRow ownerLabel={ownerLabel} record={record} />
      </div>
    );
  });
  const isEmpty = visibleGoals.length === 0;
  return (
    <>
      <GoalRouteHeader title="Goals" />
      <main
        className="mx-auto flex w-full max-w-[1230px] flex-col px-8 py-10"
        data-testid="goals-screen"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Goals</h1>
          {isGoalManager ? (
            <Button
              className="bg-[#637fb1] text-white hover:bg-[#536d9c] dark:bg-[#8aa6d8] dark:text-[#282532] dark:hover:bg-[#7795c9]"
              data-testid="create-goal"
              onClick={() => void goNewGoal()}
            >
              Create goal
            </Button>
          ) : null}
        </div>
        <search className="mt-6 flex flex-wrap items-center gap-5">
          <label
            className="relative w-full max-w-[400px]"
            htmlFor="goals-search-input"
          >
            <span className="sr-only">Search goals</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              data-testid="goals-search"
              id="goals-search-input"
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search goals"
              value={search}
            />
          </label>
          <fieldset aria-label="Goal status filter" className="flex gap-1">
            <Button
              aria-pressed={filter === "active"}
              className={
                filter === "active"
                  ? "bg-[#637fb1] text-white hover:bg-[#536d9c] dark:bg-[#8aa6d8] dark:text-[#282532] dark:hover:bg-[#7795c9]"
                  : undefined
              }
              data-testid="goals-filter-active"
              onClick={() => setFilter("active")}
              variant={filter === "active" ? "default" : "outline"}
            >
              Active
            </Button>
            <Button
              aria-pressed={filter === "archived"}
              data-testid="goals-filter-archived"
              onClick={() => setFilter("archived")}
              variant={filter === "archived" ? "default" : "outline"}
            >
              Archived
            </Button>
          </fieldset>
        </search>
        {isEmpty ? (
          <div className="mt-8 rounded-lg border border-border px-6 py-8">
            <h2 className="text-base font-semibold">
              {search.trim() ? "No matching goals" : "No goals here yet"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {search.trim()
                ? "Try a different title or goal ID."
                : "Set a direction, an owner and a clear done condition."}
            </p>
            {!search.trim() && isGoalManager ? (
              <Button className="mt-5" onClick={() => void goNewGoal()}>
                Create your first goal
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="mt-5">{rowList}</div>
        )}
      </main>
    </>
  );
}

export { GoalListRow, GoalStatusLabel };
