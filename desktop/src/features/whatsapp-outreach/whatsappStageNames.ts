/** Where a business stands in the outreach pipeline, as the relay names it. */
export type WhatsAppStage =
  | "none"
  | "queued"
  | "contacted"
  | "replied"
  | "wants_call"
  | "ready_to_call"
  | "call_booked"
  | "quote_sent"
  | "client"
  | "no_thanks"
  | "stopped"
  | "not_on_whatsapp";

/**
 * Every stage name this app reads. A name outside it comes from a newer relay and is shown
 * as `none` instead of failing the whole contact list.
 */
export const WHATSAPP_STAGES: ReadonlySet<WhatsAppStage> =
  new Set<WhatsAppStage>([
    "none",
    "queued",
    "contacted",
    "replied",
    "wants_call",
    "ready_to_call",
    "call_booked",
    "quote_sent",
    "client",
    "no_thanks",
    "stopped",
    "not_on_whatsapp",
  ]);
