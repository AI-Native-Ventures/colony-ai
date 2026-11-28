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
  useWhatsAppUnknownSendsQuery,
} from "./whatsappOutreachQueries";
import {
  BATCH_MANAGE_NOTE,
  canManageWhatsAppContact,
} from "./whatsappContactAccess";
import { aiPlanReserveChipLabel, useAiPlanReserveQuery } from "./aiPlanUsage";
import {
  type CallBriefDialogTarget,
  useCallAssigneeNames,
  useMyPubkey,
  WhatsAppCallBriefDialog,
  WhatsAppCallBriefSummary,
} from "./WhatsAppCallBriefDialog";
import { WhatsAppMessagePreview } from "./WhatsAppMessageMedia";
import {
  getWhatsAppNeedsYouItems,
  WHATSAPP_STAGE_LABELS,
  type WhatsAppNeedsYouSection,
} from "./whatsappOutreachStages";
import {
  customerRecordForContact,
  resolveOutreachContactIdentity,
} from "./outreachDeskUtils";
import {
  WhatsAppSendHealthBanner,
  WhatsAppSendHealthNeedsCard,
} from "./WhatsAppSendHealthNotice";
import { WhatsAppUnknownSendRecoveryCard } from "./WhatsAppUnknownSendRecovery";
import { MapOutreachDeskHeaderAction } from "./MapOutreachDesk";
import { WhatsAppRateLimitNotice } from "./WhatsAppRateLimitNotice";
import { isRelayHttpRateLimitError } from "@/shared/api/relayHttpRequestGate";

type Props = {
  channelIsMember: boolean;
  mapDesk?: boolean;
  onOpenChat: (waId: string) => void;
};

/**
 * The first Needs cards are the most urgent, so only they fetch a thread for
 * an inline media preview. The complete thread remains available on demand in
 * chat, while this keeps a large Needs queue below the relay request budget.
 */
const NEEDS_THREAD_PREVIEW_LIMIT = 12;

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
  const batchBusinessById = new Map<
    string,
    {
      name: string;
      website: string | null;
      logoUrl: string | null;
      placePhotoUrl: string | null;
      isLinked: boolean;
    }
  >();
  for (const row of batch.rows) {
    const rowNumber = row.to.replace(/\D/gu, "");
    const contact = contacts.find((candidate) => candidate.waId === rowNumber);
    const leadId = row.leadId ?? contact?.leadId ?? null;
    const lead = leadId
      ? businessRecords?.prospects.find(
          ({ record }) => record.prospectId === leadId,
        )?.record.prospect
      : null;
    const identity = contact
      ? resolveOutreachContactIdentity(contact, businessRecords)
      : null;
    const name = lead?.party.displayName ?? identity?.displayName ?? null;
    if (!name) continue;
    batchBusinessById.set(leadId ?? name, {
      name,
      website: lead?.website ?? identity?.website ?? null,
      logoUrl: lead?.logoUrl ?? identity?.logoUrl ?? null,
      placePhotoUrl: lead?.placePhotoUrl ?? identity?.placePhotoUrl ?? null,
      isLinked: Boolean(lead || identity?.isLinked),
    });
  }
  const batchBusinesses = [...batchBusinessById.values()];
  const safetyChecksPassed = batch.rows.every(
    (row) =>
      row.skipReason === null &&
      row.state !== "skipped" &&
      row.state !== "failed",
  );

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
          {batchBusinesses.slice(0, 3).map((business) => (
            <li key={business.name}>
              {business.isLinked ? (
                <BusinessLogoMark
                  className="c3wa-desk-business-chip-logo"
                  logoUrl={business.logoUrl}
                  name={business.name}
                  placePhotoUrl={business.placePhotoUrl}
                  style={{ width: 16, height: 16 }}
                  website={business.website}
                />
              ) : null}
              {business.name}
            </li>
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
          Message, as {batchBusinesses[0]?.name ?? "the business"} sees it
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
      {safetyChecksPassed ? (
        <p className="c3wa-desk-safety-passed" role="status">
          <span aria-hidden="true">✓</span>Safety checks passed
        </p>
      ) : (
        <p className="c3wa-desk-cap-note" role="status">
          Some contacts were held or skipped by the recorded safety checks.
        </p>
      )}
      {error ? (
        <p className="c3wa-desk-error" role="alert">
          {error}
        </p>
      ) : null}
      {!canManage ? (
        <p className="c3wa-desk-cap-note" role="note">
          {BATCH_MANAGE_NOTE}
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

/** The contact lists of Needs you, in the order they are shown. */
const NEEDS_CONTACT_SECTIONS: readonly {
  section: WhatsAppNeedsYouSection;
  heading: string;
  headingId: string;
}[] = [
  {
    section: "ready-to-call",
    heading: "Ready to call",
    headingId: "outreach-ready-to-call-heading",
  },
  {
    section: "waiting-for-reply",
    heading: "Waiting for your reply",
    headingId: "outreach-waiting-heading",
  },
  {
    section: "wants-call",
    heading: "Wants a call",
    headingId: "outreach-wants-call-heading",
  },
];

function NeedsContactCard({
  assigneeName,
  canEdit,
  contact,
  hasDraft,
  draft,
  onBookCall,
  onCallBrief,
  onOpenChat,
  onApproveDraft,
  busy,
  identity,
  previewEnabled,
  section,
}: {
  /** Who has the call, when the contact has a call brief that names a person. */
  assigneeName: string | null;
  canEdit: boolean;
  contact: WhatsAppContact;
  hasDraft: boolean;
  draft: WhatsAppDraft | null;
  onBookCall: (contact: WhatsAppContact) => void;
  /** Open the call brief form: `ready` moves the lead to Ready to call, `edit` changes it. */
  onCallBrief: (contact: WhatsAppContact, mode: "ready" | "edit") => void;
  onOpenChat: (waId: string) => void;
  onApproveDraft: (draft: WhatsAppDraft) => void;
  busy: boolean;
  identity: ReturnType<typeof resolveOutreachContactIdentity>;
  previewEnabled: boolean;
  /** The list this card is in decides what it offers, not the stage alone. */
  section: WhatsAppNeedsYouSection;
}) {
  const readyToCall = section === "ready-to-call";
  // A call to prepare or to make: the card offers the call, not a reply.
  const wantsCall = section === "wants-call" || readyToCall;
  const dateLabel = formatTime(contact.lastReplyAt ?? contact.lastInboundAt);
  const threadQuery = useWhatsAppThreadQuery(
    contact.waId,
    previewEnabled && !readyToCall,
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
            logoUrl={identity.logoUrl}
            name={identity.displayName}
            placePhotoUrl={identity.placePhotoUrl}
            website={identity.website}
          />
        ) : (
          <UserRound size={20} />
        )}
      </div>
      <div className="c3wa-desk-contact-copy">
        <div className="c3wa-desk-contact-title">
          <h3>{identity.displayName}</h3>
          <span
            className={
              readyToCall ? "is-ready" : wantsCall ? "is-call" : "is-reply"
            }
          >
            {
              WHATSAPP_STAGE_LABELS[
                readyToCall
                  ? "ready_to_call"
                  : wantsCall
                    ? "wants_call"
                    : "replied"
              ]
            }
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
        {readyToCall ? (
          <WhatsAppCallBriefSummary
            assigneeName={assigneeName}
            brief={contact.callBrief}
            showUnassigned
          />
        ) : (
          <p className="c3wa-desk-contact-preview">
            {lastInbound ? (
              <WhatsAppMessagePreview message={lastInbound} />
            ) : previewEnabled && threadQuery.isError ? (
              "Latest message unavailable"
            ) : previewEnabled && threadQuery.isPending ? (
              "Loading latest message…"
            ) : wantsCall ? (
              "They asked to speak with you"
            ) : contact.lastInboundAt ? (
              "They replied. Open chat to read their message."
            ) : (
              "Reply needed"
            )}
          </p>
        )}
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
        {wantsCall && canEdit ? (
          <Button
            data-testid={`outreach-call-brief-${contact.waId}`}
            disabled={busy}
            onClick={() => onCallBrief(contact, readyToCall ? "edit" : "ready")}
            size="sm"
            type="button"
            variant="outline"
          >
            {readyToCall ? "Edit brief" : "Ready to call"}
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

export function OutreachDeskNeedsYou({
  channelIsMember,
  mapDesk = false,
  onOpenChat,
}: Props) {
  const navigate = useNavigate();
  const statusQuery = useWhatsAppStatusQuery(true, true);
  const connected = statusQuery.data?.connected === true;
  const contactsQuery = useWhatsAppContactsQuery(connected, true);
  const draftsQuery = useWhatsAppDraftsQuery(connected, true);
  const batchesQuery = useWhatsAppPendingBatchDetailsQuery(connected, true);
  const templatesQuery = useWhatsAppTemplatesQuery(connected);
  const business = useBusinessRecords({ createIfMissing: false });
  const customerRecords = useCustomerRecords(true);
  const customerAccess = useCustomerRecordCapabilities();
  const customerAction = useCustomerRecordAction();
  const membership = useMyRelayMembershipLookupQuery();
  const profile = useProfileQuery();
  const aiPlanReserveQuery = useAiPlanReserveQuery();
  const aiPlanReserveLabel = aiPlanReserveQuery.isError
    ? "AI plan usage could not be checked"
    : aiPlanReserveChipLabel(aiPlanReserveQuery.data);
  const command = useWhatsAppCommand();
  const [actionError, setActionError] = React.useState("");
  const [busyWaId, setBusyWaId] = React.useState<string | null>(null);
  const [callBriefTarget, setCallBriefTarget] =
    React.useState<CallBriefDialogTarget | null>(null);
  const myPubkey = useMyPubkey();
  const role = membership.data?.membership?.role;
  const canManage =
    membership.data?.membershipRequired === false ||
    role === "owner" ||
    role === "admin";
  const unknownSendsQuery = useWhatsAppUnknownSendsQuery(
    canManage && connected,
  );
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
  const assigneeNameFor = useCallAssigneeNames(contacts);
  const items = getWhatsAppNeedsYouItems(contacts, drafts, myPubkey);
  const previewWaIds = new Set(
    items.slice(0, NEEDS_THREAD_PREVIEW_LIMIT).map((item) => item.contact.waId),
  );
  const pendingBatches = batchesQuery.data ?? [];
  const unknownSends = unknownSendsQuery.data ?? [];
  const hasSendHealthNeed = canManage && Boolean(status?.sendHealth);
  const needsCount =
    pendingBatches.length +
    unknownSends.length +
    items.length +
    Number(hasSendHealthNeed);

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

  function openCallBrief(contact: WhatsAppContact, mode: "ready" | "edit") {
    if (!canEdit) return;
    setActionError("");
    setCallBriefTarget({
      contact,
      mode,
      name: resolveOutreachContactIdentity(contact, businessRecords)
        .displayName,
    });
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

  /** One list of contact cards on Needs you, or nothing when the list is empty. */
  const contactSection = ({
    section,
    heading,
    headingId,
  }: (typeof NEEDS_CONTACT_SECTIONS)[number]) => {
    const sectionItems = items.filter((item) => item.section === section);
    if (sectionItems.length === 0) return null;
    return (
      <section
        aria-labelledby={headingId}
        className="c3wa-desk-needs-section"
        data-testid={`outreach-needs-${section}`}
        key={section}
      >
        <div className="c3wa-desk-section-head">
          <h2 id={headingId}>{heading}</h2>
          <span>{sectionItems.length}</span>
        </div>
        {sectionItems.map((item) => (
          <NeedsContactCard
            assigneeName={assigneeNameFor(item.contact.callBrief)}
            busy={
              (section !== "waiting-for-reply" &&
                busyWaId === item.contact.waId) ||
              customerRecords.isPending ||
              customerRecords.isError
            }
            canEdit={canEdit}
            contact={item.contact}
            draft={
              drafts.find((draft) => draft.waId === item.contact.waId) ?? null
            }
            hasDraft={item.hasDraft}
            identity={resolveOutreachContactIdentity(
              item.contact,
              businessRecords,
            )}
            key={item.contact.waId}
            onApproveDraft={(draft) => void sendDraft(draft)}
            onBookCall={(contact) => void bookCall(contact)}
            onCallBrief={openCallBrief}
            onOpenChat={onOpenChat}
            previewEnabled={previewWaIds.has(item.contact.waId)}
            section={section}
          />
        ))}
      </section>
    );
  };

  const loadError = [statusQuery.error, contactsQuery.error].find(
    (error) => error && !isRelayHttpRateLimitError(error),
  );
  if (loadError) {
    return (
      <div className="c3wa-root c3wa-desk-error-panel" role="alert">
        WhatsApp needs could not be loaded.{" "}
        {loadError instanceof Error ? loadError.message : "Please try again."}
      </div>
    );
  }

  const aiPlanControl = (
    <button
      aria-label={`Open AI plan reserve settings. ${aiPlanReserveLabel}`}
      className={`c3wa-desk-cap-pill c3wa-ai-plan-chip${
        aiPlanReserveQuery.data?.admission.state === "paused"
          ? " is-paused"
          : ""
      }`}
      data-testid="ai-plan-usage-chip"
      onClick={() =>
        void navigate({ to: "/settings", search: { section: "whatsapp" } })
      }
      type="button"
    >
      <span>Your AI plan:</span> {aiPlanReserveLabel}
    </button>
  );

  return (
    <main
      className="c3wa-root c3wa-desk c3wa-desk-needs"
      data-testid="outreach-desk-needs-you"
    >
      {mapDesk ? (
        <MapOutreachDeskHeaderAction>
          {aiPlanControl}
        </MapOutreachDeskHeaderAction>
      ) : (
        <header className="c3wa-desk-page-head">
          <div className="c3wa-desk-needs-heading">
            <h1>
              {needsCount} {needsCount === 1 ? "thing needs" : "things need"}{" "}
              you
            </h1>
            <p>Scout prepared these. Nothing goes out until you say so.</p>
          </div>
          {aiPlanControl}
        </header>
      )}
      {!mapDesk ? <WhatsAppRateLimitNotice /> : null}
      {status ? (
        <WhatsAppSendHealthBanner canManage={canManage} status={status} />
      ) : null}

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
        {hasSendHealthNeed && status ? (
          <section
            aria-labelledby="outreach-send-health-heading"
            className="c3wa-desk-needs-section"
          >
            <div className="c3wa-desk-section-head">
              <h2 id="outreach-send-health-heading">
                WhatsApp sending needs you
              </h2>
              <span>1</span>
            </div>
            <div className="c3wa-desk-batch-grid">
              <WhatsAppSendHealthNeedsCard
                canManage={canManage}
                status={status}
              />
            </div>
          </section>
        ) : null}
        {NEEDS_CONTACT_SECTIONS.filter(
          ({ section }) => section === "ready-to-call",
        ).map(contactSection)}
        {unknownSends.length > 0 ? (
          <section
            aria-labelledby="outreach-unknown-sends-heading"
            className="c3wa-desk-needs-section"
          >
            <div className="c3wa-desk-section-head">
              <h2 id="outreach-unknown-sends-heading">Held for you</h2>
              <span>{unknownSends.length}</span>
            </div>
            <div className="c3wa-desk-batch-grid">
              {unknownSends.map((message) => (
                <WhatsAppUnknownSendRecoveryCard
                  key={message.id}
                  message={message}
                />
              ))}
            </div>
          </section>
        ) : null}
        {canManage && unknownSendsQuery.isError ? (
          <p className="c3wa-desk-cap-note" role="status">
            Unknown-send recovery details need a current relay.
          </p>
        ) : null}
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

        {NEEDS_CONTACT_SECTIONS.filter(
          ({ section }) => section !== "ready-to-call",
        ).map(contactSection)}

        {statusQuery.isPending ||
        contactsQuery.isPending ||
        batchesQuery.isPending ||
        (canManage && unknownSendsQuery.isPending) ? (
          <p className="c3wa-desk-empty" role="status">
            Loading WhatsApp needs…
          </p>
        ) : pendingBatches.length === 0 &&
          items.length === 0 &&
          !hasSendHealthNeed &&
          unknownSends.length === 0 ? (
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
      <WhatsAppCallBriefDialog
        onClose={() => setCallBriefTarget(null)}
        target={callBriefTarget}
      />
    </main>
  );
}
