import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Phone, UserRound } from "lucide-react";

import { customerActions } from "@/features/cofounder/customerActions";
import {
  useCustomerRecordAction,
  useCustomerRecords,
} from "@/features/cofounder/customerHooks";
import { useCustomerRecordCapabilities } from "@/features/cofounder/customerRecordAccess";
import { useBusinessRecords } from "@/features/discovery/useBusinessRecords";
import { BusinessLogoMark } from "@/features/discovery/BusinessLogoMark";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { useProfileQuery } from "@/features/profile/hooks";
import {
  KIND_WHATSAPP_BATCH_DECISION,
  KIND_WHATSAPP_CONTACT_UPDATE,
} from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import type {
  WhatsAppBatchDetail,
  WhatsAppContact,
  WhatsAppDraft,
} from "./whatsappOutreachModels";
import {
  useWhatsAppCommand,
  useWhatsAppContactsQuery,
  useWhatsAppDraftsQuery,
  useWhatsAppPendingBatchDetailsQuery,
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
  useWhatsAppThreadQuery,
} from "./whatsappOutreachQueries";
import { canManageWhatsAppContact } from "./whatsappContactAccess";
import {
  getWhatsAppNeedsYouItems,
  WHATSAPP_STAGE_LABELS,
} from "./whatsappOutreachStages";
import {
  customerRecordForContact,
  resolveOutreachContactIdentity,
} from "./outreachDeskUtils";

type Props = {
  channelIsMember: boolean;
  onOpenChat: (waId: string) => void;
};

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function callHref(contact: WhatsAppContact): string {
  return `tel:+${contact.waId.replace(/\D/gu, "")}`;
}

function BatchApprovalCard({
  batch,
  canManage,
  cap,
  remaining,
  showCapNote,
  contacts,
  businessRecords,
  templates,
}: {
  batch: WhatsAppBatchDetail;
  canManage: boolean;
  cap: number | null;
  remaining: number | null;
  showCapNote: boolean;
  contacts: readonly WhatsAppContact[];
  businessRecords: ReturnType<typeof useBusinessRecords>["records"];
  templates: readonly {
    name: string;
    title: string;
    status: string;
    buttons: readonly { text: string }[];
  }[];
}) {
  const navigate = useNavigate();
  const command = useWhatsAppCommand();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const template = templates.find(
    (candidate) =>
      candidate.name.toLocaleLowerCase() ===
        batch.template.toLocaleLowerCase() ||
      candidate.title.toLocaleLowerCase() ===
        batch.template.toLocaleLowerCase(),
  );
  const batchBusinesses = [
    ...new Set(
      batch.rows
        .map((row) => {
          const rowNumber = row.to.replace(/\D/gu, "");
          const contact = contacts.find(
            (candidate) => candidate.waId === rowNumber,
          );
          if (contact) {
            return resolveOutreachContactIdentity(contact, businessRecords)
              .displayName;
          }
          return row.leadId
            ? businessRecords?.prospects.find(
                ({ record }) => record.prospectId === row.leadId,
              )?.record.prospect.party.displayName
            : null;
        })
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  async function approve() {
    if (!canManage || busy) return;
    setError("");
    setBusy(true);
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        batchId: batch.batchId,
        decision: "approve",
        dropRows: [],
        editRows: [],
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not approve this batch.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!canManage || busy) return;
    setError("");
    setBusy(true);
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        batchId: batch.batchId,
        decision: "reject",
        dropRows: [],
        editRows: [],
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not reject this batch.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="c3wa-desk-batch"
      data-testid={`outreach-needs-batch-${batch.batchId}`}
    >
      <div className="c3wa-desk-batch-head">
        <span aria-hidden="true" className="c3wa-desk-batch-avatar">
          S
        </span>
        <div>
          <p className="c3wa-desk-prepared-at">
            Scout{" "}
            <span>prepared at {formatTime(batch.createdAt) ?? "today"}</span>
          </p>
          <h2>{batch.note || template?.title || batch.template}</h2>
          <p>
            Template: {template?.title ?? batch.template}
            {template?.status.toLocaleUpperCase() === "APPROVED"
              ? " · approved by Meta"
              : ""}
          </p>
        </div>
        <span className="c3wa-desk-batch-kind">WhatsApp batch</span>
      </div>
      {batchBusinesses.length ? (
        <ul
          className="c3wa-desk-business-chips"
          aria-label="Businesses in this batch"
        >
          {batchBusinesses.slice(0, 3).map((name) => (
            <li key={name}>{name}</li>
          ))}
          {batch.counts.total > 3 ? (
            <li>and {Math.max(0, batch.counts.total - 3)} more</li>
          ) : null}
        </ul>
      ) : null}
      <details
        className="c3wa-desk-batch-preview"
        open={batch.materialLinks.length > 0}
      >
        <summary>
          Message, as {batchBusinesses[0] ?? "the business"} sees it
        </summary>
        <p>{batch.rows[0]?.preview ?? "No message preview is available."}</p>
        {template?.buttons.length ? (
          <ul className="c3wa-desk-quick-replies" aria-label="Quick replies">
            {template.buttons.map((button) => (
              <li key={button.text}>{button.text}</li>
            ))}
          </ul>
        ) : null}
      </details>
      {showCapNote && remaining !== null ? (
        <p className="c3wa-desk-cap-note">
          {(cap ?? 0) - remaining} of {cap ?? 0} new chats used today
          {batch.nextSendAt
            ? ` · Next send ${formatTime(batch.nextSendAt)}`
            : ""}
        </p>
      ) : null}
      {error ? (
        <p className="c3wa-desk-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="c3wa-desk-actions">
        <Button
          aria-label={`Approve and send ${batch.counts.ready}`}
          disabled={!canManage || busy}
          onClick={() => void approve()}
          type="button"
        >
          {busy ? (
            "Approving…"
          ) : (
            <>
              <span className="c3wa-desk-action-desktop">
                Approve and send {batch.counts.ready}
              </span>
              <span className="c3wa-desk-action-mobile">
                Approve {batch.counts.ready}
              </span>
            </>
          )}
        </Button>
        <Button
          aria-label="Review each message"
          disabled={busy}
          onClick={() =>
            void navigate({
              to: "/whatsapp/batches/$batchId",
              params: { batchId: batch.batchId },
            })
          }
          type="button"
          variant="outline"
        >
          <span className="c3wa-desk-action-desktop">Review each message</span>
          <span className="c3wa-desk-action-mobile">Review</span>
        </Button>
        <Button
          className="c3wa-text-danger"
          disabled={!canManage || busy}
          onClick={() => void reject()}
          type="button"
          variant="outline"
        >
          Reject
        </Button>
      </div>
    </article>
  );
}

function NeedsContactCard({
  canEdit,
  contact,
  hasDraft,
  draft,
  onBookCall,
  onOpenChat,
  onApproveDraft,
  busy,
  identity,
}: {
  canEdit: boolean;
  contact: WhatsAppContact;
  hasDraft: boolean;
  draft: WhatsAppDraft | null;
  onBookCall: (contact: WhatsAppContact) => void;
  onOpenChat: (waId: string) => void;
  onApproveDraft: (draft: WhatsAppDraft) => void;
  busy: boolean;
  identity: ReturnType<typeof resolveOutreachContactIdentity>;
}) {
  const wantsCall = contact.stage === "wants_call";
  const dateLabel = formatTime(contact.lastReplyAt ?? contact.lastInboundAt);
  const threadQuery = useWhatsAppThreadQuery(
    contact.waId,
    wantsCall || contact.unanswered,
  );
  const lastInbound = [...(threadQuery.data?.messages ?? [])]
    .reverse()
    .find((message) => message.direction === "in");
  return (
    <article
      className="c3wa-desk-contact-card"
      data-testid={`outreach-needs-contact-${contact.waId}`}
    >
      <div aria-hidden="true" className="c3wa-desk-contact-logo">
        {identity.isLinked ? (
          <BusinessLogoMark
            className="c3wa-desk-logo-mark"
            name={identity.displayName}
            website={identity.website}
          />
        ) : (
          <UserRound size={20} />
        )}
      </div>
      <div className="c3wa-desk-contact-copy">
        <div className="c3wa-desk-contact-title">
          <h3>{identity.displayName}</h3>
          <span className={wantsCall ? "is-call" : "is-reply"}>
            {WHATSAPP_STAGE_LABELS[wantsCall ? "wants_call" : "replied"]}
          </span>
        </div>
        <p className="c3wa-desk-contact-meta">
          {identity.personName ? `${identity.personName} · ` : ""}
          {identity.phone}
          {identity.location
            ? ` · ${identity.location.split(",")[0].trim()}`
            : ""}
          {dateLabel ? ` · ${dateLabel}` : ""}
        </p>
        <p className="c3wa-desk-contact-preview">
          {lastInbound?.text ??
            (threadQuery.isError
              ? "Latest message unavailable"
              : threadQuery.isPending
                ? "Loading latest message…"
                : wantsCall
                  ? "They asked to speak with you"
                  : "Reply needed")}
        </p>
        {hasDraft && !wantsCall && draft ? (
          <div className="c3wa-desk-draft-preview">
            <span className="c3wa-desk-eyebrow">Scout drafted</span>
            <p>{draft.text}</p>
          </div>
        ) : null}
      </div>
      <div className="c3wa-desk-contact-actions">
        {wantsCall ? (
          <a className="c3wa-desk-link-action" href={callHref(contact)}>
            <Phone aria-hidden="true" size={15} /> Call{" "}
            {identity.personName || identity.displayName}
          </a>
        ) : null}
        {wantsCall && canEdit ? (
          <Button
            disabled={busy}
            onClick={() => onBookCall(contact)}
            size="sm"
            type="button"
          >
            {busy ? "Saving…" : "Mark call booked"}
          </Button>
        ) : null}
        {hasDraft && !wantsCall && draft ? (
          <>
            <Button
              disabled={!canEdit}
              onClick={() => onApproveDraft(draft)}
              size="sm"
              type="button"
            >
              Send Scout&apos;s reply
            </Button>
            <Button
              onClick={() => onOpenChat(contact.waId)}
              size="sm"
              type="button"
              variant="outline"
            >
              Edit
            </Button>
          </>
        ) : null}
        <Button
          onClick={() => onOpenChat(contact.waId)}
          size="sm"
          type="button"
          variant="outline"
        >
          Open chat
        </Button>
      </div>
    </article>
  );
}

export function OutreachDeskNeedsYou({ channelIsMember, onOpenChat }: Props) {
  const statusQuery = useWhatsAppStatusQuery();
  const contactsQuery = useWhatsAppContactsQuery();
  const draftsQuery = useWhatsAppDraftsQuery();
  const batchesQuery = useWhatsAppPendingBatchDetailsQuery(
    statusQuery.data?.connected === true,
  );
  const templatesQuery = useWhatsAppTemplatesQuery(
    statusQuery.data?.connected === true,
  );
  const business = useBusinessRecords({ createIfMissing: false });
  const customerRecords = useCustomerRecords(true);
  const customerAccess = useCustomerRecordCapabilities();
  const customerAction = useCustomerRecordAction();
  const membership = useMyRelayMembershipLookupQuery();
  const profile = useProfileQuery();
  const command = useWhatsAppCommand();
  const [actionError, setActionError] = React.useState("");
  const [busyWaId, setBusyWaId] = React.useState<string | null>(null);
  const role = membership.data?.membership?.role;
  const canManage =
    membership.data?.membershipRequired === false ||
    role === "owner" ||
    role === "admin";
  const canEdit = canManageWhatsAppContact({
    role,
    isOutreachMember: channelIsMember,
    isManagedAgent: Boolean(profile.data?.ownerPubkey),
    ownerPubkey: profile.data?.ownerPubkey,
  });
  const status = statusQuery.data;
  const remaining = status
    ? Math.max(0, status.dailyNewChatCap - status.newChatsSentToday)
    : null;
  const contacts = contactsQuery.data ?? [];
  const drafts = draftsQuery.data ?? [];
  const businessRecords = business.records;
  const items = getWhatsAppNeedsYouItems(contacts, drafts);
  const pendingBatches = batchesQuery.data ?? [];
  const needsCount = pendingBatches.length + items.length;

  async function bookCall(contact: WhatsAppContact) {
    if (!canEdit || busyWaId) return;
    setActionError("");
    setBusyWaId(contact.waId);
    try {
      if (customerRecords.isError) {
        throw new Error(
          "Customer records could not be loaded. Try again before booking this call.",
        );
      }
      if (customerRecords.isPending) {
        throw new Error(
          "Customer records are still loading. Try again in a moment.",
        );
      }
      const contactIdentity = resolveOutreachContactIdentity(
        contact,
        businessRecords,
      );
      const record = customerRecordForContact(
        contact,
        contactIdentity,
        customerRecords.data ?? [],
      );
      if (record && customerAccess.canWrite) {
        await customerAction.mutateAsync(
          customerActions.recordMilestone(record, {
            milestoneKind: "call_booked",
            at: Math.floor(Date.now() / 1000),
          }),
        );
      }
      await command(KIND_WHATSAPP_CONTACT_UPDATE, {
        v: 1,
        waId: contact.waId,
        stage: "call_booked",
      });
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Could not book this call.",
      );
    } finally {
      setBusyWaId(null);
    }
  }

  async function sendDraft(draft: WhatsAppDraft) {
    if (!canManage) return;
    setActionError("");
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        draftId: draft.id,
        decision: "approve",
      });
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Could not send Scout's reply.",
      );
    }
  }

  if (statusQuery.isError || contactsQuery.isError) {
    return (
      <div className="c3wa-root c3wa-desk-error-panel" role="alert">
        WhatsApp needs could not be loaded.{" "}
        {statusQuery.error?.message ?? contactsQuery.error?.message}
      </div>
    );
  }

  return (
    <main
      className="c3wa-root c3wa-desk c3wa-desk-needs"
      data-testid="outreach-desk-needs-you"
    >
      <header className="c3wa-desk-page-head">
        <div className="c3wa-desk-needs-heading">
          <h1>
            {needsCount} {needsCount === 1 ? "thing needs" : "things need"} you
          </h1>
          <p>Scout prepared these. Nothing goes out until you say so.</p>
        </div>
      </header>

      {actionError ? (
        <p className="c3wa-desk-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {customerRecords.isError ? (
        <p className="c3wa-desk-error" role="alert">
          Customer records could not be loaded. Call booking will retry after
          the record list is refreshed.
          <Button
            className="ml-2"
            onClick={() => void customerRecords.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </p>
      ) : null}

      <div className="c3wa-desk-needs-scroll">
        {pendingBatches.length > 0 ? (
          <section
            aria-labelledby="outreach-batches-heading"
            className="c3wa-desk-needs-section"
          >
            <div className="c3wa-desk-section-head">
              <h2 id="outreach-batches-heading">Approve to send</h2>
              <span>{pendingBatches.length}</span>
            </div>
            <div className="c3wa-desk-batch-grid">
              {pendingBatches.map((batch, index) => (
                <BatchApprovalCard
                  batch={batch}
                  businessRecords={businessRecords}
                  canManage={canManage}
                  cap={status?.dailyNewChatCap ?? null}
                  contacts={contacts}
                  key={batch.batchId}
                  remaining={remaining}
                  showCapNote={index === 0}
                  templates={templatesQuery.data ?? status?.templates ?? []}
                />
              ))}
            </div>
          </section>
        ) : null}

        {items.some((item) => item.section === "waiting-for-reply") ? (
          <section
            aria-labelledby="outreach-waiting-heading"
            className="c3wa-desk-needs-section"
          >
            <div className="c3wa-desk-section-head">
              <h2 id="outreach-waiting-heading">Waiting for your reply</h2>
              <span>
                {
                  items.filter((item) => item.section === "waiting-for-reply")
                    .length
                }
              </span>
            </div>
            {items
              .filter((item) => item.section === "waiting-for-reply")
              .map((item) => (
                <NeedsContactCard
                  busy={customerRecords.isPending || customerRecords.isError}
                  canEdit={canEdit}
                  contact={item.contact}
                  draft={
                    drafts.find((draft) => draft.waId === item.contact.waId) ??
                    null
                  }
                  hasDraft={item.hasDraft}
                  identity={resolveOutreachContactIdentity(
                    item.contact,
                    businessRecords,
                  )}
                  key={item.contact.waId}
                  onBookCall={(contact) => void bookCall(contact)}
                  onApproveDraft={(draft) => void sendDraft(draft)}
                  onOpenChat={onOpenChat}
                />
              ))}
          </section>
        ) : null}

        {items.some((item) => item.section === "wants-call") ? (
          <section
            aria-labelledby="outreach-wants-call-heading"
            className="c3wa-desk-needs-section"
          >
            <div className="c3wa-desk-section-head">
              <h2 id="outreach-wants-call-heading">Wants a call</h2>
              <span>
                {items.filter((item) => item.section === "wants-call").length}
              </span>
            </div>
            {items
              .filter((item) => item.section === "wants-call")
              .map((item) => (
                <NeedsContactCard
                  busy={
                    busyWaId === item.contact.waId ||
                    customerRecords.isPending ||
                    customerRecords.isError
                  }
                  canEdit={canEdit}
                  contact={item.contact}
                  draft={
                    drafts.find((draft) => draft.waId === item.contact.waId) ??
                    null
                  }
                  hasDraft={item.hasDraft}
                  identity={resolveOutreachContactIdentity(
                    item.contact,
                    businessRecords,
                  )}
                  key={item.contact.waId}
                  onBookCall={(contact) => void bookCall(contact)}
                  onApproveDraft={(draft) => void sendDraft(draft)}
                  onOpenChat={onOpenChat}
                />
              ))}
          </section>
        ) : null}

        {statusQuery.isPending ||
        contactsQuery.isPending ||
        batchesQuery.isPending ? (
          <p className="c3wa-desk-empty" role="status">
            Loading WhatsApp needs…
          </p>
        ) : pendingBatches.length === 0 && items.length === 0 ? (
          <section
            className="c3wa-desk-empty-state"
            data-testid="outreach-needs-empty"
          >
            <span aria-hidden="true" className="c3wa-desk-empty-icon">
              ✓
            </span>
            <h2>Nothing needs you</h2>
            <p>New replies and batches will show up here.</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
