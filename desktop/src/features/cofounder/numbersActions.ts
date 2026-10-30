import { COMPANY_RECORD_SCHEMA_VERSION } from "./cofounderRecords";
import type { FunctionId } from "./cofounderRecords";
import { SCORECARD_D_TAG, goalDTag, reviewDTag } from "./numbersRecords";
import type {
  DecisionState,
  GoalPeriod,
  GoalView,
  MetricId,
  ReviewView,
} from "./numbersRecords";

/** A decision Scout asks of the owner in a weekly review. Mirrors `ReviewDecisionInput` in buzz-core. */
export type ReviewDecisionInput = {
  decisionId: string;
  title: string;
  detail?: string;
  function?: FunctionId;
};

/** Mirrors `NumbersAction` in buzz-core: each op takes only its own fields. */
export type NumbersActionInput =
  | {
      op: "goal_propose";
      goalId: string;
      function: FunctionId;
      title: string;
      metric: MetricId;
      target: number;
      period: GoalPeriod;
      reason?: string;
    }
  | {
      op: "goal_edit";
      goalId: string;
      title: string;
      metric: MetricId;
      target: number;
      period: GoalPeriod;
      reason?: string;
      expectedHeadEventId: string;
    }
  | {
      op: "goal_approve" | "goal_reject" | "goal_retire";
      goalId: string;
      note?: string;
      expectedHeadEventId: string;
    }
  | { op: "scorecard_refresh"; expectedHeadEventId?: string }
  | {
      op: "review_annotate";
      reviewDate: string;
      wins?: string[];
      misses?: string[];
      decisions?: ReviewDecisionInput[];
      expectedHeadEventId: string;
    }
  | {
      op: "review_decide";
      reviewDate: string;
      decisionId: string;
      choice: Exclude<DecisionState, "open">;
      note?: string;
      expectedHeadEventId: string;
    };

function dTagOf(input: NumbersActionInput): string {
  switch (input.op) {
    case "scorecard_refresh":
      return SCORECARD_D_TAG;
    case "review_annotate":
    case "review_decide":
      return reviewDTag(input.reviewDate);
    default:
      return goalDTag(input.goalId);
  }
}

/** The signed event content and tags of one numbers action (kind 47068). */
export function buildNumbersActionEvent(input: NumbersActionInput): {
  content: string;
  tags: string[][];
} {
  const { op, ...fields } = input;
  const body: Record<string, unknown> = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    op,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") body[key] = value;
  }
  return {
    content: JSON.stringify(body),
    tags: [["d", dTagOf(input)]],
  };
}

/** One-tap helpers for Needs you and the function page. Each names the exact head seen. */
export const numbersActions = {
  /** Edit the current proposed goal head the owner reviewed. */
  editGoal: (
    goal: GoalView,
    fields: {
      title: string;
      metric: MetricId;
      target: number;
      period: GoalPeriod;
      reason?: string;
    },
  ): NumbersActionInput => ({
    op: "goal_edit",
    goalId: goal.goalId,
    ...fields,
    expectedHeadEventId: goal.eventId,
  }),
  approveGoal: (goal: GoalView, note?: string): NumbersActionInput => ({
    op: "goal_approve",
    goalId: goal.goalId,
    note,
    expectedHeadEventId: goal.eventId,
  }),
  rejectGoal: (goal: GoalView, note?: string): NumbersActionInput => ({
    op: "goal_reject",
    goalId: goal.goalId,
    note,
    expectedHeadEventId: goal.eventId,
  }),
  retireGoal: (goal: GoalView, note?: string): NumbersActionInput => ({
    op: "goal_retire",
    goalId: goal.goalId,
    note,
    expectedHeadEventId: goal.eventId,
  }),
  /** Ask the relay to recount the scorecard. It recounts at most once a minute. */
  refreshScorecard: (expectedHeadEventId?: string): NumbersActionInput => ({
    op: "scorecard_refresh",
    expectedHeadEventId,
  }),
  decide: (
    review: ReviewView,
    decisionId: string,
    choice: Exclude<DecisionState, "open">,
    note?: string,
  ): NumbersActionInput => ({
    op: "review_decide",
    reviewDate: review.reviewDate,
    decisionId,
    choice,
    note,
    expectedHeadEventId: review.eventId,
  }),
};
