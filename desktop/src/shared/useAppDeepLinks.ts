import { useMessageDeepLinks } from "@/shared/useMessageDeepLinks";

/**
 * Subscribe to the deep links that route inside the app shell: `buzz://message`.
 *
 * It needs the router, so it mounts in `AppShell`; keeping it behind one hook
 * keeps the shell to one line per concern.
 */
export function useAppDeepLinks(enabled = true) {
  useMessageDeepLinks(enabled);
}
