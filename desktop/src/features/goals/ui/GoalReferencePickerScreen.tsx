import * as React from "react";
import { Search } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useGoalHeadsQuery } from "../goalRelay";
import { GoalRouteBackLink, GoalRouteHeader } from "./GoalRouteHeader";

type ReturnLocation = {
  pathname: string;
  search: Record<string, unknown>;
  state: Record<string, unknown>;
};

function returnLocationFromState(value: unknown): ReturnLocation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.pathname !== "string" ||
    !candidate.pathname.startsWith("/")
  )
    return null;
  return {
    pathname: candidate.pathname,
    search:
      typeof candidate.search === "object" && candidate.search !== null
        ? (candidate.search as Record<string, unknown>)
        : {},
    state:
      typeof candidate.state === "object" && candidate.state !== null
        ? (candidate.state as Record<string, unknown>)
        : {},
  };
}

function shortGoalId(goalId: string): string {
  return goalId.slice(0, 8).toUpperCase();
}

export function GoalReferencePickerScreen() {
  const goalsQuery = useGoalHeadsQuery();
  const location = useLocation();
  const navigate = useNavigate();
  const { goGoals } = useAppNavigation();
  const [search, setSearch] = React.useState("");
  const returnTo = returnLocationFromState(
    (location.state as { goalReferenceReturnTo?: unknown } | undefined)
      ?.goalReferenceReturnTo,
  );
  const goals = (goalsQuery.data ?? []).filter(
    (record) =>
      record.head.status !== "deleted" && record.head.status !== "archived",
  );
  const visibleGoals = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return goals
      .filter((record) =>
        `${record.head.title} ${record.head.goalId}`
          .toLocaleLowerCase()
          .includes(query),
      )
      .sort((left, right) => {
        const leftParentId = left.head.goal?.parentGoalId;
        const rightParentId = right.head.goal?.parentGoalId;
        if (Boolean(leftParentId) !== Boolean(rightParentId)) {
          return leftParentId ? 1 : -1;
        }
        const leftDueDate = left.head.goal?.dueDate ?? "9999-12-31";
        const rightDueDate = right.head.goal?.dueDate ?? "9999-12-31";
        return (
          leftDueDate.localeCompare(rightDueDate) ||
          left.head.title.localeCompare(right.head.title)
        );
      });
  }, [goals, search]);

  const backToMessage = React.useCallback(() => {
    if (!returnTo) {
      void goGoals();
      return;
    }
    void navigate({
      to: returnTo.pathname,
      search: returnTo.search,
      state: returnTo.state,
      replace: true,
    } as never);
  }, [goGoals, navigate, returnTo]);

  const insertGoal = React.useCallback(
    (goalId: string) => {
      if (!returnTo) return;
      void navigate({
        to: returnTo.pathname,
        search: returnTo.search,
        state: {
          ...returnTo.state,
          pendingGoalReference: {
            goalId,
            token: crypto.randomUUID(),
          },
        },
      } as never);
    },
    [navigate, returnTo],
  );

  if (goalsQuery.isPending) {
    return (
      <>
        <GoalRouteHeader title="Reference a goal" />
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
        <GoalRouteHeader title="Reference a goal" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <div className="flex items-center justify-between gap-4">
            <GoalRouteBackLink onClick={backToMessage} />
            {returnTo ? (
              <Button onClick={backToMessage} variant="outline">
                Back to message
              </Button>
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reference a goal
          </h1>
          <div className="mt-6 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">Goals unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Goals could not be loaded.
            </p>
            <Button
              className="mt-5"
              onClick={() => void goalsQuery.refetch()}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <GoalRouteHeader title="Reference a goal" />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="goal-reference-picker"
      >
        <div className="flex items-center justify-between gap-4">
          <GoalRouteBackLink onClick={backToMessage} />
          {returnTo ? (
            <Button onClick={backToMessage} variant="outline">
              Back to message
            </Button>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Reference a goal
        </h1>
        <label
          className="mt-6 block w-full"
          htmlFor="goal-reference-search-input"
        >
          <span className="mb-2 block text-sm font-semibold">
            Find a goal or sub-goal
          </span>
          <span className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              data-testid="goal-reference-search"
              id="goal-reference-search-input"
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search by title or goal ID"
              value={search}
            />
          </span>
        </label>
        {visibleGoals.length === 0 ? (
          <div className="mt-6 max-w-[650px] rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">No matching goals</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Try a different title or goal ID.
            </p>
          </div>
        ) : (
          <div className="mt-5 w-full">
            {visibleGoals.map((record) => {
              const goal = record.head.goal;
              if (!goal) return null;
              const parent = goal.parentGoalId
                ? goals.find(
                    (candidate) => candidate.head.goalId === goal.parentGoalId,
                  )
                : null;
              return (
                <div
                  className="flex items-center gap-4 border-b border-border px-3 py-5"
                  key={goal.goalId}
                >
                  <span aria-hidden="true" className="text-xl text-primary">
                    ◎
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {record.head.title}
                    </strong>
                    <small className="mt-1 block text-xs text-muted-foreground">
                      {shortGoalId(goal.goalId)} ·{" "}
                      {parent
                        ? `Sub-goal of ${parent.head.title}`
                        : "Company goal"}
                      {` · ${record.head.status.replaceAll("_", " ")}`}
                    </small>
                  </span>
                  {returnTo ? (
                    <Button
                      data-testid={`insert-goal-${goal.goalId}`}
                      onClick={() => insertGoal(goal.goalId)}
                      variant="ghost"
                    >
                      Insert
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
