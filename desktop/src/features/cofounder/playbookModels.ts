/** Presentation models for the co-founder playbook screens. */
export type PlaybookStepModel = {
  id: string;
  title: string;
  owner: {
    kind: "agent" | "worker" | "owner" | "function";
    label: string;
    avatarName?: string;
  };
  detail: string | null;
  inputs: string[];
  outputs: string[];
  tools: string[];
  approvalPrompt: string | null;
  isApprovalPoint: boolean;
};

export type PlaybookVersionModel = {
  version: number;
  summary: string;
  approvedByLabel: string;
  approvedAtLabel: string;
};

export type PlaybookChangeModel = {
  id: string;
  summary: string;
  proposedByLabel: string;
  proposedAtLabel: string;
  version: number;
};

export type PlaybookJobStepModel = PlaybookStepModel & {
  status:
    | "pending"
    | "in_progress"
    | "waiting_approval"
    | "approved"
    | "done"
    | "skipped"
    | "blocked";
};

export type PlaybookJobModel = {
  id: string;
  clientName: string;
  version: number;
  status: "running" | "completed" | "cancelled";
  startedAtLabel: string;
  currentStepId: string;
  roundLabel: string | null;
  steps: PlaybookJobStepModel[];
};

export type PlaybookScreenModel = {
  id: string;
  title: string;
  summary: string;
  version: number;
  versions: PlaybookVersionModel[];
  lastApprovedByLabel: string;
  lastApprovedAtLabel: string;
  steps: PlaybookStepModel[];
  pendingChange: PlaybookChangeModel | null;
  jobs: PlaybookJobModel[];
};
