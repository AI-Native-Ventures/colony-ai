import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, MoreHorizontal } from "lucide-react";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useProfileQuery } from "@/features/profile/hooks";
import { useRouteOrigin } from "@/app/navigation/RouteOriginContext";

import { useCustomerRecords } from "@/features/cofounder/customerHooks";
import { useCustomerRecordCapabilities } from "@/features/cofounder/customerRecordAccess";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { useDiscoveryCampaign } from "./discoveryProvider";
import { AddLeadDialog } from "./LeadDialogs";
import { LeadPill, PlusGlyph, SearchGlyph } from "./LeadParts";
import { AddToOutreachListDialog } from "./AddToOutreachListDialog";
import { OutreachBatchDialog } from "./OutreachBatchDialog";
import { OutreachFitScoreDashboard } from "./OutreachFitScorePanel";
import { OutreachFilterControls } from "./OutreachFilterControls";
import { OutreachSelectionBar } from "./OutreachSelectionBar";
import { QualificationFilterControls } from "./QualificationFilterControls";
import { QualificationRunDialog } from "./QualificationRunDialog";
import {
  filterOutreachRows,
  selectAllMatching,
  toggleOutreachSelection,
  type OutreachFilters,
  type OutreachWhatsAppStatus,
} from "./outreachSelection";
import {
  canEdit,
  findScoutDirectMessage,
  labelForStage,
  toneForStage,
  type LeadContext,
} from "./leadShared";
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
  findWhatsAppContactForLead,
  getWhatsAppLeadStatus,
  useWhatsAppLeadData,
} from "@/features/whatsapp-outreach/whatsappLeadStatus";
import { whatsappLeadStatusLabel } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import type { ProspectStage, QualifySignal } from "./businessRecordContract";
import { buildLeadLink } from "@/shared/lib/entityLink";
import type { OutreachBatchLead } from "./outreachBatch";
import { calculateOutreachFitScore } from "./outreachFitScore";
import {
  filterQualificationLeads,
  qualificationFilterLeadFromRecords,
  type QualificationFilter,
} from "./qualifyFilter";
import { qualificationObserved } from "./qualificationPresentation";
import { cloneCampaignQualificationSettings } from "./qualificationCampaign";
import {
  cancelQualificationRun,
  qualificationRunSnapshot,
  resumeQualificationRun,
  startQualificationRun,
  useQualificationProgress,
  type QualificationRunProgress,
} from "./qualificationRuntime";

import "./colony3-leads.css";

function whatsappStatusLabel(status: OutreachWhatsAppStatus): string {
  return status === "no-number"
    ? "No WhatsApp number"
    : whatsappLeadStatusLabel(status);
}

export function LeadsScreen(context: LeadContext) {
  const navigate = useNavigate();
  const routeOrigin = useRouteOrigin();
  const restored = routeOrigin.pageSnapshot?.viewState as
    | {
        query?: string;
        filters?: OutreachFilters;
        qualificationFilter?: QualificationFilter;
        selected?: string[];
        page?: number;
      }
    | undefined;
  const channelsQuery = useChannelsQuery();
  const profileQuery = useProfileQuery();
  const { campaign } = useDiscoveryCampaign();
  const customerAccess = useCustomerRecordCapabilities();
  const customerRecordsQuery = useCustomerRecords(customerAccess.enabled);
  const { contactsQuery, inBatchLeadIds } = useWhatsAppLeadData();
  const [query, setQuery] = React.useState(restored?.query ?? "");
  const [filters, setFilters] = React.useState<OutreachFilters>(
    () =>
      restored?.filters ?? {
        hasPhone: true,
        whatsappStatuses: new Set(["not-contacted"]),
        stages: new Set(["new"]),
      },
  );
  const [qualificationFilter, setQualificationFilter] =
    React.useState<QualificationFilter>(
      () =>
        restored?.qualificationFilter ?? {
          mustHave: [],
          mustNotHave: [],
          notChecked: [],
        },
    );
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(restored?.selected ?? []),
  );
  const selectionAnchor = React.useRef<string | null>(
    restored?.selected?.[restored.selected.length - 1] ?? null,
  );
  const [page, setPage] = React.useState(restored?.page ?? 0);
  const [listDialogOpen, setListDialogOpen] = React.useState(false);
  const [qualificationListDialogOpen, setQualificationListDialogOpen] =
    React.useState(false);
  const [qualificationListIds, setQualificationListIds] = React.useState<
    string[]
  >([]);
  const [batchDialogOpen, setBatchDialogOpen] = React.useState(false);
  const [minimumFit, setMinimumFit] = React.useState<number | null>(null);
  const [qualificationDialogOpen, setQualificationDialogOpen] =
    React.useState(false);
  const [qualificationRun, setQualificationRun] =
    React.useState<QualificationRunProgress | null>(null);
  const [selectionError, setSelectionError] = React.useState("");
  const [selectionBusy, setSelectionBusy] = React.useState(false);
  const [pendingBulkUpdate, setPendingBulkUpdate] =
    React.useState<PendingBulkProspectUpdate | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const canWrite = canEdit(context.role);
  const qualificationProgress = useQualificationProgress({
    channelId: context.channelId,
    communityId: context.communityId,
  });
  React.useEffect(() => {
    try {
      setPendingBulkUpdate(
        getPendingBulkProspectUpdate({
          channelId: context.channelId,
          communityId: context.communityId,
        }),
      );
    } catch (pendingError) {
      setSelectionError(errorMessage(pendingError));
    }
  }, [context.channelId, context.communityId]);
  const customerRecordByPartyId = React.useMemo(
    () =>
      new Map(
        (customerRecordsQuery.data ?? []).map((record) => [
          record.partyId,
          record,
        ]),
      ),
    [customerRecordsQuery.data],
  );
  const activeProspects = context.records.prospects.filter(
    ({ record }) => record.status === "active",
  );
  const outreachRows = React.useMemo(() => {
    const contacts = contactsQuery.data ?? [];
    return activeProspects.map((row) => {
      const prospect = row.record.prospect;
      const customerRecord = customerRecordByPartyId.get(
        prospect.party.partyId,
      );
      const contact = findWhatsAppContactForLead(
        row.record.prospectId,
        contacts,
      );
      const whatsappStatus: OutreachWhatsAppStatus =
        contact?.stage === "not_on_whatsapp"
          ? "no-number"
          : getWhatsAppLeadStatus(
              contact,
              inBatchLeadIds.has(row.record.prospectId),
            );
      const stage =
        customerRecord?.stage === "client"
          ? "client"
          : prospect.qualification === "unreviewed"
            ? "new"
            : prospect.stage;
      return {
        ...row,
        id: row.record.prospectId,
        searchableText: [
          prospect.party.displayName,
          prospect.contactName ?? "",
          prospect.industry,
          prospect.vertical,
          prospect.location ?? "",
          prospect.phone ?? "",
        ].join(" "),
        hasPhone: Boolean(
          prospect.whatsappPhone?.trim() ||
            prospect.phone?.trim() ||
            contact?.e164,
        ),
        whatsappStatus,
        stage,
        contact,
        customerRecord,
      };
    });
  }, [
    activeProspects,
    contactsQuery.data,
    customerRecordByPartyId,
    inBatchLeadIds,
  ]);
  const qualificationRows = React.useMemo(
    () =>
      activeProspects.map((row) =>
        qualificationFilterLeadFromRecords(
          row,
          context.records.qualificationObservations,
        ),
      ),
    [activeProspects, context.records.qualificationObservations],
  );
  const qualifiedLeadIds = React.useMemo(
    () =>
      new Set(
        filterQualificationLeads(qualificationRows, qualificationFilter).map(
          (row) => row.leadId,
        ),
      ),
    [qualificationFilter, qualificationRows],
  );
  const qualificationHeadsByLeadId = React.useMemo(
    () =>
      new Map(
        context.records.qualificationObservations.map((head) => [
          head.record.leadId,
          head.record,
        ]),
      ),
    [context.records.qualificationObservations],
  );
  const fitByLeadId = React.useMemo(
    () =>
      new Map(
        activeProspects.map(({ record }) => [
          record.prospectId,
          calculateOutreachFitScore(
            record.prospect.maps,
            qualificationHeadsByLeadId.get(record.prospectId),
          ),
        ]),
      ),
    [activeProspects, qualificationHeadsByLeadId],
  );
  const filteredRows = filterOutreachRows(outreachRows, filters, query).filter(
    ({ id }) => qualifiedLeadIds.has(id),
  );
  const outreachFitLeads = React.useMemo(
    () =>
      filteredRows.map(({ hasPhone, id, record }) => ({
        leadId: id,
        name: record.prospect.party.displayName,
        location: record.prospect.location,
        fit: fitByLeadId.get(id) ?? null,
        hasWhatsAppNumber: hasPhone,
      })),
    [filteredRows, fitByLeadId],
  );
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize);
  const pageIds = pageRows.map(({ id }) => id);
  const selectedPageCount = pageIds.filter((id) => selected.has(id)).length;
  const selectedRows = outreachRows.filter(({ id }) => selected.has(id));
  const selectionMatchesOutreachBoard =
    filters.hasPhone === true &&
    filters.whatsappStatuses.has("not-contacted") &&
    filters.stages.has("new");
  const outreachListDefaultName = selectionMatchesOutreachBoard
    ? "Guesthouses with a phone, not contacted"
    : `Selected leads, ${new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date())}`;
  const outreachListDescription = selectionMatchesOutreachBoard
    ? "Every lead with a phone number, not contacted on WhatsApp, stage New. You and Scout can mention the list in any chat."
    : `${selectedRows.length} leads selected. You and Scout can mention this shared list in any chat.`;
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const allMatchingSelected =
    filteredRows.length > 0 && filteredRows.every(({ id }) => selected.has(id));
  const runnerName = campaign?.runBy
    ? profileQuery.data?.displayName?.trim() || campaign.runBy.name
    : null;
  const batchLeads: OutreachBatchLead[] = selectedRows.map(({ record }) => ({
    leadId: record.prospectId,
    name: record.prospect.party.displayName,
    contactName: record.prospect.contactName,
    phone: record.prospect.phone,
    whatsappPhone: record.prospect.whatsappPhone,
    fit: fitByLeadId.get(record.prospectId) ?? null,
  }));
  const manualQualificationProgress = qualificationRun
    ? (qualificationProgress.get(qualificationRun.runId) ?? qualificationRun)
    : null;
  const qualificationInitialSignals = cloneCampaignQualificationSettings(
    campaign?.qualification,
  ).selectedSignals;

  React.useEffect(() => {
    const scrollTarget = document.querySelector<HTMLElement>(".c3l-page");
    const save = () =>
      routeOrigin.savePageSnapshot({
        backLabel: "All leads",
        breadcrumbs: ["Business", "Sales", "Leads"],
        viewState: {
          query,
          filters,
          qualificationFilter,
          selected: [...selected],
          page,
        },
        scrollY: scrollTarget?.scrollTop ?? window.scrollY,
        scrollTarget: scrollTarget ? ".c3l-page" : undefined,
      });
    save();
    const scrollHost: Window | HTMLElement = scrollTarget ?? window;
    scrollHost.addEventListener("scroll", save, { passive: true });
    return () => scrollHost.removeEventListener("scroll", save);
  }, [
    filters,
    page,
    qualificationFilter,
    query,
    routeOrigin.savePageSnapshot,
    selected,
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

  function setFilterState(next: OutreachFilters) {
    setFilters(next);
    setSelected(new Set());
    selectionAnchor.current = null;
    setPage(0);
  }

  function setQualificationFilterState(next: QualificationFilter) {
    setQualificationFilter(next);
    setSelected(new Set());
    selectionAnchor.current = null;
    setPage(0);
  }

  function saveQualificationList() {
    setQualificationListIds(filteredRows.map(({ id }) => id));
    setQualificationListDialogOpen(true);
  }

  async function checkSelectedWebsites(input: {
    refresh: boolean;
    selectedSignals: QualifySignal[];
  }) {
    if (!canWrite || selectedRows.length === 0) return;
    const initial = await startQualificationRun({
      channelId: context.channelId,
      communityId: context.communityId,
      leads: selectedRows.map(({ record }) => ({
        leadId: record.prospectId,
        website: record.prospect.website,
      })),
      refresh: input.refresh,
      runId: crypto.randomUUID(),
      selectedSignals: input.selectedSignals,
    });
    setQualificationRun(initial);
    setSelectionError(
      `Website checks started for ${selectedRows.length} ${selectedRows.length === 1 ? "lead" : "leads"}.`,
    );
  }

  async function cancelSelectedWebsiteChecks() {
    if (!qualificationRun || selectionBusy) return;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      await cancelQualificationRun({
        channelId: context.channelId,
        communityId: context.communityId,
        runId: qualificationRun.runId,
      });
      const snapshot = await qualificationRunSnapshot({
        channelId: context.channelId,
        communityId: context.communityId,
        runId: qualificationRun.runId,
      });
      if (snapshot) setQualificationRun(snapshot);
    } catch (cancelError) {
      setSelectionError(errorMessage(cancelError));
    } finally {
      setSelectionBusy(false);
    }
  }

  async function resumeSelectedWebsiteChecks() {
    if (!qualificationRun || selectionBusy) return;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      const progress = await resumeQualificationRun({
        channelId: context.channelId,
        communityId: context.communityId,
        runId: qualificationRun.runId,
      });
      setQualificationRun(progress);
    } catch (resumeError) {
      setSelectionError(errorMessage(resumeError));
    } finally {
      setSelectionBusy(false);
    }
  }

  function toggleOne(id: string, checked: boolean, shiftKey: boolean) {
    const next = toggleOutreachSelection({
      selected,
      visibleIds: pageIds,
      id,
      checked,
      shiftKey,
      anchorId: selectionAnchor.current,
    });
    selectionAnchor.current = next.anchorId;
    setSelected(next.selected);
  }

  function selectCurrentPage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    selectionAnchor.current = pageIds[0] ?? null;
  }

  async function updateSelectedStage(stage: ProspectStage) {
    if (!canWrite || selectionBusy || selectedRows.length === 0) return;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      await updateProspectsStage({
        channelId: context.channelId,
        communityId: context.communityId,
        prospectIds: selectedRows.map(({ id }) => id),
        stage,
      });
      await context.refresh();
      setPendingBulkUpdate(null);
      setSelected(new Set());
    } catch (updateError) {
      setSelectionError(errorMessage(updateError));
      refreshPendingBulkUpdate();
    } finally {
      setSelectionBusy(false);
    }
  }

  async function markSelectedLost() {
    if (!canWrite || selectionBusy || selectedRows.length === 0) return;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      await markProspectsLost({
        channelId: context.channelId,
        communityId: context.communityId,
        prospectIds: selectedRows.map(({ id }) => id),
      });
      await context.refresh();
      setPendingBulkUpdate(null);
      setSelected(new Set());
    } catch (updateError) {
      setSelectionError(errorMessage(updateError));
      refreshPendingBulkUpdate();
    } finally {
      setSelectionBusy(false);
    }
  }

  function refreshPendingBulkUpdate() {
    try {
      setPendingBulkUpdate(getPendingBulkProspectUpdate(context));
    } catch (pendingError) {
      setSelectionError(errorMessage(pendingError));
    }
  }

  async function retryPendingBulkUpdate() {
    if (selectionBusy) return;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      await resumePendingProspectUpdate(context);
      await context.refresh();
      setPendingBulkUpdate(null);
      setSelected(new Set());
    } catch (retryError) {
      setSelectionError(errorMessage(retryError));
      refreshPendingBulkUpdate();
    } finally {
      setSelectionBusy(false);
    }
  }

  async function askScout() {
    const prompt = [
      "Please research these leads and update their records:",
      ...selectedRows.map(({ record }) => buildLeadLink(record.prospectId)),
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
        setSelectionError(
          copied
            ? "Lead references copied. Scout's chat is unavailable."
            : "Scout's chat is unavailable and the lead references could not be copied.",
        );
        return;
      }
      setSelectionError(
        copied
          ? "Lead references copied."
          : "Could not copy the lead references.",
      );
      void navigate({
        to: "/channels/$channelId",
        params: { channelId: scoutDm.id },
      });
    } catch {
      setSelectionError(
        copied
          ? "Lead references copied. Scout's chat could not be opened."
          : "Could not copy the lead references or open Scout's chat.",
      );
    }
  }

  return (
    <main className="c3l-page" data-testid="w10-leads-page">
      <div className="c3l-wrap c3l-wrap-leads">
        <header
          className="c3l-mobile-leads-header"
          data-testid="leads-mobile-header"
        >
          <button
            aria-label="Back to discovery"
            onClick={() => void navigate({ to: "/discovery" })}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={20} />
          </button>
          <div className="c3l-mobile-leads-heading">
            <h1>Leads</h1>
            <span>
              {activeProspects.length}{" "}
              {activeProspects.length === 1 ? "lead" : "leads"} · Sales
            </span>
          </div>
          <details className="c3l-mobile-leads-menu">
            <summary aria-label="Lead actions">
              <MoreHorizontal aria-hidden="true" size={20} />
            </summary>
            <div className="c3l-list-row-menu-content">
              {canWrite ? (
                <button onClick={() => setDialogOpen(true)} type="button">
                  Add lead
                </button>
              ) : null}
              <button
                onClick={() => void navigate({ to: "/discovery" })}
                type="button"
              >
                Find prospects
              </button>
            </div>
          </details>
        </header>
        <div className="c3l-head c3l-leads-desktop-head">
          <div className="c3l-head-text">
            <h1 className="c3l-title">Leads</h1>
            <span className="c3l-subtitle c3l-subtitle-inline">
              {activeProspects.length}{" "}
              {activeProspects.length === 1 ? "lead" : "leads"}
              {runnerName ? (
                <>
                  {" · sourced by "}
                  {runnerName}’s Discovery campaigns
                </>
              ) : null}
            </span>
          </div>
          <div className="c3l-head-actions">
            {canWrite ? (
              <button
                className="c3l-btn c3l-btn-outline"
                onClick={() => setDialogOpen(true)}
                type="button"
              >
                <PlusGlyph />
                Add lead
              </button>
            ) : null}
            <button
              className="c3l-btn c3l-btn-primary"
              onClick={() => void navigate({ to: "/discovery" })}
              type="button"
            >
              Find prospects <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <nav aria-label="Business views" className="c3l-tabs">
          <a aria-current="page" href="#/leads">
            Leads
          </a>
          <a href="#/lists">Lists</a>
          <a href="#/pipeline">Pipeline</a>
          <span aria-disabled="true" className="c3l-tab-placeholder">
            Proposals
          </span>
          <span aria-disabled="true" className="c3l-tab-placeholder">
            Services
          </span>
        </nav>

        <OutreachFitScoreDashboard
          leads={outreachFitLeads}
          minimumFit={minimumFit}
          onMinimumFitChange={setMinimumFit}
        />

        <div className="c3l-filterbar">
          <label className="c3l-search">
            <SearchGlyph />
            <input
              aria-label="Search leads"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setSelected(new Set());
                selectionAnchor.current = null;
                setPage(0);
              }}
              placeholder="Search leads…"
              type="search"
              value={query}
            />
          </label>
          <button
            aria-label="Show all stages"
            className="c3l-stage-scope"
            onClick={() => setFilterState({ ...filters, stages: new Set() })}
            type="button"
          >
            All stages <ChevronDown aria-hidden="true" size={15} />
          </button>
        </div>

        <OutreachFilterControls
          allMatchingSelected={allMatchingSelected}
          filters={filters}
          onSelectAllMatching={() =>
            setSelected((current) =>
              selectAllMatching(
                current,
                filteredRows.map(({ id }) => id),
              ),
            )
          }
          matching={filteredRows.length}
          onChange={setFilterState}
          pageSelectedCount={pageIds.filter((id) => selected.has(id)).length}
          query={query}
          rows={outreachRows}
          showSelectAll
        />
        <QualificationFilterControls
          filter={qualificationFilter}
          matching={filteredRows.length}
          onChange={setQualificationFilterState}
          onSaveList={saveQualificationList}
          rows={qualificationRows}
        />
        {manualQualificationProgress ? (
          <div
            className="c3q-run-notice"
            data-testid="manual-qualification-progress"
            role="status"
          >
            <p>
              Website checks: {manualQualificationProgress.checked} of{" "}
              {manualQualificationProgress.total} checked
              {manualQualificationProgress.skippedFresh
                ? `, ${manualQualificationProgress.skippedFresh} already checked in the last 30 days`
                : ""}
              {manualQualificationProgress.failureReason
                ? `. ${manualQualificationProgress.failureReason}`
                : "."}
            </p>
            {manualQualificationProgress.status === "running" ? (
              <button
                disabled={selectionBusy}
                onClick={() => void cancelSelectedWebsiteChecks()}
                type="button"
              >
                Cancel checks
              </button>
            ) : null}
            {manualQualificationProgress.status === "paused" ||
            manualQualificationProgress.status === "cancelled" ? (
              <button
                disabled={selectionBusy}
                onClick={() => void resumeSelectedWebsiteChecks()}
                type="button"
              >
                Resume checks
              </button>
            ) : null}
          </div>
        ) : null}

        {selectedPageCount > 0 ? (
          <div className="c3l-page-selection-note">
            <span>
              {selectedPageCount === pageIds.length
                ? `All ${pageIds.length} on this page are selected.`
                : `${selectedPageCount} on this page are selected.`}
            </span>
            {!allMatchingSelected && filteredRows.length > pageIds.length ? (
              <button
                onClick={() =>
                  setSelected((current) =>
                    selectAllMatching(
                      current,
                      filteredRows.map(({ id }) => id),
                    ),
                  )
                }
                type="button"
              >
                Select all {filteredRows.length} matching leads
              </button>
            ) : allMatchingSelected ? (
              <strong>All {filteredRows.length} matching leads selected</strong>
            ) : null}
          </div>
        ) : null}

        {pageRows.length ? (
          <React.Fragment>
            <div className="c3l-card c3l-table-wrap">
              <table
                aria-label="Leads"
                className="c3l-table"
                data-testid="leads-primary-table"
              >
                <thead>
                  <tr className="c3l-row c3l-row-head">
                    <th>
                      <input
                        aria-label={`Select all ${pageRows.length} leads on this page`}
                        checked={allPageSelected}
                        onChange={(event) =>
                          selectCurrentPage(event.currentTarget.checked)
                        }
                        type="checkbox"
                      />
                    </th>
                    <th>Business</th>
                    <th>Phone</th>
                    <th>Stage</th>
                    <th>WhatsApp</th>
                    <th>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(
                    ({
                      record,
                      eventId,
                      contact,
                      whatsappStatus,
                      customerRecord,
                      id,
                    }) => {
                      const prospect = record.prospect;
                      const qualificationFacts = qualificationObserved(
                        qualificationHeadsByLeadId.get(id),
                      ).slice(0, 3);
                      return (
                        <tr
                          aria-selected={selected.has(id)}
                          className={`c3l-row${selected.has(id) ? " is-selected" : ""}`}
                          key={eventId}
                        >
                          <td>
                            <input
                              aria-label={`Select ${prospect.party.displayName}`}
                              checked={selected.has(id)}
                              onClick={(event) => {
                                (
                                  event.currentTarget as HTMLInputElement
                                ).dataset.shiftKey = String(event.shiftKey);
                              }}
                              onChange={(event) =>
                                toggleOne(
                                  id,
                                  event.currentTarget.checked,
                                  event.currentTarget.dataset.shiftKey ===
                                    "true",
                                )
                              }
                              onKeyDown={(event) => {
                                if (
                                  event.key === " " ||
                                  event.key === "Spacebar"
                                ) {
                                  event.currentTarget.dataset.shiftKey = String(
                                    event.shiftKey,
                                  );
                                }
                              }}
                              type="checkbox"
                            />
                          </td>
                          <td className="c3l-cell-business">
                            <div className="c3l-business-identity">
                              <BusinessLogoMark
                                className="c3l-mark"
                                logoUrl={prospect.logoUrl}
                                name={prospect.party.displayName}
                                placePhotoUrl={prospect.placePhotoUrl}
                                website={prospect.website}
                              />
                              <span className="c3l-business-text">
                                <strong>{prospect.party.displayName}</strong>
                                <small>
                                  {prospect.vertical} ·{" "}
                                  {prospect.location ?? "Location not set"}
                                </small>
                                <span className="c3l-mobile-lead-contact">
                                  {prospect.phone ?? contact?.e164 ?? "Not set"}
                                  <span aria-hidden="true"> · </span>
                                  {whatsappStatusLabel(whatsappStatus)}
                                </span>
                                {qualificationFacts.length ? (
                                  <span className="c3q-row-chips">
                                    {qualificationFacts.map((fact) => (
                                      <span
                                        className={`c3q-row-chip is-${fact.certainty.toLocaleLowerCase()}`}
                                        key={fact.observation.signal}
                                        title={fact.label}
                                      >
                                        {fact.label}
                                      </span>
                                    ))}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          </td>
                          <td className="c3l-cell-phone">
                            <strong>
                              {prospect.phone ?? contact?.e164 ?? "Not set"}
                            </strong>
                            <small>{prospect.contactName ?? ""}</small>
                          </td>
                          <td>
                            {customerRecord?.stage === "client" ? (
                              <LeadPill tone="green">Client</LeadPill>
                            ) : (
                              <LeadPill
                                tone={toneForStage(
                                  prospect.stage,
                                  prospect.qualification,
                                )}
                              >
                                {labelForStage(
                                  prospect.stage,
                                  prospect.qualification,
                                  "New",
                                )}
                              </LeadPill>
                            )}
                          </td>
                          <td>
                            <span className="c3l-whatsapp-status">
                              {whatsappStatusLabel(whatsappStatus)}
                            </span>
                          </td>
                          <td className="c3l-cell-next-step">
                            <Link
                              className="c3l-next-step"
                              params={{ prospectId: record.prospectId }}
                              to="/sales/lead/$prospectId"
                            >
                              Review lead
                            </Link>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
            {pageCount > 1 ? (
              <nav aria-label="Lead pages" className="c3l-pagination">
                <button
                  className="c3l-btn c3l-btn-outline c3l-btn-small"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  type="button"
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  className="c3l-btn c3l-btn-outline c3l-btn-small"
                  disabled={page + 1 >= pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(pageCount - 1, current + 1))
                  }
                  type="button"
                >
                  Next
                </button>
              </nav>
            ) : null}
          </React.Fragment>
        ) : (
          <div className="c3l-card c3l-empty">
            <h2>
              {activeProspects.length
                ? "No leads match these filters."
                : "No leads yet"}
            </h2>
            <p>
              {activeProspects.length
                ? "Try a different name, location or stage."
                : "Find a business that could benefit from your service, or add a lead yourself."}
            </p>
            {activeProspects.length ? (
              <button
                className="c3l-btn c3l-btn-outline"
                onClick={() => {
                  setQuery("");
                  setFilterState({
                    hasPhone: null,
                    whatsappStatuses: new Set(),
                    stages: new Set(),
                  });
                }}
                type="button"
              >
                Clear filters
              </button>
            ) : (
              <button
                className="c3l-btn c3l-btn-primary"
                onClick={() => void navigate({ to: "/discovery" })}
                type="button"
              >
                Explore Discovery
              </button>
            )}
          </div>
        )}
        {pendingBulkUpdate ? (
          <PendingBulkProspectUpdateNotice
            busy={selectionBusy}
            onRetry={() => void retryPendingBulkUpdate()}
            pending={pendingBulkUpdate}
          />
        ) : null}
        {selectionError ? (
          <p className="c3l-outreach-note" role="status">
            {selectionError}
          </p>
        ) : null}
        {canWrite && !listDialogOpen ? (
          <OutreachSelectionBar
            count={selected.size}
            onAddToList={() => setListDialogOpen(true)}
            onAskScout={() => void askScout()}
            onCheckWebsites={() => setQualificationDialogOpen(true)}
            onChangeStage={(stage) => void updateSelectedStage(stage)}
            onClear={() => {
              setSelected(new Set());
              selectionAnchor.current = null;
            }}
            onMarkLost={() => void markSelectedLost()}
            onDiscuss={() =>
              void navigate({
                to: "/channels/$channelId",
                params: { channelId: context.channelId },
              })
            }
            onWhatsAppBatch={() => setBatchDialogOpen(true)}
          />
        ) : null}
      </div>

      <AddToOutreachListDialog
        context={context}
        defaultName={outreachListDefaultName}
        description={outreachListDescription}
        leadIds={selectedRows.map(({ id }) => id)}
        onOpenChange={setListDialogOpen}
        open={listDialogOpen}
      />
      <AddToOutreachListDialog
        context={context}
        defaultName={`Website checks, ${new Intl.DateTimeFormat("en", {
          day: "numeric",
          month: "short",
        }).format(new Date())}`}
        description={`${qualificationListIds.length} leads matching this exact website-check filter will be saved as a static list.`}
        leadIds={qualificationListIds}
        onOpenChange={setQualificationListDialogOpen}
        open={qualificationListDialogOpen}
      />
      <OutreachBatchDialog
        leads={batchLeads}
        listName="selected leads"
        minimumFit={minimumFit}
        onMinimumFitChange={setMinimumFit}
        onOpenChange={setBatchDialogOpen}
        open={batchDialogOpen}
      />
      <QualificationRunDialog
        initialSignals={qualificationInitialSignals}
        leadCount={selectedRows.length}
        onOpenChange={setQualificationDialogOpen}
        onRun={checkSelectedWebsites}
        open={qualificationDialogOpen}
      />

      <AddLeadDialog
        canWrite={canWrite}
        context={context}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
      />
    </main>
  );
}
