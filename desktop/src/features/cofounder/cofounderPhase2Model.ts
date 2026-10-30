import type { ApprovalSwitches, MoneyPreference } from "./cofounderRecords";
import type {
  OnboardingHead,
  OnboardingStep,
  OnboardingStepState,
  OnboardingMap,
} from "./initiativeRecords";

/** A compact view model used by the plan card renderer. */
export type CofounderPlanStepStatus =
  | "planned"
  | "approved"
  | "in_progress"
  | "waiting"
  | "done"
  | "blocked"
  | "skipped"
  | "failed";

export type CofounderPlanStep = {
  id: string;
  title: string;
  owner: string;
  cost: string;
  timing: string;
  status: CofounderPlanStepStatus;
};

export type CofounderPlan = {
  id: string;
  title: string;
  summary: string;
  functionName: string;
  decideBy: string | null;
  steps: CofounderPlanStep[];
  costSummary: string;
  timingSummary: string;
  targetSummary: string;
  status:
    | "proposed"
    | "approved"
    | "rejected"
    | "in_progress"
    | "done"
    | "cancelled";
};

export type CofounderBusinessBrief = {
  companyName: string;
  whatYouSell: string;
  whoBuys: string;
  prices: string;
  howYouTalk: string;
  sources: string[];
};

export type CofounderOnboardingStep =
  | "brief"
  | "money"
  | "approvals"
  | "account"
  | "map"
  | "waiting"
  | "complete";

export type CofounderOnboardingModel = {
  step: CofounderOnboardingStep;
  visibleThrough: Exclude<CofounderOnboardingStep, "waiting" | "complete">;
  questionText: string | null;
  brief: CofounderBusinessBrief | null;
  briefPending: boolean;
  briefConfirmed: boolean;
  moneyPreference: MoneyPreference;
  approvalSwitches: ApprovalSwitches;
  accountName: string | null;
  accountUrl: string | null;
  accountChannelId: string;
  accountConnected: boolean;
  map: OnboardingMap | null;
  steps: Array<{ step: OnboardingStep; state: OnboardingStepState }>;
};

export function buildCofounderOnboardingModel(input: {
  head: OnboardingHead;
  brief: {
    confirmed: {
      whatYouSell: string;
      whoBuys: string;
      prices?: string;
      howYouTalk: string;
      sources: string[];
    } | null;
    pending: {
      whatYouSell: string;
      whoBuys: string;
      prices?: string;
      howYouTalk: string;
      sources: string[];
    } | null;
  } | null;
  companyName: string;
  accountChannelId: string;
  moneyPreference: MoneyPreference;
  approvalSwitches: ApprovalSwitches;
}): CofounderOnboardingModel {
  const { head } = input;
  const activeQuestionStep = head.question?.step;
  const mappedStep: Record<
    OnboardingStep,
    Exclude<CofounderOnboardingStep, "waiting" | "complete">
  > = {
    brief: "brief",
    money: "money",
    approvals: "approvals",
    accounts: "account",
    map: "map",
  };
  const firstUnsettled = head.steps.find(
    (step) => step.state !== "done" && step.state !== "skipped",
  )?.step;
  const visibleThrough = head.map
    ? "map"
    : activeQuestionStep
      ? mappedStep[activeQuestionStep]
      : mappedStep[firstUnsettled ?? "map"];
  const step: CofounderOnboardingStep =
    head.status === "complete"
      ? "complete"
      : head.map
        ? "map"
        : activeQuestionStep
          ? mappedStep[activeQuestionStep]
          : firstUnsettled === "map"
            ? "map"
            : "waiting";
  const account =
    head.question?.account ?? head.accounts[head.accounts.length - 1] ?? null;
  const accountEntry = account
    ? head.accounts.find((candidate) => candidate.id === account.id)
    : null;
  const briefContent = input.brief?.pending ?? input.brief?.confirmed ?? null;

  return {
    step,
    visibleThrough,
    questionText: head.question?.text ?? null,
    brief: briefContent
      ? {
          companyName: input.companyName,
          whatYouSell: briefContent.whatYouSell,
          whoBuys: briefContent.whoBuys,
          prices: briefContent.prices ?? "",
          howYouTalk: briefContent.howYouTalk,
          sources: briefContent.sources,
        }
      : null,
    briefPending:
      input.brief?.pending !== null && input.brief?.pending !== undefined,
    briefConfirmed:
      input.brief?.confirmed !== null && input.brief?.confirmed !== undefined,
    moneyPreference: input.moneyPreference,
    approvalSwitches: input.approvalSwitches,
    accountName: account?.label ?? null,
    accountUrl: account?.url ?? null,
    accountChannelId: input.accountChannelId,
    accountConnected: accountEntry?.state === "done",
    map: head.map,
    steps: head.steps,
  };
}
