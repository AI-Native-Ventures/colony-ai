import * as React from "react";

import {
  type BrowserChannelState,
  EMPTY_BROWSER_CHANNEL,
  ensureBrowserChannel,
  getBrowserBusinessId,
  getBrowserChannelState,
  subscribeBrowserTabs,
} from "./browserTabsStore";

/**
 * The browser pages for one channel. Mounting the browser tab is what creates
 * them (restored from disk, or one blank page), so a channel nobody opened the
 * browser in costs nothing.
 */
export function useBrowserChannel(
  channelId: string,
  /** The pages are only created once the tab has been on screen. */
  shown: boolean,
): BrowserChannelState {
  const state = React.useSyncExternalStore(
    subscribeBrowserTabs,
    () => getBrowserChannelState(channelId),
    () => EMPTY_BROWSER_CHANNEL,
  );
  React.useEffect(() => {
    if (shown) ensureBrowserChannel(channelId);
  }, [channelId, shown]);
  return state;
}

/** True once the active community's browser store has been initialised. */
export function useBrowserBusinessReady(): boolean {
  return React.useSyncExternalStore(
    subscribeBrowserTabs,
    () => getBrowserBusinessId() !== null,
    () => false,
  );
}
