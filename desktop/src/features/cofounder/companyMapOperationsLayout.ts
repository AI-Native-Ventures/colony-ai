import type { FunctionId } from "./cofounderRecords";
import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions";
import {
  COMPANY_MAP_LAYOUT,
  COMPANY_MAP_SIZE,
  type CompanyMapJobPosition,
  type CompanyMapPartPosition,
  type CompanyMapPoint,
} from "./companyMapLayout";

const LEFT_OPERATIONS_FUNCTIONS: readonly FunctionId[] = [
  "operations",
  "customer_success",
  "brand",
];
const WORKFLOW_PITCH = 48;
const OPEN_NEIGHBOUR_PITCH = 34;
const CLOSED_NEIGHBOUR_PITCH = 48;
const LEFT_GROUP_GAP = 20;
const STEP_PITCH = 30;
const OPEN_STEP_GAP = 6;

/** The stable IDs needed to place a real Operations playbook and its steps. */
export type CompanyMapOperationsWorkflowInput = {
  playbookId: string;
  stepIds: readonly string[];
};

/** A workflow circle's board coordinate. */
export type CompanyMapWorkflowPosition = {
  playbookId: string;
  point: CompanyMapPoint;
};

/** A second-ring step circle's board coordinate. */
export type CompanyMapWorkflowStepPosition = {
  playbookId: string;
  point: CompanyMapPoint;
  stepId: string;
};

/**
 * The dynamic left-side map geometry when a company has real Operations
 * workflows. The regular right side remains on the first-sheet coordinates.
 */
export type CompanyMapOperationsLayout = {
  addStep: { playbookId: string; point: CompanyMapPoint } | null;
  addWorkflow: { point: CompanyMapPoint };
  jobs: CompanyMapJobPosition[];
  parts: CompanyMapPartPosition[];
  steps: CompanyMapWorkflowStepPosition[];
  workflows: CompanyMapWorkflowPosition[];
};

function workflowHeight(
  workflow: CompanyMapOperationsWorkflowInput,
  openPlaybookId: string | null,
): number {
  if (workflow.playbookId !== openPlaybookId) return WORKFLOW_PITCH;
  // The board keeps a six-pixel breath before and after every open rail.
  return (
    WORKFLOW_PITCH +
    (workflow.stepIds.length + 1) * STEP_PITCH +
    OPEN_STEP_GAP * 2
  );
}

/**
 * Reproduces `gen.js build('o1')` for data-backed Operations workflows. The
 * open rail deliberately stays a real series of points even when a long
 * workflow starts above the default board frame, so pan and zoom can recover
 * every step instead of truncating the data.
 */
export function buildCompanyMapOperationsLayout({
  workflows,
  openPlaybookId,
}: {
  openPlaybookId: string | null;
  workflows: readonly CompanyMapOperationsWorkflowInput[];
}): CompanyMapOperationsLayout {
  const openWorkflow = workflows.some(
    (workflow) => workflow.playbookId === openPlaybookId,
  )
    ? openPlaybookId
    : null;
  const hasOpenWorkflow = openWorkflow !== null;
  const operationsHeight =
    workflows.reduce(
      (height, workflow) => height + workflowHeight(workflow, openWorkflow),
      0,
    ) + WORKFLOW_PITCH;
  const leftHeight =
    LEFT_OPERATIONS_FUNCTIONS.reduce((height, functionId) => {
      if (functionId === "operations") return height + operationsHeight;
      const pitch = hasOpenWorkflow
        ? OPEN_NEIGHBOUR_PITCH
        : CLOSED_NEIGHBOUR_PITCH;
      return height + FUNCTION_DETAILS[functionId].subFunctions.length * pitch;
    }, 0) +
    (LEFT_OPERATIONS_FUNCTIONS.length - 1) * LEFT_GROUP_GAP;

  let y = (COMPANY_MAP_SIZE.height - leftHeight) / 2 - 8;
  const dynamicParts = new Map<FunctionId, CompanyMapPartPosition>();
  const dynamicJobs: CompanyMapJobPosition[] = [];
  const workflowPositions: CompanyMapWorkflowPosition[] = [];
  const stepPositions: CompanyMapWorkflowStepPosition[] = [];
  let addStep: CompanyMapOperationsLayout["addStep"] = null;
  let addWorkflow: CompanyMapOperationsLayout["addWorkflow"] = {
    point: { x: 220, y: 0 },
  };

  for (const functionId of LEFT_OPERATIONS_FUNCTIONS) {
    const firstY = y;
    if (functionId === "operations") {
      for (const workflow of workflows) {
        const point = { x: 220, y: Math.round(y + WORKFLOW_PITCH / 2) };
        workflowPositions.push({ playbookId: workflow.playbookId, point });
        y += WORKFLOW_PITCH;
        if (workflow.playbookId !== openWorkflow) continue;
        y += OPEN_STEP_GAP;
        for (const stepId of workflow.stepIds) {
          stepPositions.push({
            playbookId: workflow.playbookId,
            point: { x: 220, y: Math.round(y + STEP_PITCH / 2) },
            stepId,
          });
          y += STEP_PITCH;
        }
        addStep = {
          playbookId: workflow.playbookId,
          point: { x: 220, y: Math.round(y + STEP_PITCH / 2) },
        };
        y += STEP_PITCH + OPEN_STEP_GAP;
      }
      const addPoint = { x: 220, y: Math.round(y + WORKFLOW_PITCH / 2) };
      addWorkflow = { point: addPoint };
      y += WORKFLOW_PITCH;
      const lastY = addPoint.y;
      dynamicParts.set(functionId, {
        functionId,
        point: { x: 420, y: Math.round((firstY + 24 + lastY) / 2) },
        side: -1,
      });
    } else {
      const pitch = hasOpenWorkflow
        ? OPEN_NEIGHBOUR_PITCH
        : CLOSED_NEIGHBOUR_PITCH;
      const names = FUNCTION_DETAILS[functionId].subFunctions;
      for (const name of names) {
        dynamicJobs.push({
          functionId,
          name,
          point: { x: 220, y: Math.round(y + pitch / 2) },
          side: -1,
        });
        y += pitch;
      }
      const lastY = y - pitch / 2;
      dynamicParts.set(functionId, {
        functionId,
        point: { x: 420, y: Math.round((firstY + pitch / 2 + lastY) / 2) },
        side: -1,
      });
    }
    y += LEFT_GROUP_GAP;
  }

  const parts = FUNCTION_ORDER.map(
    (functionId) =>
      dynamicParts.get(functionId) ??
      COMPANY_MAP_LAYOUT.parts.find(
        (part) => part.functionId === functionId,
      ) ?? {
        functionId,
        point: { x: 700, y: 395 },
        side: functionId === "sales" || functionId === "finance" ? 1 : -1,
      },
  );
  const jobs = [
    ...COMPANY_MAP_LAYOUT.jobs.filter(
      (job) => job.functionId === "sales" || job.functionId === "finance",
    ),
    ...dynamicJobs,
  ].sort(
    (first, second) =>
      FUNCTION_ORDER.indexOf(first.functionId) -
        FUNCTION_ORDER.indexOf(second.functionId) ||
      first.point.y - second.point.y,
  );

  return {
    addStep,
    addWorkflow,
    jobs,
    parts,
    steps: stepPositions,
    workflows: workflowPositions,
  };
}
