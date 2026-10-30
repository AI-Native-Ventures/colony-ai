import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { useBusinessRecords } from "@/features/discovery/useBusinessRecords";
import { useProfileQuery, useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import {
  KIND_WHATSAPP_BATCH_DECISION,
  KIND_WHATSAPP_SEND_REQUEST,
  KIND_WHATSAPP_SETTINGS,
} from "@/shared/constants/kinds";
import {
  getWhatsAppDailyCapProgress,
  maskWhatsAppNumber,
  type WhatsAppBatchDetail,
  type WhatsAppBatchRow,
  type WhatsAppContact,
  type WhatsAppTemplate,
} from "./whatsappOutreachModels";
import { WhatsAppPendingBatches } from "./WhatsAppPendingBatches";
import {
  formatWhatsAppDateTime,
  whatsappInitials,
  WhatsAppThreadMessage,
} from "./WhatsAppThreadMessage";
import {
  useWhatsAppCommand,
  useWhatsAppContactsQuery,
  useWhatsAppDraftsQuery,
  useWhatsAppPendingBatchDetailsQuery,
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
  useWhatsAppThreadQuery,
} from "./whatsappOutreachQueries";
import "./whatsappOutreach.css";

type ContactFilter = "all" | "replied" | "sent" | "opted-out";

type WhatsAppOutreachScreenProps = {
  channelId: string;
  initialThreadRootId: string | null;
  initialContactWaId?: string | null;
  mode?: "full" | "dock";
};

function contactStatus(
  contact: WhatsAppContact,
  waitingForApproval = false,
): string {
  if (contact.optedOut) return "Opted out";
  if (waitingForApproval || contact.awaitingApproval) {
    return "Waiting for your approval";
  }
  if (contact.unanswered) return "Replied";
  if (contact.lastInboundAt) return "Replied";
  return "Sent";
}

function normalizedPhone(value: string): string {
  return value.replace(/\D/gu, "");
}

type PendingBatchRow = Readonly<{
  batch: WhatsAppBatchDetail;
  row: WhatsAppBatchRow;
}>;

function pendingBatchRowsForContact(
  contact: WhatsAppContact,
  batches: readonly WhatsAppBatchDetail[],
): PendingBatchRow[] {
  const contactPhone = normalizedPhone(contact.e164 || contact.waId);
  return batches
    .filter((batch) => batch.status === "pending")
    .flatMap((batch) =>
      batch.rows
        .filter(
          (row) =>
            normalizedPhone(row.to) === contactPhone &&
            !["dropped", "skipped", "failed"].includes(
              row.state.toLocaleLowerCase(),
            ),
        )
        .map((row) => ({ batch, row })),
    );
}

function uniquePendingBatchRowForContact(
  contact: WhatsAppContact,
  batches: readonly WhatsAppBatchDetail[],
): PendingBatchRow | null {
  const rows = pendingBatchRowsForContact(contact, batches);
  return rows.length === 1 ? rows[0] : null;
}

function dayKey(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function messageDayLabel(value: string): string {
  const today = dayKey(new Date());
  const messageDay = dayKey(value);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (messageDay === today) return "Today";
  if (messageDay === dayKey(yesterdayDate)) return "Yesterday";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function windowTimeRemaining(value: string | null): string {
  if (!value) return "";
  const minutes = Math.max(
    0,
    Math.ceil((Date.parse(value) - Date.now()) / 60_000),
  );
  if (minutes >= 60) return `${Math.ceil(minutes / 60)}h left`;
  return `${Math.max(1, minutes)}m left`;
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "c3wa-contact-chip",
        status === "Opted out" && "is-opted",
        status === "Replied" && "is-replied",
        status === "Waiting for your approval" && "is-awaiting",
      )}
    >
      {status}
    </span>
  );
}

function ContactRow({
  contact,
  businessName,
  hasDraft,
  preview,
  waitingForApproval,
  canReviewBatch,
  selected,
  onSelect,
  onReviewBatch,
}: {
  contact: WhatsAppContact;
  businessName: string;
  hasDraft: boolean;
  preview: string | null;
  waitingForApproval: boolean;
  canReviewBatch: boolean;
  selected: boolean;
  onSelect: () => void;
  onReviewBatch: () => void;
}) {
  const name = businessName;
  const status = contactStatus(contact, waitingForApproval);
  return (
    <div className={cn("c3wa-contact-row", selected && "is-selected")}>
      <button
        aria-current={selected ? "true" : undefined}
        className="c3wa-contact-select"
        data-testid={`whatsapp-contact-${contact.waId}`}
        onClick={onSelect}
        type="button"
      >
        <span aria-hidden="true" className="c3wa-contact-avatar">
          {whatsappInitials(name)}
        </span>
        <span className="c3wa-contact-main">
          <span className="c3wa-contact-title">
            <strong>{name}</strong>
            <time>
              {contact.lastInboundAt
                ? formatWhatsAppDateTime(contact.lastInboundAt)
                : ""}
            </time>
          </span>
          <span className="c3wa-contact-subtitle">
            <StatusChip status={status} />
            {hasDraft ? (
              <span className="c3wa-draft-waiting">Draft waiting</span>
            ) : null}
            {contact.unanswered && !selected ? (
              <span
                aria-label="Unread reply"
                className="c3wa-unread-dot"
                role="img"
              />
            ) : null}
            <span>{maskWhatsAppNumber(contact.e164)}</span>
          </span>
          {preview ? (
            <span className="c3wa-contact-preview">{preview}</span>
          ) : null}
        </span>
      </button>
      {waitingForApproval ? (
        <button
          aria-label={`Review batch for ${name}`}
          className="c3wa-contact-review"
          disabled={!canReviewBatch}
          onClick={onReviewBatch}
          type="button"
        >
          Review
        </button>
      ) : null}
    </div>
  );
}

function TemplatePicker({
  onClose,
  onSelect,
  templates,
}: {
  onClose: () => void;
  onSelect: (template: WhatsAppTemplate) => void;
  templates: readonly WhatsAppTemplate[];
}) {
  const approved = templates.filter(
    (template) => template.status.toLocaleUpperCase() === "APPROVED",
  );
  return (
    <div
      aria-labelledby="wa-template-picker-title"
      aria-modal="true"
      className="c3wa-template-picker"
      role="dialog"
    >
      <div className="c3wa-template-picker-head">
        <strong id="wa-template-picker-title">Choose a template</strong>
        <button
          aria-label="Close template picker"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="c3wa-template-picker-list">
        {approved.map((template) => (
          <button
            key={`${template.name}:${template.language}`}
            onClick={() => onSelect(template)}
            type="button"
          >
            <strong>{template.title}</strong>
            <span>{template.category.toLocaleLowerCase()}</span>
          </button>
        ))}
        {approved.length === 0 ? (
          <p>No approved templates are available.</p>
        ) : null}
      </div>
    </div>
  );
}

export function WhatsAppOutreachScreen({
  channelId,
  initialThreadRootId,
  initialContactWaId = null,
  mode = "full",
}: WhatsAppOutreachScreenProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const statusQuery = useWhatsAppStatusQuery();
  const contactsQuery = useWhatsAppContactsQuery();
  const businessData = useBusinessRecords({ createIfMissing: false });
  const templatesQuery = useWhatsAppTemplatesQuery(
    statusQuery.data?.connected === true,
  );
  const draftsQuery = useWhatsAppDraftsQuery();
  const pendingBatchesQuery = useWhatsAppPendingBatchDetailsQuery(
    statusQuery.data?.connected === true,
  );
  const identityQuery = useIdentityQuery();
  const profileQuery = useProfileQuery();
  const membershipQuery = useMyRelayMembershipLookupQuery();
  const command = useWhatsAppCommand();
  const [selectedWaId, setSelectedWaId] = React.useState<string | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<ContactFilter>("all");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [showContactList, setShowContactList] = React.useState(false);
  const [messageText, setMessageText] = React.useState("");
  const [selectedTemplate, setSelectedTemplate] =
    React.useState<WhatsAppTemplate | null>(null);
  const [templateParams, setTemplateParams] = React.useState<string[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = React.useState(false);
  const [threadMenuOpen, setThreadMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const messageListRef = React.useRef<HTMLDivElement>(null);
  const threadMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const lastContactRequestRef = React.useRef<string | null>(null);

  const contacts = contactsQuery.data ?? [];
  const leadIdentities = React.useMemo(
    () =>
      new Map(
        (businessData.records?.prospects ?? []).map(
          ({ record }) =>
            [
              record.prospectId,
              {
                businessName: record.prospect.party.displayName,
                personName: record.prospect.contactName,
                location: record.prospect.location,
              },
            ] as const,
        ),
      ),
    [businessData.records?.prospects],
  );
  const identityForContact = (contact: WhatsAppContact) => {
    const linkedLead = contact.leadId
      ? leadIdentities.get(contact.leadId)
      : undefined;
    return {
      businessName:
        linkedLead?.businessName ?? contact.displayName ?? "WhatsApp contact",
      personName:
        linkedLead?.personName ?? contact.displayName ?? "WhatsApp contact",
      location: linkedLead?.location ?? null,
    };
  };
  const templates = templatesQuery.data ?? statusQuery.data?.templates ?? [];
  const currentPubkey = identityQuery.data?.pubkey;
  const role = membershipQuery.data?.membership?.role;
  const canManage =
    membershipQuery.data?.membershipRequired === false ||
    role === "owner" ||
    role === "admin";
  const status = statusQuery.data;
  const progress = status
    ? getWhatsAppDailyCapProgress(
        status.newChatsSentToday,
        status.dailyNewChatCap,
      )
    : null;

  React.useEffect(() => {
    if (
      !initialContactWaId ||
      initialContactWaId === lastContactRequestRef.current
    ) {
      return;
    }
    lastContactRequestRef.current = initialContactWaId;
    setSelectedWaId(initialContactWaId);
  }, [initialContactWaId]);

  React.useEffect(() => {
    if (!contacts.length) return;
    if (initialThreadRootId) {
      const matched = contacts.find(
        (contact) => contact.threadRootEventId === initialThreadRootId,
      );
      if (matched) setSelectedWaId(matched.waId);
    } else if (
      !selectedWaId ||
      !contacts.some((contact) => contact.waId === selectedWaId)
    ) {
      setSelectedWaId(
        contacts.some((contact) => contact.waId === initialContactWaId)
          ? initialContactWaId
          : contacts[0].waId,
      );
    }
  }, [contacts, initialContactWaId, initialThreadRootId, selectedWaId]);

  const selectedContact =
    contacts.find((contact) => contact.waId === selectedWaId) ?? null;
  const threadQuery = useWhatsAppThreadQuery(selectedContact?.waId ?? null);
  const thread = threadQuery.data;
  const pendingBatches = pendingBatchesQuery.data ?? [];
  const selectedPendingBatchRows = selectedContact
    ? pendingBatchRowsForContact(selectedContact, pendingBatches)
    : [];
  const selectedPendingBatchRow = selectedContact
    ? uniquePendingBatchRowForContact(selectedContact, pendingBatches)
    : null;
  const selectedContactWithThreadIdentity = selectedContact
    ? {
        ...selectedContact,
        displayName:
          selectedContact.displayName ?? thread?.contact.displayName ?? null,
        leadId:
          selectedContact.leadId ??
          thread?.contact.leadId ??
          selectedPendingBatchRow?.row.leadId ??
          null,
      }
    : null;
  const selectedIdentity = selectedContactWithThreadIdentity
    ? identityForContact(selectedContactWithThreadIdentity)
    : null;
  const pendingDrafts = draftsQuery.data ?? [];
  const filteredContacts = contacts.filter((contact) => {
    const visibleContact =
      contact.waId === selectedContactWithThreadIdentity?.waId
        ? selectedContactWithThreadIdentity
        : contact;
    const waitingForApproval =
      pendingBatchRowsForContact(visibleContact, pendingBatches).length > 0;
    const visibleStatus = contactStatus(visibleContact, waitingForApproval);
    const matchesFilter =
      activeFilter === "replied"
        ? visibleStatus === "Replied"
        : activeFilter === "sent"
          ? visibleStatus === "Sent"
          : activeFilter === "opted-out"
            ? visibleStatus === "Opted out"
            : true;
    const search = searchTerm.trim().toLocaleLowerCase();
    const matchesSearch =
      !search ||
      `${identityForContact(contact).businessName} ${contact.e164}`
        .toLocaleLowerCase()
        .includes(search);
    return matchesFilter && matchesSearch;
  });
  const selectedDraft =
    pendingDrafts.find((draft) => draft.waId === selectedContact?.waId) ?? null;
  const hasPendingDraft = Boolean(
    selectedDraft ||
      thread?.messages.some((message) => message.state === "draft"),
  );
  const chronologicalMessages = React.useMemo(
    () =>
      [...(thread?.messages ?? [])].sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt),
      ),
    [thread?.messages],
  );
  const selectedPendingBatch = selectedPendingBatchRow?.batch ?? null;
  const selectedHeldPreview = selectedPendingBatchRow?.row.preview ?? null;
  const selectedAwaitingApproval = selectedPendingBatchRows.length > 0;
  const agentPubkeys = [
    ...new Set(
      chronologicalMessages
        .map((message) => message.senderPubkey)
        .filter((pubkey): pubkey is string =>
          Boolean(pubkey && pubkey !== currentPubkey),
        ),
    ),
  ];
  const agentProfilesQuery = useUsersBatchQuery(agentPubkeys, {
    enabled: agentPubkeys.length > 0,
  });
  const currentUserName = profileQuery.data?.displayName?.trim() || "You";
  const openerTitle = chronologicalMessages.find(
    (message) => message.templateName,
  )?.templateName;
  const openerLabel = templates.find(
    (template) => template.name === openerTitle,
  )?.title;

  React.useLayoutEffect(() => {
    if (!selectedWaId && !chronologicalMessages.length && !hasPendingDraft)
      return;
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [selectedWaId, chronologicalMessages.length, hasPendingDraft]);

  function selectContact(contact: WhatsAppContact) {
    setSelectedWaId(contact.waId);
    setShowContactList(false);
    setMessageText("");
    setSelectedTemplate(null);
    setActionError("");
  }

  function closeThreadMenuOnEscape(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== "Escape") return;
    setThreadMenuOpen(false);
    threadMenuButtonRef.current?.focus();
    event.stopPropagation();
  }

  async function approveDraft(draftId: string, text?: string) {
    setActionError("");
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        draftId,
        decision: "approve",
        ...(text ? { text } : {}),
      });
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not approve this draft.",
      );
    }
  }

  async function rejectDraft(draftId: string) {
    setActionError("");
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        draftId,
        decision: "reject",
      });
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not discard this draft.",
      );
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedContact ||
      !status ||
      busy ||
      selectedContact.optedOut ||
      selectedContact.paused ||
      (hasPendingDraft && !canManage)
    )
      return;
    const trimmed = messageText.trim();
    if (
      (!selectedContact.windowOpen && !selectedTemplate) ||
      (!trimmed && !selectedTemplate)
    )
      return;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setActionError("");
    try {
      await command(KIND_WHATSAPP_SEND_REQUEST, {
        v: 1,
        requestId,
        to: selectedContact.e164,
        ...(selectedTemplate
          ? {
              template: {
                name: selectedTemplate.name,
                language: selectedTemplate.language,
                params: templateParams,
              },
            }
          : { text: trimmed }),
      });
      setMessageText("");
      setSelectedTemplate(null);
      setTemplateParams([]);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "WhatsApp could not send this message.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    if (!status || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await command(KIND_WHATSAPP_SETTINGS, {
        v: 1,
        sendingPaused: !status.sendingPaused,
      });
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not change sending pause.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openLead() {
    const leadId = selectedContactWithThreadIdentity?.leadId;
    if (!leadId) return;
    void navigate({
      to: "/sales/lead/$prospectId",
      params: { prospectId: leadId },
    });
  }

  function reviewBatch(batch: WhatsAppBatchDetail | null) {
    if (!batch) return;
    void navigate({
      to: "/whatsapp/batches/$batchId",
      params: { batchId: batch.batchId },
    });
  }

  async function approveBatch(batchId: string) {
    if (!canManage || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        batchId,
        decision: "approve",
        dropRows: [],
        editRows: [],
      });
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not approve this WhatsApp batch.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    void navigate({ to: "/settings", search: { section: "whatsapp" } });
  }

  function chooseTemplate(template: WhatsAppTemplate) {
    setSelectedTemplate(template);
    setTemplateParams(
      Array.from({ length: template.slots }, (_, index) =>
        index === 0
          ? selectedContact
            ? identityForContact(selectedContact).personName
            : ""
          : "",
      ),
    );
    setTemplatePickerOpen(false);
  }

  if (
    statusQuery.isPending ||
    contactsQuery.isPending ||
    (status?.connected && pendingBatchesQuery.isPending)
  ) {
    return (
      <div aria-busy="true" className="c3wa-loading c3wa-outreach-loading">
        Loading WhatsApp conversations…
      </div>
    );
  }

  if (
    statusQuery.isError ||
    contactsQuery.isError ||
    (status?.connected && pendingBatchesQuery.isError)
  ) {
    const error =
      statusQuery.error ?? contactsQuery.error ?? pendingBatchesQuery.error;
    return (
      <main className="c3wa-root c3wa-outreach-error" role="alert">
        {error?.message ?? "WhatsApp conversations could not be loaded."}
      </main>
    );
  }

  if (!status?.connected) {
    return (
      <main className="c3wa-root c3wa-outreach-empty">
        <h1>WhatsApp is not connected</h1>
        <p>Connect your Horizon Labs number in Settings to open Outreach.</p>
        <Button onClick={openSettings} type="button">
          Open WhatsApp settings
        </Button>
      </main>
    );
  }

  return (
    <main
      className="c3wa-root c3wa-outreach"
      data-testid="whatsapp-outreach"
      data-channel-id={channelId}
    >
      <aside
        className={cn(
          "c3wa-contact-panel",
          showContactList && "is-mobile-visible",
        )}
        aria-label="WhatsApp contacts"
      >
        <header className="c3wa-contact-panel-head">
          <WhatsAppPendingBatches
            canManage={canManage}
            placement="outreach"
            templates={templates}
          />
          <div className="c3wa-outreach-title-row">
            <div>
              <h1>{mode === "dock" ? "Chats" : "Outreach"}</h1>
              <span>WhatsApp · {status.displayPhoneNumber}</span>
            </div>
            <button
              aria-label="WhatsApp settings"
              className="c3wa-icon-button"
              onClick={openSettings}
              type="button"
            >
              ⚙
            </button>
          </div>
          <input
            aria-label="Search chats"
            className="c3wa-contact-search"
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            placeholder="Search chats"
            type="search"
            value={searchTerm}
          />
          <div
            aria-label="Filter contacts"
            className="c3wa-contact-filters"
            role="tablist"
          >
            {(["all", "replied", "sent", "opted-out"] as const).map(
              (filter) => (
                <button
                  aria-selected={activeFilter === filter}
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  role="tab"
                  type="button"
                >
                  {filter === "opted-out"
                    ? "Opted out"
                    : filter[0].toUpperCase() + filter.slice(1)}
                </button>
              ),
            )}
          </div>
        </header>
        <div className="c3wa-contact-list">
          {filteredContacts.map((contact) => {
            const isSelected = contact.waId === selectedContact?.waId;
            const listedContact =
              isSelected && selectedContactWithThreadIdentity
                ? selectedContactWithThreadIdentity
                : contact;
            const rowMatches = pendingBatchRowsForContact(
              listedContact,
              pendingBatches,
            );
            const rowBatch = rowMatches.length === 1 ? rowMatches[0] : null;
            const rowContact = {
              ...listedContact,
              leadId: listedContact.leadId ?? rowBatch?.row.leadId ?? null,
            };
            return (
              <ContactRow
                businessName={identityForContact(rowContact).businessName}
                canReviewBatch={Boolean(rowBatch)}
                contact={rowContact}
                hasDraft={pendingDrafts.some(
                  (draft) => draft.waId === contact.waId,
                )}
                key={contact.waId}
                onReviewBatch={() => reviewBatch(rowBatch?.batch ?? null)}
                onSelect={() => selectContact(contact)}
                preview={rowBatch?.row.preview ?? null}
                selected={isSelected}
                waitingForApproval={rowMatches.length > 0}
              />
            );
          })}
          {filteredContacts.length === 0 ? (
            <p className="c3wa-contact-empty">No contacts match this filter.</p>
          ) : null}
        </div>
      </aside>

      {selectedContact ? (
        <section
          className={cn(
            "c3wa-thread-panel",
            showContactList && "is-mobile-hidden",
          )}
          aria-label={`Conversation with ${selectedIdentity?.businessName ?? "WhatsApp contact"}`}
        >
          <div aria-hidden="true" className="c3wa-mobile-safe-area" />
          <header className="c3wa-thread-head">
            <button
              aria-label="Back to WhatsApp contacts"
              className="c3wa-mobile-back"
              onClick={() => setShowContactList(true)}
              type="button"
            >
              ‹
            </button>
            <span aria-hidden="true" className="c3wa-thread-avatar">
              {whatsappInitials(selectedIdentity?.businessName ?? "WhatsApp")}
            </span>
            <div className="c3wa-thread-head-copy">
              <strong>
                {selectedIdentity?.businessName ?? "WhatsApp contact"}
              </strong>
              <span className="c3wa-thread-head-desktop">
                {selectedIdentity?.personName ?? "Contact"} ·{" "}
                {maskWhatsAppNumber(selectedContact.e164)}
                {selectedIdentity?.location
                  ? ` · ${selectedIdentity.location.split(",")[0].trim()}`
                  : ""}
              </span>
              <span className="c3wa-thread-head-mobile">
                WhatsApp ·
                {contactStatus(
                  selectedContactWithThreadIdentity ?? selectedContact,
                  selectedAwaitingApproval,
                )}
              </span>
            </div>
            {selectedContactWithThreadIdentity?.leadId ? (
              <Button
                className="c3wa-open-lead"
                onClick={openLead}
                size="sm"
                type="button"
                variant="outline"
              >
                Open lead
              </Button>
            ) : null}
            <div className="c3wa-thread-menu">
              <button
                aria-controls="c3wa-thread-menu-panel"
                aria-expanded={threadMenuOpen}
                aria-label="WhatsApp conversation actions"
                onClick={() => setThreadMenuOpen((open) => !open)}
                onKeyDown={closeThreadMenuOnEscape}
                ref={threadMenuButtonRef}
                type="button"
              >
                ⋮
              </button>
              {threadMenuOpen ? (
                <div
                  className="c3wa-thread-menu-content"
                  id="c3wa-thread-menu-panel"
                >
                  <button
                    aria-checked={status.sendingPaused}
                    aria-label="Pause all WhatsApp sending"
                    disabled={!canManage || busy}
                    onClick={() => void togglePause()}
                    onKeyDown={closeThreadMenuOnEscape}
                    role="switch"
                    type="button"
                  >
                    {status.sendingPaused
                      ? "Resume all WhatsApp sending"
                      : "Pause all WhatsApp sending"}
                  </button>
                </div>
              ) : null}
            </div>
          </header>

          {selectedContact.optedOut ? (
            <div className="c3wa-contact-lock" role="status">
              <strong>This contact opted out.</strong>
              <span>No WhatsApp messages can be sent to this number.</span>
            </div>
          ) : selectedContact.paused ? (
            <div className="c3wa-contact-lock" role="status">
              <strong>This contact is paused.</strong>
              <span>
                {selectedContact.pauseReason ??
                  "Sending is paused for this contact."}
              </span>
            </div>
          ) : null}

          {(selectedContactWithThreadIdentity?.leadId ??
          selectedContact.leadId) ? (
            <div className="c3wa-lead-context c3wa-mobile-lead-context">
              <span aria-hidden="true" className="c3wa-context-check">
                ✓
              </span>
              <span>
                <strong>
                  Lead ·{" "}
                  {contactStatus(
                    selectedContactWithThreadIdentity ?? selectedContact,
                    selectedAwaitingApproval,
                  ) === "Replied"
                    ? "In conversation"
                    : contactStatus(
                        selectedContactWithThreadIdentity ?? selectedContact,
                        selectedAwaitingApproval,
                      )}
                </strong>
                <small>
                  {openerLabel ? `Opener: ${openerLabel}` : "Horizon Labs lead"}
                </small>
              </span>
              <button onClick={openLead} type="button">
                Open lead
              </button>
            </div>
          ) : null}

          <div
            className="c3wa-message-list"
            data-testid="whatsapp-thread-messages"
            ref={messageListRef}
          >
            {threadQuery.isPending ? (
              <p className="c3wa-thread-loading">Loading messages…</p>
            ) : null}
            {threadQuery.isError ? (
              <div className="c3wa-alert" role="alert">
                {threadQuery.error.message}
              </div>
            ) : null}
            {chronologicalMessages.map((message, index) => {
              const previousMessage = chronologicalMessages[index - 1];
              const startsDay =
                !previousMessage ||
                dayKey(previousMessage.createdAt) !== dayKey(message.createdAt);
              return (
                <React.Fragment key={message.id}>
                  {startsDay ? (
                    <div
                      className={cn(
                        "c3wa-thread-day-divider",
                        "is-mobile-history",
                      )}
                    >
                      <span>{messageDayLabel(message.createdAt)}</span>
                    </div>
                  ) : null}
                  <WhatsAppThreadMessage
                    agentName={
                      agentProfilesQuery.data?.profiles[
                        message.senderPubkey?.toLowerCase() ?? ""
                      ]?.displayName?.trim() || "Agent"
                    }
                    contactName={
                      selectedIdentity?.personName ?? "WhatsApp contact"
                    }
                    currentPubkey={currentPubkey}
                    currentUserName={currentUserName}
                    message={message}
                    mobileHistory={index < chronologicalMessages.length - 3}
                    onApproveDraft={approveDraft}
                    onRejectDraft={rejectDraft}
                    templates={templates}
                    waitingForApproval={
                      message.direction === "out" &&
                      message.state === "queued" &&
                      selectedPendingBatchRows.some(
                        ({ row }) => row.preview === message.text,
                      )
                    }
                  />
                </React.Fragment>
              );
            })}
            {selectedAwaitingApproval ? (
              <article
                aria-label="WhatsApp batch waiting for approval"
                className="c3wa-held-batch-card"
                data-testid="whatsapp-thread-held-batch"
              >
                <div>
                  <strong>Waiting for your approval</strong>
                  <p>{selectedHeldPreview ?? "Loading message preview…"}</p>
                </div>
                <div className="c3wa-held-batch-actions">
                  <Button
                    disabled={
                      busy || !canManage || selectedPendingBatch === null
                    }
                    onClick={() => {
                      if (selectedPendingBatch) {
                        void approveBatch(selectedPendingBatch.batchId);
                      }
                    }}
                    size="sm"
                    type="button"
                  >
                    Approve batch
                  </Button>
                  <Button
                    disabled={selectedPendingBatch === null}
                    onClick={() => reviewBatch(selectedPendingBatch)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Review
                  </Button>
                  {!canManage ? (
                    <span>
                      Only the owner or an admin can approve this batch.
                    </span>
                  ) : null}
                  {pendingBatchesQuery.isPending ? (
                    <span>Finding the pending batch…</span>
                  ) : null}
                  {pendingBatchesQuery.isError ? (
                    <span role="alert">
                      {pendingBatchesQuery.error.message}
                    </span>
                  ) : null}
                  {!pendingBatchesQuery.isPending &&
                  !pendingBatchesQuery.isError &&
                  !selectedPendingBatch ? (
                    <span>The pending batch is not available.</span>
                  ) : null}
                </div>
              </article>
            ) : null}
            {thread &&
            thread.messages.length === 0 &&
            !selectedAwaitingApproval ? (
              <p className="c3wa-thread-empty">No messages yet.</p>
            ) : null}
          </div>

          <div className="c3wa-composer-area">
            {actionError ? (
              <p className="c3wa-action-error" role="alert">
                {actionError}
              </p>
            ) : null}
            {selectedContact.windowOpen ? (
              <div className="c3wa-window-status is-open" role="status">
                <span aria-hidden="true">◷</span>Reply window open
                {selectedContact.windowClosesAt
                  ? `, ${windowTimeRemaining(selectedContact.windowClosesAt)}`
                  : ""}
              </div>
            ) : !selectedContact.optedOut ? (
              <div className="c3wa-window-status is-closed" role="status">
                <span aria-hidden="true">◷</span>Reply window closed. Choose an
                approved template to send a new message.
              </div>
            ) : null}
            {selectedTemplate ? (
              <div className="c3wa-selected-template">
                <div>
                  <span>Template</span>
                  <strong>{selectedTemplate.title}</strong>
                </div>
                <button
                  aria-label="Remove selected template"
                  onClick={() => {
                    setSelectedTemplate(null);
                    setTemplateParams([]);
                  }}
                  type="button"
                >
                  ×
                </button>
                {selectedTemplate.slots ? (
                  <div className="c3wa-template-params">
                    {templateParams
                      .map((param, index) => ({
                        key: `${selectedTemplate.name}:variable:${index + 1}`,
                        index,
                        param,
                      }))
                      .map(({ key, index, param }) => (
                        <label key={key}>
                          <span>Variable {index + 1}</span>
                          <input
                            aria-label={`Template variable ${index + 1}`}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setTemplateParams((current) =>
                                current.map((item, valueIndex) =>
                                  valueIndex === index ? value : item,
                                ),
                              );
                            }}
                            value={param}
                          />
                        </label>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {templatePickerOpen ? (
              <TemplatePicker
                onClose={() => setTemplatePickerOpen(false)}
                onSelect={chooseTemplate}
                templates={templates}
              />
            ) : null}
            <form
              className="c3wa-composer"
              onSubmit={(event) => void sendMessage(event)}
            >
              <label className="c3wa-sr-only" htmlFor="wa-reply">
                Reply on WhatsApp to{" "}
                {selectedIdentity?.businessName ?? "contact"}
              </label>
              <textarea
                data-testid="whatsapp-reply-input"
                disabled={
                  !selectedContact.windowOpen ||
                  selectedContact.optedOut ||
                  selectedContact.paused ||
                  (hasPendingDraft && !canManage) ||
                  busy ||
                  Boolean(selectedTemplate)
                }
                id="wa-reply"
                onChange={(event) => setMessageText(event.currentTarget.value)}
                placeholder={
                  selectedContact.optedOut
                    ? "This contact opted out"
                    : selectedContact.windowOpen
                      ? isMobile
                        ? "Reply on WhatsApp…"
                        : "Reply on WhatsApp as Horizon Labs"
                      : "Choose a template to send a message"
                }
                rows={2}
                value={messageText}
              />
              <div className="c3wa-composer-toolbar">
                <Button
                  aria-label="Use a template"
                  className="c3wa-mobile-template-action"
                  disabled={
                    selectedContact.optedOut ||
                    selectedContact.paused ||
                    (hasPendingDraft && !canManage) ||
                    busy
                  }
                  onClick={() => setTemplatePickerOpen((open) => !open)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <span
                    aria-hidden="true"
                    className="c3wa-mobile-composer-icon"
                  >
                    +
                  </span>
                  <span className="c3wa-sr-only">Use a template</span>
                </Button>
                <span className="c3wa-composer-spacer" />
                <Button
                  aria-label={
                    busy ? "Sending" : canManage ? "Send" : "Request approval"
                  }
                  className="c3wa-mobile-send-action"
                  disabled={
                    selectedContact.optedOut ||
                    selectedContact.paused ||
                    (hasPendingDraft && !canManage) ||
                    busy ||
                    (!messageText.trim() && !selectedTemplate) ||
                    (!selectedContact.windowOpen && !selectedTemplate)
                  }
                  data-testid="whatsapp-send-message"
                  size="sm"
                  type="submit"
                >
                  <span
                    aria-hidden="true"
                    className="c3wa-mobile-composer-icon"
                  >
                    ↑
                  </span>
                  <span className="c3wa-sr-only">
                    {busy ? "Sending" : canManage ? "Send" : "Request approval"}
                  </span>
                </Button>
              </div>
            </form>
            {selectedContact.windowOpen && progress ? (
              <p className="c3wa-cap-note">
                {progress.sent} of {progress.cap} new chats used today. Replies
                do not count toward the cap.
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section
          className={cn(
            "c3wa-thread-panel c3wa-no-contact",
            showContactList && "is-mobile-hidden",
          )}
          aria-label="WhatsApp conversation"
        >
          <p>Select a contact to open the conversation.</p>
        </section>
      )}
    </main>
  );
}
