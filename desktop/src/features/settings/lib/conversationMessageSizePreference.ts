import type { AppearanceSnapshot } from "./appearanceSnapshot";

export type ConversationMessageSize = AppearanceSnapshot["messageSize"];

const CSS_SCALE: Record<ConversationMessageSize, string> = {
  smaller: "0.8125",
  default: "0.875",
  larger: "0.9375",
};

/** Apply the global conversation size without persisting a second record. */
export function applyConversationMessageSize(
  next: ConversationMessageSize,
): void {
  globalThis.document?.documentElement?.style?.setProperty(
    "--conversation-message-font-size",
    `calc(var(--buzz-type-rem) * ${CSS_SCALE[next]})`,
  );
}
