import type { PlainWorkflowStep } from "./plainWorkflowModel";

export type BuilderScreen =
  | "describe"
  | "timing"
  | "steps"
  | "step"
  | "remove"
  | "preview"
  | "review"
  | "detail"
  | "pause"
  | "unsupported";

export type EditableStep = PlainWorkflowStep;

export type StepEditor = {
  step: EditableStep;
  index: number | null;
} | null;
