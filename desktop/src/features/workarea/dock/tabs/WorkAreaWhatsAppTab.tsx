import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { WhatsAppOutreachScreen } from "@/features/whatsapp-outreach/WhatsAppOutreachScreen";
import { useWhatsAppContactsQuery } from "@/features/whatsapp-outreach/whatsappOutreachQueries";

export function WhatsAppUnreadBadge({
  id,
}: {
  channelId: string;
  id?: string;
}) {
  const contactsQuery = useWhatsAppContactsQuery();
  const count = (contactsQuery.data ?? []).filter(
    (contact) => contact.unanswered,
  ).length;

  return (
    <span
      className="colony-work-area-whatsapp-badge"
      data-count={count}
      data-testid="work-area-whatsapp-unread-count"
      id={id}
      title={`${count} unread WhatsApp ${count === 1 ? "reply" : "replies"}`}
    >
      {count > 0 ? count : null}
      <span className="sr-only">
        {count} unread WhatsApp {count === 1 ? "reply" : "replies"}
      </span>
    </span>
  );
}

export function WorkAreaWhatsAppTab({ channelId, tab }: WorkAreaTabPanelProps) {
  return (
    <WhatsAppOutreachScreen
      channelId={channelId}
      initialContactWaId={tab.contactWaId ?? null}
      initialThreadRootId={null}
      mode="dock"
    />
  );
}
