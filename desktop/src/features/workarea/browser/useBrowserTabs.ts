import * as React from "react";

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
