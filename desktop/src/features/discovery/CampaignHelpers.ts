import type { ProspectStage } from "./businessRecordContract";
import type { BusinessRecords } from "./businessRecordRelay";
import type {
  DiscoveryCampaign,
  DiscoveryRunStatus,
} from "./discoveryProvider";

export type CampaignProspect = BusinessRecords["prospects"][number];
export type ProspectFilter = "all" | "high-fit" | "accepted" | "candidates";
export type PillTone = "ok" | "idle" | "accent" | "need" | "info" | "bad";

export const RUN_LABELS: Record<DiscoveryRunStatus, string> = {
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

/** The run status as the resume card and campaign list word it. */
export function campaignStatusLabel(status: DiscoveryRunStatus): string {
  return status === "complete" ? "Ready to review" : status;
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

export function formatBudget(budgetUsd: number): string {
  return `$${budgetUsd.toFixed(2)}`;
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
