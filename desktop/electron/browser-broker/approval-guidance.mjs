/** Next action while the app is preparing a managed browser task. */
export const BROWSER_ACCESS_PENDING_GUIDANCE =
  "Colony is preparing the browser for this task. Wait for it to become available, and do not ask the person to approve it in chat.";

/** Next action after a person explicitly stopped a managed browser task. */
export const BROWSER_RESUME_PENDING_GUIDANCE =
  "The person previously stopped browser access. A single Allow card is waiting in this conversation. Wait for their choice, and do not ask them to approve it in chat.";

/**
 * Kept as the shared fallback name while older call sites migrate. It must
 * never tell an agent to request browser approval in chat.
 */
export const BROWSER_APPROVAL_GUIDANCE = BROWSER_ACCESS_PENDING_GUIDANCE;
