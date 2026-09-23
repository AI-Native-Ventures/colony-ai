export const ELECTRON_NOTIFICATION_ACTIVATED_EVENT =
  "electron-shell:notification-activated";

function safeNotificationTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = {};
  for (const key of ["channelId", "channelName", "content", "pubkey"]) {
    if (typeof value[key] === "string") target[key] = value[key];
  }
  for (const key of ["createdAt", "kind"]) {
    if (typeof value[key] === "number") target[key] = value[key];
  }
  for (const key of ["eventId", "threadRootId"]) {
    if (typeof value[key] === "string") target[key] = value[key];
  }
  return target.channelId || target.eventId ? target : null;
}

export function createNativeNotificationHandler({
  Notification,
  revealWindow,
  emit,
}) {
  return async function showNativeNotification(payload = {}) {
    if (!Notification?.isSupported?.()) {
      throw new Error("Desktop notifications are not supported");
    }
    if (typeof payload.title !== "string" || payload.title.length === 0) {
      throw new Error("Notification title is required");
    }

    const target = safeNotificationTarget(payload.target);
    const notification = new Notification({
      title: payload.title,
      body: typeof payload.body === "string" ? payload.body : "",
      silent: true,
    });
    notification.once("click", () => {
      revealWindow();
      if (target) emit(ELECTRON_NOTIFICATION_ACTIVATED_EVENT, target);
    });
    notification.show();
    return null;
  };
}
