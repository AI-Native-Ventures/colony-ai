import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { BusinessRecords } from "./businessRecordRelay";
import { publishProspectAction } from "./businessRecordMutations";
import { errorMessage } from "./BusinessCommon";
import {
  acceptChanges,
  exportProspects,
  isAccepted,
  type CampaignProspect,
  type ProspectFilter,
} from "./CampaignHelpers";
import { CampaignDialog, type CampaignDialogMode } from "./CampaignDialogs";
import {
  CampaignSelectionBar,
  CampaignTable,
  CampaignToolbar,
  type ProspectSort,
} from "./CampaignProspectTable";
import { CampaignRunPanel, type RunAction } from "./CampaignRunPanel";
import { useDiscoveryCampaign } from "./discoveryProvider";

import "./colony3-discovery.css";

type CampaignContext = {
  channelId: string;
  communityId: TenantCommunityId;
  records: BusinessRecords;
  refresh: () => Promise<void>;
  role: BusinessRecords["role"];
};

function matchesFilter(
  prospect: CampaignProspect["record"]["prospect"],
  filter: ProspectFilter,
): boolean {
  const accepted = isAccepted(prospect);
  const score = prospect.fitScore ?? 0;
  return (
    filter === "all" ||
    (filter === "high-fit" && score >= 85) ||
    (filter === "accepted" && accepted) ||
    (filter === "candidates" && !accepted)
  );
}

export function CampaignScreen(context: CampaignContext) {
  const navigate = useNavigate();
  const { campaign, provider } = useDiscoveryCampaign();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<ProspectFilter>("all");
  const [sort, setSort] = React.useState<ProspectSort>("fit");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [dialogMode, setDialogMode] = React.useState<CampaignDialogMode>(null);
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
      return matchesQuery && matchesFilter(prospect, filter);
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
        changes: acceptChanges(row),
      });
      await context.refresh();
      setSelected(new Set());
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function changeRun(action: RunAction) {
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

  function toggleRow(prospectId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(prospectId);
    else next.delete(prospectId);
    setSelected(next);
  }

  function toggleAll(checked: boolean) {
    const next = new Set(selected);
    for (const row of visibleRows) {
      if (checked) next.add(row.record.prospectId);
      else next.delete(row.record.prospectId);
    }
    setSelected(next);
  }

  const waiting = campaign.status === "running" && campaign.count === 0;
  const footnote = campaign.simulated
    ? "Example public profiles · Review before outreach"
    : "Public business listings · Review before outreach";

  return (
    <>
      <main className="c3d-root" data-testid="w10-campaign-page">
        <div className="c3d-page is-campaign">
          <CampaignRunPanel
            campaign={campaign}
            onChangeRun={(action) => void changeRun(action)}
            onDiscuss={shareInSales}
            onNewSearch={() => void navigate({ to: "/discovery" })}
            onOpenDetails={() => setDialogMode("details")}
            onOpenSettings={() => setDialogMode("settings")}
          />
          <CampaignToolbar
            exportDisabled={!visibleRows.length}
            filter={filter}
            onExport={() => exportProspects(visibleRows)}
            onFilter={setFilter}
            onQuery={setQuery}
            onSort={setSort}
            query={query}
            sort={sort}
          />
          {selectedRows.length ? (
            <CampaignSelectionBar
              canAccept={canWrite && selectedRows.length === 1 && !saving}
              count={selectedRows.length}
              onAccept={() => void acceptSelected()}
              onClear={() => setSelected(new Set())}
              onDiscuss={shareInSales}
              runner={campaign.runBy ?? null}
            />
          ) : null}
          {error ? (
            <p className="c3d-error" role="alert">
              {error}
            </p>
          ) : null}
          {visibleRows.length ? (
            <>
              <CampaignTable
                onToggle={toggleRow}
                onToggleAll={toggleAll}
                rows={visibleRows}
                selected={selected}
              />
              <p className="c3d-footnote">
                {visibleRows.length}{" "}
                {visibleRows.length === 1 ? "prospect" : "prospects"} shown ·{" "}
                {footnote}
              </p>
            </>
          ) : (
            <div className="c3d-campaign-empty">
              <h2>
                {waiting
                  ? "Looking for your first prospects…"
                  : "No prospects match these filters."}
              </h2>
              <p>
                {waiting
                  ? "The search is running. You can leave this view and return at any time."
                  : "Try a different name, location or filter."}
              </p>
              <button
                className="c3d-btn c3d-btn--outline c3d-btn--sm"
                onClick={clearFilters}
                type="button"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </main>
      <CampaignDialog
        campaign={campaign}
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onCreateSearch={() => {
          setDialogMode(null);
          void navigate({ to: "/discovery" });
        }}
        onPreviewFailure={
          campaign.simulated
            ? () => {
                window.__BUZZ_E2E_W10_FAIL_NEXT_RUN__ = true;
                setDialogMode(null);
              }
            : null
        }
      />
    </>
  );
}
