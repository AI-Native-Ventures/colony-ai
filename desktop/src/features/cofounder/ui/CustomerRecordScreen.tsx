import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  Check,
  CircleDollarSign,
  FileText,
  Flag,
  Mail,
  MessageCircle,
  Paperclip,
  Search,
  Send,
} from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  BusinessTrail,
  type TrailCrumb,
} from "@/features/clients/ui/BusinessTrail";
import {
  ClientWorkspace,
  RecordMessage,
} from "@/features/clients/ui/ClientWorkspace";
import { useBusinessRecords } from "@/features/discovery/useBusinessRecords";
import { useWhatsAppStatusQuery } from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { maskWhatsAppNumber } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import { customerActions } from "@/features/cofounder/customerActions";
import {
  useCustomerRecord,
  useCustomerRecordAction,
} from "@/features/cofounder/customerHooks";
import type {
  AttachmentView,
  CustomerRecordView,
  TimelineKind,
} from "@/features/cofounder/customerRecords";
import { useCustomerRecordCapabilities } from "@/features/cofounder/customerRecordAccess";
import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";

import "./cofounderCustomerRecord.css";

const TIMELINE_ICON: Record<TimelineKind, typeof Search> = {
  found: Search,
  opener_approved: Check,
  opener_sent: Send,
  replied: MessageCircle,
  call_booked: CalendarDays,
  quote_drafted: FileText,
  quote_accepted: Check,
  agreement_signed: FileText,
  milestone: Flag,
  email: Mail,
  file: Paperclip,
  converted: Flag,
  invoice_issued: FileText,
  payment_received: CircleDollarSign,
  project_started: Flag,
  project_completed: Check,
};

function localDateTime(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateLabel(value: number | null): string {
  if (value === null) return "";
  const date = new Date(value * 1_000);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function moneyLabel(value: number | null, currency: string | null): string {
  if (value === null || currency === null) return "-";
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
    }).format(value / 100);
  } catch {
    return "-";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The customer record could not be changed. Try again.";
}

function emailAttachments(record: CustomerRecordView): AttachmentView[] {
  return record.attachments.filter((attachment) => attachment.kind === "email");
}

function fileAttachments(record: CustomerRecordView): AttachmentView[] {
  return record.attachments.filter((attachment) => attachment.kind === "file");
}

export function CustomerRecordScreen({ partyId }: { partyId: string }) {
  const navigate = useNavigate();
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const access = useCustomerRecordCapabilities();
  const recordQuery = useCustomerRecord(partyId);
  const recordAction = useCustomerRecordAction();
  const business = useBusinessRecords({ createIfMissing: false });
  const whatsappStatus = useWhatsAppStatusQuery(
    Boolean(recordQuery.record?.chats.whatsapp),
  );
  const { goClients } = useAppNavigation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [milestoneKind, setMilestoneKind] = useState<
    "call_booked" | "agreement_signed" | "other"
  >("call_booked");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneAt, setMilestoneAt] = useState(() =>
    localDateTime(new Date()),
  );
  const [milestoneNote, setMilestoneNote] = useState("");
  const [milestoneFile, setMilestoneFile] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [fileReference, setFileReference] = useState("");

  const prospect = useMemo(
    () =>
      business.records?.prospects.find(
        (row) => row.record.prospect.party.partyId === partyId,
      )?.record.prospect ?? null,
    [business.records?.prospects, partyId],
  );

  useEffect(() => {
    if (settings.data && settings.data.settings.enabled === null) {
      void navigate({ to: "/clients", replace: true });
    }
  }, [navigate, settings.data]);

  const record = recordQuery.record;
  const name =
    record?.displayName ?? prospect?.party.displayName ?? "Customer record";
  const location = prospect?.location?.trim() || "Location not set";
  const businessType =
    prospect?.vertical?.trim() || prospect?.industry?.trim() || "Business";
  const wa = record?.chats.whatsapp ?? null;
  const contactLine = [
    prospect?.contactName?.trim() || null,
    wa ? maskWhatsAppNumber(wa.waId) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const chatEmails = record ? emailAttachments(record) : [];
  const files = record ? fileAttachments(record) : [];
  const crumbs: TrailCrumb[] = [
    { label: "Business" },
    { label: "Clients", onClick: () => void goClients() },
    { label: name },
  ];

  async function applyAction(
    action: Parameters<typeof recordAction.mutateAsync>[0],
  ): Promise<boolean> {
    setActionError(null);
    try {
      await recordAction.mutateAsync(action);
      return true;
    } catch (error) {
      setActionError(errorText(error));
      return false;
    }
  }

  async function openChat() {
    const channelId = whatsappStatus.data?.outreachChannelId;
    if (!wa || !channelId) {
      setActionError(
        "WhatsApp chat is not available yet. Try again when the channel is ready.",
      );
      return;
    }
    await navigate({
      to: "/channels/$channelId",
      params: { channelId },
      search: { whatsappContactWaId: wa.waId },
    });
  }

  async function recordMilestone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record) return;
    const at = Math.floor(new Date(milestoneAt).getTime() / 1_000);
    const saved = await applyAction(
      customerActions.recordMilestone(record, {
        milestoneKind: milestoneKind,
        at,
        ...(milestoneKind === "other" ? { title: milestoneTitle.trim() } : {}),
        ...(milestoneNote.trim() ? { note: milestoneNote.trim() } : {}),
        ...(milestoneFile.trim() ? { fileRef: milestoneFile.trim() } : {}),
      }),
    );
    if (saved) {
      setMilestoneOpen(false);
      setMilestoneTitle("");
      setMilestoneNote("");
      setMilestoneFile("");
    }
  }

  async function attachFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record) return;
    const saved = await applyAction(
      customerActions.attachFile(record, {
        label: fileLabel.trim(),
        fileRef: fileReference.trim(),
      }),
    );
    if (saved) {
      setFileOpen(false);
      setFileLabel("");
      setFileReference("");
    }
  }

  if (settings.isError) {
    return (
      <ClientWorkspace title="Customer record">
        <div className="b3-state" role="alert">
          <p className="b3-state-body">
            Co-founder mode could not be verified.
          </p>
          <div className="b3-state-actions">
            <button
              className="b3-btn"
              onClick={() => void settings.refetch()}
              type="button"
            >
              Try again
            </button>
          </div>
        </div>
      </ClientWorkspace>
    );
  }
  if (settings.isPending || !settings.data) {
    return (
      <ClientWorkspace title="Customer record">
        <RecordMessage kind="loading">Loading company settings</RecordMessage>
      </ClientWorkspace>
    );
  }
  if (!settings.data.settings.enabled) return null;

  if (recordQuery.isPending) {
    return (
      <ClientWorkspace title={name}>
        <BusinessTrail crumbs={crumbs} />
        <RecordMessage kind="loading">Loading customer record</RecordMessage>
      </ClientWorkspace>
    );
  }
  if (recordQuery.isError) {
    return (
      <ClientWorkspace title={name}>
        <BusinessTrail crumbs={crumbs} />
        <div className="b3-state" role="alert">
          <p className="b3-state-body">
            Customer record could not be loaded. {errorText(recordQuery.error)}
          </p>
          <div className="b3-state-actions">
            <button
              className="b3-btn"
              onClick={() => void recordQuery.refetch()}
              type="button"
            >
              Try again
            </button>
          </div>
        </div>
      </ClientWorkspace>
    );
  }

  if (!record) {
    return (
      <ClientWorkspace title={name}>
        <BusinessTrail crumbs={crumbs} />
        <div className="b3-state" data-testid="customer-record-empty">
          <div className="b3-state-head">
            <span className="b3-state-icon" aria-hidden="true">
              <FileText size={18} />
            </span>
            <h2 className="b3-state-title">No customer record yet</h2>
          </div>
          <p className="b3-state-body">
            Create the record from the business history already held by this
            company.
          </p>
          {access.canWrite ? (
            <div className="b3-state-actions">
              <button
                className="b3-btn"
                disabled={recordAction.isPending}
                onClick={() =>
                  void applyAction(customerActions.create(partyId))
                }
                type="button"
              >
                Create record
              </button>
            </div>
          ) : null}
          {actionError ? (
            <div className="cf-customer-error-row" role="alert">
              <p>{actionError}</p>
              <button
                className="b3-btn b3-btn-compact"
                onClick={async () => {
                  await recordQuery.refetch();
                  setActionError(null);
                }}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </ClientWorkspace>
    );
  }

  const stageLabel = record.stage === "client" ? "Client" : "Lead";
  const projectLabel =
    record.project?.currentStepTitle ?? record.project?.title ?? null;

  return (
    <ClientWorkspace
      gap={24}
      header={
        <>
          <BusinessTrail crumbs={crumbs} />
          <div className="b3-detail-head cf-customer-head">
            <div className="cf-customer-title">
              <h1 className="b3-title">{name}</h1>
              <span className="b3-subtitle">
                {businessType} · {location}
              </span>
            </div>
            <div className="b3-head-actions cf-customer-head-actions">
              {record.stage === "lead" && access.canConvert ? (
                <button
                  className="b3-btn"
                  data-testid="customer-record-make-client"
                  disabled={recordAction.isPending}
                  onClick={() =>
                    void applyAction(customerActions.convertToClient(record))
                  }
                  type="button"
                >
                  Make client
                </button>
              ) : null}
              {wa ? (
                <button
                  className="b3-btn"
                  onClick={() => void openChat()}
                  type="button"
                >
                  Open chat
                </button>
              ) : null}
            </div>
          </div>
          <div className="cf-customer-status-row">
            <span className="b3-pill b3-pill-status" data-status={record.stage}>
              {record.stage === "client" ? (
                <Check aria-hidden="true" size={13} />
              ) : null}
              {stageLabel}
            </span>
            {projectLabel ? (
              <span className="b3-pill b3-pill-project">{projectLabel}</span>
            ) : null}
            {contactLine ? (
              <span className="cf-customer-contact">{contactLine}</span>
            ) : null}
          </div>
          {actionError ? (
            <div className="cf-customer-error-row" role="alert">
              <p>{actionError}</p>
              <button
                className="b3-btn b3-btn-compact"
                onClick={async () => {
                  await recordQuery.refetch();
                  setActionError(null);
                }}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : null}
          {access.canWrite ? (
            <div className="cf-customer-actions">
              <button
                aria-expanded={milestoneOpen}
                className="b3-btn b3-btn-compact"
                onClick={() => setMilestoneOpen((open) => !open)}
                type="button"
              >
                Record milestone
              </button>
              <button
                aria-expanded={fileOpen}
                className="b3-btn b3-btn-compact"
                onClick={() => setFileOpen((open) => !open)}
                type="button"
              >
                Attach file
              </button>
            </div>
          ) : null}
          {milestoneOpen && access.canWrite ? (
            <form
              className="cf-customer-form b3-card"
              onSubmit={(event) => void recordMilestone(event)}
            >
              <h2 className="b3-side-title">Record milestone</h2>
              <label>
                <span>Milestone</span>
                <select
                  onChange={(event) =>
                    setMilestoneKind(
                      event.currentTarget.value as typeof milestoneKind,
                    )
                  }
                  value={milestoneKind}
                >
                  <option value="call_booked">Call booked</option>
                  <option value="agreement_signed">Agreement signed</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {milestoneKind === "other" ? (
                <label>
                  <span>Title</span>
                  <input
                    onChange={(event) =>
                      setMilestoneTitle(event.currentTarget.value)
                    }
                    required
                    value={milestoneTitle}
                  />
                </label>
              ) : null}
              <label>
                <span>When it happened</span>
                <input
                  onChange={(event) =>
                    setMilestoneAt(event.currentTarget.value)
                  }
                  required
                  type="datetime-local"
                  value={milestoneAt}
                />
              </label>
              <label>
                <span>Note</span>
                <textarea
                  onChange={(event) =>
                    setMilestoneNote(event.currentTarget.value)
                  }
                  rows={2}
                  value={milestoneNote}
                />
              </label>
              <label>
                <span>File reference, optional</span>
                <input
                  onChange={(event) =>
                    setMilestoneFile(event.currentTarget.value)
                  }
                  value={milestoneFile}
                />
              </label>
              <div className="cf-customer-form-actions">
                <button
                  className="b3-btn"
                  disabled={
                    recordAction.isPending ||
                    (milestoneKind === "other" && !milestoneTitle.trim())
                  }
                  type="submit"
                >
                  Save milestone
                </button>
                <button
                  className="b3-btn"
                  onClick={() => setMilestoneOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {fileOpen && access.canWrite ? (
            <form
              className="cf-customer-form b3-card"
              onSubmit={(event) => void attachFile(event)}
            >
              <h2 className="b3-side-title">Attach file</h2>
              <label>
                <span>File name</span>
                <input
                  onChange={(event) => setFileLabel(event.currentTarget.value)}
                  required
                  value={fileLabel}
                />
              </label>
              <label>
                <span>Blossom file reference</span>
                <input
                  onChange={(event) =>
                    setFileReference(event.currentTarget.value)
                  }
                  required
                  value={fileReference}
                />
              </label>
              <div className="cf-customer-form-actions">
                <button
                  className="b3-btn"
                  disabled={
                    recordAction.isPending ||
                    !fileLabel.trim() ||
                    !fileReference.trim()
                  }
                  type="submit"
                >
                  Attach file
                </button>
                <button
                  className="b3-btn"
                  onClick={() => setFileOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </>
      }
      title={name}
    >
      <div
        className="b3-detail-body cf-customer-body"
        data-testid="customer-record-screen"
      >
        <section
          aria-labelledby="customer-timeline-title"
          className="b3-card b3-detail-main cf-customer-timeline-card"
        >
          <h2 className="b3-card-title" id="customer-timeline-title">
            From lead to client
          </h2>
          {record.timeline.length ? (
            <ol className="cf-customer-timeline">
              {record.timeline.map((entry, index) => {
                const Icon = TIMELINE_ICON[entry.kind];
                return (
                  <li
                    className="cf-customer-timeline-entry"
                    key={entry.entryId}
                  >
                    {index < record.timeline.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="cf-customer-timeline-line"
                      />
                    ) : null}
                    <span
                      aria-hidden="true"
                      className="cf-customer-timeline-icon"
                      data-kind={entry.kind}
                    >
                      <Icon size={18} strokeWidth={2.2} />
                    </span>
                    <span className="cf-customer-timeline-copy">
                      <span className="cf-customer-timeline-title">
                        {entry.title}
                      </span>
                      {entry.detail ? (
                        <span className="cf-customer-timeline-detail">
                          {entry.detail}
                        </span>
                      ) : null}
                    </span>
                    <time
                      className="cf-customer-timeline-date"
                      dateTime={new Date(entry.at * 1_000).toISOString()}
                    >
                      {dateLabel(entry.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="b3-fine">No milestones have been recorded yet.</p>
          )}
        </section>

        <aside
          aria-label="Customer details"
          className="b3-detail-side cf-customer-side"
        >
          <section
            aria-labelledby="customer-money-title"
            className="b3-card b3-side-card cf-customer-money-card"
          >
            <h2 className="b3-side-title" id="customer-money-title">
              Money
            </h2>
            <dl className="cf-customer-money-grid">
              <dt>Quote</dt>
              <dd>
                {moneyLabel(
                  record.money.quoteTotalMinor,
                  record.money.currency,
                )}
              </dd>
              <dt>
                Deposit paid
                {record.money.depositPaidAt !== null
                  ? ` · paid ${dateLabel(record.money.depositPaidAt)}`
                  : ""}
              </dt>
              <dd data-tone="success">
                {moneyLabel(
                  record.money.depositPaidMinor,
                  record.money.currency,
                )}
              </dd>
              <dt>Balance due</dt>
              <dd>
                {moneyLabel(
                  record.money.balanceDueMinor,
                  record.money.currency,
                )}
              </dd>
            </dl>
            {record.money.otherCurrencyFacts > 0 ? (
              <p className="cf-customer-other-currency">
                {record.money.otherCurrencyFacts} amount
                {record.money.otherCurrencyFacts === 1 ? "" : "s"} in another
                currency
              </p>
            ) : null}
          </section>

          <section
            aria-labelledby="customer-chats-title"
            className="b3-card b3-side-card cf-customer-side-list"
          >
            <h2 className="b3-side-title" id="customer-chats-title">
              Chats
            </h2>
            {wa ? (
              <div className="cf-customer-side-row">
                <span aria-hidden="true" className="cf-customer-side-icon">
                  <MessageCircle size={18} />
                </span>
                <span className="cf-customer-side-copy">
                  <strong>WhatsApp</strong>
                  <span>
                    {wa.messageCount} messages
                    {wa.lastMessageAt !== null
                      ? ` · last ${dateLabel(wa.lastMessageAt)}`
                      : ""}
                  </span>
                </span>
                <button
                  className="cf-customer-open-link"
                  onClick={() => void openChat()}
                  type="button"
                >
                  Open
                </button>
              </div>
            ) : (
              <p className="b3-fine">No WhatsApp chat is linked.</p>
            )}
            {record.chats.emailCount > 0 ? (
              <div className="cf-customer-email-summary">
                <span aria-hidden="true" className="cf-customer-side-icon">
                  <Mail size={18} />
                </span>
                <span className="cf-customer-side-copy">
                  <strong>Gmail, copied to this record</strong>
                  <span>
                    {record.chats.emailCount}{" "}
                    {record.chats.emailCount === 1 ? "email" : "emails"}
                    {chatEmails[0]?.label ? ` · ${chatEmails[0].label}` : ""}
                  </span>
                </span>
              </div>
            ) : null}
            {chatEmails.map((attachment) => (
              <details
                className="cf-customer-email-detail"
                key={attachment.attachmentId}
              >
                <summary>
                  {attachment.email?.subject ?? attachment.label}
                </summary>
                {attachment.email ? <p>{attachment.email.summary}</p> : null}
              </details>
            ))}
          </section>

          <section
            aria-labelledby="customer-files-title"
            className="b3-card b3-side-card cf-customer-side-list"
          >
            <div className="cf-customer-side-heading">
              <h2 className="b3-side-title" id="customer-files-title">
                Files
              </h2>
              {access.canWrite ? (
                <button
                  className="cf-customer-text-action"
                  onClick={() => setFileOpen((open) => !open)}
                  type="button"
                >
                  Attach
                </button>
              ) : null}
            </div>
            {files.length ? (
              files.map((attachment) => (
                <div
                  className="cf-customer-file-row"
                  key={attachment.attachmentId}
                >
                  <span aria-hidden="true" className="cf-customer-side-icon">
                    <FileText size={18} />
                  </span>
                  <span className="cf-customer-side-copy">
                    <strong>{attachment.label}</strong>
                    <span>
                      {attachment.fileRefs.length
                        ? "File"
                        : "No file reference"}
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <p className="b3-fine">No files attached yet.</p>
            )}
          </section>
        </aside>
      </div>
    </ClientWorkspace>
  );
}
