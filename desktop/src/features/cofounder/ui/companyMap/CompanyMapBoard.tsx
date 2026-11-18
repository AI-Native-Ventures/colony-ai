import { Fragment, useMemo, useState } from "react";
import type { CSSProperties, FocusEvent, ReactNode } from "react";
import { Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type { TeamMember } from "@/features/company-team/teamModels";
import { WorkspaceMark } from "@/features/communities/ui/WorkspaceMark";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";
import { companyMapJobDoer } from "@/features/cofounder/companyMapAssignments";
import {
  FUNCTION_DETAILS,
  FUNCTION_ORDER,
} from "@/features/cofounder/functions";
import {
  COMPANY_MAP_CENTER,
  COMPANY_MAP_LAYOUT,
  COMPANY_MAP_SIZE,
  type CompanyMapJobPosition,
  type CompanyMapPartPosition,
  type CompanyMapPoint,
  mapPercent,
} from "@/features/cofounder/companyMapLayout";
import { prebuiltAgentAvatarDataUrl } from "@/features/cofounder/prebuiltAgentAvatar";
import { prebuiltHeadForFunction } from "@/features/cofounder/prebuiltAgents";
import {
  companyMapJobKey,
  companyMapWhatsAppSearch,
  companyMapWindowSearch,
  getCompanyMapJobRoute,
  isCompanyMapJobFallback,
} from "@/features/cofounder/companyMapJobRoutes";
import {
  companyMapJobConnectorState,
  type CompanyMapConnectorState,
} from "@/features/cofounder/companyMapConnectorState";
import {
  buildCompanyMapOperationsLayout,
  type CompanyMapOperationsLayout,
} from "@/features/cofounder/companyMapOperationsLayout";
import type { CompanyMapOperationsWorkflow } from "@/features/cofounder/companyMapOperations";
import { CompanyMapPhone } from "./CompanyMapPhone";
import { CompanyMapPartCard } from "./CompanyMapPartCard";
import { CompanyMapHoverBridge } from "./CompanyMapHoverBridge";
import {
  AddWorkflowNode,
  CompanyMapOperationsNodes,
  fullName,
  MapDoer,
  NeedsBadge,
  slotForFunction,
} from "./CompanyMapOperationsNodes";
import { useCompanyMapCamera } from "./useCompanyMapCamera";
import { useCompanyMapDesktopOpenPart } from "./useCompanyMapDesktopOpenPart";
import { useCompanyMapNoScreenCloseFocus } from "./useCompanyMapNoScreenCloseFocus";
import type {
  CompanyMapBoardProps,
  CompanyMapSummary as MapSummary,
  ProfileLookup,
} from "./companyMapTypes";
import "./companyMap.css";
type StageStyle = CSSProperties & { "--company-map-transform": string };

const STATIC_OPERATIONS_ADD_WORKFLOW_POINT = { x: 220, y: 271 } as const;

type CompanyMapLayoutSurface = {
  jobs: readonly CompanyMapJobPosition[];
  parts: readonly CompanyMapPartPosition[];
};

function partInLayout(
  layout: CompanyMapLayoutSurface,
  functionId: FunctionId,
): CompanyMapPartPosition {
  return (
    layout.parts.find((part) => part.functionId === functionId) ??
    COMPANY_MAP_LAYOUT.parts.find((part) => part.functionId === functionId) ?? {
      functionId,
      point: { x: COMPANY_MAP_SIZE.width / 2, y: COMPANY_MAP_SIZE.height / 2 },
      side: functionId === "sales" || functionId === "finance" ? 1 : -1,
    }
  );
}

function countLabel(count: number): string {
  return count === 1
    ? "1 thing needs your yes"
    : `${count} things need your yes`;
}

function DoerForPart({
  slot,
  members,
  profiles,
}: {
  slot: FunctionSlotView;
  members: TeamMember[];
  profiles: ProfileLookup;
}) {
  const member =
    slot.state === "filled" && slot.leadPubkey
      ? members.find(
          (candidate) =>
            candidate.pubkey.toLowerCase() === slot.leadPubkey?.toLowerCase(),
        )
      : undefined;
  const name = member ? fullName(member, profiles) : undefined;
  const avatarUrl = member
    ? (profiles[member.pubkey.toLowerCase()]?.avatarUrl ?? null)
    : null;
  const className = "company-map-part-avatar";

  if (slot.state === "covered_by_scout") {
    return <MapDoer className={className} scout />;
  }
  if (member) {
    const prebuiltHead = prebuiltHeadForFunction(slot.functionId);
    return (
      <MapDoer
        avatarUrl={avatarUrl}
        className={className}
        fallbackInstance={
          prebuiltHead && name === prebuiltHead.name
            ? prebuiltAgentAvatarDataUrl(prebuiltHead)
            : null
        }
        member={member}
        name={name}
      />
    );
  }
  return (
    <span aria-hidden="true" className={`${className} company-map-plus`}>
      <Plus size={24} strokeWidth={2.2} />
    </span>
  );
}

function JobDoer({
  slot,
  members,
  profiles,
}: {
  slot: FunctionSlotView;
  members: TeamMember[];
  profiles: ProfileLookup;
}) {
  const assigned = companyMapJobDoer(slot);
  if (assigned.kind === "scout") {
    return <MapDoer className="company-map-job-avatar" scout />;
  }
  const member = members.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() === assigned.pubkey.toLowerCase(),
  );
  if (member) {
    const name = fullName(member, profiles);
    const prebuiltHead = prebuiltHeadForFunction(slot.functionId);
    return (
      <MapDoer
        avatarUrl={profiles[member.pubkey.toLowerCase()]?.avatarUrl}
        className="company-map-job-avatar"
        fallbackInstance={
          prebuiltHead && name === prebuiltHead.name
            ? prebuiltAgentAvatarDataUrl(prebuiltHead)
            : null
        }
        member={member}
        name={name}
      />
    );
  }
  return <MapDoer className="company-map-job-avatar" scout />;
}

function JobLink({
  functionId,
  jobName,
  count,
  whatsappChannelId,
  children,
  style,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
}: {
  functionId: FunctionId;
  jobName: string;
  count: number;
  whatsappChannelId?: string | null;
  children: ReactNode;
  style?: CSSProperties;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const destination = getCompanyMapJobRoute(functionId, jobName);
  const fallback = isCompanyMapJobFallback(functionId, jobName);
  const mapWindowSearch = companyMapWindowSearch(functionId, jobName);
  const mapJob = mapWindowSearch?.mapJob;
  const common = {
    "aria-label": fallback
      ? `${jobName}. No screen for this job yet. Opens ${FUNCTION_DETAILS[functionId].name}.`
      : destination.kind === "whatsapp" && !whatsappChannelId
        ? `${jobName}. WhatsApp is not set up. Opens Outreach setup.`
        : count > 0
          ? `${jobName}, ${countLabel(count)}`
          : jobName,
    "data-map-group": functionId,
    "data-job": companyMapJobKey(functionId, jobName),
    "data-testid": `cofounder-map-job-${functionId}-${jobName.toLowerCase().replaceAll(" ", "-")}`,
    onBlur,
    onFocus,
    onMouseEnter,
    onMouseLeave,
  };
  if (destination.kind === "app") {
    return (
      <Link
        {...common}
        className="company-map-job-link"
        search={mapWindowSearch}
        style={style}
        to={destination.to}
      >
        {children}
      </Link>
    );
  }
  if (destination.kind === "work") {
    return (
      <Link
        {...common}
        className="company-map-job-link"
        params={{ workSurface: "work" }}
        search={mapWindowSearch}
        style={style}
        to="/$workSurface"
      >
        {children}
      </Link>
    );
  }
  if (destination.kind === "whatsapp" && whatsappChannelId) {
    return (
      <Link
        {...common}
        className="company-map-job-link"
        params={{ channelId: whatsappChannelId }}
        search={companyMapWhatsAppSearch(mapJob, destination.tab, "channel")}
        style={style}
        to="/channels/$channelId"
      >
        {children}
      </Link>
    );
  }
  if (destination.kind === "whatsapp") {
    return (
      <Link
        {...common}
        className="company-map-job-link"
        search={companyMapWhatsAppSearch(mapJob, destination.tab, "setup")}
        style={style}
        to="/leads"
      >
        {children}
      </Link>
    );
  }
  const partId =
    destination.kind === "part" ? destination.functionId : functionId;
  return (
    <Link
      {...common}
      className="company-map-job-link"
      params={{ function: partId }}
      search={mapWindowSearch}
      style={style}
      to="/company/function/$function"
    >
      {children}
    </Link>
  );
}

function countForPart(summary: MapSummary | undefined, functionId: FunctionId) {
  return summary?.byPart[functionId] ?? 0;
}

function countForJob(
  summary: MapSummary | undefined,
  functionId: FunctionId,
  name: string,
) {
  return summary?.byJob[companyMapJobKey(functionId, name)] ?? 0;
}

function connectorPath(x1: number, y1: number, x2: number, y2: number): string {
  const middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}

function MapConnectors({
  summary,
  activePart,
  slots,
  liveFunctionIds,
  layout,
  operationsLayout,
  operationsWorkflows,
}: {
  summary: MapSummary | undefined;
  activePart: FunctionId | null;
  slots: FunctionSlotView[];
  liveFunctionIds: readonly FunctionId[];
  layout: CompanyMapLayoutSurface;
  operationsLayout: CompanyMapOperationsLayout | null;
  operationsWorkflows: readonly CompanyMapOperationsWorkflow[];
}) {
  return (
    <svg
      aria-hidden="true"
      className="company-map-connectors"
      viewBox={`0 0 ${COMPANY_MAP_SIZE.width} ${COMPANY_MAP_SIZE.height}`}
    >
      {FUNCTION_ORDER.map((functionId) => {
        const part = partInLayout(layout, functionId);
        const { point: position, side } = part;
        const slot = slotForFunction(functionId, slots);
        const state: CompanyMapConnectorState = liveFunctionIds.includes(
          functionId,
        )
          ? "live"
          : slot.state === "empty"
            ? "off"
            : "on";
        return (
          <path
            className="company-map-center-line"
            d={connectorPath(
              COMPANY_MAP_CENTER.x + (side ?? 1) * 62,
              COMPANY_MAP_CENTER.y,
              position.x - (side ?? 1) * 46,
              position.y,
            )}
            data-map-connector
            data-map-target={functionId}
            data-state={state}
            key={functionId}
          />
        );
      })}
      {activePart
        ? layout.jobs
            .filter((job) => job.functionId === activePart)
            .map((job) => {
              const { name, point: position, side } = job;
              const state = companyMapJobConnectorState(
                activePart,
                name,
                slotForFunction(activePart, slots).state,
                liveFunctionIds.includes(activePart),
                countForJob(summary, activePart, name) > 0,
              );
              const part = partInLayout(layout, activePart).point;
              return (
                <path
                  className="company-map-job-line"
                  d={connectorPath(
                    part.x + (side ?? 1) * 46,
                    part.y,
                    position.x - (side ?? 1) * 26,
                    position.y,
                  )}
                  data-map-connector
                  data-map-target={`${activePart}:${name}`}
                  data-state={state}
                  key={name}
                />
              );
            })
        : layout.jobs
            .filter((job) => countForJob(summary, job.functionId, job.name) > 0)
            .map((job) => {
              const { functionId, name, point: position, side } = job;
              const part = partInLayout(layout, functionId).point;
              return (
                <path
                  className="company-map-job-line"
                  d={connectorPath(
                    part.x + (side ?? 1) * 46,
                    part.y,
                    position.x - (side ?? 1) * 26,
                    position.y,
                  )}
                  data-map-connector
                  data-map-target={`${functionId}:${name}`}
                  data-state={companyMapJobConnectorState(
                    functionId,
                    name,
                    slotForFunction(functionId, slots).state,
                    liveFunctionIds.includes(functionId),
                    countForJob(summary, functionId, name) > 0,
                  )}
                  key={`${functionId}:${name}`}
                />
              );
            })}
      {activePart === "operations" && operationsLayout
        ? operationsLayout.workflows.map((position) => {
            const workflow = operationsWorkflows.find(
              (candidate) => candidate.playbookId === position.playbookId,
            );
            const part = partInLayout(layout, "operations").point;
            return (
              <path
                className="company-map-job-line"
                d={connectorPath(
                  part.x - 46,
                  part.y,
                  position.point.x + 26,
                  position.point.y,
                )}
                data-map-connector
                data-map-target={`operations:${position.playbookId}`}
                data-state={workflow?.isNew ? "seat" : "on"}
                key={`operations:${position.playbookId}`}
              />
            );
          })
        : null}
    </svg>
  );
}

function CompanyHub({
  companyId,
  companyName,
  relayUrl,
  ownerName,
  ownerPubkey,
  ownerAvatarUrl,
  scoutPubkey,
  onClick,
}: {
  companyId?: string;
  companyName: string;
  relayUrl?: string;
  ownerName: string;
  ownerPubkey?: string;
  ownerAvatarUrl?: string | null;
  scoutPubkey?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`${companyName}. ${ownerName}, founder, and Scout, chief of staff. Show the whole company.`}
      className="company-map-hub"
      data-testid="cofounder-map-company-hub"
      onClick={onClick}
      type="button"
    >
      <span className="company-map-hub-disc">
        <WorkspaceMark
          className="company-map-logo"
          communityIconFit="cover"
          communityId={companyId}
          dataTestId="cofounder-map-company-logo"
          fallbackContent={
            <span>{companyName.trim().slice(0, 1).toUpperCase() || "C"}</span>
          }
          imageClassName="company-map-logo-image"
          imageFit="contain"
          name={companyName}
          relayUrl={relayUrl}
        />
      </span>
      <span className="company-map-hub-people">
        <MapDoer
          avatarUrl={ownerAvatarUrl}
          className="company-map-owner-avatar"
          name={ownerName}
          owner
          pubkey={ownerPubkey}
        />
        <MapDoer
          className="company-map-owner-avatar"
          scout
          pubkey={scoutPubkey ?? undefined}
        />
      </span>
      <span className="company-map-hub-name">{companyName}</span>
    </button>
  );
}

function JobNode({
  functionId,
  name,
  count,
  slot,
  side,
  point,
  members,
  profiles,
  whatsappChannelId,
  onGroupFocus,
  onGroupBlur,
  onGroupMouseEnter,
  onGroupMouseLeave,
}: {
  functionId: FunctionId;
  name: string;
  count: number;
  slot: FunctionSlotView;
  side: -1 | 1;
  point: CompanyMapPoint;
  members: TeamMember[];
  profiles: ProfileLookup;
  whatsappChannelId?: string | null;
  onGroupFocus: (functionId: FunctionId) => void;
  onGroupBlur: (event: FocusEvent<HTMLElement>, functionId: FunctionId) => void;
  onGroupMouseEnter: (functionId: FunctionId) => void;
  onGroupMouseLeave: () => void;
}) {
  const left = side === 1 ? point.x - 24 : point.x + 24 - 232;
  const style = {
    left: mapPercent(left, COMPANY_MAP_SIZE.width),
    top: mapPercent(point.y - 24, COMPANY_MAP_SIZE.height),
  };
  return (
    <JobLink
      functionId={functionId}
      jobName={name}
      count={count}
      whatsappChannelId={whatsappChannelId}
      style={style}
      onBlur={(event) => onGroupBlur(event, functionId)}
      onFocus={() => onGroupFocus(functionId)}
      onMouseEnter={() => onGroupMouseEnter(functionId)}
      onMouseLeave={onGroupMouseLeave}
    >
      <span className="company-map-job-row" data-side={side}>
        <span
          className="company-map-job-disc"
          data-testid={`cofounder-map-job-disc-${functionId}-${name.toLowerCase().replaceAll(" ", "-")}`}
        >
          <JobDoer members={members} profiles={profiles} slot={slot} />
          <NeedsBadge
            count={count}
            testId={`cofounder-map-job-needs-${functionId}-${name.toLowerCase().replaceAll(" ", "-")}`}
          />
        </span>
        <span
          className="company-map-job-name"
          data-built={!isCompanyMapJobFallback(functionId, name)}
        >
          {name}
        </span>
      </span>
    </JobLink>
  );
}

function PartNode({
  functionId,
  active,
  faded,
  count,
  slot,
  point,
  members,
  profiles,
  onClick,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
}: {
  functionId: FunctionId;
  active: boolean;
  faded: boolean;
  count: number;
  slot: FunctionSlotView;
  point: CompanyMapPoint;
  members: TeamMember[];
  profiles: ProfileLookup;
  onClick: () => void;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const detail = FUNCTION_DETAILS[functionId];
  const style = {
    left: mapPercent(point.x - 80, COMPANY_MAP_SIZE.width),
    top: mapPercent(point.y - 44, COMPANY_MAP_SIZE.height),
  };
  const ownerText =
    slot.state === "covered_by_scout"
      ? "covered by Scout"
      : slot.state === "filled"
        ? `led by ${(() => {
            const member = members.find(
              (candidate) =>
                candidate.pubkey.toLowerCase() ===
                slot.leadPubkey?.toLowerCase(),
            );
            return member ? fullName(member, profiles) : "assigned lead";
          })()}`
        : "empty slot";

  return (
    <button
      aria-expanded={active}
      aria-label={`${detail.name}, ${ownerText}${count > 0 ? `, ${countLabel(count)}` : ""}`}
      className="company-map-part-button"
      data-function={functionId}
      data-faded={faded ? "true" : undefined}
      data-map-group={functionId}
      data-testid={`cofounder-map-${functionId}`}
      data-state={slot.state}
      onBlur={onBlur}
      onClick={onClick}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={style}
      type="button"
    >
      <span
        className="company-map-part-disc"
        data-map-circle={functionId}
        data-state={slot.state}
      >
        <DoerForPart members={members} profiles={profiles} slot={slot} />
        <NeedsBadge
          count={count}
          testId={`cofounder-map-part-needs-${functionId}`}
        />
      </span>
      <span className="company-map-part-name">{detail.name}</span>
    </button>
  );
}

function CompanyMapDesktop({
  companyId,
  companyName,
  relayUrl,
  ownerName,
  ownerPubkey,
  ownerAvatarUrl,
  scoutPubkey,
  canHirePrebuiltHeads = false,
  onHireHead = () => undefined,
  recentPrebuiltHires,
  members,
  profiles,
  slots,
  liveFunctionIds,
  summary,
  whatsAppChannelId: whatsappChannelId,
  operationsWorkflows = [],
  scoutChannelId,
  clientChannelId,
  mapWindowDepth = 0,
  mapWindowJob = null,
  onMapWindowClose,
  onMapWindowFit,
}: CompanyMapBoardProps) {
  const {
    activePart: interactiveActivePart,
    blurPart,
    clearOpenPart,
    closeHoverSoon,
    enterPart,
    focusPart,
    togglePinnedPart,
  } = useCompanyMapDesktopOpenPart();
  const activePart = mapWindowJob?.functionId ?? interactiveActivePart;
  const [selectedOperationsWorkflowId, setSelectedOperationsWorkflowId] =
    useState<string | null>(null);
  const mapWindowWorkflowId =
    mapWindowJob && "playbookId" in mapWindowJob
      ? mapWindowJob.playbookId
      : null;
  const selectedWorkflowIsPresent = operationsWorkflows.some(
    (workflow) => workflow.playbookId === selectedOperationsWorkflowId,
  );
  const openOperationsWorkflowId =
    activePart === "operations"
      ? (mapWindowWorkflowId ??
        (selectedWorkflowIsPresent ? selectedOperationsWorkflowId : null))
      : null;
  const operationsLayout = useMemo(
    () =>
      operationsWorkflows.length > 0
        ? buildCompanyMapOperationsLayout({
            openPlaybookId: openOperationsWorkflowId,
            workflows: operationsWorkflows.map((workflow) => ({
              playbookId: workflow.playbookId,
              stepIds: workflow.steps.map((step) => step.stepId),
            })),
          })
        : null,
    [openOperationsWorkflowId, operationsWorkflows],
  );
  const layout: CompanyMapLayoutSurface =
    operationsLayout ?? COMPANY_MAP_LAYOUT;
  const mapWindowOpen = mapWindowJob !== null;
  const {
    camera,
    fitCamera,
    onClickCapture,
    onContextMenuCapture,
    onDragStartCapture,
    onKeyDown: onCameraKeyDown,
    onKeyUp: onCameraKeyUp,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    stageRef,
    viewportRef,
    zoomCameraBy,
  } = useCompanyMapCamera({ disabled: mapWindowOpen });
  useCompanyMapNoScreenCloseFocus({
    activePart: interactiveActivePart,
    clearOpenPart,
    focusPart,
    mapWindowJob,
  });
  const mapWindowPart = mapWindowJob
    ? partInLayout(layout, mapWindowJob.functionId)
    : null;
  const mapWindowSide = mapWindowPart?.side ?? null;
  const trailDepth = Math.max(0, Math.floor(mapWindowDepth));
  const stageStyle: StageStyle = {
    "--company-map-transform": mapWindowPart
      ? `translate(${(mapWindowSide === -1 ? 1316 : 84) - mapWindowPart.point.x + (mapWindowSide === -1 ? trailDepth : -trailDepth) * 1260}px, ${100 - mapWindowPart.point.y}px) scale(1)`
      : `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
  };
  const jobs = activePart
    ? layout.jobs.filter((job) => job.functionId === activePart)
    : summary
      ? layout.jobs.filter(
          (job) => countForJob(summary, job.functionId, job.name) > 0,
        )
      : [];
  const mapHint =
    activePart === "operations" && operationsWorkflows.length > 0
      ? "Tap a workflow or a step. Its screen opens right here."
      : "Point at a part to open it. Tap a job to go in.";

  return (
    <div className="company-map-desktop" data-testid="cofounder-map-desktop">
      <div className="company-map-scroll">
        {/* A plain group, not a fieldset: a fieldset clips everything inside
            it when it is stretched by its minimum height. */}
        {/* biome-ignore lint/a11y/useSemanticElements: see the note above */}
        <div
          aria-label={`${companyName} company map`}
          className="company-map-viewport"
          data-map-camera-wheel-owner={mapWindowOpen ? undefined : "true"}
          data-testid="cofounder-map-viewport"
          role="group"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: This application map implements the documented keyboard panning and zooming controls.
          tabIndex={0}
          onClickCapture={onClickCapture}
          onClick={(event) => {
            if (mapWindowOpen) return;
            if (
              event.target === event.currentTarget ||
              event.target ===
                event.currentTarget.querySelector(".company-map-stage")
            ) {
              clearOpenPart();
            }
          }}
          onContextMenuCapture={onContextMenuCapture}
          onDragStartCapture={onDragStartCapture}
          onKeyDown={(event) => {
            if (onCameraKeyDown(event)) return;
            if (event.key !== "Escape") return;
            if (mapWindowOpen) {
              onMapWindowClose?.();
              return;
            }
            clearOpenPart();
          }}
          onKeyUp={onCameraKeyUp}
          onLostPointerCapture={onLostPointerCapture}
          onPointerCancel={onPointerCancel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          data-zoomed={camera.scale > 1}
          data-map-window-open={mapWindowOpen ? "true" : undefined}
          data-map-window-side={
            mapWindowSide === -1
              ? "left"
              : mapWindowSide === 1
                ? "right"
                : undefined
          }
          ref={viewportRef}
        >
          <div
            aria-hidden={mapWindowOpen ? true : undefined}
            className="company-map-stage"
            data-active-part={activePart ?? "none"}
            data-map-window-open={mapWindowOpen ? "true" : undefined}
            data-testid="cofounder-map-stage"
            inert={mapWindowOpen ? true : undefined}
            ref={stageRef}
            style={stageStyle}
          >
            <MapConnectors
              activePart={activePart}
              layout={layout}
              liveFunctionIds={liveFunctionIds}
              operationsLayout={operationsLayout}
              operationsWorkflows={operationsWorkflows}
              slots={slots}
              summary={summary}
            />
            <div
              aria-hidden="true"
              className="company-map-highlight"
              data-active={activePart ?? "none"}
              style={
                activePart
                  ? {
                      left: partInLayout(layout, activePart).point.x - 50,
                      top: partInLayout(layout, activePart).point.y - 50,
                      width: 100,
                      height: 100,
                    }
                  : {
                      left: COMPANY_MAP_CENTER.x - 50,
                      top: COMPANY_MAP_CENTER.y - 50,
                      width: 100,
                      height: 100,
                    }
              }
            />
            {FUNCTION_ORDER.map((functionId) => (
              <Fragment key={functionId}>
                <PartNode
                  active={activePart === functionId}
                  count={countForPart(summary, functionId)}
                  faded={activePart !== null && activePart !== functionId}
                  functionId={functionId}
                  members={members}
                  onBlur={(event) => blurPart(event, functionId)}
                  onClick={() => togglePinnedPart(functionId)}
                  onFocus={() => focusPart(functionId)}
                  onMouseEnter={() => enterPart(functionId)}
                  onMouseLeave={closeHoverSoon}
                  point={partInLayout(layout, functionId).point}
                  profiles={profiles}
                  slot={slotForFunction(functionId, slots)}
                />
                {jobs
                  .filter((job) => job.functionId === functionId)
                  .map((job) => (
                    <JobNode
                      count={countForJob(summary, job.functionId, job.name)}
                      functionId={job.functionId}
                      key={`${job.functionId}:${job.name}`}
                      members={members}
                      name={job.name}
                      onGroupBlur={blurPart}
                      onGroupFocus={focusPart}
                      onGroupMouseEnter={enterPart}
                      onGroupMouseLeave={closeHoverSoon}
                      point={job.point}
                      profiles={profiles}
                      side={job.side}
                      slot={slotForFunction(job.functionId, slots)}
                      whatsappChannelId={whatsappChannelId}
                    />
                  ))}
                {functionId === "operations" &&
                activePart === "operations" &&
                operationsLayout ? (
                  <CompanyMapOperationsNodes
                    clientChannelId={clientChannelId}
                    onGroupBlur={blurPart}
                    onGroupFocus={focusPart}
                    onGroupMouseEnter={enterPart}
                    onGroupMouseLeave={closeHoverSoon}
                    onSelectWorkflow={setSelectedOperationsWorkflowId}
                    operationsLayout={operationsLayout}
                    operationsWorkflows={operationsWorkflows}
                    scoutChannelId={scoutChannelId}
                  />
                ) : null}
                {functionId === "operations" &&
                activePart === "operations" &&
                operationsWorkflows.length === 0 ? (
                  <AddWorkflowNode
                    onGroupBlur={blurPart}
                    onGroupFocus={focusPart}
                    onGroupMouseEnter={enterPart}
                    onGroupMouseLeave={closeHoverSoon}
                    point={STATIC_OPERATIONS_ADD_WORKFLOW_POINT}
                    scoutChannelId={scoutChannelId}
                  />
                ) : null}
                <CompanyMapHoverBridge
                  functionId={functionId}
                  onEnter={() => enterPart(functionId)}
                  onLeave={closeHoverSoon}
                  onClick={clearOpenPart}
                />
              </Fragment>
            ))}
            <CompanyHub
              companyId={companyId}
              companyName={companyName}
              onClick={clearOpenPart}
              ownerAvatarUrl={ownerAvatarUrl}
              ownerName={ownerName}
              ownerPubkey={ownerPubkey}
              relayUrl={relayUrl}
              scoutPubkey={scoutPubkey}
            />
            <CompanyMapPartCard
              activePart={activePart}
              canHirePrebuiltHeads={canHirePrebuiltHeads}
              members={members}
              onClose={clearOpenPart}
              onGroupBlur={blurPart}
              onGroupFocus={focusPart}
              onGroupMouseEnter={enterPart}
              onGroupMouseLeave={closeHoverSoon}
              onHireHead={onHireHead}
              ownerName={ownerName}
              profiles={profiles}
              recentPrebuiltHires={recentPrebuiltHires}
              slots={slots}
              summary={summary}
            />
          </div>
          <div
            className="company-map-zoom"
            data-map-control
            data-testid="cofounder-map-zoom"
          >
            <button
              aria-label="Zoom out"
              onClick={() => {
                if (mapWindowOpen) {
                  onMapWindowClose?.();
                  return;
                }
                zoomCameraBy(-0.15);
              }}
              type="button"
            >
              −
            </button>
            <button
              aria-label="Fit the whole company"
              data-testid="cofounder-map-fit"
              onClick={() => {
                if (mapWindowOpen) {
                  if (onMapWindowFit) {
                    onMapWindowFit();
                    return;
                  }
                  onMapWindowClose?.();
                  return;
                }
                fitCamera();
              }}
              type="button"
            >
              Fit
            </button>
            <button
              aria-label="Zoom in"
              onClick={() => zoomCameraBy(0.15)}
              type="button"
            >
              +
            </button>
          </div>
          <p className="company-map-note">{mapHint}</p>
        </div>
      </div>
      <span className="sr-only" data-testid="cofounder-map-zoom-level">
        {Math.round(camera.scale * 100)} percent
      </span>
    </div>
  );
}
export function CompanyMapBoard(props: CompanyMapBoardProps) {
  return (
    <main className="company-map-page" data-testid="cofounder-company-map">
      <h1 className="sr-only">Company map</h1>
      <CompanyMapDesktop {...props} />
      <CompanyMapPhone {...props} />
    </main>
  );
}
