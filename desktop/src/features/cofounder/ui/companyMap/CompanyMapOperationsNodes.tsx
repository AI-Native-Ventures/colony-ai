import type { CSSProperties, FocusEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import type { TeamMember } from "@/features/company-team/teamModels";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";
import {
  companyMapOperationsWindowSearch,
  type CompanyMapOperationsWindowTarget,
} from "@/features/cofounder/companyMapJobRoutes";
import {
  COMPANY_MAP_SIZE,
  type CompanyMapPoint,
  mapPercent,
} from "@/features/cofounder/companyMapLayout";
import type {
  CompanyMapOperationsStep,
  CompanyMapOperationsWorkflow,
} from "@/features/cofounder/companyMapOperations";
import type { CompanyMapOperationsLayout } from "@/features/cofounder/companyMapOperationsLayout";

import type { ProfileLookup } from "./companyMapTypes";

export function fullName(member: TeamMember, profiles: ProfileLookup): string {
  return (
    profiles[member.pubkey.toLowerCase()]?.displayName?.trim() ||
    member.managedAgent?.name?.trim() ||
    member.fallbackName?.trim() ||
    "Company agent"
  );
}

export function slotForFunction(
  functionId: FunctionId,
  slots: FunctionSlotView[],
): FunctionSlotView {
  return (
    slots.find((slot) => slot.functionId === functionId) ?? {
      functionId,
      state: "empty",
      leadPubkey: null,
    }
  );
}

export function MapDoer({
  className,
  member,
  name,
  avatarUrl,
  pubkey,
  scout = false,
  owner = false,
}: {
  className: string;
  member?: TeamMember;
  name?: string;
  avatarUrl?: string | null;
  pubkey?: string;
  scout?: boolean;
  owner?: boolean;
}) {
  if (owner) {
    return (
      <ProfileAvatar
        avatarUrl={avatarUrl ?? null}
        className={className}
        initialsLabel={name}
        label={name ?? "Company owner"}
        pubkey={pubkey ?? member?.pubkey ?? null}
        shape="circle"
      />
    );
  }
  if (scout) {
    return (
      <EmployeeAvatar
        className={className}
        name="Scout"
        pubkey={pubkey ?? member?.pubkey ?? null}
      />
    );
  }
  if (member) {
    const display = name ?? "Company agent";
    return member.kind === "employee" ? (
      <EmployeeAvatar
        className={className}
        instance={member.managedAgent?.avatarUrl}
        name={display}
        personaId={member.managedAgent?.personaId}
        profile={avatarUrl}
        pubkey={member.pubkey}
      />
    ) : (
      <ProfileAvatar
        avatarUrl={avatarUrl ?? null}
        className={className}
        label={display}
        pubkey={member.pubkey ?? null}
        shape="circle"
      />
    );
  }
  return (
    <span aria-hidden="true" className={`${className} company-map-plus`}>
      <Plus size={24} strokeWidth={2.2} />
    </span>
  );
}

export function NeedsBadge({
  count,
  testId,
}: {
  count: number;
  testId: string;
}) {
  return count > 0 ? (
    <span className="company-map-needs-badge" data-testid={testId}>
      {count}
    </span>
  ) : null;
}

type OperationsInteractionProps = {
  onGroupBlur: (event: FocusEvent<HTMLElement>, functionId: FunctionId) => void;
  onGroupFocus: (functionId: FunctionId) => void;
  onGroupMouseEnter: (functionId: FunctionId) => void;
  onGroupMouseLeave: () => void;
};

type OperationsMapNodeProps = {
  children: ReactNode;
  ariaLabel: string;
  className: string;
  dataTestId: string;
  kind: "add-step" | "add-workflow" | "step" | "workflow";
  mapWindowSearch: { mapJob: string };
  target: CompanyMapOperationsWindowTarget;
  channelId?: string | null;
  playbookId?: string | null;
  stepId?: string | null;
  style: CSSProperties;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onFocus: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

function OperationsMapNodeLink({
  children,
  ariaLabel,
  className,
  dataTestId,
  kind,
  mapWindowSearch,
  target,
  channelId,
  playbookId = null,
  stepId = null,
  style,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
}: OperationsMapNodeProps) {
  const common = {
    "aria-label": ariaLabel,
    "data-map-group": "operations",
    "data-map-kind": kind,
    "data-map-step": stepId ?? undefined,
    "data-map-workflow": playbookId ?? undefined,
    "data-testid": dataTestId,
    className,
    onBlur,
    onFocus,
    onMouseEnter,
    onMouseLeave,
    style,
  };

  if (target === "channel" && channelId) {
    return (
      <Link
        {...common}
        params={{ channelId }}
        search={mapWindowSearch}
        to="/channels/$channelId"
      >
        {children}
      </Link>
    );
  }
  if (target === "work") {
    return (
      <Link
        {...common}
        params={{ workSurface: "work" }}
        search={mapWindowSearch}
        to="/$workSurface"
      >
        {children}
      </Link>
    );
  }
  if (target === "needs-you") {
    return (
      <Link {...common} search={mapWindowSearch} to="/today/needs-you">
        {children}
      </Link>
    );
  }
  return (
    <Link
      {...common}
      params={{ function: "operations" }}
      search={mapWindowSearch}
      to="/company/function/$function"
    >
      {children}
    </Link>
  );
}

function operationsWindowTarget(
  step: CompanyMapOperationsStep,
  clientChannelId: string | null | undefined,
): CompanyMapOperationsWindowTarget {
  if (step.target === "client-conversation" && clientChannelId) {
    return "channel";
  }
  return step.target === "client-conversation" ? "operations" : step.target;
}

function stepOwnerDescription(step: CompanyMapOperationsStep): string {
  if (step.owner.kind === "owner") return "Yours";
  if (step.owner.kind === "lead_agent") return "An agent's";
  if (step.owner.kind === "worker") return "A worker's";
  if (step.owner.functionId) {
    return `The ${step.owner.functionId.replaceAll("_", " ")} team's`;
  }
  return "Your team's";
}

function stepDestinationDescription(target: CompanyMapOperationsWindowTarget) {
  if (target === "work") return "Opens Work.";
  if (target === "channel") return "Opens the client conversation.";
  return "Opens Operations.";
}

function operationsWorkflowStyle(point: CompanyMapPoint): CSSProperties {
  return {
    left: mapPercent(point.x + 24 - 232, COMPANY_MAP_SIZE.width),
    top: mapPercent(point.y - 24, COMPANY_MAP_SIZE.height),
  };
}

function operationsStepStyle(point: CompanyMapPoint): CSSProperties {
  return {
    left: mapPercent(point.x - 212, COMPANY_MAP_SIZE.width),
    top: mapPercent(point.y - 14, COMPANY_MAP_SIZE.height),
  };
}

function WorkflowNode({
  workflow,
  point,
  onSelect,
  ...interactions
}: {
  workflow: CompanyMapOperationsWorkflow;
  point: CompanyMapPoint;
  onSelect: () => void;
} & OperationsInteractionProps) {
  const waitingCount = workflow.steps.filter(
    (step) => step.waitingForOwner,
  ).length;
  return (
    <OperationsMapNodeLink
      ariaLabel={
        workflow.isNew
          ? `${workflow.title}. New workflow waiting for your yes.`
          : `${workflow.title}. ${workflow.runningJobCount} running ${workflow.runningJobCount === 1 ? "job" : "jobs"}.`
      }
      className="company-map-workflow-link"
      dataTestId={`cofounder-map-workflow-${workflow.playbookId}`}
      kind="workflow"
      mapWindowSearch={companyMapOperationsWindowSearch({
        kind: "workflow",
        playbookId: workflow.playbookId,
        target: "operations",
      })}
      onBlur={(event) => interactions.onGroupBlur(event, "operations")}
      onFocus={() => {
        onSelect();
        interactions.onGroupFocus("operations");
      }}
      onMouseEnter={() => {
        onSelect();
        interactions.onGroupMouseEnter("operations");
      }}
      onMouseLeave={interactions.onGroupMouseLeave}
      playbookId={workflow.playbookId}
      style={operationsWorkflowStyle(point)}
      target="operations"
    >
      <span className="company-map-workflow-row" data-side="-1">
        <span
          className="company-map-workflow-disc"
          data-new={workflow.isNew ? "true" : undefined}
        >
          <MapDoer className="company-map-workflow-avatar" scout />
          <NeedsBadge
            count={workflow.isNew ? 1 : waitingCount}
            testId={`cofounder-map-workflow-needs-${workflow.playbookId}`}
          />
        </span>
        <span className="company-map-workflow-name">{workflow.title}</span>
      </span>
    </OperationsMapNodeLink>
  );
}

function WorkflowStepNode({
  workflow,
  step,
  stepNumber,
  point,
  clientChannelId,
  onSelect,
  ...interactions
}: {
  workflow: CompanyMapOperationsWorkflow;
  step: CompanyMapOperationsStep;
  stepNumber: number;
  point: CompanyMapPoint;
  clientChannelId?: string | null;
  onSelect: () => void;
} & OperationsInteractionProps) {
  const target = operationsWindowTarget(step, clientChannelId);
  const needsYou = step.waitingForOwner || step.target === "needs-you";
  return (
    <OperationsMapNodeLink
      ariaLabel={
        `Step ${stepNumber}. ${step.title}. ${stepOwnerDescription(step)}.` +
        (needsYou ? " Needs you." : ` ${stepDestinationDescription(target)}`)
      }
      channelId={target === "channel" ? clientChannelId : null}
      className="company-map-workflow-step-link"
      dataTestId={`cofounder-map-workflow-step-${workflow.playbookId}-${step.stepId}`}
      kind="step"
      mapWindowSearch={companyMapOperationsWindowSearch({
        kind: "step",
        playbookId: workflow.playbookId,
        stepId: step.stepId,
        target,
      })}
      onBlur={(event) => interactions.onGroupBlur(event, "operations")}
      onFocus={() => {
        onSelect();
        interactions.onGroupFocus("operations");
      }}
      onMouseEnter={() => {
        onSelect();
        interactions.onGroupMouseEnter("operations");
      }}
      onMouseLeave={interactions.onGroupMouseLeave}
      playbookId={workflow.playbookId}
      stepId={step.stepId}
      style={operationsStepStyle(point)}
      target={target}
    >
      <span className="company-map-workflow-step-row" data-side="-1">
        <span
          className="company-map-workflow-step-disc"
          data-owner={step.owner.kind}
        >
          {stepNumber}
          {needsYou ? (
            <span
              aria-hidden="true"
              className="company-map-workflow-step-need-dot"
              data-testid={`cofounder-map-workflow-step-needs-${workflow.playbookId}-${step.stepId}`}
            />
          ) : null}
        </span>
        <span className="company-map-workflow-step-name">{step.title}</span>
      </span>
    </OperationsMapNodeLink>
  );
}

function AddStepNode({
  workflow,
  point,
  onSelect,
  ...interactions
}: {
  workflow: CompanyMapOperationsWorkflow;
  point: CompanyMapPoint;
  onSelect: () => void;
} & OperationsInteractionProps) {
  return (
    <OperationsMapNodeLink
      ariaLabel={`Add a step to ${workflow.title}. Opens Operations.`}
      className="company-map-workflow-step-link"
      dataTestId={`cofounder-map-add-step-${workflow.playbookId}`}
      kind="add-step"
      mapWindowSearch={companyMapOperationsWindowSearch({
        kind: "add-step",
        playbookId: workflow.playbookId,
        target: "operations",
      })}
      onBlur={(event) => interactions.onGroupBlur(event, "operations")}
      onFocus={() => {
        onSelect();
        interactions.onGroupFocus("operations");
      }}
      onMouseEnter={() => {
        onSelect();
        interactions.onGroupMouseEnter("operations");
      }}
      onMouseLeave={interactions.onGroupMouseLeave}
      playbookId={workflow.playbookId}
      style={operationsStepStyle(point)}
      target="operations"
    >
      <span className="company-map-workflow-step-row" data-side="-1">
        <span className="company-map-workflow-step-disc" data-add="true">
          <Plus aria-hidden="true" size={13} strokeWidth={2.2} />
        </span>
        <span className="company-map-workflow-step-name" data-add="true">
          Add a step
        </span>
      </span>
    </OperationsMapNodeLink>
  );
}

export function AddWorkflowNode({
  point,
  scoutChannelId,
  ...interactions
}: {
  point: CompanyMapPoint;
  scoutChannelId?: string | null;
} & OperationsInteractionProps) {
  const target = scoutChannelId ? "channel" : "operations";
  return (
    <OperationsMapNodeLink
      ariaLabel={
        scoutChannelId
          ? "Add a workflow. Opens your conversation with Scout."
          : "Add a workflow. Opens Operations."
      }
      channelId={scoutChannelId}
      className="company-map-workflow-link"
      dataTestId="cofounder-map-add-workflow"
      kind="add-workflow"
      mapWindowSearch={companyMapOperationsWindowSearch({
        kind: "add-workflow",
        target,
      })}
      onBlur={(event) => interactions.onGroupBlur(event, "operations")}
      onFocus={() => interactions.onGroupFocus("operations")}
      onMouseEnter={() => interactions.onGroupMouseEnter("operations")}
      onMouseLeave={interactions.onGroupMouseLeave}
      style={operationsWorkflowStyle(point)}
      target={target}
    >
      <span className="company-map-workflow-row" data-side="-1">
        <span className="company-map-workflow-disc" data-add="true">
          <Plus aria-hidden="true" size={16} strokeWidth={2.2} />
        </span>
        <span className="company-map-workflow-name" data-add="true">
          Add a workflow
        </span>
      </span>
    </OperationsMapNodeLink>
  );
}

function stepRailStyle({
  point,
  startY,
  endY,
}: {
  point: CompanyMapPoint;
  startY: number;
  endY: number;
}): CSSProperties {
  return {
    height: mapPercent(endY - startY, COMPANY_MAP_SIZE.height),
    left: mapPercent(point.x - 1, COMPANY_MAP_SIZE.width),
    top: mapPercent(startY, COMPANY_MAP_SIZE.height),
  };
}

function WorkflowStepRail({
  operationsLayout,
}: {
  operationsLayout: CompanyMapOperationsLayout;
}) {
  const addStep = operationsLayout.addStep;
  if (!addStep) return null;
  const steps = [...operationsLayout.steps]
    .filter((step) => step.playbookId === addStep.playbookId)
    .sort((first, second) => first.point.y - second.point.y);
  const first = steps[0];
  const last = steps.at(-1);
  if (!first || !last) return null;
  return (
    <>
      {steps.length > 1 ? (
        <span
          aria-hidden="true"
          className="company-map-workflow-step-rail"
          data-testid={`cofounder-map-workflow-step-rail-${addStep.playbookId}-solid`}
          style={stepRailStyle({
            endY: last.point.y,
            point: first.point,
            startY: first.point.y,
          })}
        />
      ) : null}
      <span
        aria-hidden="true"
        className="company-map-workflow-step-rail"
        data-style="dashed"
        data-testid={`cofounder-map-workflow-step-rail-${addStep.playbookId}-dashed`}
        style={stepRailStyle({
          endY: addStep.point.y,
          point: last.point,
          startY: last.point.y,
        })}
      />
    </>
  );
}

export function CompanyMapOperationsNodes({
  operationsLayout,
  operationsWorkflows,
  clientChannelId,
  scoutChannelId,
  onSelectWorkflow,
  ...interactions
}: {
  operationsLayout: CompanyMapOperationsLayout;
  operationsWorkflows: readonly CompanyMapOperationsWorkflow[];
  clientChannelId?: string | null;
  scoutChannelId?: string | null;
  onSelectWorkflow: (playbookId: string) => void;
} & OperationsInteractionProps) {
  return (
    <>
      <WorkflowStepRail operationsLayout={operationsLayout} />
      {operationsLayout.workflows.map((position) => {
        const workflow = operationsWorkflows.find(
          (candidate) => candidate.playbookId === position.playbookId,
        );
        return workflow ? (
          <WorkflowNode
            key={`workflow:${workflow.playbookId}`}
            onSelect={() => onSelectWorkflow(workflow.playbookId)}
            point={position.point}
            workflow={workflow}
            {...interactions}
          />
        ) : null;
      })}
      {operationsLayout.steps.map((position) => {
        const workflow = operationsWorkflows.find(
          (candidate) => candidate.playbookId === position.playbookId,
        );
        const step = workflow?.steps.find(
          (candidate) => candidate.stepId === position.stepId,
        );
        return workflow && step ? (
          <WorkflowStepNode
            clientChannelId={clientChannelId}
            key={`step:${workflow.playbookId}:${step.stepId}`}
            onSelect={() => onSelectWorkflow(workflow.playbookId)}
            point={position.point}
            step={step}
            stepNumber={workflow.steps.indexOf(step) + 1}
            workflow={workflow}
            {...interactions}
          />
        ) : null;
      })}
      {operationsLayout.addStep
        ? (() => {
            const workflow = operationsWorkflows.find(
              (candidate) =>
                candidate.playbookId === operationsLayout.addStep?.playbookId,
            );
            return workflow ? (
              <AddStepNode
                key={`add-step:${workflow.playbookId}`}
                onSelect={() => onSelectWorkflow(workflow.playbookId)}
                point={operationsLayout.addStep.point}
                workflow={workflow}
                {...interactions}
              />
            ) : null;
          })()
        : null}
      <AddWorkflowNode
        point={operationsLayout.addWorkflow.point}
        scoutChannelId={scoutChannelId}
        {...interactions}
      />
    </>
  );
}
