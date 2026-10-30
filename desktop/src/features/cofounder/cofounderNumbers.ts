import type { FunctionId } from "./cofounderRecords";

export type ScorecardMetric = {
  label: string;
  value: string;
};

export type ApprovedFunctionGoal = {
  id: string;
  title: string;
  current: number;
  target: number;
  owner: string;
  approvedBy: string;
  approvedOn: string;
};

export type ProposedFunctionGoal = {
  id: string;
  title: string;
  current: number;
  target: number;
  owner: string;
};

export type FunctionGoalsFixture = {
  approved: ApprovedFunctionGoal[];
  proposed: ProposedFunctionGoal[];
  suggested: ProposedFunctionGoal | null;
};

export type WeeklyFunctionRow = {
  functionId: FunctionId;
  current: string;
  change: string;
  direction: "up" | "down" | "flat";
};

export type WeeklyReviewDecision = {
  id: string;
  kind: "plan" | "hire";
  title: string;
  detail: string;
  primaryLabel: string;
  secondaryLabel?: string;
};

/** Mock-only view data until C3-COF5-NUMBERS provides the signed record contract. */
export type CofounderNumbersFixture = {
  dateLabel: string;
  rangeLabel: string;
  rows: WeeklyFunctionRow[];
  worked: string;
  missed: string;
  proposedChange: string;
  decisions: WeeklyReviewDecision[];
  scorecards: Partial<Record<FunctionId, ScorecardMetric[]>>;
  scorecardNotes: Partial<Record<FunctionId, string>>;
  goals: Partial<Record<FunctionId, FunctionGoalsFixture>>;
};

/** Only the E2E mock bridge supplies numbers before the shared contract lands. */
export function getCofounderNumbersFixture(): CofounderNumbersFixture | null {
  if (typeof window === "undefined") return null;
  return window.__BUZZ_E2E__?.mock?.cofounderNumbers ?? null;
}
