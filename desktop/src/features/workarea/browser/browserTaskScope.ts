/** A browser task follows the conversation boundary, never page-provided text. */
export function browserTaskScope(
  channelId: string,
  channelType: string,
  threadRootId?: string | null,
): string | null {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      channelId,
    )
  )
    return null;
  if (channelType === "dm") return `conversation:${channelId.toLowerCase()}`;
  if (!threadRootId || !/^[0-9a-f]{64}$/iu.test(threadRootId)) return null;
  return `thread:${channelId.toLowerCase()}:${threadRootId.toLowerCase()}`;
}

/** Display and approve only an exact HTTP origin, without credentials or paths. */
export function browserApprovalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Fixed confirmation copy; untrusted page labels never become instructions. */
export function browserConfirmationTitle(category?: string | null): string {
  switch (category) {
    case "payment":
      return "Confirm this purchase or payment?";
    case "send_or_post":
      return "Send or publish this content?";
    case "permission":
      return "Change site permissions?";
    case "file_upload":
      return "Upload this file?";
    default:
      return "Confirm this action?";
  }
}
