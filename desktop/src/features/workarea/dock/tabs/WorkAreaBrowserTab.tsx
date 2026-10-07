import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import type { BrowserShortcutAction } from "@/shared/api/browserHost";
import { isMacPlatform } from "@/shared/lib/platform";

import { BrowserNotices } from "../../browser/BrowserNotices";
import {
  BrowserToolbar,
  type BrowserToolbarHandle,
} from "../../browser/BrowserToolbar";
import { BrowserViewport } from "../../browser/BrowserViewport";
import { browserPageKeyOf } from "../../browser/browserTabId";
import { browserShortcutFromKey } from "../../browser/browserShortcuts";
import {
  getBrowserPage,
  goBackBrowserPage,
  goForwardBrowserPage,
  onBrowserShortcut,
  reloadBrowserPage,
  takeBrowserAddressFocus,
} from "../../browser/browserTabsStore";
import {
  useBrowserNotices,
  useBrowserPage,
} from "../../browser/useBrowserTabs";
import { toggleWorkAreaFrom } from "../workAreaActions";
import {
  requestCloseWorkAreaTab,
  requestNewWorkAreaTab,
} from "../workAreaRequests";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";

/**
 * One browser page in the dock: a real, isolated browser beside the
 * conversation. The page is an Electron view (never an iframe) in a profile
 * that belongs to this business alone, so cookies and storage are not shared
 * with any other community. The person signs in to sites themselves, and
 * nothing in this tab is visible to agents.
 *
 * Keyboard and pointer reach every control: the toolbar, the address bar,
 * notices and the page itself (Enter on the page region hands it the keyboard;
 * Control or Command plus L comes back). Shortcuts work from the app's own
 * controls here and from a focused page through the host relay. Opening and
 * closing pages is the dock's: new and close go through its requests.
 */
export function WorkAreaBrowserTab({
  channelId,
  tabId,
  active,
}: WorkAreaTabPanelProps) {
  const pageKey = browserPageKeyOf(tabId);
  const page = useBrowserPage(channelId, pageKey, active);
  const notices = useBrowserNotices(pageKey);
  const { activeCommunity } = useCommunities();
  const toolbarRef = React.useRef<BrowserToolbarHandle>(null);
  const hasPage = page !== null;

  // A page the person just made takes the address bar, once its tab is shown.
  React.useEffect(() => {
    if (!active || !hasPage || !takeBrowserAddressFocus(pageKey)) return;
    // After the dock's own "focus the selected tab" has run.
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() =>
        toolbarRef.current?.focusAddress(),
      );
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [active, hasPage, pageKey]);

  const run = React.useCallback(
    (action: BrowserShortcutAction) => {
      // Read the store, not render state: a relayed key may outlive a render.
      const current = getBrowserPage(pageKey);
      switch (action) {
        case "focus-address":
          toolbarRef.current?.focusAddress();
          return;
        case "new-tab":
          requestNewWorkAreaTab("browser");
          return;
        case "close-tab":
          requestCloseWorkAreaTab(tabId);
          return;
        case "reload":
          reloadBrowserPage(pageKey);
          return;
        case "back":
          if (current?.canGoBack) goBackBrowserPage(pageKey);
          return;
        case "forward":
          if (current?.canGoForward) goForwardBrowserPage(pageKey);
          return;
        case "toggle-dock":
          toggleWorkAreaFrom(channelId, document.activeElement);
      }
    },
    [channelId, pageKey, tabId],
  );

  // Keys relayed from this page when the page, not the app, has focus.
  React.useEffect(() => {
    if (!active) return;
    return onBrowserShortcut((request) => {
      if (request.pageKey === pageKey) run(request.action);
    });
  }, [active, pageKey, run]);

  const onChromeKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const action = browserShortcutFromKey(event.nativeEvent, isMacPlatform());
    // The dock's own Cmd/Ctrl+\ handler owns toggling; do not toggle twice.
    if (!action || action === "toggle-dock") return;
    event.preventDefault();
    run(action);
  };

  if (!page) {
    return (
      <div className="colony-browser-state" data-testid="browser-not-ready">
        <p>The browser is getting ready.</p>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards browser shortcuts from its own controls.
    <div
      className="colony-browser"
      data-testid="work-area-browser"
      onKeyDown={onChromeKeyDown}
    >
      <BrowserToolbar page={page} ref={toolbarRef} />
      <BrowserNotices notices={notices} pageKey={pageKey} />
      <BrowserViewport active={active} page={page} />
      <footer className="colony-browser-status" data-testid="browser-status">
        <span>
          {activeCommunity?.name ?? "This business"} · Separate browser profile
        </span>
        <span>Not shared with agents</span>
      </footer>
    </div>
  );
}
