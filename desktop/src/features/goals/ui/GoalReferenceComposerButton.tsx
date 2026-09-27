import * as React from "react";
import { useLocation } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";

export function GoalReferenceComposerButton() {
  const location = useLocation();
  const { goGoalReference } = useAppNavigation();

  const handleClick = React.useCallback(() => {
    const state = location.state as unknown as
      | Record<string, unknown>
      | undefined;
    void goGoalReference({
      pathname: location.pathname,
      search: location.search as Record<string, unknown>,
      state: state ?? {},
    });
  }, [goGoalReference, location.pathname, location.search, location.state]);

  return (
    <button
      className="inline-flex min-h-5 items-center gap-1 rounded px-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="reference-goal-button"
      onClick={handleClick}
      type="button"
    >
      <span aria-hidden="true">◎</span>
      Reference goal or sub-goal
    </button>
  );
}
