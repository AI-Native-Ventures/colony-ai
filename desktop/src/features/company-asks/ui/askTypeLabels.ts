import type { AskComposerType } from "../askComposer";

export const ASK_TYPES: Array<{ value: AskComposerType; label: string }> = [
  { value: "approval", label: "Approval" },
  { value: "question", label: "Question" },
  { value: "choice", label: "Choice" },
  { value: "checklist", label: "Checklist" },
  { value: "verdict", label: "Verdict" },
  { value: "hire_proposal", label: "Hire proposal" },
];
