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
  whatsappDeliveryLabel,
  type WhatsAppContact,
  type WhatsAppMessage,
  type WhatsAppTemplate,
} from "./whatsappOutreachModels";
import {
  useWhatsAppCommand,
  useWhatsAppContactsQuery,
  useWhatsAppDraftsQuery,
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
  useWhatsAppThreadQuery,
} from "./whatsappOutreachQueries";
import "./whatsappOutreach.css";

type ContactFilter = "all" | "replied" | "sent" | "opted-out";

type WhatsAppOutreachScreenProps = {
  channelId: string;
  initialThreadRootId: string | null;
};

function contactStatus(contact: WhatsAppContact): string {
  if (contact.optedOut) return "Opted out";
  if (contact.unanswered) return "Replied";
  if (contact.lastInboundAt) return "Replied";
  return "Sent";
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(date);
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

function isAgentAuthored(
  message: WhatsAppMessage,
  currentPubkey: string | undefined,
) {
  return Boolean(
    message.senderPubkey && message.senderPubkey !== currentPubkey,
  );
}

function deliveryGlyph(state: WhatsAppMessage["state"]): string {
  if (state === "read" || state === "delivered") return "✓✓";
  if (state === "sent") return "✓";
  if (state === "queued" || state === "sending") return "◷";
  if (state === "failed" || state === "unconfirmed") return "!";
  return "";
}

function StatusChip({ contact }: { contact: WhatsAppContact }) {
  const status = contactStatus(contact);
  return (
    <span
      className={cn(
        "c3wa-contact-chip",
        status === "Opted out" && "is-opted",
        status === "Replied" && "is-replied",
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
  selected,
  onSelect,
}: {
  contact: WhatsAppContact;
  businessName: string;
  hasDraft: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = businessName;
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn("c3wa-contact-row", selected && "is-selected")}
      data-testid={`whatsapp-contact-${contact.waId}`}
      onClick={onSelect}
      type="button"
    >
      <span aria-hidden="true" className="c3wa-contact-avatar">
        {initials(name)}
      </span>
      <span className="c3wa-contact-main">
        <span className="c3wa-contact-title">
          <strong>{name}</strong>
          <time>
            {contact.lastInboundAt ? dateTime(contact.lastInboundAt) : ""}
          </time>
        </span>
        <span className="c3wa-contact-subtitle">
          <StatusChip contact={contact} />
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
      </span>
    </button>
  );
}

function ApprovalDraft({
  agentName,
  agentWritten,
  message,
  createdAt,
  onApprove,
  onReject,
}: {
  agentName: string;
  agentWritten: boolean;
  message: WhatsAppMessage;
  createdAt: string;
  onApprove: (text?: string) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(message.text);
  const [busy, setBusy] = React.useState(false);

  async function approve(value?: string) {
    setBusy(true);
    try {
      await onApprove(value);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await onReject();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="c3wa-message-row is-outbound is-draft"
      data-testid={`whatsapp-draft-${message.id}`}
    >
      <span aria-hidden="true" className="c3wa-message-avatar is-sender">
        {initials(agentName)}
      </span>
      <div className="c3wa-message-content">
        <div className="c3wa-message-author">
          <strong>{agentName}</strong>
          <span className="c3wa-agent-badge">AI</span>
          <time>{dateTime(createdAt)}</time>
        </div>
        <div className="c3wa-draft-card">
          <span className="c3wa-draft-pill">
            Draft by {agentWritten ? agentName : "Scout"}, needs your OK
          </span>
          {editing ? (
            <label
              className="c3wa-sr-only"
              htmlFor={`wa-draft-edit-${message.id}`}
            >
              Edit WhatsApp message draft
            </label>
          ) : null}
          {editing ? (
            <textarea
              data-testid="whatsapp-draft-edit"
              id={`wa-draft-edit-${message.id}`}
              onChange={(event) => setText(event.currentTarget.value)}
              rows={4}
              value={text}
            />
          ) : (
            <p>{message.text}</p>
          )}
          <div className="c3wa-draft-actions">
            {editing ? (
              <>
                <Button
                  disabled={busy || !text.trim()}
                  onClick={() => void approve(text.trim())}
                  size="sm"
                  type="button"
                >
                  Save and send
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setText(message.text);
                    setEditing(false);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void approve()}
                  size="sm"
                  type="button"
                >
                  Send
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setEditing(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Edit
                </Button>
                <Button
                  className="c3wa-text-danger"
                  disabled={busy}
                  onClick={() => void reject()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Discard
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ThreadMessage({
  currentPubkey,
  currentUserName,
  agentName,
  message,
  templates,
  contactName,
  mobileHistory,
  onApproveDraft,
  onRejectDraft,
}: {
  currentPubkey: string | undefined;
  currentUserName: string;
  agentName: string;
  message: WhatsAppMessage;
  templates: readonly WhatsAppTemplate[];
  contactName: string;
  mobileHistory: boolean;
  onApproveDraft: (draftId: string, text?: string) => Promise<void>;
  onRejectDraft: (draftId: string) => Promise<void>;
}) {
  const agentWritten = isAgentAuthored(message, currentPubkey);
  if (message.state === "draft") {
    return (
      <ApprovalDraft
        agentName={agentName}
        agentWritten={agentWritten}
        createdAt={message.createdAt}
        message={message}
        onApprove={(text) => onApproveDraft(message.id, text)}
        onReject={() => onRejectDraft(message.id)}
      />
    );
  }
  const inbound = message.direction === "in";
  const statusLabel = whatsappDeliveryLabel(message.state, message.errorText);
  const template =
    templates.find((item) => item.name === message.templateName) ?? null;
  const mediaParts =
    message.kind === "media" ? message.text.split(/\s*·\s*/u) : [];
  return (
    <article
      className={cn(
        "c3wa-message-row",
        inbound ? "is-inbound" : "is-outbound",
        mobileHistory && "is-mobile-history",
      )}
      data-testid={`whatsapp-message-${message.id}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          "c3wa-message-avatar",
          inbound ? "is-contact" : "is-sender",
        )}
      >
        {initials(
          inbound ? contactName : agentWritten ? agentName : currentUserName,
        )}
      </span>
      <div className="c3wa-message-content">
        <div className="c3wa-message-author">
          <strong>
            {inbound ? contactName : agentWritten ? agentName : currentUserName}
          </strong>
          {!inbound && agentWritten ? (
            <span className="c3wa-agent-context">
              managed by {currentUserName} · sent as Horizon Labs
            </span>
          ) : null}
          <time>{dateTime(message.createdAt)}</time>
          {template ? (
            <span className="c3wa-template-marker">
              Template: <strong>{template.title}</strong>
            </span>
          ) : null}
        </div>
        {message.kind === "media" ? (
          <figure
            className="c3wa-media-card"
            aria-label={`Image attachment ${mediaParts[0] ?? message.text}`}
          >
            <span aria-hidden="true" className="c3wa-media-icon">
              ▧
            </span>
            <span>
              <strong>{mediaParts[0] ?? message.text}</strong>
              <small>{mediaParts.slice(1).join(" · ")}</small>
            </span>
          </figure>
        ) : message.kind === "button" ? (
          <div className="c3wa-button-reply">
            <p>
              <span aria-hidden="true">↶</span>
              {message.text}
            </p>
            <span>Tapped a reply button</span>
          </div>
        ) : (
          <p className="c3wa-message-text">{message.text}</p>
        )}
        {template?.buttons.length ? (
          <fieldset className="c3wa-template-buttons">
            <legend className="sr-only">
              Reply buttons the guesthouse sees
            </legend>
            {template.buttons.map((button) => (
              <span key={`${button.type}:${button.text}`}>↶ {button.text}</span>
            ))}
          </fieldset>
        ) : null}
        {message.state === "failed" ? (
          <div className="c3wa-message-failure" role="status">
            <span aria-hidden="true">!</span>
            <span>{message.errorText ?? statusLabel}</span>
          </div>
        ) : !inbound ? (
          <div className="c3wa-message-receipt">
            <span aria-hidden="true" className="c3wa-delivery-glyph">
              {deliveryGlyph(message.state)}
            </span>
            {agentWritten ? (
              <>
                <span>{statusLabel}</span>
                <span className="c3wa-approved-mark">
                  Approved by {currentUserName}
                  {message.kind === "template" ? " in a batch" : ""}
                </span>
              </>
            ) : (
              <span>{statusLabel} · you, as Horizon Labs</span>
            )}
          </div>
        ) : null}
      </div>
    </article>
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
  const identityQuery = useIdentityQuery();
  const profileQuery = useProfileQuery();
  const membershipQuery = useMyRelayMembershipLookupQuery();
  const command = useWhatsAppCommand();
  const [selectedWaId, setSelectedWaId] = React.useState<string | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<ContactFilter>("all");
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
      setSelectedWaId(contacts[0].waId);
    }
  }, [contacts, initialThreadRootId, selectedWaId]);

  const selectedContact =
    contacts.find((contact) => contact.waId === selectedWaId) ?? null;
  const selectedIdentity = selectedContact
    ? identityForContact(selectedContact)
    : null;
  const threadQuery = useWhatsAppThreadQuery(selectedContact?.waId ?? null);
  const thread = threadQuery.data;
  const pendingDrafts = draftsQuery.data ?? [];
  const filteredContacts = contacts.filter((contact) => {
    if (activeFilter === "replied")
      return Boolean(contact.lastInboundAt) && !contact.optedOut;
    if (activeFilter === "sent")
      return !contact.optedOut && !contact.lastInboundAt;
    if (activeFilter === "opted-out") return contact.optedOut;
    return true;
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
    if (!selectedContact?.leadId) return;
    void navigate({
      to: "/sales/lead/$prospectId",
      params: { prospectId: selectedContact.leadId },
    });
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

  if (statusQuery.isPending || contactsQuery.isPending) {
    return (
      <div aria-busy="true" className="c3wa-loading c3wa-outreach-loading">
        Loading WhatsApp conversations…
      </div>
    );
  }

  if (statusQuery.isError || contactsQuery.isError) {
    const error = statusQuery.error ?? contactsQuery.error;
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
          <div className="c3wa-outreach-title-row">
            <div>
              <h1>Outreach</h1>
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
          {filteredContacts.map((contact) => (
            <ContactRow
              businessName={identityForContact(contact).businessName}
              contact={contact}
              hasDraft={pendingDrafts.some(
                (draft) => draft.waId === contact.waId,
              )}
              key={contact.waId}
              onSelect={() => selectContact(contact)}
              selected={contact.waId === selectedContact?.waId}
            />
          ))}
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
              {initials(selectedIdentity?.businessName ?? "WhatsApp")}
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
                WhatsApp · {contactStatus(selectedContact)}
              </span>
            </div>
            {selectedContact.leadId ? (
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

          {selectedContact.leadId ? (
            <div className="c3wa-lead-context c3wa-mobile-lead-context">
              <span aria-hidden="true" className="c3wa-context-check">
                ✓
              </span>
              <span>
                <strong>
                  Lead ·{" "}
                  {contactStatus(selectedContact) === "Replied"
                    ? "In conversation"
                    : contactStatus(selectedContact)}
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
                  <ThreadMessage
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
                  />
                </React.Fragment>
              );
            })}
            {thread && thread.messages.length === 0 ? (
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
