export type WhatsAppOutreachScreenProps = {
  channelId: string;
  initialThreadRootId: string | null;
  initialContactWaId?: string | null;
  /** Uses the shared map-only Outreach header instead of a local title row. */
  mapDesk?: boolean;
  mode?: "full" | "dock" | "desk";
  channelIsMember?: boolean;
  hideSelectedConversation?: boolean;
  onContactSelected?: (waId: string) => void;
  onSelectedContactChange?: (waId: string) => void;
};
