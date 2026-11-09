import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useRouteOrigin } from "@/app/navigation/RouteOriginContext";

import { publishProspectAction } from "./businessRecordMutations";
import { errorMessage } from "./BusinessCommon";
import { PendingBulkProspectUpdateNotice } from "./PendingBulkProspectUpdateNotice";
import {
  getPendingBulkProspectUpdate,
  markProspectsLost,
  resumePendingProspectUpdate,
  updateProspectsStage,
} from "./bulkProspectUpdateRuntime";
import type { PendingBulkProspectUpdate } from "./bulkProspectUpdate";
import {
  acceptButtonState,
  acceptProspects,
  acceptSummary,
  reconcileAccepted,
  type BulkAcceptProgress,
} from "./bulkAccept";
import {
  acceptChanges,
  exportProspects,
  isAccepted,
  type CampaignProspect,
  type ProspectFilter,
} from "./CampaignHelpers";
import { CampaignDialog, type CampaignDialogMode } from "./CampaignDialogs";
import {
  DiscoveryCampaignDialog,
  DiscoveryContinuationDialog,
  type CampaignFormInput,
  type PendingCampaign,
} from "./DiscoveryCampaignDialogs";
import {
  CampaignSelectionBar,
  CampaignTable,
  CampaignToolbar,
  type ProspectSort,
} from "./CampaignProspectTable";
import { CampaignRunPanel, type RunAction } from "./CampaignRunPanel";
import { CampaignQualificationPanel } from "./CampaignQualificationPanel";
import type { DiscoveryLocation } from "./discoveryLocation";
import {
  type DiscoveryContinuation,
  useDiscoveryCampaign,
} from "./discoveryProvider";
import {
  DiscoveryTypeDetailsDialog,
  RelatedVerticalOptions,
} from "./DiscoveryTypeDetailsDialog";
import {
  loadVerticalTags,
  relatedVerticalsFor,
  type CatalogueRow,
} from "./taxonomy";
import { compareDiscoveryTagFit } from "./discoveryTags";
import { AddToOutreachListDialog } from "./AddToOutreachListDialog";
import { OutreachBatchDialog } from "./OutreachBatchDialog";
import { OutreachFilterControls } from "./OutreachFilterControls";
import {
  EMPTY_OUTREACH_FILTERS,
  filterOutreachRows,
  type OutreachFilters,
  type OutreachWhatsAppStatus,
} from "./outreachSelection";
import { buildLeadLink } from "@/shared/lib/entityLink";
import {
  findWhatsAppContactForLead,
  getWhatsAppLeadStatus,
  useWhatsAppLeadData,
} from "@/features/whatsapp-outreach/whatsappLeadStatus";
import { whatsappLeadStatusLabel } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import type { OutreachBatchLead } from "./outreachBatch";
import { calculateOutreachFitScore } from "./outreachFitScore";
import { findScoutDirectMessage } from "./leadShared";
import type { LeadContext } from "./leadShared";
import type { ProspectStage } from "./businessRecordContract";

import "./colony3-discovery.css";

type CampaignContext = LeadContext;

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
  const routeOrigin = useRouteOrigin();
  const restored = routeOrigin.pageSnapshot?.viewState as
    | {
        campaignId?: string;
        query?: string;
        filter?: ProspectFilter;
        sort?: ProspectSort;
        selected?: string[];
        page?: number;
        outreachFilters?: OutreachFilters;
      }
    | undefined;
  const channelsQuery = useChannelsQuery();
  const { campaign, provider } = useDiscoveryCampaign();
  const [query, setQuery] = React.useState(restored?.query ?? "");
  const [filter, setFilter] = React.useState<ProspectFilter>(
    restored?.filter ?? "all",
  );
  const [sort, setSort] = React.useState<ProspectSort>(restored?.sort ?? "fit");
  const [page, setPage] = React.useState(restored?.page ?? 0);
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(restored?.selected ?? []),
  );
  const [outreachFilters, setOutreachFilters] = React.useState<OutreachFilters>(
    () => restored?.outreachFilters ?? EMPTY_OUTREACH_FILTERS,
  );
  const [listDialogOpen, setListDialogOpen] = React.useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = React.useState(false);
  const [minimumFit, setMinimumFit] = React.useState<number | null>(null);
  const [dialogMode, setDialogMode] = React.useState<CampaignDialogMode>(null);
  const [relatedTypeId, setRelatedTypeId] = React.useState<string | null>(null);
  const [widenPending, setWidenPending] =
    React.useState<PendingCampaign | null>(null);
  const [widenOpen, setWidenOpen] = React.useState(false);
  const [widenLocation, setWidenLocation] =
    React.useState<DiscoveryLocation | null>(null);
  const [widenSourceCampaign, setWidenSourceCampaign] = React.useState<
    string | null
  >(null);
  const [continuation, setContinuation] =
    React.useState<DiscoveryContinuation | null>(null);
  const [continuationOpen, setContinuationOpen] = React.useState(false);
  const [, setTagsReady] = React.useState(false);
  const [progress, setProgress] = React.useState<BulkAcceptProgress | null>(
    null,
  );
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [pendingBulkUpdate, setPendingBulkUpdate] =
    React.useState<PendingBulkProspectUpdate | null>(null);
  const whatsapp = useWhatsAppLeadData();
  const recordsRef = React.useRef(context.records);
  recordsRef.current = context.records;

  const campaignId = campaign?.id;
  const lastCampaignId = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (campaignId === undefined) return;
    if (lastCampaignId.current === undefined) {
      lastCampaignId.current = campaignId;
      if (restored?.campaignId !== campaignId) {
        setPage(0);
        setSelected(new Set());
      }
      return;
    }
    if (lastCampaignId.current !== campaignId) {
      lastCampaignId.current = campaignId;
      setPage(0);
      setSelected(new Set());
    }
  }, [campaignId, restored?.campaignId]);

  React.useEffect(() => {
    if (!campaign) return;
    const scrollTarget = document.querySelector<HTMLElement>(".c3d-root");
    const save = () =>
      routeOrigin.savePageSnapshot({
        backLabel: campaign.name,
        breadcrumbs: ["Business", "Discovery", campaign.name],
        viewState: {
          campaignId: campaign.id,
          query,
          filter,
          sort,
          selected: [...selected],
          page,
          outreachFilters,
        },
        scrollY: scrollTarget?.scrollTop ?? window.scrollY,
        scrollTarget: scrollTarget ? ".c3d-root" : undefined,
      });
    save();
    const scrollHost: Window | HTMLElement = scrollTarget ?? window;
    scrollHost.addEventListener("scroll", save, { passive: true });
    return () => scrollHost.removeEventListener("scroll", save);
  }, [
    campaign,
    filter,
    outreachFilters,
    page,
    query,
    routeOrigin.savePageSnapshot,
    selected,
    sort,
  ]);

  React.useEffect(() => {
    const scrollY = routeOrigin.pageSnapshot?.scrollY;
    if (typeof scrollY !== "number" || scrollY <= 0) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = routeOrigin.pageSnapshot?.scrollTarget
          ? document.querySelector<HTMLElement>(
              routeOrigin.pageSnapshot.scrollTarget,
            )
          : null;
        if (target) target.scrollTo({ top: scrollY });
        else window.scrollTo({ top: scrollY });
      }),
    );
  }, [
    routeOrigin.pageSnapshot?.scrollTarget,
    routeOrigin.pageSnapshot?.scrollY,
  ]);

  React.useEffect(() => {
    if (!provider || !campaign) void navigate({ to: "/discovery" });
  }, [campaign, navigate, provider]);

  React.useEffect(() => {
    try {
      setPendingBulkUpdate(
        getPendingBulkProspectUpdate({
          channelId: context.channelId,
          communityId: context.communityId,
        }),
      );
    } catch (pendingError) {
      setError(errorMessage(pendingError));
    }
  }, [context.channelId, context.communityId]);

  React.useEffect(() => {
    let live = true;
    void loadVerticalTags().then((loaded) => {
      if (live && loaded) setTagsReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!provider || !campaign) {
    return null;
  }
  const currentCampaign = campaign;
  const campaignRunner = campaign.runBy;

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
  const qualificationHeadsByLeadId = new Map(
    context.records.qualificationObservations.map((head) => [
      head.record.leadId,
      head.record,
    ]),
  );
  const campaignFilterRows = campaignRows.map((row) => {
    const prospect = row.record.prospect;
    const contact = findWhatsAppContactForLead(
      row.record.prospectId,
      whatsapp.contactsQuery.data ?? [],
    );
    const whatsappStatus: OutreachWhatsAppStatus =
      contact?.stage === "not_on_whatsapp"
        ? "no-number"
        : getWhatsAppLeadStatus(
            contact,
            whatsapp.inBatchLeadIds.has(row.record.prospectId),
          );
    const stage =
      prospect.qualification === "unreviewed" ? "new" : prospect.stage;
    return {
      campaign: row,
      id: row.record.prospectId,
      searchableText: [
        prospect.party.displayName,
        prospect.location ?? "",
        prospect.vertical,
        prospect.contactName ?? "",
        prospect.phone ?? "",
      ].join(" "),
      hasPhone: Boolean(
        prospect.whatsappPhone?.trim() ||
          prospect.phone?.trim() ||
          contact?.e164,
      ),
      whatsappStatus,
      stage,
      prospect,
      contact,
    };
  });
  const visibleRows = filterOutreachRows(
    campaignFilterRows,
    outreachFilters,
    query,
  )
    .filter(({ prospect }) => matchesFilter(prospect, filter))
    .sort((left, right) => {
      if (sort === "name") {
        return left.prospect.party.displayName.localeCompare(
          right.prospect.party.displayName,
        );
      }
      return compareDiscoveryTagFit(
        left.prospect.discoveryTags ?? [],
        left.prospect.fitScore,
        right.prospect.discoveryTags ?? [],
        right.prospect.fitScore,
      );
    });
  const pageSize = 7;
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const pageRows = visibleRows.slice(page * pageSize, (page + 1) * pageSize);
  const visibleProspectRows = pageRows.map(({ campaign: row }) => row);
  const outreachByLead = new Map(
    campaignFilterRows.map(({ id, prospect, contact, whatsappStatus }) => [
      id,
      {
        phone:
          prospect.whatsappPhone?.trim() ||
          prospect.phone?.trim() ||
          contact?.e164 ||
          "",
        whatsapp:
          whatsappStatus === "no-number"
            ? "No WhatsApp number"
            : whatsappLeadStatusLabel(whatsappStatus),
      },
    ]),
  );
  const selectedRows = visibleRows
    .map(({ campaign: row }) => row)
    .filter(({ record }) => selected.has(record.prospectId));
  const selectedPageCount = pageRows.filter(({ id }) =>
    selected.has(id),
  ).length;
  const allMatchingSelected =
    visibleRows.length > 0 && visibleRows.every(({ id }) => selected.has(id));
  const selectedLeadIds = campaign.prospectIds.filter(
    (prospectId) =>
      selected.has(prospectId) &&
      visibleRows.some(({ id }) => id === prospectId),
  );
  const selectedBatchLeads: OutreachBatchLead[] = selectedRows.map(
    ({ record }) => ({
      leadId: record.prospectId,
      name: record.prospect.party.displayName,
      contactName: record.prospect.contactName,
      phone: record.prospect.phone,
      whatsappPhone: record.prospect.whatsappPhone,
      fit: calculateOutreachFitScore(
        record.prospect.maps,
        qualificationHeadsByLeadId.get(record.prospectId),
      ),
    }),
  );
  const canWrite =
    context.role === "owner" ||
    context.role === "admin" ||
    context.role === "member";

  async function acceptSelected() {
    if (!canWrite || progress || selectedRows.length === 0) return;
    const rows = selectedRows;
    setError("");
    setNotice("");
    setProgress({ done: 0, total: rows.length });
    try {
      const first = await acceptProspects({
        rows,
        publish: (row) =>
          publishProspectAction({
            channelId: context.channelId,
            communityId: context.communityId,
            current: { eventId: row.eventId, record: row.record },
            changes: acceptChanges(row),
          }),
        onProgress: setProgress,
      });
      // One refresh for the whole action: statuses update in place.
      try {
        await context.refresh();
      } catch {
        // The saves are done; the list refreshes on its own later.
      }
      if (first.failed.length > 0) {
        // Let the refreshed list render before checking which failed rows
        // were in fact saved (a write can land and only its answer be lost).
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const result = reconcileAccepted(first, recordsRef.current.prospects);
      const summary = acceptSummary(result);
      if (result.failed.length === 0) {
        setSelected(new Set());
        setNotice(summary);
      } else {
        // Only the rows that failed stay selected, ready for another try.
        setSelected(
          new Set(result.failed.map((failure) => failure.prospectId)),
        );
        setError(summary);
      }
    } finally {
      setProgress(null);
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
    setOutreachFilters(EMPTY_OUTREACH_FILTERS);
    setSelected(new Set());
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

  async function changeSelectedStage(stage: ProspectStage) {
    if (!canWrite || selectedRows.length === 0 || progress) return;
    setError("");
    setProgress({ done: 0, total: selectedRows.length });
    try {
      await updateProspectsStage({
        channelId: context.channelId,
        communityId: context.communityId,
        prospectIds: selectedRows.map(({ record }) => record.prospectId),
        stage,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      await context.refresh();
      setPendingBulkUpdate(null);
      setSelected(new Set());
    } catch (stageError) {
      setError(errorMessage(stageError));
      refreshPendingBulkUpdate();
    } finally {
      setProgress(null);
    }
  }

  async function markSelectedLost() {
    if (!canWrite || selectedRows.length === 0 || progress) return;
    setError("");
    setProgress({ done: 0, total: selectedRows.length });
    try {
      await markProspectsLost({
        channelId: context.channelId,
        communityId: context.communityId,
        prospectIds: selectedRows.map(({ record }) => record.prospectId),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      await context.refresh();
      setPendingBulkUpdate(null);
      setSelected(new Set());
    } catch (stageError) {
      setError(errorMessage(stageError));
      refreshPendingBulkUpdate();
    } finally {
      setProgress(null);
    }
  }

  function refreshPendingBulkUpdate() {
    try {
      setPendingBulkUpdate(getPendingBulkProspectUpdate(context));
    } catch (pendingError) {
      setError(errorMessage(pendingError));
    }
  }

  async function retryPendingBulkUpdate() {
    if (progress) return;
    setError("");
    setProgress({ done: 0, total: pendingBulkUpdate?.prospectIds.length ?? 0 });
    try {
      await resumePendingProspectUpdate({
        channelId: context.channelId,
        communityId: context.communityId,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      await context.refresh();
      setPendingBulkUpdate(null);
      setSelected(new Set());
    } catch (retryError) {
      setError(errorMessage(retryError));
      refreshPendingBulkUpdate();
    } finally {
      setProgress(null);
    }
  }

  async function askScout() {
    const prompt = [
      "Please research these leads and update their records:",
      ...selectedLeadIds.map(buildLeadLink),
    ].join("\n");
    let copied = false;
    try {
      await navigator.clipboard.writeText(prompt);
      copied = true;
    } catch {
      copied = false;
    }
    try {
      const channels =
        channelsQuery.data ?? (await channelsQuery.refetch()).data ?? [];
      const scoutDm = findScoutDirectMessage(channels);
      if (!scoutDm) {
        setNotice(
          copied
            ? "Lead references copied. Scout's chat is unavailable."
            : "Scout's chat is unavailable and the lead references could not be copied.",
        );
        return;
      }
      setNotice(
        copied
          ? "Lead references copied."
          : "Could not copy the lead references.",
      );
      void navigate({
        to: "/channels/$channelId",
        params: { channelId: scoutDm.id },
      });
    } catch {
      setNotice(
        copied
          ? "Lead references copied. Scout's chat could not be opened."
          : "Could not copy the lead references or open Scout's chat.",
      );
    }
  }

  function toggleAll(checked: boolean) {
    const next = new Set(selected);
    for (const row of visibleProspectRows) {
      if (checked) next.add(row.record.prospectId);
      else next.delete(row.record.prospectId);
    }
    setSelected(next);
  }

  function selectAllMatching() {
    setSelected(
      (current) => new Set([...current, ...visibleRows.map(({ id }) => id)]),
    );
  }

  function openWidenSearch(row: CatalogueRow, pickedTags: string[]) {
    setRelatedTypeId(null);
    setWidenLocation(currentCampaign.locationSelection ?? null);
    setWidenSourceCampaign(null);
    setWidenPending({
      audience: "businesses",
      industryId: row.parentId,
      industryName: row.parentName,
      verticalId: row.id,
      verticalName: row.name,
      pickedTags,
    });
    setWidenOpen(true);
  }

  async function startWidenSearch(input: CampaignFormInput) {
    if (!provider || !widenPending) return;
    await provider.start({
      ...widenPending,
      ...input,
      runBy: campaignRunner ?? undefined,
    });
    setWidenOpen(false);
    await navigate({ to: "/campaign" });
  }

  async function continueCampaign(additionalBudgetUsd?: number) {
    if (!provider) return;
    try {
      setError("");
      setNotice("");
      await provider.continueCampaign(additionalBudgetUsd);
    } catch (continueError) {
      setError(errorMessage(continueError));
    }
  }

  async function openFindMore() {
    if (!provider) return;
    const next = provider.getContinuation();
    if (!next) {
      setError(
        "This campaign cannot continue from its current state. Retry an interrupted search or start a nearby campaign.",
      );
      return;
    }
    if (next.state === "unavailable") {
      setError(next.message ?? "This provider query has no next page.");
      return;
    }
    if (next.state === "approval_required") {
      setContinuation(next);
      setContinuationOpen(true);
      return;
    }
    await continueCampaign();
  }

  function openNearbySearch(location: DiscoveryLocation) {
    setRelatedTypeId(null);
    setWidenLocation(location);
    setWidenSourceCampaign(currentCampaign.name);
    setWidenPending({
      audience: currentCampaign.audience,
      industryId: currentCampaign.industryId,
      industryName: currentCampaign.industryName,
      verticalId: currentCampaign.verticalId,
      verticalName: currentCampaign.verticalName,
      pickedTags: currentCampaign.pickedTags ?? [],
    });
    setWidenOpen(true);
  }

  const waiting = campaign.status === "running" && campaign.count === 0;
  const footnote = campaign.simulated
    ? "Example public profiles · Review before outreach"
    : "Public business listings · Review before outreach";
  const relatedTypes = relatedVerticalsFor(campaign.verticalId);

  return (
    <>
      <main className="c3d-root" data-testid="w10-campaign-page">
        <div className="c3d-page is-campaign">
          <CampaignRunPanel
            campaign={campaign}
            onChangeRun={(action) => void changeRun(action)}
            onDiscuss={shareInSales}
            onFindMore={() => void openFindMore()}
            onNewSearch={() => void navigate({ to: "/discovery" })}
            onOpenDetails={() => setDialogMode("details")}
            onOpenSettings={() => setDialogMode("settings")}
            onSearchNearby={openNearbySearch}
          />
          <CampaignQualificationPanel
            campaign={campaign}
            context={context}
            provider={provider}
            rows={campaignRows}
          />
          {relatedTypes.length ? (
            <section
              aria-labelledby="c3d-widen-title"
              className="c3d-related-search"
            >
              <div>
                <h2 id="c3d-widen-title">Widen this search</h2>
                <p>
                  Choose a related business type to start a separate campaign.
                </p>
              </div>
              <RelatedVerticalOptions
                onSelect={setRelatedTypeId}
                types={relatedTypes}
              />
            </section>
          ) : null}
          <CampaignToolbar
            exportDisabled={!visibleRows.length}
            filter={filter}
            onExport={() =>
              exportProspects(visibleRows.map(({ campaign: row }) => row))
            }
            onFilter={(value) => {
              setFilter(value);
              setSelected(new Set());
              setPage(0);
            }}
            onQuery={(value) => {
              setQuery(value);
              setSelected(new Set());
              setPage(0);
            }}
            onSort={(value) => {
              setSort(value);
              setPage(0);
            }}
            query={query}
            sort={sort}
          />
          <OutreachFilterControls
            allMatchingSelected={allMatchingSelected}
            filters={outreachFilters}
            matching={visibleRows.length}
            onSelectAllMatching={selectAllMatching}
            onChange={(next) => {
              setOutreachFilters(next);
              setSelected(new Set());
              setPage(0);
            }}
            pageSelectedCount={0}
            query={query}
            rows={campaignFilterRows}
            showSelectAll={false}
          />
          {selectedPageCount > 0 ? (
            <div
              aria-live="polite"
              className="c3d-page-selection-notice"
              data-testid="campaign-selection-page-notice"
            >
              <span>
                {allMatchingSelected
                  ? `All ${visibleRows.length} matching prospects are selected.`
                  : selectedPageCount === pageRows.length
                    ? `All ${pageRows.length} on this page are selected.`
                    : `${selectedPageCount} selected on this page.`}
              </span>
              {!allMatchingSelected ? (
                <button onClick={selectAllMatching} type="button">
                  Select all {visibleRows.length} matching prospects
                </button>
              ) : null}
            </div>
          ) : null}
          {selectedRows.length ? (
            <CampaignSelectionBar
              accept={acceptButtonState({
                rows: selectedRows,
                canWrite,
                progress,
              })}
              count={selectedRows.length}
              canWrite={canWrite}
              busy={Boolean(progress)}
              onAddToList={() => setListDialogOpen(true)}
              onAskScout={() => void askScout()}
              onAccept={() => void acceptSelected()}
              onBatch={() => setBatchDialogOpen(true)}
              onChangeStage={(stage) => void changeSelectedStage(stage)}
              onClear={() => setSelected(new Set())}
              onDiscuss={shareInSales}
              onMarkLost={() => void markSelectedLost()}
            />
          ) : null}
          {notice ? (
            <p className="c3d-notice" role="status">
              {notice}
            </p>
          ) : null}
          {pendingBulkUpdate ? (
            <PendingBulkProspectUpdateNotice
              busy={Boolean(progress)}
              onRetry={() => void retryPendingBulkUpdate()}
              pending={pendingBulkUpdate}
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
                outreachByLead={outreachByLead}
                rows={visibleProspectRows}
                selected={selected}
              />
              {pageCount > 1 ? (
                <nav aria-label="Campaign prospect pages" className="c3d-pages">
                  <button
                    className="c3d-btn c3d-btn--outline c3d-btn--sm"
                    disabled={page === 0}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                    type="button"
                  >
                    Previous
                  </button>
                  <span>
                    Page {page + 1} of {pageCount}
                  </span>
                  <button
                    className="c3d-btn c3d-btn--outline c3d-btn--sm"
                    disabled={page + 1 >= pageCount}
                    onClick={() =>
                      setPage((value) => Math.min(pageCount - 1, value + 1))
                    }
                    type="button"
                  >
                    Next
                  </button>
                </nav>
              ) : null}
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
      <DiscoveryTypeDetailsDialog
        canFind={Boolean(provider)}
        industryId={null}
        onClose={() => setRelatedTypeId(null)}
        onFind={openWidenSearch}
        onSelectIndustry={() => {
          setRelatedTypeId(null);
          void navigate({ to: "/discovery" });
        }}
        onSelectRelated={setRelatedTypeId}
        showIndustries={false}
        typeId={relatedTypeId}
      />
      <DiscoveryCampaignDialog
        initialLocation={widenLocation}
        continuationSourceCampaign={widenSourceCampaign}
        onOpenChange={setWidenOpen}
        onSubmit={startWidenSearch}
        open={widenOpen}
        pending={widenPending}
        runner={campaign.runBy ?? null}
        simulatedCosts={Boolean(campaign.simulated)}
      />
      <AddToOutreachListDialog
        context={context}
        defaultName={campaign.name}
        description={`Add ${selectedLeadIds.length} leads to a shared list in Sales.`}
        leadIds={selectedLeadIds}
        onOpenChange={setListDialogOpen}
        open={listDialogOpen}
        sourceCampaignId={campaign.id}
      />
      <OutreachBatchDialog
        leads={selectedBatchLeads}
        listName={campaign.name}
        minimumFit={minimumFit}
        onMinimumFitChange={setMinimumFit}
        onOpenChange={setBatchDialogOpen}
        open={batchDialogOpen}
      />
      <DiscoveryContinuationDialog
        campaign={campaign}
        continuation={continuation}
        onOpenChange={(open) => {
          setContinuationOpen(open);
          if (!open) setContinuation(null);
        }}
        onSubmit={continueCampaign}
        open={continuationOpen}
      />
    </>
  );
}
