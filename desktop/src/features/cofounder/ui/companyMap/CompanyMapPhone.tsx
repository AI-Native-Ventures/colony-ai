import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { WorkspaceMark } from "@/features/communities/ui/WorkspaceMark";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";
import { companyMapJobDoer } from "@/features/cofounder/companyMapAssignments";
import {
  FUNCTION_DESCRIPTIONS,
  FUNCTION_DETAILS,
  FUNCTION_ORDER,
} from "@/features/cofounder/functions";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  companyMapJobKey,
  companyMapWindowSearch,
  getCompanyMapJobRoute,
  isCompanyMapJobFallback,
} from "@/features/cofounder/companyMapJobRoutes";
import { prebuiltHeadForFunction } from "@/features/cofounder/prebuiltAgents";
import { prebuiltAgentAvatarDataUrl } from "@/features/cofounder/prebuiltAgentAvatar";
import type {
  PrebuiltHireCompletion,
  PrebuiltHireStartup,
} from "@/features/cofounder/prebuiltHireStorage";

import type { CompanyMapBoardProps, ProfileLookup } from "./companyMapTypes";
import {
  PrebuiltHeadPreview,
  PrebuiltHireStartupNotice,
  PrebuiltHiredHeadPreview,
  PrebuiltJustHiredContent,
} from "./CompanyMapPartCard";

function fullName(
  member: CompanyMapBoardProps["members"][number],
  profiles: ProfileLookup,
): string {
  return (
    profiles[member.pubkey.toLowerCase()]?.displayName?.trim() ||
    member.managedAgent?.name?.trim() ||
    member.fallbackName?.trim() ||
    "Company agent"
  );
}

function slotFor(functionId: FunctionId, slots: FunctionSlotView[]) {
  return (
    slots.find((slot) => slot.functionId === functionId) ?? {
      functionId,
      state: "empty" as const,
      leadPubkey: null,
    }
  );
}

function countForPart(
  summary: CompanyMapBoardProps["summary"],
  functionId: FunctionId,
) {
  return summary?.byPart[functionId] ?? 0;
}

function countForJob(
  summary: CompanyMapBoardProps["summary"],
  functionId: FunctionId,
  jobName: string,
) {
  return summary?.byJob[companyMapJobKey(functionId, jobName)] ?? 0;
}

function countLabel(count: number) {
  return count === 1
    ? "1 thing needs your yes"
    : `${count} things need your yes`;
}

function partCountSentence(count: number) {
  return count === 1
    ? "1 thing here needs you."
    : `${count} things here need you.`;
}

function greetingPeriod() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  return "Evening";
}

function PersonAvatar({
  className,
  member,
  profiles,
  name,
  scout,
  owner,
  ownerPubkey,
  ownerAvatarUrl,
  fallbackInstance,
}: {
  className: string;
  member?: CompanyMapBoardProps["members"][number];
  profiles: ProfileLookup;
  name?: string;
  scout?: boolean;
  owner?: boolean;
  ownerPubkey?: string;
  ownerAvatarUrl?: string | null;
  fallbackInstance?: string | null;
}) {
  if (owner) {
    return (
      <ProfileAvatar
        avatarUrl={ownerAvatarUrl ?? null}
        className={className}
        initialsLabel={name}
        label={name ?? "Company owner"}
        pubkey={ownerPubkey ?? null}
        shape="circle"
      />
    );
  }
  if (scout) return <EmployeeAvatar className={className} name="Scout" />;
  if (!member)
    return (
      <span
        aria-hidden="true"
        className={`${className} company-map-phone-plus`}
      />
    );
  const display = name ?? fullName(member, profiles);
  return member.kind === "employee" ? (
    <EmployeeAvatar
      className={className}
      instance={member.managedAgent?.avatarUrl ?? fallbackInstance}
      name={display}
      personaId={member.managedAgent?.personaId}
      profile={
        fallbackInstance
          ? null
          : (profiles[member.pubkey.toLowerCase()]?.avatarUrl ?? null)
      }
      pubkey={member.pubkey}
    />
  ) : (
    <ProfileAvatar
      avatarUrl={profiles[member.pubkey.toLowerCase()]?.avatarUrl ?? null}
      className={className}
      label={display}
      pubkey={member.pubkey}
      shape="circle"
    />
  );
}

function LeadAvatar({
  jobName,
  slot,
  members,
  profiles,
  size,
}: {
  jobName?: string;
  slot: FunctionSlotView;
  members: CompanyMapBoardProps["members"];
  profiles: ProfileLookup;
  size: "part" | "job";
}) {
  const className = `company-map-phone-${size}-avatar`;
  const jobDoer = jobName === undefined ? null : companyMapJobDoer(slot);
  if (slot.state === "covered_by_scout" || jobDoer?.kind === "scout") {
    return <PersonAvatar className={className} profiles={profiles} scout />;
  }
  const member =
    jobDoer?.kind === "head" || jobDoer?.kind === "specialist"
      ? members.find(
          (candidate) =>
            candidate.pubkey.toLowerCase() === jobDoer.pubkey.toLowerCase(),
        )
      : slot.state === "filled" && slot.leadPubkey
        ? members.find(
            (candidate) =>
              candidate.pubkey.toLowerCase() === slot.leadPubkey?.toLowerCase(),
          )
        : undefined;
  if (!member)
    return (
      <span
        aria-hidden="true"
        className={`${className} company-map-phone-plus`}
      />
    );
  const prebuiltHead = prebuiltHeadForFunction(slot.functionId);
  const fallbackInstance =
    prebuiltHead && fullName(member, profiles) === prebuiltHead.name
      ? prebuiltAgentAvatarDataUrl(prebuiltHead)
      : null;
  return (
    <PersonAvatar
      className={className}
      fallbackInstance={fallbackInstance}
      member={member}
      name={fullName(member, profiles)}
      profiles={profiles}
    />
  );
}

function PhoneJobLink({
  functionId,
  jobName,
  count,
  whatsappChannelId,
  children,
}: {
  functionId: FunctionId;
  jobName: string;
  count: number;
  whatsappChannelId?: string | null;
  children: ReactNode;
}) {
  const route = getCompanyMapJobRoute(functionId, jobName);
  const fallback = isCompanyMapJobFallback(functionId, jobName);
  const retainsLegacyOutreachLeads =
    functionId === "sales" && jobName === "Outreach";
  const mapWindowSearch = companyMapWindowSearch(functionId, jobName);
  const testProps = {
    "aria-label": fallback
      ? `${jobName}. No screen for this job yet. Opens ${FUNCTION_DETAILS[functionId].name}.`
      : route.kind === "whatsapp" &&
          !whatsappChannelId &&
          !retainsLegacyOutreachLeads
        ? `${jobName}. WhatsApp is not set up. Opens ${FUNCTION_DETAILS[functionId].name}.`
        : count > 0
          ? `${jobName}, ${countLabel(count)}`
          : jobName,
    "data-job": companyMapJobKey(functionId, jobName),
    "data-testid": `cofounder-map-phone-job-${functionId}-${jobName.toLowerCase().replaceAll(" ", "-")}`,
  };
  // The phone map retains its existing Leads destination. The joined desk is
  // only used by the desktop canvas shell.
  if (retainsLegacyOutreachLeads) {
    return (
      <Link
        {...testProps}
        className="company-map-job-link"
        search={mapWindowSearch}
        to="/leads"
      >
        {children}
      </Link>
    );
  }
  if (route.kind === "app") {
    return (
      <Link
        {...testProps}
        className="company-map-job-link"
        search={mapWindowSearch}
        to={route.to}
      >
        {children}
      </Link>
    );
  }
  if (route.kind === "work") {
    return (
      <Link
        {...testProps}
        className="company-map-job-link"
        params={{ workSurface: "work" }}
        search={mapWindowSearch}
        to="/$workSurface"
      >
        {children}
      </Link>
    );
  }
  if (route.kind === "whatsapp" && whatsappChannelId) {
    return (
      <Link
        {...testProps}
        className="company-map-job-link"
        params={{ channelId: whatsappChannelId }}
        search={{
          mapJob: mapWindowSearch?.mapJob,
          whatsappDeskTab: route.tab,
        }}
        to="/channels/$channelId"
      >
        {children}
      </Link>
    );
  }
  const target = route.kind === "part" ? route.functionId : functionId;
  return (
    <Link
      {...testProps}
      className="company-map-job-link"
      params={{ function: target }}
      search={mapWindowSearch}
      to="/company/function/$function"
    >
      {children}
    </Link>
  );
}

function PartStatus({
  slot,
  members,
  profiles,
}: {
  slot: FunctionSlotView;
  members: CompanyMapBoardProps["members"];
  profiles: ProfileLookup;
}) {
  if (slot.state === "covered_by_scout") return <>Covered by Scout</>;
  if (slot.state === "filled") {
    const lead = members.find(
      (member) =>
        member.pubkey.toLowerCase() === slot.leadPubkey?.toLowerCase(),
    );
    return <>Led by {lead ? fullName(lead, profiles) : "assigned lead"}</>;
  }
  return <>Waiting for a lead</>;
}

function PhoneActionCard({
  activePart,
  canHirePrebuiltHeads,
  ownerName,
  slots,
  summary,
  members,
  profiles,
  recentPrebuiltHires,
  prebuiltHireStartups,
  onClose,
  onHireHead,
  onRetryPrebuiltHireStart,
}: {
  activePart: FunctionId | null;
  canHirePrebuiltHeads: boolean;
  ownerName: string;
  slots: FunctionSlotView[];
  summary: CompanyMapBoardProps["summary"];
  members: CompanyMapBoardProps["members"];
  profiles: ProfileLookup;
  recentPrebuiltHires?: Partial<Record<FunctionId, PrebuiltHireCompletion>>;
  prebuiltHireStartups?: Partial<Record<FunctionId, PrebuiltHireStartup>>;
  onClose: () => void;
  onHireHead: (functionId: FunctionId) => void;
  onRetryPrebuiltHireStart: (functionId: FunctionId) => void;
}) {
  const firstName = ownerName.trim().split(/\s+/)[0] || "there";
  if (!activePart) {
    return (
      <section
        aria-label="Your day"
        className="company-map-card"
        data-testid="cofounder-map-home-card-phone"
      >
        <div className="company-map-card-intro">
          <EmployeeAvatar className="company-map-card-avatar" name="Scout" />
          <p>
            {summary ? (
              summary.total > 0 ? (
                <>
                  {greetingPeriod()}, {firstName}. {countLabel(summary.total)}.
                </>
              ) : (
                <>
                  {greetingPeriod()}, {firstName}. Nothing needs you right now.
                </>
              )
            ) : (
              <span aria-live="polite">Loading what needs your yes.</span>
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
  const slot = slotFor(activePart, slots);
  const lead =
    slot.state === "filled" && slot.leadPubkey
      ? members.find(
          (member) =>
            member.pubkey.toLowerCase() === slot.leadPubkey?.toLowerCase(),
        )
      : undefined;
  const count = countForPart(summary, activePart);
  const prebuiltHead = prebuiltHeadForFunction(activePart);
  const recentHire =
    slot.state === "filled" &&
    slot.leadPubkey &&
    recentPrebuiltHires?.[activePart]?.employeePubkey.toLowerCase() ===
      slot.leadPubkey.toLowerCase()
      ? (recentPrebuiltHires[activePart] ?? null)
      : null;
  const leader =
    slot.state === "covered_by_scout"
      ? `Scout runs ${detail.name} for now.`
      : lead
        ? `${fullName(lead, profiles)} runs ${detail.name}.`
        : slot.state === "filled"
          ? `The assigned lead runs ${detail.name}.`
          : `Scout runs ${detail.name} for now.`;
  const canHireHead = Boolean(
    slot.state !== "filled" && prebuiltHead && canHirePrebuiltHeads,
  );
  const candidateStartup = prebuiltHireStartups?.[activePart];
  const startup =
    candidateStartup &&
    (!recentHire ||
      (candidateStartup.hireId === recentHire.hireId &&
        candidateStartup.employeePubkey.toLowerCase() ===
          recentHire.employeePubkey.toLowerCase()))
      ? candidateStartup
      : null;

  if (recentHire && prebuiltHead) {
    return (
      <section
        aria-label={`${detail.name} part details`}
        className="company-map-card company-map-card--part"
      >
        <PrebuiltJustHiredContent
          head={prebuiltHead}
          lead={lead}
          leadName={lead ? fullName(lead, profiles) : null}
          recentHire={recentHire}
        />
        {startup ? (
          <PrebuiltHireStartupNotice
            head={prebuiltHead}
            onRetry={() => onRetryPrebuiltHireStart(activePart)}
            startup={startup}
          />
        ) : null}
        <div className="company-map-card-actions">
          <Link
            className="company-map-primary-action"
            params={{ channelId: recentHire.directChannelId }}
            to="/channels/$channelId"
          >
            Open direct chat
          </Link>
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

  return (
    <section
      aria-label={`${detail.name} part details`}
      className="company-map-card company-map-card--part"
    >
      <p className="company-map-card-eyebrow">Part of your company</p>
      <h2>{detail.name}</h2>
      <p className="company-map-card-copy">
        {FUNCTION_DESCRIPTIONS[activePart]} {leader}
        {count > 0 ? ` ${partCountSentence(count)}` : ""}
      </p>
      {slot.state !== "filled" ? (
        <PrebuiltHeadPreview functionId={activePart} />
      ) : null}
      {startup && prebuiltHead ? (
        <PrebuiltHireStartupNotice
          head={prebuiltHead}
          onRetry={() => onRetryPrebuiltHireStart(activePart)}
          startup={startup}
        />
      ) : null}
      {slot.state === "filled" && prebuiltHead ? (
        <PrebuiltHiredHeadPreview
          head={prebuiltHead}
          isPrebuilt={
            lead?.managedAgent?.name === prebuiltHead.name ||
            recentHire !== null
          }
          lead={lead}
          leadName={lead ? fullName(lead, profiles) : null}
        />
      ) : null}
      <div className="company-map-card-actions">
        {canHireHead && prebuiltHead ? (
          <button
            className="company-map-primary-action"
            data-testid={`cofounder-hire-head-phone-${activePart}`}
            onClick={() => onHireHead(activePart)}
            type="button"
          >
            Hire {prebuiltHead.name}
          </button>
        ) : null}
        <Link
          className={
            canHireHead
              ? "company-map-secondary-action"
              : "company-map-primary-action"
          }
          params={{ function: activePart }}
          to="/company/function/$function"
        >
          Open {detail.name}
        </Link>
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

export function CompanyMapPhone({
  companyId,
  companyName,
  relayUrl,
  ownerName,
  ownerPubkey,
  ownerAvatarUrl,
  members,
  profiles,
  slots,
  summary,
  whatsAppChannelId,
  canHirePrebuiltHeads = false,
  onHireHead = () => undefined,
  onRetryPrebuiltHireStart = () => undefined,
  recentPrebuiltHires,
  prebuiltHireStartups,
}: CompanyMapBoardProps) {
  const [activePart, setActivePart] = useState<FunctionId | null>(null);
  return (
    <div className="company-map-phone" data-testid="cofounder-map-phone">
      <div className="company-map-phone-hub">
        <WorkspaceMark
          className="company-map-phone-logo"
          communityIconFit="cover"
          communityId={companyId}
          fallbackContent={<span>{companyName.slice(0, 1).toUpperCase()}</span>}
          imageClassName="company-map-logo-image"
          imageFit="contain"
          name={companyName}
          relayUrl={relayUrl}
        />
        <div>
          <p className="company-map-phone-eyebrow">Your company</p>
          <h1>{companyName}</h1>
          <div className="company-map-phone-people">
            <PersonAvatar
              ownerAvatarUrl={ownerAvatarUrl}
              className="company-map-phone-avatar"
              name={ownerName}
              owner
              ownerPubkey={ownerPubkey}
              profiles={profiles}
            />
            <span>{ownerName.trim().split(/\s+/)[0] || "Owner"}</span>
            <PersonAvatar
              className="company-map-phone-avatar"
              profiles={profiles}
              scout
            />
            <span>Scout</span>
          </div>
        </div>
      </div>
      <div className="company-map-phone-parts">
        {FUNCTION_ORDER.map((functionId) => {
          const detail = FUNCTION_DETAILS[functionId];
          const slot = slotFor(functionId, slots);
          const count = countForPart(summary, functionId);
          const expanded = activePart === functionId;
          return (
            <section
              className="company-map-phone-part"
              data-function={functionId}
              key={functionId}
            >
              <button
                aria-expanded={expanded}
                className="company-map-phone-part-button"
                data-testid={`cofounder-map-phone-${functionId}`}
                onClick={() => setActivePart(expanded ? null : functionId)}
                type="button"
              >
                <span className="company-map-phone-part-disc">
                  <LeadAvatar
                    members={members}
                    profiles={profiles}
                    size="part"
                    slot={slot}
                  />
                  {count > 0 ? (
                    <span
                      aria-hidden="true"
                      className="company-map-needs-badge"
                      data-testid={`cofounder-map-phone-part-needs-${functionId}`}
                    >
                      {count}
                    </span>
                  ) : null}
                </span>
                <span className="company-map-phone-part-copy">
                  <strong>{detail.name}</strong>
                  <span>
                    <PartStatus
                      members={members}
                      profiles={profiles}
                      slot={slot}
                    />
                  </span>
                </span>
                <span className="company-map-phone-part-count">
                  {count > 0 ? count : ""}
                </span>
                <span aria-hidden="true" className="company-map-phone-chevron">
                  {expanded ? "−" : "+"}
                </span>
              </button>
              {expanded ? (
                <div className="company-map-phone-jobs">
                  {detail.subFunctions.map((jobName) => {
                    const jobCount = countForJob(summary, functionId, jobName);
                    return (
                      <PhoneJobLink
                        count={jobCount}
                        functionId={functionId}
                        jobName={jobName}
                        key={jobName}
                        whatsappChannelId={whatsAppChannelId}
                      >
                        <span className="company-map-phone-job">
                          <span className="company-map-phone-job-disc">
                            <LeadAvatar
                              jobName={jobName}
                              members={members}
                              profiles={profiles}
                              size="job"
                              slot={slot}
                            />
                            {jobCount > 0 ? (
                              <span
                                aria-hidden="true"
                                className="company-map-needs-badge"
                                data-testid={`cofounder-map-phone-job-needs-${functionId}-${jobName.toLowerCase().replaceAll(" ", "-")}`}
                              >
                                {jobCount}
                              </span>
                            ) : null}
                          </span>
                          <span
                            data-built={
                              !isCompanyMapJobFallback(functionId, jobName)
                            }
                          >
                            {jobName}
                          </span>
                          <span
                            aria-hidden="true"
                            className="company-map-phone-job-arrow"
                          >
                            ›
                          </span>
                        </span>
                      </PhoneJobLink>
                    );
                  })}
                  <Link
                    className="company-map-phone-open-part"
                    params={{ function: functionId }}
                    to="/company/function/$function"
                  >
                    Open {detail.name}
                  </Link>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <PhoneActionCard
        activePart={activePart}
        canHirePrebuiltHeads={canHirePrebuiltHeads}
        members={members}
        onClose={() => setActivePart(null)}
        onHireHead={onHireHead}
        onRetryPrebuiltHireStart={onRetryPrebuiltHireStart}
        ownerName={ownerName}
        profiles={profiles}
        recentPrebuiltHires={recentPrebuiltHires}
        prebuiltHireStartups={prebuiltHireStartups}
        slots={slots}
        summary={summary}
      />
    </div>
  );
}
