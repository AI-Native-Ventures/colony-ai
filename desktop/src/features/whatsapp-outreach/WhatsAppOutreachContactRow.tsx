import { UserRound } from "lucide-react";

import { BusinessLogoMark } from "@/features/discovery/BusinessLogoMark";
import { cn } from "@/shared/lib/cn";
import {
  maskWhatsAppNumber,
  type WhatsAppContact,
} from "./whatsappOutreachModels";
import { WHATSAPP_STAGE_LABELS } from "./whatsappOutreachStages";
import { contactStatus } from "./whatsappOutreachContactState";
import {
  formatWhatsAppDateTime,
  whatsappInitials,
} from "./WhatsAppThreadMessage";

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

export function WhatsAppOutreachContactRow({
  contact,
  businessName,
  hasDraft,
  preview,
  waitingForApproval,
  canReviewBatch,
  selected,
  onSelect,
  onReviewBatch,
  personName,
  website,
  isDesk = false,
  isLinked = Boolean(contact.leadId || contact.businessName),
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
  personName: string | null;
  website: string | null;
  isDesk?: boolean;
  isLinked?: boolean;
}) {
  const status = contactStatus(contact, waitingForApproval);
  const lastMessageAt = [
    contact.lastInboundAt,
    contact.lastReplyAt,
    contact.lastContactedAt,
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

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
          {isDesk ? (
            isLinked ? (
              <BusinessLogoMark
                className="c3wa-desk-logo-mark"
                name={businessName}
                website={website}
              />
            ) : (
              <UserRound aria-hidden="true" size={18} />
            )
          ) : (
            whatsappInitials(businessName)
          )}
        </span>
        <span className="c3wa-contact-main">
          <span className="c3wa-contact-title">
            <strong>{businessName}</strong>
            <time>
              {lastMessageAt ? formatWhatsAppDateTime(lastMessageAt) : ""}
            </time>
          </span>
          <span className="c3wa-contact-subtitle">
            {personName && isDesk ? <span>{personName}</span> : null}
            {isDesk ? (
              <span className="c3wa-contact-stage-chip">
                {WHATSAPP_STAGE_LABELS[contact.stage]}
              </span>
            ) : (
              <StatusChip status={status} />
            )}
            {isDesk && !isLinked ? (
              <span className="c3wa-contact-unlinked-chip">
                Not linked to a business
              </span>
            ) : null}
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
            {!isDesk ? <span>{maskWhatsAppNumber(contact.e164)}</span> : null}
          </span>
          {preview ? (
            <span className="c3wa-contact-preview">{preview}</span>
          ) : null}
        </span>
      </button>
      {waitingForApproval ? (
        <button
          aria-label={`Review batch for ${businessName}`}
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
