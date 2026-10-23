import type { AppearanceSnapshot } from "./appearanceSnapshot";

export type ConversationMessageSize = AppearanceSnapshot["messageSize"];

/**
 * The office reference's 17px message text is the default step (two px above
 * `text-sm`, so 16 / 17 / 18px across the Font size preference); Smaller and
 * Larger move one step down or up from it.
 */
const CSS_SIZE: Record<ConversationMessageSize, string> = {
  smaller: "calc(var(--text-sm) + 1rem / 16)",
  default: "calc(var(--text-sm) + 2rem / 16)",
  larger: "calc(var(--text-sm) + 3rem / 16)",
};

/** Resolve the shared conversation type step for live messages and previews. */
export function conversationMessageSizeCss(
  next: ConversationMessageSize,
): string {
  return CSS_SIZE[next];
}

/** Apply the global conversation size without persisting a second record. */
export function applyConversationMessageSize(
  next: ConversationMessageSize,
): void {
  globalThis.document?.documentElement?.style?.setProperty(
    "--conversation-message-font-size",
    conversationMessageSizeCss(next),
  );
}
