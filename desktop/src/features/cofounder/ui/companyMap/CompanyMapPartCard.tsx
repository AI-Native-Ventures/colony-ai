import type { FocusEvent } from "react";
import { Link } from "@tanstack/react-router";

import { agentAntAvatarDataUrl } from "@/features/agents/ui/agentAntAvatar";
import type { TeamMember } from "@/features/company-team/teamModels";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";
import { companyMapScoutCoverageSentence } from "@/features/cofounder/companyMapAssignments";
import {
  FUNCTION_DETAILS,
  FUNCTION_DESCRIPTIONS,
} from "@/features/cofounder/functions";
import { prebuiltHeadForFunction } from "@/features/cofounder/prebuiltAgents";

import { fullName, MapDoer, slotForFunction } from "./CompanyMapOperationsNodes";
import type { CompanyMapSummary, ProfileLookup } from "./companyMapTypes";

function partCountSentence(count: number): string {
  return count === 1
    ? "1 thing here needs you."
    : `${count} things here need you.`;
}

function countForPart(
  summary: CompanyMapSummary | undefined,
  functionId: FunctionId,
): number {
  return summary?.byPart[functionId] ?? 0;
}

export function PrebuiltHeadPreview({
  functionId,
}: {
  functionId: FunctionId;
}) {
  const head = prebuiltHeadForFunction(functionId);
  if (!head) return null;
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-border bg-background/70 p-3">
      <EmployeeAvatar
        className="size-10 rounded-full"
        instance={agentAntAvatarDataUrl(head.name)}
        name={head.name}
        role={`Head of ${FUNCTION_DETAILS[functionId].name}`}
      />
      <div className="min-w-0">
        <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
          Prebuilt head
        </p>
        <p className="truncate text-sm font-bold">{head.name}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {head.does[0]}
        </p>
      </div>
    </div>
  );
}

export function CompanyMapPartCard({
  activePart,
  canHirePrebuiltHeads,
  members,
  onClose,
  onGroupBlur,
  onGroupFocus,
  onGroupMouseEnter,
  onGroupMouseLeave,
  onHireHead,
  ownerName,
  profiles,
  slots,
  summary,
}: {
  activePart: FunctionId | null;
  canHirePrebuiltHeads: boolean;
  members: TeamMember[];
  onClose: () => void;
  onGroupBlur: (event: FocusEvent<HTMLElement>, functionId: FunctionId) => void;
  onGroupFocus: (functionId: FunctionId) => void;
  onGroupMouseEnter: (functionId: FunctionId) => void;
  onGroupMouseLeave: () => void;
  onHireHead: (functionId: FunctionId) => void;
  ownerName: string;
  profiles: ProfileLookup;
  slots: FunctionSlotView[];
  summary: CompanyMapSummary | undefined;
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
                  Good day, {name}. {summary.total === 1 ? "1 thing needs your yes." : `${summary.total} things need your yes.`}
                </>
              ) : (
                <>
                  Good day, {name}. Nothing needs your yes right now.
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
      ? `Scout runs ${detail.name} until you hire someone.`
      : leadName
        ? `${leadName} runs ${detail.name}.`
        : `Nobody runs ${detail.name} yet. ${companyMapScoutCoverageSentence(activePart, slot.state)}`;
  const head = prebuiltHeadForFunction(activePart);

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
      {slot.state === "empty" ? <PrebuiltHeadPreview functionId={activePart} /> : null}
      <div className="company-map-card-actions">
        <Link
          className="company-map-primary-action"
          params={{ function: activePart }}
          to="/company/function/$function"
        >
          Open {detail.name}
        </Link>
        {slot.state === "empty" && head && canHirePrebuiltHeads ? (
          <button
            className="company-map-secondary-action"
            data-testid={`cofounder-hire-head-${activePart}`}
            onClick={() => onHireHead(activePart)}
            type="button"
          >
            Hire {head.name}
          </button>
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
