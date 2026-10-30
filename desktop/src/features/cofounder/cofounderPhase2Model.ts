import type { ApprovalSwitches, MoneyPreference } from "./cofounderRecords";

/** UI view models for Phase 2. Relay fields are mapped after the shared contract lands. */
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

export type CofounderApprovalItem =
  | {
      id: string;
      kind: "outreach";
      title: string;
      summary: string;
      detail: string;
    }
  | {
      id: string;
      kind: "reply_drafts";
      title: string;
      summary: string;
      drafts: Array<{
        id: string;
        recipient: string;
        message: string;
      }>;
    }
  | {
      id: string;
      kind: "taste";
      title: string;
      summary: string;
      options: string[];
      recommendedOption: string;
      recommendation: string;
    };

export type CofounderDoItem = {
  id: string;
  title: string;
  summary: string;
  browserUrl: string;
  browserChannelId: string;
  costLabel: string;
};

export type CofounderDecisionItem = {
  id: string;
  title: string;
  summary: string;
  acceptLabel: string;
  declineLabel: string;
};

export type CofounderNeedsYouModel = {
  plans: CofounderPlan[];
  approvals: CofounderApprovalItem[];
  doItems: CofounderDoItem[];
  decisions: CofounderDecisionItem[];
};

export type CofounderBusinessBrief = {
  companyName: string;
  whatYouSell: string;
  whoBuys: string;
  prices: string;
  priceNote: string;
  howYouTalk: string;
  sources: string[];
};

export type CofounderOnboardingStep =
  | "brief"
  | "money"
  | "approvals"
  | "account"
  | "map"
  | "complete";

export type CofounderOnboardingModel = {
  step: CofounderOnboardingStep;
  brief: CofounderBusinessBrief;
  moneyPreference: MoneyPreference;
  approvalSwitches: ApprovalSwitches;
  accountName: string;
  accountUrl: string;
  accountChannelId: string;
  accountConnected: boolean;
};

export type CofounderAccessRequest = {
  id: string;
  title: string;
  description: string;
  costLabel: string;
  browserUrl: string;
  browserChannelId: string;
};

export type CofounderAccessEntry = {
  id: string;
  label: string;
  usedFor: string;
  usedBy: string;
  cost: string;
};

export type CofounderAccessModel = {
  pendingRequest: CofounderAccessRequest | null;
  entries: CofounderAccessEntry[];
};

/** E2E fixture model until Phase 2 relay record shapes are published. */
export type CofounderPhase2Fixture = {
  onboarding: CofounderOnboardingModel;
  chatPlan: CofounderPlan;
  needsYou: CofounderNeedsYouModel;
  access: CofounderAccessModel;
};
