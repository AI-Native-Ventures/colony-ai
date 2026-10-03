import type { AppearanceSnapshot } from "./appearanceSnapshot";

export type ConversationMessageSize = AppearanceSnapshot["messageSize"];

const CSS_SIZE: Record<ConversationMessageSize, string> = {
  smaller: "calc(var(--text-sm) - 1rem / 16)",
  default: "var(--text-sm)",
  larger: "calc(var(--text-sm) + 1rem / 16)",
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
