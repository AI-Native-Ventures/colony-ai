import type { FocusEvent } from "react";
import { Link } from "@tanstack/react-router";

import { agentAntAvatarDataUrl } from "@/features/agents/ui/agentAntAvatar";
import type { TeamMember } from "@/features/company-team/teamModels";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";
import {
  FUNCTION_DETAILS,
  FUNCTION_DESCRIPTIONS,
} from "@/features/cofounder/functions";
import { prebuiltHeadForFunction } from "@/features/cofounder/prebuiltAgents";
import type { PrebuiltHireCompletion } from "@/features/cofounder/prebuiltHireStorage";

import {
  fullName,
  MapDoer,
  slotForFunction,
} from "./CompanyMapOperationsNodes";
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
    <div className="mt-2.5 flex items-center gap-3 rounded-[14px] bg-muted/50 p-3">
      <EmployeeAvatar
        className="size-10 rounded-full border-2 border-dashed border-border p-0.5"
        instance={agentAntAvatarDataUrl(head.name)}
        name={head.name}
        role={`Head of ${FUNCTION_DETAILS[functionId].name}`}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-extrabold">{head.name}</p>
          <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-extrabold text-primary">
            Pre-built
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {head.does[0]}
        </p>
      </div>
    </div>
  );
}

export function PrebuiltHiredHeadPreview({
  head,
  lead,
  leadName,
  recentHire,
}: {
  head: NonNullable<ReturnType<typeof prebuiltHeadForFunction>>;
  lead: TeamMember | undefined;
  leadName: string | null;
  recentHire: PrebuiltHireCompletion | null;
}) {
  const name = leadName ?? head.name;
  const isPrebuilt =
    lead?.managedAgent?.name === head.name ||
    recentHire?.employeePubkey.toLowerCase() === lead?.pubkey.toLowerCase();
  const legacyTitle = lead?.position?.head.title ?? "Assigned lead";
  return (
    <div className="mt-4 rounded-xl border border-border bg-background/70 p-3">
      <div className="flex items-center gap-3">
        <EmployeeAvatar
          className="size-10 rounded-full"
          instance={lead?.managedAgent?.avatarUrl}
          name={name}
          personaId={lead?.managedAgent?.personaId}
          profile={lead ? undefined : null}
          pubkey={lead?.pubkey}
          role={head.name}
        />
        <div className="min-w-0">
          {isPrebuilt ? (
            <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs font-extrabold text-emerald-700 dark:text-emerald-300">
              Works here
            </span>
          ) : null}
          <p className="truncate text-sm font-bold">{name}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {isPrebuilt ? head.does[0] : legacyTitle}
          </p>
        </div>
      </div>
      {recentHire ? (
        <div className="mt-3 rounded-lg bg-muted/60 p-3">
          <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            Just hired
          </p>
          <p className="mt-1 text-sm">{recentHire.firstMove}</p>
          <Link
            className="mt-2 inline-flex text-sm font-bold text-primary underline"
            params={{ channelId: recentHire.directChannelId }}
            to="/channels/$channelId"
          >
            Open direct chat
          </Link>
        </div>
      ) : null}
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
  recentPrebuiltHires,
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
  recentPrebuiltHires?: Partial<Record<FunctionId, PrebuiltHireCompletion>>;
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
                  Good day, {name}.{" "}
                  {summary.total === 1
                    ? "1 thing needs your yes."
                    : `${summary.total} things need your yes.`}
                </>
              ) : (
                <>Good day, {name}. Nothing needs your yes right now.</>
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
  const head = prebuiltHeadForFunction(activePart);
  const recentHire =
    slot.state === "filled" &&
    slot.leadPubkey &&
    recentPrebuiltHires?.[activePart]?.employeePubkey.toLowerCase() ===
      slot.leadPubkey.toLowerCase()
      ? (recentPrebuiltHires[activePart] ?? null)
      : null;
  const isPrebuiltLead =
    slot.state === "filled" &&
    head &&
    (lead?.managedAgent?.name === head.name || recentHire !== null);
  const summaryLine =
    slot.state === "filled" && leadName
      ? isPrebuiltLead
        ? `${leadName} is your ${lead?.position?.head.title ?? head?.name}. ${leadName} does every job here that has no specialist of its own.`
        : `${leadName} runs ${detail.name}.`
      : `Scout runs ${detail.name} for now.`;

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
      {slot.state === "empty" ? (
        <PrebuiltHeadPreview functionId={activePart} />
      ) : null}
      {slot.state === "filled" && head ? (
        <PrebuiltHiredHeadPreview
          head={head}
          lead={lead}
          leadName={leadName}
          recentHire={recentHire}
        />
      ) : null}
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
