import type { ProspectStage } from "./businessRecordContract";
import type { BusinessRecords } from "./businessRecordRelay";
import { shortAreaName } from "./discoveryCampaignAreas";
import { MAX_PAGES } from "./discoveryCampaignContinuation";
import type {
  DiscoveryCampaign,
  DiscoveryRunStatus,
} from "./discoveryProvider";

export type CampaignProspect = BusinessRecords["prospects"][number];
export type ProspectFilter = "all" | "high-fit" | "accepted" | "candidates";
export type PillTone = "ok" | "idle" | "accent" | "need" | "info" | "bad";

const RUN_LABELS: Record<DiscoveryRunStatus, string> = {
  running: "Finding prospects",
  paused: "Search paused",
  failed: "Search interrupted",
  cancelled: "Search cancelled",
  complete: "Search complete",
};

export const STAGE_LABELS: Record<ProspectStage, string> = {
  qualified: "Qualified",
  in_conversation: "In conversation",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

/**
 * The run card's title. A search that stopped with part of the request still
 * to find is not finished, and its card says what can be done next, so the
 * title states what was found instead of "Search complete".
 */
export function runTitle(
  campaign: Pick<DiscoveryCampaign, "status" | "count" | "target">,
): string {
  if (stoppedShortOfRequest(campaign)) {
    return `Found ${campaign.count} of ${campaign.target}`;
  }
  return RUN_LABELS[campaign.status];
}

function stoppedShortOfRequest(
  campaign: Pick<DiscoveryCampaign, "status" | "count" | "target">,
): boolean {
  return campaign.status === "complete" && campaign.count < campaign.target;
}

function atPageLimit(campaign: Pick<DiscoveryCampaign, "pagesFetched">) {
  return (campaign.pagesFetched ?? 0) >= MAX_PAGES;
}

function areaRanOut(campaign: Pick<DiscoveryCampaign, "endReason">) {
  return (
    campaign.endReason === "provider_end" ||
    campaign.endReason === "provider_ceiling"
  );
}

/**
 * Whether the card offers Find more: the search stopped short and can go on,
 * either in the same area or, once the owner says so, in its nearby areas.
 */
export function canFindMore(campaign: DiscoveryCampaign): boolean {
  if (!stoppedShortOfRequest(campaign) || atPageLimit(campaign)) return false;
  if (areaRanOut(campaign)) return (campaign.nearbyAreasLeft ?? []).length > 0;
  return (
    campaign.endReason === "provider_repeat" ||
    campaign.endReason === "approved_budget"
  );
}

/** "Umhlanga and Pinetown", or "Umhlanga, Pinetown and 2 more nearby areas". */
function areaList(labels: readonly string[]): string {
  const names = labels.map(shortAreaName);
  if (names.length <= 2) return names.join(" and ");
  const more = names.length - 2;
  return `${names[0]}, ${names[1]} and ${more} more nearby ${more === 1 ? "area" : "areas"}`;
}

/** Where the campaign has searched, short enough for the card's detail row. */
export function searchedAreasLabel(campaign: DiscoveryCampaign): string {
  const searched = campaign.areasSearched ?? [];
  if (searched.length <= 1) return campaign.location;
  const nearby = searched.length - 1;
  return `${shortAreaName(searched[0] ?? campaign.location)} + ${nearby} nearby ${nearby === 1 ? "area" : "areas"}`;
}

/**
 * One short line for a search that stopped short: what ran out, and what Find
 * more would do. The full reason stays in Run details and the Sales message.
 */
function stoppedShortLine(campaign: DiscoveryCampaign): string {
  const searched = campaign.areasSearched?.length
    ? campaign.areasSearched
    : [campaign.location];
  const here = shortAreaName(searched.at(-1) ?? campaign.location);
  const remaining = campaign.target - campaign.count;
  if (atPageLimit(campaign)) {
    return `This search reached its limit of ${MAX_PAGES} pages. Try another business type or area.`;
  }
  if (areaRanOut(campaign)) {
    const left = campaign.nearbyAreasLeft ?? [];
    if (left.length) {
      return `${here} has no more. Find more in ${areaList(left)}?`;
    }
    return searched.length > 1
      ? `${shortAreaName(searched[0] ?? campaign.location)} and its nearby areas have no more. Try another business type.`
      : `${here} has no more. Try another business type or area.`;
  }
  if (campaign.endReason === "provider_repeat") {
    return "Results started repeating. Find more tries the next page.";
  }
  if (campaign.endReason === "approved_budget") {
    const owned = campaign.skippedDuplicates ?? 0;
    return owned > 0
      ? `${owned} were already in your Leads and are free. Find the other ${remaining}?`
      : `Find the other ${remaining}?`;
  }
  return (
    campaign.endNote?.trim() ||
    `${campaign.count} prospects found · ${campaign.target} requested`
  );
}

/** The run status as the resume card and campaign list word it. */
export function campaignStatusLabel(status: DiscoveryRunStatus): string {
  if (status === "complete") return "Ready to review";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

const STAGE_TONES: Record<ProspectStage, PillTone> = {
  qualified: "info",
  in_conversation: "accent",
  proposal: "need",
  won: "ok",
  lost: "bad",
};

const INTERRUPTED_FALLBACK =
  "One source stopped responding. Your existing results are safe.";

export function isAccepted(
  prospect: CampaignProspect["record"]["prospect"],
): boolean {
  return prospect.saved || prospect.qualification !== "unreviewed";
}

/** The status pill for a prospect row: its stage once accepted, "New" before. */
export function prospectStatus(
  prospect: CampaignProspect["record"]["prospect"],
): {
  label: string;
  tone: PillTone;
} {
  if (!isAccepted(prospect)) return { label: "New", tone: "idle" };
  return {
    label: STAGE_LABELS[prospect.stage] ?? prospect.stage,
    tone: STAGE_TONES[prospect.stage] ?? "idle",
  };
}

export function runDescription(campaign: DiscoveryCampaign): string {
  if (campaign.status === "running")
    return "You can keep working. Results appear as they arrive.";
  if (campaign.status === "complete") {
    if (stoppedShortOfRequest(campaign)) return stoppedShortLine(campaign);
    return `${campaign.count} prospects found · ${campaign.target} requested`;
  }
  if (campaign.status === "paused")
    return "Your results are saved. Resume when you’re ready.";
  if (campaign.status === "failed")
    return campaign.failureReason?.trim() || INTERRUPTED_FALLBACK;
  return "Results already found remain available.";
}

export function fitLabel(
  prospect: CampaignProspect["record"]["prospect"],
): string {
  const score = prospect.fitScore;
  return score === null || score === undefined ? "Not scored" : String(score);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function exportProspects(rows: CampaignProspect[]): void {
  const lines = [
    ["Business / person", "Location", "Fit", "Status"],
    ...rows.map(({ record }) => {
      const prospect = record.prospect;
      const status = isAccepted(prospect)
        ? (STAGE_LABELS[prospect.stage] ?? prospect.stage)
        : "Candidate";
      return [
        prospect.party.displayName,
        prospect.location ?? "",
        fitLabel(prospect),
        status,
      ];
    }),
  ];
  const contents = lines
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "prospects.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/** The prospect's own fields, accepted as a qualified lead. */
export function acceptChanges(row: CampaignProspect) {
  const prospect = row.record.prospect;
  return {
    prospectId: row.record.prospectId,
    displayName: prospect.party.displayName,
    partyType:
      prospect.party.partyType === "person"
        ? ("person" as const)
        : ("organization" as const),
    industry: prospect.industry,
    vertical: prospect.vertical,
    fitScore: prospect.fitScore ?? null,
    potentialMonthlyValueMinor: prospect.potentialMonthlyValueMinor ?? null,
    website: prospect.website,
    contactName: prospect.contactName,
    location: prospect.location,
    email: prospect.email,
    phone: prospect.phone,
    evidence: prospect.evidence,
    lastVerifiedAt: prospect.lastVerifiedAt,
    qualification: "qualified" as const,
    saved: true,
    stage: prospect.stage === "lost" ? ("qualified" as const) : prospect.stage,
    lostReason: null,
  };
}
