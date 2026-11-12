import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { FocusEvent, PointerEvent, ReactNode } from "react";
import { Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type { TeamMember } from "@/features/company-team/teamModels";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { WorkspaceMark } from "@/features/communities/ui/WorkspaceMark";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";
import {
  companyMapJobIsScoutLed,
  companyMapScoutCoverageSentence,
} from "@/features/cofounder/companyMapAssignments";
import {
  FUNCTION_DETAILS,
  FUNCTION_DESCRIPTIONS,
  FUNCTION_ORDER,
} from "@/features/cofounder/functions";
import {
  COMPANY_MAP_CENTER,
  COMPANY_MAP_LAYOUT,
  COMPANY_MAP_SIZE,
  companyMapJobPosition as jobPosition,
  companyMapPartPosition as partPosition,
  mapPercent,
} from "@/features/cofounder/companyMapLayout";
import {
  companyMapJobKey,
  getCompanyMapJobRoute,
  isCompanyMapJobFallback,
} from "@/features/cofounder/companyMapJobRoutes";
import { CompanyMapPhone } from "./CompanyMapPhone";
import { CompanyMapHoverBridge } from "./CompanyMapHoverBridge";
import type {
  CompanyMapBoardProps,
  CompanyMapSummary as MapSummary,
  ProfileLookup,
} from "./companyMapTypes";
import "./companyMap.css";

type StageStyle = CSSProperties & { "--company-map-transform": string };

function fullName(member: TeamMember, profiles: ProfileLookup): string {
  return (
    profiles[member.pubkey.toLowerCase()]?.displayName?.trim() ||
    member.managedAgent?.name?.trim() ||
    member.fallbackName?.trim() ||
    "Company agent"
  );
}

function greetingPeriod(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  return "Evening";
}

function countLabel(count: number): string {
  return count === 1
    ? "1 thing needs your yes"
    : `${count} things need your yes`;
}

function partCountSentence(count: number): string {
  return count === 1
    ? "1 thing here needs you."
    : `${count} things here need you.`;
}

function slotForFunction(
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

function jobLead(
  functionId: FunctionId,
  jobName: string,
  slot: FunctionSlotView,
): { kind: "scout" } | { kind: "member"; member: TeamMember } | null {
  if (companyMapJobIsScoutLed(functionId, jobName, slot.state)) {
    return { kind: "scout" };
  }
  return null;
}

function MapDoer({
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
    return (
      <MapDoer
        avatarUrl={avatarUrl}
        className={className}
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
  functionId,
  jobName,
  slot,
  members,
  profiles,
}: {
  functionId: FunctionId;
  jobName: string;
  slot: FunctionSlotView;
  members: TeamMember[];
  profiles: ProfileLookup;
}) {
  const assigned = jobLead(functionId, jobName, slot);
  if (assigned?.kind === "scout") {
    return <MapDoer className="company-map-job-avatar" scout />;
  }
  if (slot.state === "filled" && slot.leadPubkey) {
    const member = members.find(
      (candidate) =>
        candidate.pubkey.toLowerCase() === slot.leadPubkey?.toLowerCase(),
    );
    if (member) {
      const name = fullName(member, profiles);
      return (
        <MapDoer
          avatarUrl={profiles[member.pubkey.toLowerCase()]?.avatarUrl}
          className="company-map-job-avatar"
          member={member}
          name={name}
        />
      );
    }
  }
  return (
    <span aria-hidden="true" className="company-map-job-plus">
      <Plus size={20} strokeWidth={2.2} />
    </span>
  );
}

function NeedsBadge({ count, testId }: { count: number; testId: string }) {
  return count > 0 ? (
    <span className="company-map-needs-badge" data-testid={testId}>
      {count}
    </span>
  ) : null;
}

function FunctionLink({
  functionId,
  children,
}: {
  functionId: FunctionId;
  children: ReactNode;
}) {
  return (
    <Link
      data-testid={`cofounder-map-open-${functionId}`}
      params={{ function: functionId }}
      to="/company/function/$function"
    >
      {children}
    </Link>
  );
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
  const common = {
    "aria-label": fallback
      ? `${jobName}. No screen for this job yet. Opens ${FUNCTION_DETAILS[functionId].name}.`
      : destination.kind === "whatsapp" && !whatsappChannelId
        ? `${jobName}. WhatsApp is not set up. Opens ${FUNCTION_DETAILS[functionId].name}.`
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
        style={style}
        search={{ whatsappDeskTab: destination.tab }}
        to="/channels/$channelId"
      >
        {children}
      </Link>
    );
  }
  const functionIdForLink =
    destination.kind === "part" ? destination.functionId : functionId;
  return (
    <Link
      {...common}
      className="company-map-job-link"
      params={{ function: functionIdForLink }}
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

function jobHasDoer(
  functionId: FunctionId,
  name: string,
  slot: FunctionSlotView,
) {
  return jobLead(functionId, name, slot) !== null || slot.state === "filled";
}

function connectorPath(x1: number, y1: number, x2: number, y2: number): string {
  const middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}

function MapConnectors({
  summary,
  activePart,
  slots,
}: {
  summary: MapSummary | undefined;
  activePart: FunctionId | null;
  slots: FunctionSlotView[];
}) {
  return (
    <svg
      aria-hidden="true"
      className="company-map-connectors"
      viewBox={`0 0 ${COMPANY_MAP_SIZE.width} ${COMPANY_MAP_SIZE.height}`}
    >
      {FUNCTION_ORDER.map((functionId) => {
        const position = partPosition(functionId);
        const side = COMPANY_MAP_LAYOUT.parts.find(
          (part) => part.functionId === functionId,
        )?.side;
        const count = countForPart(summary, functionId);
        const slot = slotForFunction(functionId, slots);
        const state =
          count > 0 ? "waiting" : slot.state === "empty" ? "empty" : "assigned";
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
        ? FUNCTION_DETAILS[activePart].subFunctions.map((name) => {
            const position = jobPosition(activePart, name);
            const side = COMPANY_MAP_LAYOUT.jobs.find(
              (job) => job.functionId === activePart && job.name === name,
            )?.side;
            const count = countForJob(summary, activePart, name);
            const state =
              count > 0
                ? "waiting"
                : jobHasDoer(
                      activePart,
                      name,
                      slotForFunction(activePart, slots),
                    )
                  ? "assigned"
                  : "empty";
            const part = partPosition(activePart);
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
        : FUNCTION_ORDER.flatMap((functionId) =>
            FUNCTION_DETAILS[functionId].subFunctions
              .filter((name) => countForJob(summary, functionId, name) > 0)
              .map((name) => {
                const position = jobPosition(functionId, name);
                const side = COMPANY_MAP_LAYOUT.jobs.find(
                  (job) => job.functionId === functionId && job.name === name,
                )?.side;
                const part = partPosition(functionId);
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
                    data-state="waiting"
                    key={`${functionId}:${name}`}
                  />
                );
              }),
          )}
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

function ActionCard({
  activePart,
  ownerName,
  slots,
  summary,
  profiles,
  members,
  onClose,
  onGroupFocus,
  onGroupBlur,
  onGroupMouseEnter,
  onGroupMouseLeave,
}: {
  activePart: FunctionId | null;
  ownerName: string;
  slots: FunctionSlotView[];
  summary: MapSummary | undefined;
  profiles: ProfileLookup;
  members: TeamMember[];
  onClose: () => void;
  onGroupFocus: (functionId: FunctionId) => void;
  onGroupBlur: (event: FocusEvent<HTMLElement>, functionId: FunctionId) => void;
  onGroupMouseEnter: (functionId: FunctionId) => void;
  onGroupMouseLeave: () => void;
}) {
  const name = ownerName.trim().split(/\s+/)[0] || "there";
  if (!activePart) {
    return (
      <section
        aria-label="Your day"
        className="company-map-card"
        data-testid="cofounder-map-home-card"
      >
        <div className="company-map-card-intro">
          <MapDoer className="company-map-card-avatar" scout />
          <p>
            {summary ? (
              summary.total > 0 ? (
                <>
                  {greetingPeriod()}, {name}. {countLabel(summary.total)}.
                </>
              ) : (
                <>
                  {greetingPeriod()}, {name}. Nothing needs you right now.
                </>
              )
            ) : (
              <span
                aria-live="polite"
                data-testid="cofounder-map-summary-loading"
              >
                Loading what needs your yes.
              </span>
            )}
          </p>
        </div>
        {summary && summary.total > 0 ? (
          <Link className="company-map-primary-action" to="/today/needs-you">
            See them
          </Link>
        ) : null}
      </section>
    );
  }

  const detail = FUNCTION_DETAILS[activePart];
  const slot = slotForFunction(activePart, slots);
  const count = countForPart(summary, activePart);
  const lead =
    slot.state === "filled" && slot.leadPubkey
      ? members.find(
          (member) =>
            member.pubkey.toLowerCase() === slot.leadPubkey?.toLowerCase(),
        )
      : undefined;
  const leadName = lead ? fullName(lead, profiles) : null;
  const summaryLine =
    slot.state === "covered_by_scout"
      ? `Scout runs ${detail.name} until you hire someone.${activePart === "operations" ? " Each circle is one workflow. Tap it to see its steps." : ""}`
      : leadName
        ? `${leadName} runs ${detail.name}.`
        : activePart === "operations"
          ? "Nobody runs Operations yet."
          : `Nobody runs ${detail.name} yet. ${companyMapScoutCoverageSentence(activePart, slot.state)}`;

  return (
    <section
      aria-label={`${detail.name} part details`}
      className="company-map-card company-map-card--part"
      data-map-group={activePart}
      data-testid="cofounder-map-part-card"
      onBlur={(event) => onGroupBlur(event, activePart)}
      onFocus={() => onGroupFocus(activePart)}
      onMouseEnter={() => onGroupMouseEnter(activePart)}
      onMouseLeave={onGroupMouseLeave}
    >
      <p className="company-map-card-eyebrow">Part of your company</p>
      <h2>{detail.name}</h2>
      <p className="company-map-card-copy">
        {FUNCTION_DESCRIPTIONS[activePart]} {summaryLine}
        {count > 0 ? ` ${partCountSentence(count)}` : ""}
      </p>
      <div className="company-map-card-actions">
        <FunctionLink functionId={activePart}>
          <span className="company-map-primary-action">Open {detail.name}</span>
        </FunctionLink>
        {slot.state === "empty" && activePart !== "operations" ? (
          <Link className="company-map-secondary-action" to="/hire/roles">
            Hire a {detail.suggestedHire}
          </Link>
        ) : null}
        <button
          className="company-map-secondary-action"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
    </section>
  );
}

function JobNode({
  functionId,
  name,
  count,
  slot,
  side,
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
  members: TeamMember[];
  profiles: ProfileLookup;
  whatsappChannelId?: string | null;
  onGroupFocus: (functionId: FunctionId) => void;
  onGroupBlur: (event: FocusEvent<HTMLElement>, functionId: FunctionId) => void;
  onGroupMouseEnter: (functionId: FunctionId) => void;
  onGroupMouseLeave: () => void;
}) {
  const point = jobPosition(functionId, name);
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
          <JobDoer
            functionId={functionId}
            jobName={name}
            members={members}
            profiles={profiles}
            slot={slot}
          />
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
  members: TeamMember[];
  profiles: ProfileLookup;
  onClick: () => void;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const detail = FUNCTION_DETAILS[functionId];
  const point = partPosition(functionId);
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
  members,
  profiles,
  slots,
  summary,
  whatsAppChannelId: whatsappChannelId,
}: CompanyMapBoardProps) {
  const [pinnedPart, setPinnedPart] = useState<FunctionId | null>(null);
  const [hoveredPart, setHoveredPart] = useState<FunctionId | null>(null);
  const [focusedPart, setFocusedPart] = useState<FunctionId | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLFieldSetElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    pan: { x: number; y: number };
  } | null>(null);
  const suppressClickRef = useRef(false);
  const hoverCloseRef = useRef<number | null>(null);
  const activePart = focusedPart ?? hoveredPart ?? pinnedPart;

  useEffect(
    () => () => {
      if (hoverCloseRef.current !== null)
        window.clearTimeout(hoverCloseRef.current);
    },
    [],
  );

  function closeHoverSoon() {
    if (hoverCloseRef.current !== null)
      window.clearTimeout(hoverCloseRef.current);
    hoverCloseRef.current = window.setTimeout(() => setHoveredPart(null), 140);
  }

  function enterPart(functionId: FunctionId) {
    if (hoverCloseRef.current !== null)
      window.clearTimeout(hoverCloseRef.current);
    setHoveredPart(functionId);
  }

  function clearOpenPart() {
    setPinnedPart(null);
    setHoveredPart(null);
    setFocusedPart(null);
  }

  function blurPart(event: FocusEvent<HTMLElement>, functionId: FunctionId) {
    const next = event.relatedTarget;
    if (
      next instanceof HTMLElement &&
      next.closest<HTMLElement>("[data-map-group]")?.dataset.mapGroup ===
        functionId
    ) {
      return;
    }
    window.setTimeout(() => {
      const current = document.activeElement;
      const nextGroup =
        current instanceof HTMLElement
          ? current.closest<HTMLElement>("[data-map-group]")?.dataset.mapGroup
          : undefined;
      setFocusedPart(
        FUNCTION_ORDER.find((candidate) => candidate === nextGroup) ?? null,
      );
    }, 0);
  }

  function setBoardZoom(next: number) {
    const bounded = Math.min(1.3, Math.max(0.7, next));
    setZoom(bounded);
    if (bounded <= 1) setPan({ x: 0, y: 0 });
  }

  function handlePointerDown(event: PointerEvent<HTMLFieldSetElement>) {
    if (
      zoom <= 1 ||
      event.button !== 0 ||
      (event.target instanceof HTMLElement &&
        event.target.closest("button, a, [data-map-control]"))
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLFieldSetElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) {
      suppressClickRef.current = true;
    }
    const maxX = (COMPANY_MAP_SIZE.width * (zoom - 1)) / 2;
    const maxY = (COMPANY_MAP_SIZE.height * (zoom - 1)) / 2;
    setPan({
      x: Math.max(-maxX, Math.min(maxX, drag.pan.x + event.clientX - drag.x)),
      y: Math.max(-maxY, Math.min(maxY, drag.pan.y + event.clientY - drag.y)),
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLFieldSetElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  const stageStyle: StageStyle = {
    "--company-map-transform": `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  };
  const jobs = activePart
    ? FUNCTION_DETAILS[activePart].subFunctions.map((name) => ({
        functionId: activePart,
        name,
        point: jobPosition(activePart, name),
        side:
          COMPANY_MAP_LAYOUT.jobs.find(
            (job) => job.functionId === activePart && job.name === name,
          )?.side ?? 1,
      }))
    : summary
      ? FUNCTION_ORDER.flatMap((functionId) =>
          FUNCTION_DETAILS[functionId].subFunctions
            .filter((name) => countForJob(summary, functionId, name) > 0)
            .map((name) => ({
              functionId,
              name,
              point: jobPosition(functionId, name),
              side:
                COMPANY_MAP_LAYOUT.jobs.find(
                  (job) => job.functionId === functionId && job.name === name,
                )?.side ?? 1,
            })),
        )
      : [];

  return (
    <div className="company-map-desktop" data-testid="cofounder-map-desktop">
      <div className="company-map-scroll">
        <fieldset
          className="company-map-viewport"
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            if (
              event.target === event.currentTarget ||
              event.target ===
                event.currentTarget.querySelector(".company-map-stage")
            ) {
              clearOpenPart();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") clearOpenPart();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          data-zoomed={zoom > 1}
          ref={stageRef}
        >
          <legend className="sr-only">{companyName} company map</legend>
          <div
            className="company-map-stage"
            data-active-part={activePart ?? "none"}
            data-testid="cofounder-map-stage"
            style={stageStyle}
          >
            <MapConnectors
              activePart={activePart}
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
                      left: partPosition(activePart).x - 50,
                      top: partPosition(activePart).y - 50,
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
                  onClick={() => {
                    setPinnedPart((current) => {
                      if (current === functionId) {
                        setHoveredPart(null);
                        setFocusedPart(null);
                        return null;
                      }
                      return functionId;
                    });
                    setFocusedPart(null);
                  }}
                  onFocus={() => setFocusedPart(functionId)}
                  onMouseEnter={() => enterPart(functionId)}
                  onMouseLeave={closeHoverSoon}
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
                      onGroupFocus={setFocusedPart}
                      onGroupMouseEnter={enterPart}
                      onGroupMouseLeave={closeHoverSoon}
                      profiles={profiles}
                      side={job.side}
                      slot={slotForFunction(job.functionId, slots)}
                      whatsappChannelId={whatsappChannelId}
                    />
                  ))}
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
            <ActionCard
              activePart={activePart}
              members={members}
              onClose={clearOpenPart}
              onGroupBlur={blurPart}
              onGroupFocus={setFocusedPart}
              onGroupMouseEnter={enterPart}
              onGroupMouseLeave={closeHoverSoon}
              ownerName={ownerName}
              profiles={profiles}
              slots={slots}
              summary={summary}
            />
          </div>
          <div className="company-map-zoom" data-map-control>
            <button
              aria-label="Zoom out"
              onClick={() => setBoardZoom(zoom - 0.15)}
              type="button"
            >
              −
            </button>
            <button
              aria-label="Fit the whole company"
              data-testid="cofounder-map-fit"
              onClick={() => {
                setBoardZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              type="button"
            >
              Fit
            </button>
            <button
              aria-label="Zoom in"
              onClick={() => setBoardZoom(zoom + 0.15)}
              type="button"
            >
              +
            </button>
          </div>
          <p className="company-map-note">
            Point at a part to open it. Tap a job to go in.
          </p>
        </fieldset>
      </div>
      <span className="sr-only" data-testid="cofounder-map-zoom-level">
        {Math.round(zoom * 100)} percent
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
