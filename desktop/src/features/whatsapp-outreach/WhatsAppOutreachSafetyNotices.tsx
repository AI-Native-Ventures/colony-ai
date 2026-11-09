import { WHATSAPP_THREAD_VISIBLE_LIMIT } from "./whatsappOutreachApi";

/** Explains the relay's durable business-wide outreach fence in the active chat. */
export function WhatsAppBusinessStopNotice({
  reason,
}: {
  reason: string | null;
}) {
  return (
    <div className="c3wa-business-stop-note" role="status">
      <strong>
        Automatic outreach is stopped for everyone at this business.
      </strong>
      <span>
        {reason
          ? `Reason: ${reason}`
          : "A linked reply created a durable business-level hold."}
      </span>
    </div>
  );
}

/** Makes the relay's bounded visible-history response explicit to the reviewer. */
export function WhatsAppThreadContextLimitNotice({
  messageCount,
}: {
  messageCount: number;
}) {
  if (messageCount < WHATSAPP_THREAD_VISIBLE_LIMIT) return null;
  return (
    <p className="c3wa-thread-context-limit" role="status">
      Showing the newest {WHATSAPP_THREAD_VISIBLE_LIMIT} messages. Earlier
      conversation may be outside this review.
    </p>
  );
}
