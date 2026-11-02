export type WhatsAppOutreachScreenProps = {
  channelId: string;
  initialThreadRootId: string | null;
  initialContactWaId?: string | null;
  mode?: "full" | "dock" | "desk";
  channelIsMember?: boolean;
  onSelectedContactChange?: (waId: string) => void;
};
