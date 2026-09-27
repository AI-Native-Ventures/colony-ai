import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  MapPin,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { BusinessRecords } from "./businessRecordRelay";
import type { ProspectStage } from "./businessRecordContract";
import { publishProspectAction } from "./businessRecordMutations";
import {
  errorMessage,
  W10Button,
  W10Heading,
  W10Page,
  W10Pill,
} from "./BusinessCommon";
import {
  useDiscoveryCampaign,
  type DiscoveryCampaign,
  type DiscoveryRunStatus,
} from "./discoveryProvider";

type CampaignContext = {
  channelId: string;
  communityId: string;
  records: BusinessRecords;
  refresh: () => Promise<void>;
  role: BusinessRecords["role"];
};

type CampaignProspect = BusinessRecords["prospects"][number];
type ProspectFilter = "all" | "high-fit" | "accepted" | "candidates";
type DialogMode = "details" | "settings" | null;

const RUN_LABELS: Record<DiscoveryRunStatus, string> = {
  running: "Finding prospects",
  paused: "Search paused",
  failed: "Search interrupted",
  cancelled: "Search cancelled",
  complete: "Search complete",
};

const STAGE_LABELS: Record<ProspectStage, string> = {
  qualified: "Qualified",
  in_conversation: "In conversation",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

function isAccepted(prospect: CampaignProspect["record"]["prospect"]): boolean {
  return prospect.saved || prospect.qualification !== "unreviewed";
}

function runDescription(campaign: DiscoveryCampaign): string {
  if (campaign.status === "running")
    return "You can keep working. Results appear as they arrive.";
  if (campaign.status === "complete") {
    return `${campaign.count} prospects found · ${campaign.target} requested`;
  }
  if (campaign.status === "paused")
    return "Your results are saved. Resume when you’re ready.";
  if (campaign.status === "failed")
    return "One source stopped responding. Your existing results are safe.";
  return "Results already found remain available.";
}

function fitLabel(prospect: CampaignProspect["record"]["prospect"]): string {
  const score = prospect.fitScore;
  return score === null || score === undefined ? "Not scored" : String(score);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function exportProspects(rows: CampaignProspect[]): void {
  const lines = [
    ["Business / person", "Location", "Fit", "Status"],
    ...rows.map(({ record }) => {
      const prospect = record.prospect;
      const status = isAccepted(record.prospect)
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

function detailChanges(row: CampaignProspect) {
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

export function CampaignScreen(context: CampaignContext) {
  const navigate = useNavigate();
  const { campaign, provider } = useDiscoveryCampaign();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<ProspectFilter>("all");
  const [sort, setSort] = React.useState<"fit" | "name">("fit");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [dialogMode, setDialogMode] = React.useState<DialogMode>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!provider || !campaign) void navigate({ to: "/discovery" });
  }, [campaign, navigate, provider]);

  if (!provider || !campaign) {
    return null;
  }

  const campaignRows = campaign.prospectIds
    .slice(0, Math.min(campaign.count, campaign.prospectIds.length))
    .map((prospectId) =>
      context.records.prospects.find(
        (candidate) => candidate.record.prospectId === prospectId,
      ),
    )
    .filter((row): row is CampaignProspect =>
      Boolean(row && row.record.status === "active"),
    );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = campaignRows
    .filter((row) => {
      const prospect = row.record.prospect;
      const accepted = isAccepted(prospect);
      const matchesQuery =
        !normalizedQuery ||
        [
          prospect.party.displayName,
          prospect.location ?? "",
          prospect.vertical,
          prospect.contactName ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      const score = prospect.fitScore ?? 0;
      const matchesFilter =
        filter === "all" ||
        (filter === "high-fit" && score >= 85) ||
        (filter === "accepted" && accepted) ||
        (filter === "candidates" && !accepted);
      return matchesQuery && matchesFilter;
    })
    .sort((left, right) =>
      sort === "name"
        ? left.record.prospect.party.displayName.localeCompare(
            right.record.prospect.party.displayName,
          )
        : (right.record.prospect.fitScore ?? -1) -
          (left.record.prospect.fitScore ?? -1),
    );
  const selectedRows = visibleRows.filter(({ record }) =>
    selected.has(record.prospectId),
  );
  const canWrite =
    context.role === "owner" ||
    context.role === "admin" ||
    context.role === "member";
  const allVisibleSelected =
    visibleRows.length > 0 &&
    visibleRows.every(({ record }) => selected.has(record.prospectId));

  async function acceptSelected() {
    if (selectedRows.length !== 1 || !canWrite) return;
    const row = selectedRows[0];
    if (!row) return;
    setSaving(true);
    setError("");
    try {
      await publishProspectAction({
        channelId: context.channelId,
        communityId: context.communityId,
        current: { eventId: row.eventId, record: row.record },
        changes: detailChanges(row),
      });
      await context.refresh();
      setSelected(new Set());
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function changeRun(action: "pause" | "resume" | "cancel" | "retry") {
    if (!provider) return;
    try {
      await provider[action]();
    } catch (runError) {
      setError(errorMessage(runError));
    }
  }

  function clearFilters() {
    setQuery("");
    setFilter("all");
    setSort("fit");
  }

  function shareInSales() {
    void navigate({
      to: "/channels/$channelId",
      params: { channelId: context.channelId },
    });
  }

  return (
    <>
      <W10Page wide testId="w10-campaign-page">
        <W10Heading
          actions={
            <W10Button onClick={shareInSales}>
              <MessageCircle aria-hidden="true" />
              Discuss in Sales
            </W10Button>
          }
          description={`${campaign.verticalName} · ${campaign.location}`}
          title={campaign.name}
        />
        <nav aria-label="Campaign" className="w10-filter-tabs">
          <a aria-current="page" className="is-active" href="#/campaign">
            Prospects <span>{campaign.count}</span>
          </a>
          <button onClick={() => setDialogMode("settings")} type="button">
            Search &amp; budget
          </button>
          <button onClick={shareInSales} type="button">
            Conversation <ArrowRight aria-hidden="true" />
          </button>
        </nav>
        <section
          aria-label="Search progress"
          className={`w10-run-panel${campaign.status === "failed" ? " is-failed" : ""}`}
        >
          <div className="w10-run-header">
            <span
              aria-hidden="true"
              className={`w10-run-icon is-${campaign.status}`}
            >
              {campaign.status === "running" ? (
                <Search />
              ) : campaign.status === "complete" ? (
                <CircleCheck />
              ) : campaign.status === "failed" ? (
                <CircleAlert />
              ) : (
                <Pause />
              )}
            </span>
            <div className="w10-run-copy">
              <strong>{RUN_LABELS[campaign.status]}</strong>
              <small>{runDescription(campaign)}</small>
            </div>
            <div className="w10-run-actions">
              {campaign.status === "running" ? (
                <>
                  <W10Button onClick={() => void changeRun("pause")}>
                    <Pause aria-hidden="true" /> Pause
                  </W10Button>
                  <W10Button
                    aria-label="Cancel search"
                    onClick={() => void changeRun("cancel")}
                    variant="quiet"
                  >
                    <X aria-hidden="true" />
                  </W10Button>
                </>
              ) : campaign.status === "paused" ? (
                <W10Button
                  onClick={() => void changeRun("resume")}
                  variant="primary"
                >
                  <Play aria-hidden="true" /> Resume
                </W10Button>
              ) : campaign.status === "failed" ? (
                <W10Button
                  onClick={() => void changeRun("retry")}
                  variant="primary"
                >
                  <RotateCcw aria-hidden="true" /> Retry search
                </W10Button>
              ) : (
                <W10Button onClick={() => void navigate({ to: "/discovery" })}>
                  <Plus aria-hidden="true" /> New search
                </W10Button>
              )}
            </div>
          </div>
          <div
            aria-label="Prospect target"
            aria-valuemax={campaign.target}
            aria-valuemin={0}
            aria-valuenow={Math.min(campaign.count, campaign.target)}
            className="w10-run-progress"
            role="progressbar"
          >
            <span
              style={{
                width: `${Math.min(100, (campaign.count / campaign.target) * 100)}%`,
              }}
            />
          </div>
          <div className="w10-run-meta">
            <span>
              <MapPin aria-hidden="true" /> {campaign.location}
            </span>
            <span>
              <Users aria-hidden="true" /> {campaign.count} prospects
            </span>
            <span>Budget approved · ${campaign.budgetUsd.toFixed(2)}</span>
            <button
              className="w10-text-button"
              onClick={() => setDialogMode("details")}
              type="button"
            >
              Run details
            </button>
          </div>
        </section>
        <div className="w10-campaign-toolbar">
          <label className="w10-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Search prospects</span>
            <input
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search prospects…"
              value={query}
            />
          </label>
          <label className="sr-only" htmlFor="w10-campaign-filter">
            Filter prospects
          </label>
          <select
            id="w10-campaign-filter"
            onChange={(event) =>
              setFilter(event.currentTarget.value as ProspectFilter)
            }
            value={filter}
          >
            <option value="all">All prospects</option>
            <option value="high-fit">Strong fit · 85+</option>
            <option value="accepted">Accepted leads</option>
            <option value="candidates">Not yet accepted</option>
          </select>
          <label className="sr-only" htmlFor="w10-campaign-sort">
            Sort prospects
          </label>
          <select
            id="w10-campaign-sort"
            onChange={(event) =>
              setSort(event.currentTarget.value as "fit" | "name")
            }
            value={sort}
          >
            <option value="fit">Best fit first</option>
            <option value="name">Name A–Z</option>
          </select>
          <button
            aria-label="Export visible prospects"
            className="w10-icon-button"
            disabled={!visibleRows.length}
            onClick={() => exportProspects(visibleRows)}
            type="button"
          >
            <Download aria-hidden="true" />
          </button>
        </div>
        {selectedRows.length ? (
          <section
            aria-label="Selected prospects"
            className="w10-selection-bar"
          >
            <strong>{selectedRows.length} selected</strong>
            <button
              disabled={!canWrite || selectedRows.length !== 1 || saving}
              onClick={() => void acceptSelected()}
              type="button"
            >
              <Check aria-hidden="true" /> Accept as leads
            </button>
            <button onClick={shareInSales} type="button">
              <MessageCircle aria-hidden="true" /> Discuss with Aya
            </button>
            <button
              aria-label="Clear selection"
              className="w10-icon-button"
              onClick={() => setSelected(new Set())}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </section>
        ) : null}
        {error ? (
          <p className="w10-form-error" role="alert">
            {error}
          </p>
        ) : null}
        {visibleRows.length ? (
          <div className="w10-campaign-table-wrap">
            <table className="w10-campaign-table">
              <thead>
                <tr>
                  <th className="w10-check-cell">
                    <input
                      aria-label="Select all visible prospects"
                      checked={allVisibleSelected}
                      onChange={(event) => {
                        const next = new Set(selected);
                        for (const row of visibleRows) {
                          if (event.currentTarget.checked)
                            next.add(row.record.prospectId);
                          else next.delete(row.record.prospectId);
                        }
                        setSelected(next);
                      }}
                      type="checkbox"
                    />
                  </th>
                  <th>Business / person</th>
                  <th>Location</th>
                  <th>Fit</th>
                  <th>Status</th>
                  <th aria-label="Open profile" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const prospect = row.record.prospect;
                  const accepted = isAccepted(prospect);
                  const stageLabel = accepted
                    ? STAGE_LABELS[prospect.stage]
                    : "Candidate";
                  return (
                    <tr
                      className={
                        selected.has(row.record.prospectId) ? "is-selected" : ""
                      }
                      key={row.eventId}
                    >
                      <td className="w10-check-cell">
                        <input
                          aria-label={`Select ${prospect.party.displayName}`}
                          checked={selected.has(row.record.prospectId)}
                          onChange={(event) => {
                            const next = new Set(selected);
                            if (event.currentTarget.checked)
                              next.add(row.record.prospectId);
                            else next.delete(row.record.prospectId);
                            setSelected(next);
                          }}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <a
                          className="w10-campaign-prospect"
                          href={`#/sales/lead/${row.record.prospectId}`}
                        >
                          <span className="w10-prospect-mark">
                            {prospect.party.displayName.slice(0, 1)}
                          </span>
                          <span>
                            <strong>{prospect.party.displayName}</strong>
                            <small>{prospect.vertical}</small>
                          </span>
                        </a>
                      </td>
                      <td>{prospect.location ?? "Not set"}</td>
                      <td>
                        <span className="w10-fit-score">
                          {fitLabel(prospect)}
                          <i aria-hidden="true" />
                        </span>
                      </td>
                      <td>
                        <W10Pill tone={accepted ? "green" : "neutral"}>
                          {stageLabel}
                        </W10Pill>
                      </td>
                      <td>
                        <a
                          aria-label={`Open ${prospect.party.displayName}`}
                          className="w10-icon-button"
                          href={`#/sales/lead/${row.record.prospectId}`}
                        >
                          <ChevronRight aria-hidden="true" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <footer className="w10-campaign-table-footer">
              <span>
                {visibleRows.length}{" "}
                {visibleRows.length === 1 ? "prospect" : "prospects"} shown
              </span>
              <span>Example public profiles · Review before outreach</span>
            </footer>
          </div>
        ) : (
          <div className="w10-campaign-empty">
            <h2>
              {campaign.status === "running" && campaign.count === 0
                ? "Looking for your first prospects…"
                : "No prospects match these filters."}
            </h2>
            <p>
              {campaign.status === "running" && campaign.count === 0
                ? "The search is running. You can leave this view and return at any time."
                : "Try a different name, location or filter."}
            </p>
            <W10Button onClick={clearFilters}>Clear filters</W10Button>
          </div>
        )}
      </W10Page>
      <CampaignDialog
        campaign={campaign}
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onCreateSearch={() => {
          setDialogMode(null);
          void navigate({ to: "/discovery" });
        }}
      />
    </>
  );
}

function CampaignDialog({
  campaign,
  mode,
  onClose,
  onCreateSearch,
}: {
  campaign: DiscoveryCampaign;
  mode: DialogMode;
  onClose: () => void;
  onCreateSearch: () => void;
}) {
  const { provider } = useDiscoveryCampaign();
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={mode !== null}
    >
      <DialogContent className="w10-dialog" showCloseButton={false}>
        {mode === "details" ? (
          <>
            <DialogHeader>
              <DialogTitle>Search activity.</DialogTitle>
              <DialogDescription>
                {campaign.name} · Example run
              </DialogDescription>
            </DialogHeader>
            <div className="w10-step-trace">
              <span>
                <Check aria-hidden="true" /> Search criteria prepared
              </span>
              <span>
                <Check aria-hidden="true" /> {campaign.count} public profiles
                found
              </span>
              <span>
                {campaign.status === "failed" ? (
                  <CircleAlert aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}{" "}
                {campaign.status === "failed"
                  ? "A search source stopped responding"
                  : "Duplicate check and source references retained"}
              </span>
              <span>
                {campaign.status === "complete" ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Clock3 aria-hidden="true" />
                )}{" "}
                {RUN_LABELS[campaign.status]}
              </span>
            </div>
            <p className="w10-notice">
              This prototype simulates progress and results. It does not contact
              a provider or spend credits.
            </p>
            <div className="w10-dialog-actions">
              {campaign.status === "running" && provider ? (
                <W10Button
                  onClick={() => {
                    window.__BUZZ_E2E_W10_FAIL_NEXT_RUN__ = true;
                    onClose();
                  }}
                >
                  Preview a source failure
                </W10Button>
              ) : null}
              <W10Button onClick={onClose} variant="primary">
                Done
              </W10Button>
            </div>
          </>
        ) : mode === "settings" ? (
          <>
            <DialogHeader>
              <DialogTitle>Search &amp; budget.</DialogTitle>
              <DialogDescription>{campaign.name}</DialogDescription>
            </DialogHeader>
            <dl className="w10-campaign-facts">
              <dt>Audience</dt>
              <dd>{campaign.verticalName}</dd>
              <dt>Location</dt>
              <dd>{campaign.location}</dd>
              <dt>Target</dt>
              <dd>{campaign.target} prospects</dd>
              <dt>Criteria</dt>
              <dd>
                {campaign.criteria ||
                  "Independent stores with a local-maker focus."}
              </dd>
              <dt>Budget</dt>
              <dd>Up to ${campaign.budgetUsd.toFixed(2)} · Example</dd>
            </dl>
            <p className="w10-notice">
              A different audience, location or spending limit needs a new
              review before the search starts.
            </p>
            <div className="w10-dialog-actions">
              <W10Button onClick={onCreateSearch}>
                Create another search
              </W10Button>
              <W10Button onClick={onClose} variant="primary">
                Done
              </W10Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
