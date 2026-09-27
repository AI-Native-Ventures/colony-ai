import type { Project } from "@/features/projects/hooks";
import type { FactoryRun } from "@/shared/api/factoryRuntime";

export type FactoryPlanTask = {
  id: string;
  title: string;
  dependencies: string[];
  status: "ready" | "blocked" | "done";
};

export type FactoryPlan = {
  id: string;
  projectId: string;
  title: string;
  outcome: string;
  acceptanceCriteria: string[];
  tasks: FactoryPlanTask[];
  revisions: Array<{ version: number; updatedAt: string; title: string }>;
  status: "draft" | "review" | "approved";
  updatedAt: string;
};

export type DeskTab = { id: string; name: string };
export type FactoryRepository = Project["repositories"][number];
export type FactoryDesk = {
  tabs: DeskTab[];
  activeTabId: string;
  runToTab: Record<string, string>;
};

export type FactoryPageRoute =
  | { kind: "workbench" }
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "plans" }
  | { kind: "plan"; planId: string }
  | { kind: "review"; runId: string }
  | { kind: "sessions" }
  | { kind: "states" };

export type FactoryDeskView =
  | { kind: "run"; id: string; run: FactoryRun }
  | { kind: "plan"; id: string; plan: FactoryPlan };

export type FactoryPanePosition = "lead" | "delegates" | "sessions";
