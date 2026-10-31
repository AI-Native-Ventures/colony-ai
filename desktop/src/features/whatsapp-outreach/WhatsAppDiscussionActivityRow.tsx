import { useNavigate } from "@tanstack/react-router";
import type { TimelineMessage } from "@/features/messages/types";

export function WhatsAppDiscussionActivity({
  channelId,
  message,
}: {
  channelId?: string | null;
  message: TimelineMessage;
}) {
  const navigate = useNavigate();
  const activity = message.whatsappActivity;
  if (!activity) return null;

  return (
    <details
      className="c3wa-discussion-activity"
      data-testid="whatsapp-discussion-activity"
    >
      <summary>{activity.summary}</summary>
      <ul>
        {activity.items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.label}</strong>
              {item.detail && item.detail !== item.label ? (
                <small>{item.detail}</small>
              ) : null}
            </span>
            <button
              onClick={() => {
                if (item.batchId) {
                  void navigate({
                    to: "/whatsapp/batches/$batchId",
                    params: { batchId: item.batchId },
                  });
                  return;
                }
                if (channelId) {
                  void navigate({
                    to: "/channels/$channelId",
                    params: { channelId },
                    search: {
                      ...(item.waId ? { whatsappContactWaId: item.waId } : {}),
                      whatsappDeskTab: "chats",
                    },
                  });
                }
              }}
              type="button"
            >
              {item.batchId
                ? "Open batch"
                : item.waId
                  ? "Open chat"
                  : "Open chats"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
