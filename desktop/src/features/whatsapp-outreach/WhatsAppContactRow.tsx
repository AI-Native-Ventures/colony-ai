import { UserRound } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { contactStatus } from "./whatsappOutreachContactState";
import {
  formatWhatsAppDateTime,
  whatsappInitials,
} from "./WhatsAppThreadMessage";
import {
  isWhatsAppPhoneLikeName,
  type WhatsAppContact,
} from "./whatsappOutreachModels";

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

export function WhatsAppContactRow({
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
          {isWhatsAppPhoneLikeName(businessName) ? (
            <UserRound aria-hidden="true" size={17} strokeWidth={1.8} />
          ) : (
            whatsappInitials(businessName)
          )}
        </span>
        <span className="c3wa-contact-main">
          <span className="c3wa-contact-title">
            <strong>{businessName}</strong>
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
            {preview ? (
              <span className="c3wa-contact-preview">{preview}</span>
            ) : null}
            {contact.unanswered && !selected ? (
              <span
                aria-label="Unread reply"
                className="c3wa-unread-dot"
                role="img"
              />
            ) : null}
          </span>
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
