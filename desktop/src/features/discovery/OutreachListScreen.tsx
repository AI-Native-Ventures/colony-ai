import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Archive,
  Compass,
  Copy,
  List,
  ListPlus,
  MessageCircle,
  MoreHorizontal,
  RotateCcw,
  Save,
  Sparkles,
  UserMinus,
} from "lucide-react";
import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { useMapShellEnabled } from "@/features/map-shell/useMapShellEnabled";
import { useMediaBreakpoint } from "@/shared/hooks/use-mobile";

import {
  useWhatsAppLeadData,
  findWhatsAppContactForLead,
  getWhatsAppLeadStatus,
} from "@/features/whatsapp-outreach/whatsappLeadStatus";
import { whatsappLeadStatusLabel } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import { buildOutreachListLink } from "@/shared/lib/entityLink";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useProfileQuery } from "@/features/profile/hooks";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { OutreachBatchDialog } from "./OutreachBatchDialog";
import { errorMessage } from "./BusinessCommon";
import { publishOutreachListAction } from "./businessRecordMutations";
import type { LeadContext } from "./leadShared";
import { buildOutreachListMutation } from "./outreachRecords";
import type { OutreachBatchLead } from "./outreachBatch";
import { calculateOutreachFitScore } from "./outreachFitScore";
import { canEdit } from "./leadShared";
import {
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
} from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { MapOutreachDeskHeader } from "@/features/whatsapp-outreach/MapOutreachDesk";

import "./colony3-leads.css";

function sourceLabel(
  source: LeadContext["records"]["outreachLists"][number]["record"]["source"],
  campaignNames: ReadonlyMap<string, string>,
): string {
  if (source.kind === "campaign") {
    return source.campaignId
      ? (campaignNames.get(source.campaignId) ?? "Discovery campaign")
      : "Discovery campaign";
  }
  return source.kind === "agent" ? "Created by Scout" : "Created by a person";
}

function stageLabel(
  prospect: LeadContext["records"]["prospects"][number]["record"]["prospect"],
): string {
  if (prospect.qualification === "unreviewed") return "New";
  switch (prospect.stage) {
    case "in_conversation":
      return "In conversation";
    case "qualified":
      return "Qualified";
    case "proposal":
      return "Proposal";
    case "won":
      return "Won";
    case "lost":
      return "Lost";
  }
}

function statusLabel(
  leadId: string,
  phone: string | null,
  contacts: ReturnType<typeof useWhatsAppLeadData>["contactsQuery"]["data"],
  inBatchLeadIds: ReadonlySet<string>,
): string {
  const contact = findWhatsAppContactForLead(leadId, contacts ?? []);
  if (contact?.stage === "not_on_whatsapp") return "No WhatsApp";
  if (!phone && !contact?.e164) return "No phone number";
  const leadStatus = getWhatsAppLeadStatus(contact, inBatchLeadIds.has(leadId));
  if (leadStatus === "opted-out") return whatsappLeadStatusLabel(leadStatus);
  if (leadStatus === "replied" || contact?.stage === "replied") {
    return "Replied";
  }
  if (leadStatus === "in-batch") return whatsappLeadStatusLabel(leadStatus);
  switch (contact?.lastOutboundState) {
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    case "failed":
      return "Failed";
    case "sent":
      return "Sent";
  }
  return contact?.lastContactedAt ? "Sent" : "Not contacted";
}

function contactedAtLabel(value: string): string {
  const date = new Date(value);
  const dayKey = (candidate: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Africa/Johannesburg",
      year: "numeric",
    }).format(candidate);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) {
    return `Today ${new Intl.DateTimeFormat("en-ZA", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: "Africa/Johannesburg",
    }).format(date)}`;
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

export function OutreachListScreen({
  context,
  listId,
}: {
  context: LeadContext;
  listId?: string;
}) {
  const navigate = useNavigate();
  const mapShellEnabled = useMapShellEnabled();
  const isMapCanvasNarrow = useMediaBreakpoint(701);
  const mapOutreachDesk = mapShellEnabled && !isMapCanvasNarrow;
  const { contactsQuery, inBatchLeadIds } = useWhatsAppLeadData();
  const channelsQuery = useChannelsQuery();
  const profileQuery = useProfileQuery();
  const whatsappStatus = useWhatsAppStatusQuery();
  const templatesQuery = useWhatsAppTemplatesQuery(
    whatsappStatus.data?.connected === true,
  );
  const [query, setQuery] = React.useState("");
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [minimumFit, setMinimumFit] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const canWrite = canEdit(context.role);
  const listOverviewActions = (
    <button
      className="c3l-btn c3l-btn-primary"
      data-map-canvas-same-desk="true"
      onClick={() => void navigate({ to: "/leads" })}
      type="button"
    >
      <ListPlus aria-hidden="true" size={16} /> Add leads
    </button>
  );
  React.useEffect(() => {
    if (
      message !== "Default template updated." &&
      message !== "Default template cleared."
    ) {
      return;
    }
    const timeout = window.setTimeout(() => setMessage(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [message]);
  const campaignNames = new Map(
    context.records.discoveryCampaigns.map(({ record }) => [
      record.campaignId,
      record.name,
    ]),
  );
  const allLists = context.records.outreachLists;
  const current = listId
    ? (allLists.find(({ record }) => record.listId === listId) ?? null)
    : null;
  const visibleLists = allLists
    .filter(({ record }) =>
      showArchived ? record.status === "archived" : record.status === "active",
    )
    .filter(({ record }) =>
      `${record.name} ${record.note ?? ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((left, right) => right.record.updatedAt - left.record.updatedAt);
  const leadsById = new Map(
    context.records.prospects.map((row) => [row.record.prospectId, row]),
  );
  const qualificationHeadsByLeadId = new Map(
    context.records.qualificationObservations.map((head) => [
      head.record.leadId,
      head.record,
    ]),
  );
  const memberLeads: OutreachBatchLead[] = (
    current?.record.members ?? []
  ).flatMap((member) => {
    const row = leadsById.get(member.leadId);
    if (row?.record.status !== "active") return [];
    return [
      {
        leadId: member.leadId,
        name: row.record.prospect.party.displayName,
        contactName: row.record.prospect.contactName,
        phone: row.record.prospect.phone,
        whatsappPhone: row.record.prospect.whatsappPhone,
        fit: calculateOutreachFitScore(
          row.record.prospect.maps,
          qualificationHeadsByLeadId.get(member.leadId),
        ),
      },
    ];
  });
  const listMembers = (current?.record.members ?? []).map((member) => {
    const row = leadsById.get(member.leadId);
    const prospect =
      row?.record.status === "active" ? row.record.prospect : null;
    const contact = findWhatsAppContactForLead(
      member.leadId,
      contactsQuery.data ?? [],
    );
    return { member, prospect, contact };
  });
  const knownWhatsAppCount = listMembers.filter(
    ({ prospect, contact }) =>
      prospect && contact && contact.stage !== "not_on_whatsapp",
  ).length;
  const contactedCount = listMembers.filter(({ prospect, contact }) =>
    Boolean(prospect && contact?.lastContactedAt),
  ).length;
  const repliedCount = listMembers.filter(({ prospect, contact }) =>
    Boolean(prospect && (contact?.lastReplyAt || contact?.stage === "replied")),
  ).length;
  const defaultTemplate = (
    templatesQuery.data ??
    whatsappStatus.data?.templates ??
    []
  ).find(
    (item) =>
      item.name === current?.record.defaultTemplate?.name &&
      item.language === current?.record.defaultTemplate?.language,
  );
  const createdByName = current
    ? current.record.createdByAgent
      ? "Scout"
      : current.record.createdBy === context.currentPubkey
        ? profileQuery.data?.displayName?.trim().split(/\s+/u)[0] || "you"
        : "a team member"
    : "";

  async function copyReference() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(
        buildOutreachListLink(current.record.listId),
      );
      setMessage("List reference copied.");
    } catch {
      setMessage("Could not copy the list reference.");
    }
  }

  async function askScout() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(
        `Please research these leads and update their records: ${buildOutreachListLink(current.record.listId)}`,
      );
      setMessage("List reference copied. Paste it in Scout's chat.");
      const channels =
        channelsQuery.data ?? (await channelsQuery.refetch()).data ?? [];
      const scoutDm = channels.find(
        (channel) =>
          channel.channelType === "dm" &&
          [channel.name, ...channel.participants].some((name) =>
            name.toLocaleLowerCase().includes("scout"),
          ),
      );
      if (!scoutDm) return;
      void navigate({
        to: "/channels/$channelId",
        params: { channelId: scoutDm.id },
      });
    } catch {
      setMessage(
        "Could not copy the list reference. Open Scout's chat to ask.",
      );
    }
  }

  async function archiveList() {
    if (!current || busy || !canWrite) return;
    setBusy(true);
    setMessage("");
    try {
      await publishOutreachListAction({
        channelId: context.channelId,
        communityId: context.communityId,
        action: buildOutreachListMutation({
          listId: current.record.listId,
          expectedHeadEventId: current.eventId,
          op: "archive",
        }),
      });
      await context.refresh();
      void navigate({ to: "/lists" });
    } catch (archiveError) {
      setMessage(errorMessage(archiveError));
    } finally {
      setBusy(false);
    }
  }

  async function updateList(
    action: ReturnType<typeof buildOutreachListMutation>,
    successMessage: string,
  ) {
    if (!current || busy || !canWrite) return;
    setBusy(true);
    setMessage("");
    try {
      await publishOutreachListAction({
        channelId: context.channelId,
        communityId: context.communityId,
        action,
      });
      await context.refresh();
      setMessage(successMessage);
      setRenameOpen(false);
    } catch (updateError) {
      setMessage(errorMessage(updateError));
    } finally {
      setBusy(false);
    }
  }

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    await updateList(
      buildOutreachListMutation({
        listId: current.record.listId,
        expectedHeadEventId: current.eventId,
        op: "rename",
        name: nameDraft,
      }),
      "List name updated.",
    );
  }

  async function setDefaultTemplate(value: string) {
    if (!current) return;
    const template = (
      templatesQuery.data ??
      whatsappStatus.data?.templates ??
      []
    ).find((item) => `${item.name}:${item.language}` === value);
    await updateList(
      buildOutreachListMutation({
        listId: current.record.listId,
        expectedHeadEventId: current.eventId,
        op: "set_default_template",
        defaultTemplate: template
          ? { name: template.name, language: template.language }
          : undefined,
      }),
      template ? "Default template updated." : "Default template cleared.",
    );
  }

  async function removeMember(leadId: string) {
    if (!current) return;
    await updateList(
      buildOutreachListMutation({
        listId: current.record.listId,
        expectedHeadEventId: current.eventId,
        op: "remove_members",
        leadIds: [leadId],
      }),
      "Lead removed from the list.",
    );
  }

  async function unarchiveList() {
    if (!current) return;
    await updateList(
      buildOutreachListMutation({
        listId: current.record.listId,
        expectedHeadEventId: current.eventId,
        op: "unarchive",
      }),
      "List restored.",
    );
  }

  const common = !mapOutreachDesk ? (
    <nav
      aria-label="Business views"
      className="c3l-tabs"
      data-map-canvas-same-desk="true"
    >
      <a href="#/leads">Leads</a>
      <a aria-current="page" href="#/lists">
        Lists
      </a>
      <a href="#/pipeline">Pipeline</a>
    </nav>
  ) : null;

  if (!listId) {
    return (
      <main
        className={`c3l-page${mapOutreachDesk ? " map-outreach-desk-page" : ""}`}
        data-testid="outreach-lists-page"
      >
        {mapOutreachDesk ? (
          <MapOutreachDeskHeader
            actions={listOverviewActions}
            active="lists"
            outreachChannelId={whatsappStatus.data?.outreachChannelId}
          />
        ) : null}
        <div className="c3l-wrap c3l-wrap-leads">
          {!mapOutreachDesk ? (
            <div className="c3l-head">
              <div className="c3l-head-text">
                <h1 className="c3l-title">Lists</h1>
                <span className="c3l-subtitle">
                  {visibleLists.length} shared outreach{" "}
                  {visibleLists.length === 1 ? "list" : "lists"}
                </span>
              </div>
              {listOverviewActions}
            </div>
          ) : null}
          {common}
          <div className="c3l-list-toolbar">
            <label className="c3l-search">
              <input
                aria-label="Search outreach lists"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search lists"
                type="search"
                value={query}
              />
            </label>
            <label className="c3l-archived-toggle">
              <input
                checked={showArchived}
                onChange={(event) =>
                  setShowArchived(event.currentTarget.checked)
                }
                type="checkbox"
              />
              Show archived
            </label>
          </div>
          {visibleLists.length > 0 ? (
            <div className="c3l-card c3l-list-table-wrap">
              <table aria-label="Outreach lists" className="c3l-list-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Leads</th>
                    <th>Source</th>
                    <th>Default template</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLists.map(({ record }) => (
                    <tr key={record.listId}>
                      <td>
                        <a
                          data-map-canvas-same-desk="true"
                          href={`#/lists/${record.listId}`}
                        >
                          {record.name}
                        </a>
                        {record.note ? <small>{record.note}</small> : null}
                      </td>
                      <td>{record.members.length}</td>
                      <td>{sourceLabel(record.source, campaignNames)}</td>
                      <td>{record.defaultTemplate?.name ?? "Not set"}</td>
                      <td>
                        {new Date(record.updatedAt * 1000).toLocaleDateString(
                          "en-ZA",
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <section className="c3l-card c3l-empty">
              <h2>
                {showArchived ? "No archived lists" : "No outreach lists yet"}
              </h2>
              <p>Select leads in the Leads table to create a named list.</p>
              <button
                className="c3l-btn c3l-btn-outline"
                onClick={() => void navigate({ to: "/leads" })}
                type="button"
              >
                Open Leads
              </button>
            </section>
          )}
        </div>
      </main>
    );
  }

  if (!current) {
    return (
      <main
        className={`c3l-page${mapOutreachDesk ? " map-outreach-desk-page" : ""}`}
        data-testid="outreach-list-unavailable"
      >
        {mapOutreachDesk ? (
          <MapOutreachDeskHeader
            active="lists"
            outreachChannelId={whatsappStatus.data?.outreachChannelId}
          />
        ) : null}
        <div className="c3l-wrap c3l-wrap-leads">
          {!mapOutreachDesk ? (
            <button
              className="c3l-text-button"
              onClick={() => void navigate({ to: "/lists" })}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={15} /> Back to Lists
            </button>
          ) : null}
          <section className="c3l-card c3l-empty">
            {mapOutreachDesk ? (
              <h2>This list is no longer available</h2>
            ) : (
              <h1>This list is no longer available</h1>
            )}
            <p>It may have been archived or removed.</p>
          </section>
        </div>
      </main>
    );
  }

  const listDetailActions = (
    <>
      <button
        className="c3l-btn c3l-btn-outline"
        onClick={() => void copyReference()}
        type="button"
      >
        <Copy aria-hidden="true" size={14} /> Copy reference
      </button>
      <button
        className="c3l-btn c3l-btn-outline"
        onClick={() => void askScout()}
        type="button"
      >
        <Sparkles aria-hidden="true" size={15} /> Ask Scout
      </button>
      <button
        aria-label="Prepare WhatsApp batch"
        className="c3l-btn c3l-btn-primary"
        disabled={!canWrite || busy || current.record.status === "archived"}
        onClick={() => setBatchOpen(true)}
        type="button"
      >
        <MessageCircle aria-hidden="true" size={15} />
        <span className="c3l-list-action-desktop">Prepare WhatsApp batch</span>
        <span className="c3l-list-action-mobile">WhatsApp batch</span>
      </button>
      <details className="c3l-list-admin-menu c3l-list-desktop-menu">
        <summary aria-label="List actions">
          <MoreHorizontal aria-hidden="true" size={16} />
        </summary>
        <div className="c3l-list-row-menu-content">
          <button
            disabled={!canWrite || busy}
            onClick={() => {
              setNameDraft(current.record.name);
              setRenameOpen(true);
            }}
            type="button"
          >
            <Save aria-hidden="true" size={14} /> Rename list
          </button>
          {current.record.status === "archived" ? (
            <button
              disabled={!canWrite || busy}
              onClick={() => void unarchiveList()}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} /> Restore list
            </button>
          ) : (
            <button
              disabled={!canWrite || busy}
              onClick={() => void archiveList()}
              type="button"
            >
              <Archive aria-hidden="true" size={14} /> Archive list
            </button>
          )}
        </div>
      </details>
    </>
  );

  return (
    <main
      className={`c3l-page${mapOutreachDesk ? " map-outreach-desk-page" : ""}`}
      data-testid="outreach-list-detail"
    >
      {!mapOutreachDesk ? (
        <AppTopChromePortal>
          <nav
            aria-label="Breadcrumb"
            className="colony-breadcrumb"
            data-testid="top-bar-breadcrumb"
          >
            <span>Business</span>
            <span aria-hidden="true">/</span>
            <span>Sales</span>
            <span aria-hidden="true">/</span>
            <a href="#/lists">Lists</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{current.record.name}</span>
          </nav>
        </AppTopChromePortal>
      ) : null}
      {mapOutreachDesk ? (
        <MapOutreachDeskHeader
          actions={listDetailActions}
          active="lists"
          outreachChannelId={whatsappStatus.data?.outreachChannelId}
        />
      ) : null}
      <div className="c3l-wrap c3l-wrap-leads c3l-wrap-list-detail">
        {!mapOutreachDesk ? (
          <header
            className="c3l-mobile-list-header"
            data-testid="list-mobile-header"
          >
            <button
              aria-label="Back to lists"
              onClick={() => void navigate({ to: "/lists" })}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={20} />
            </button>
            <div>
              <h1>{current.record.name}</h1>
              <span>Outreach list · {current.record.members.length} leads</span>
            </div>
            <details className="c3l-mobile-list-menu">
              <summary aria-label="List actions">
                <MoreHorizontal aria-hidden="true" size={20} />
              </summary>
              <div className="c3l-list-row-menu-content">
                <button
                  disabled={!canWrite || busy}
                  onClick={() => {
                    setNameDraft(current.record.name);
                    setRenameOpen(true);
                  }}
                  type="button"
                >
                  <Save aria-hidden="true" size={14} /> Rename list
                </button>
                {current.record.status === "archived" ? (
                  <button
                    disabled={!canWrite || busy}
                    onClick={() => void unarchiveList()}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={14} /> Restore list
                  </button>
                ) : (
                  <button
                    disabled={!canWrite || busy}
                    onClick={() => void archiveList()}
                    type="button"
                  >
                    <Archive aria-hidden="true" size={14} /> Archive list
                  </button>
                )}
              </div>
            </details>
          </header>
        ) : null}
        {!mapOutreachDesk ? (
          <div className="c3l-list-back-row">
            <button
              className="c3l-text-button"
              onClick={() => void navigate({ to: "/lists" })}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={15} /> Business / Sales /
              Lists
            </button>
          </div>
        ) : null}
        {common}
        <div className="c3l-head c3l-list-detail-head">
          <div className="c3l-head-text">
            <div className="c3l-list-eyebrow">
              <List aria-hidden="true" size={14} /> Outreach list
            </div>
            {mapOutreachDesk ? (
              <h2 className="c3l-title">{current.record.name}</h2>
            ) : (
              <h1 className="c3l-title">{current.record.name}</h1>
            )}
            <span className="c3l-list-mobile-subtitle">
              Outreach list · {current.record.members.length} leads
            </span>
            <div className="c3l-list-provenance">
              <span className="c3l-list-source">
                <Compass aria-hidden="true" size={13} />
                {sourceLabel(current.record.source, campaignNames)}
              </span>
              <div className="c3l-list-template-field">
                {whatsappStatus.data?.connected ? (
                  <>
                    <label
                      className="c3l-list-template-label"
                      htmlFor="outreach-list-default-template"
                    >
                      Default template
                    </label>
                    <MessageCircle
                      aria-hidden="true"
                      className="c3l-list-template-icon"
                      size={13}
                    />
                    <select
                      aria-label="Default WhatsApp template"
                      disabled={
                        !canWrite ||
                        busy ||
                        current.record.status === "archived" ||
                        templatesQuery.isPending
                      }
                      id="outreach-list-default-template"
                      onChange={(event) =>
                        void setDefaultTemplate(event.currentTarget.value)
                      }
                      value={
                        current.record.defaultTemplate
                          ? `${current.record.defaultTemplate.name}:${current.record.defaultTemplate.language}`
                          : ""
                      }
                    >
                      <option value="">Not set</option>
                      {(templatesQuery.data ?? whatsappStatus.data.templates)
                        .filter(
                          (item) =>
                            item.status.toLocaleUpperCase() === "APPROVED",
                        )
                        .map((item) => (
                          <option
                            key={`${item.name}:${item.language}`}
                            value={`${item.name}:${item.language}`}
                          >
                            {item.title}
                          </option>
                        ))}
                    </select>
                  </>
                ) : (
                  <>
                    <span className="c3l-list-template-label">
                      Default template
                    </span>
                    <span className="c3l-list-template-name">
                      {defaultTemplate?.title ??
                        current.record.defaultTemplate?.name ??
                        "Not set"}
                    </span>
                  </>
                )}
              </div>
              <span className="c3l-list-created-by">
                Made by {createdByName},{" "}
                {new Intl.DateTimeFormat("en-ZA", {
                  day: "numeric",
                  month: "short",
                }).format(new Date(current.record.createdAt * 1000))}
              </span>
            </div>
            {current.record.note ? (
              <p className="c3l-list-note">{current.record.note}</p>
            ) : null}
          </div>
          {!mapOutreachDesk ? (
            <div className="c3l-head-actions">{listDetailActions}</div>
          ) : null}
        </div>
        <section aria-label="List summary" className="c3l-list-summary">
          <article className="c3l-list-summary-card">
            <span>Leads</span>
            <strong>{current.record.members.length}</strong>
          </article>
          <article className="c3l-list-summary-card">
            <span>With WhatsApp</span>
            <strong>
              {contactsQuery.isPending ? "..." : knownWhatsAppCount}
            </strong>
          </article>
          <article className="c3l-list-summary-card">
            <span>Contacted</span>
            <strong>{contactsQuery.isPending ? "..." : contactedCount}</strong>
          </article>
          <article className="c3l-list-summary-card">
            <span>Replied</span>
            <strong>{contactsQuery.isPending ? "..." : repliedCount}</strong>
          </article>
        </section>
        {renameOpen ? (
          <form
            aria-label="Rename outreach list"
            className="c3l-list-rename"
            onSubmit={(event) => void saveName(event)}
          >
            <label htmlFor="outreach-list-rename">List name</label>
            <input
              id="outreach-list-rename"
              maxLength={80}
              onChange={(event) => setNameDraft(event.currentTarget.value)}
              required
              value={nameDraft}
            />
            <button
              className="c3l-btn c3l-btn-outline c3l-btn-small"
              disabled={!canWrite || busy}
              type="submit"
            >
              <Save aria-hidden="true" size={14} /> Save
            </button>
          </form>
        ) : null}
        {message ? (
          <p className="c3l-outreach-note" role="status">
            {message}
          </p>
        ) : null}
        <div className="c3l-card c3l-list-table-wrap c3l-list-detail-members">
          <table
            aria-label="List members"
            className="c3l-list-table c3l-list-members"
          >
            <thead>
              <tr>
                <th>Business</th>
                <th>Stage</th>
                <th>WhatsApp</th>
                <th>Last contacted</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {listMembers.map(({ member, prospect, contact }) => {
                const whatsappStatus = prospect
                  ? statusLabel(
                      member.leadId,
                      prospect.whatsappPhone ?? prospect.phone,
                      contactsQuery.data,
                      inBatchLeadIds,
                    )
                  : "Not available";
                return (
                  <tr key={member.leadId}>
                    <td className="c3l-list-business-cell">
                      {prospect ? (
                        <BusinessLogoMark
                          className="c3l-list-member-mark"
                          name={prospect.party.displayName}
                          website={prospect.website}
                        />
                      ) : null}
                      <div className="c3l-list-member-copy">
                        <div className="c3l-list-member-business">
                          {prospect ? (
                            <a href={`#/sales/lead/${member.leadId}`}>
                              {prospect.party.displayName}
                            </a>
                          ) : (
                            <span className="c3l-muted">
                              This lead is no longer available
                            </span>
                          )}
                        </div>
                        {prospect?.phone ? (
                          <small>{prospect.phone}</small>
                        ) : null}
                        <span
                          aria-hidden="true"
                          className="c3l-list-status-badge c3l-list-mobile-status"
                          data-status={whatsappStatus}
                        >
                          {whatsappStatus}
                        </span>
                      </div>
                    </td>
                    <td className="c3l-list-stage-cell">
                      {prospect ? stageLabel(prospect) : "Not available"}
                    </td>
                    <td className="c3l-list-status-cell">
                      <span
                        className="c3l-list-status-badge"
                        data-status={whatsappStatus}
                      >
                        {whatsappStatus}
                      </span>
                    </td>
                    <td className="c3l-list-contacted-cell">
                      {contact?.lastContactedAt
                        ? contactedAtLabel(contact.lastContactedAt)
                        : "Never"}
                    </td>
                    <td className="c3l-list-action-cell">
                      <details className="c3l-list-row-menu">
                        <summary
                          aria-label={`Actions for ${prospect?.party.displayName ?? "unavailable lead"}`}
                        >
                          <MoreHorizontal aria-hidden="true" size={16} />
                        </summary>
                        <div className="c3l-list-row-menu-content">
                          <button
                            disabled={
                              !canWrite ||
                              busy ||
                              current.record.status === "archived"
                            }
                            onClick={() => void removeMember(member.leadId)}
                            type="button"
                          >
                            <UserMinus aria-hidden="true" size={14} />
                            Remove from list
                          </button>
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {memberLeads.length < current.record.members.length ? (
          <p className="c3l-outreach-note">
            {current.record.members.length - memberLeads.length} lead
            {current.record.members.length - memberLeads.length === 1
              ? " is"
              : "s are"}{" "}
            no longer available.
          </p>
        ) : null}
      </div>
      <OutreachBatchDialog
        defaultTemplate={current.record.defaultTemplate}
        leads={memberLeads}
        listName={current.record.name}
        minimumFit={minimumFit}
        onMinimumFitChange={setMinimumFit}
        onOpenChange={setBatchOpen}
        open={batchOpen && current.record.status === "active"}
      />
    </main>
  );
}
