import { CHANNEL_MESSAGE_EVENT_KINDS } from "@/shared/constants/kinds";

export const DM_NOTIFIABLE_EVENT_KINDS = [
  ...CHANNEL_MESSAGE_EVENT_KINDS,
] as const;

const DM_NOTIFIABLE_KINDS = new Set<number>(DM_NOTIFIABLE_EVENT_KINDS);

// DM OS-notifications gate. The DM subscription matches every `h`-tagged
// event in the channel (kind:5/7/9005/edits/etc.), so we must filter to
// human-visible message kinds before firing a toast.
export function isDmNotifiableKind(kind: number): boolean {
  return DM_NOTIFIABLE_KINDS.has(kind);
}
