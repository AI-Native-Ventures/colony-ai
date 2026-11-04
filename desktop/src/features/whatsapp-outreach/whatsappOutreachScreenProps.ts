export type WhatsAppOutreachScreenProps = {
  channelId: string;
  initialThreadRootId: string | null;
  initialContactWaId?: string | null;
  mode?: "full" | "dock" | "desk";
  channelIsMember?: boolean;
  hideSelectedConversation?: boolean;
  onContactSelected?: (waId: string) => void;
  onSelectedContactChange?: (waId: string) => void;
};
