import * as React from "react";

import {
  type AgentAccessRequest,
  getWaitingAgentAccess,
  subscribeAgentAccess,
} from "./agentBrowserAccess";
import {
  type BrowserNotice,
  type BrowserPage,
  EMPTY_BROWSER_NOTICES,
  ensureBrowserPage,
  getBrowserBusinessId,
  getBrowserNotices,
  getBrowserPage,
  subscribeBrowserTabs,
} from "./browserTabsStore";

/** True once the active community's browser store has been initialised. */
export function useBrowserBusinessReady(): boolean {
  return React.useSyncExternalStore(
    subscribeBrowserTabs,
    () => getBrowserBusinessId() !== null,
    () => false,
  );
}

/**
 * One browser page. Showing its tab is what brings it into memory (restored
 * from disk, or blank) and loads it, so a channel whose browser tabs nobody
 * looks at costs nothing.
 */
export function useBrowserPage(
  channelId: string,
  pageKey: string,
  shown: boolean,
): BrowserPage | null {
  const ready = useBrowserBusinessReady();
  const page = React.useSyncExternalStore(
    subscribeBrowserTabs,
    () => getBrowserPage(pageKey),
    () => null,
  );
  React.useEffect(() => {
    if (shown && ready) ensureBrowserPage(channelId, pageKey);
  }, [channelId, pageKey, shown, ready]);
  return page;
}

export function useBrowserNotices(pageKey: string): readonly BrowserNotice[] {
  return React.useSyncExternalStore(
    subscribeBrowserTabs,
    () => getBrowserNotices(pageKey),
    () => EMPTY_BROWSER_NOTICES,
  );
}

const NO_WAITING_AGENTS: readonly AgentAccessRequest[] = Object.freeze([]);

/** Agents that asked to continue after the person stopped them, on this page. */
export function useWaitingAgentAccess(
  hostId: string | null,
): readonly AgentAccessRequest[] {
  const all = React.useSyncExternalStore(
    subscribeAgentAccess,
    getWaitingAgentAccess,
    () => NO_WAITING_AGENTS,
  );
  return React.useMemo(
    () =>
      hostId
        ? all.filter((entry) => entry.hostId === hostId)
        : NO_WAITING_AGENTS,
    [all, hostId],
  );
}
