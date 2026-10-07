import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { isMacPlatform } from "@/shared/lib/platform";

import { BrowserNotices } from "../../browser/BrowserNotices";
import { BrowserPageTabs } from "../../browser/BrowserPageTabs";
import {
  BrowserToolbar,
  type BrowserToolbarHandle,
} from "../../browser/BrowserToolbar";
import { BrowserViewport } from "../../browser/BrowserViewport";
import { browserShortcutFromKey } from "../../browser/browserShortcuts";
import {
  closeBrowserPage,
  getBrowserChannelState,
  goBackBrowserPage,
  goForwardBrowserPage,
  onBrowserShortcut,
  openBrowserPage,
  reloadBrowserPage,
  selectBrowserPage,
} from "../../browser/browserTabsStore";
import {
  useBrowserBusinessReady,
  useBrowserChannel,
} from "../../browser/useBrowserTabs";
import { toggleWorkAreaFrom } from "../workAreaActions";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import type { BrowserShortcutAction } from "@/shared/api/browserHost";

/**
 * The Browser tab: a real, isolated browser beside the conversation. Pages are
 * Electron views (never an iframe) in a profile that belongs to this business
 * alone, so cookies and storage are not shared with any other community. The
 * person signs in to sites themselves, and nothing in this tab is visible to
 * agents.
 *
 * Keyboard and pointer reach every control: the toolbar, the address bar, the
 * tab strip, notices and the page itself (Enter on the page region hands it the
 * keyboard; Control or Command plus L comes back). Shortcuts work from the
 * app's own controls here and from a focused page through the host relay.
 */
export function WorkAreaBrowserTab({
  channelId,
  active,
}: WorkAreaTabPanelProps) {
  const ready = useBrowserBusinessReady();
  const state = useBrowserChannel(channelId, active);
  const { activeCommunity } = useCommunities();
  const toolbarRef = React.useRef<BrowserToolbarHandle>(null);
  const page =
    state.pages.find((entry) => entry.key === state.activeKey) ??
    state.pages[0] ??
    null;

  const run = React.useCallback(
    (action: BrowserShortcutAction, pageKey?: string) => {
      // Read the store, not render state: a relayed key may outlive a render.
      const current = getBrowserChannelState(channelId);
      const key = pageKey ?? current.activeKey;
      const target = current.pages.find((entry) => entry.key === key);
      switch (action) {
        case "focus-address":
          toolbarRef.current?.focusAddress();
          return;
        case "new-tab": {
          const result = openBrowserPage(channelId);
          if (result.ok)
            window.requestAnimationFrame(() =>
              toolbarRef.current?.focusAddress(),
            );
          return;
        }
        case "close-tab":
          if (target) closeBrowserPage(channelId, target.key);
          return;
        case "reload":
          if (target) reloadBrowserPage(channelId, target.key);
          return;
        case "back":
          if (target?.canGoBack) goBackBrowserPage(channelId, target.key);
          return;
        case "forward":
          if (target?.canGoForward) goForwardBrowserPage(channelId, target.key);
          return;
        case "toggle-dock":
          toggleWorkAreaFrom(channelId, document.activeElement);
      }
    },
    [channelId],
  );

  // Keys relayed from a focused page (the page swallows them otherwise).
  React.useEffect(() => {
    if (!active) return;
    return onBrowserShortcut((request) => {
      if (request.channelId !== channelId) return;
      run(request.action, request.pageKey);
    });
  }, [active, channelId, run]);

  const onChromeKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const action = browserShortcutFromKey(event.nativeEvent, isMacPlatform());
    // The dock's own Cmd/Ctrl+\ handler owns toggling; do not toggle twice.
    if (!action || action === "toggle-dock") return;
    event.preventDefault();
    run(action);
  };

  if (!ready || !page) {
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
      <BrowserPageTabs
        activeKey={page.key}
        onClose={(key) => closeBrowserPage(channelId, key)}
        onNew={() => run("new-tab")}
        onSelect={(key) => selectBrowserPage(channelId, key)}
        pages={state.pages}
      />
      <BrowserToolbar channelId={channelId} page={page} ref={toolbarRef} />
      <BrowserNotices channelId={channelId} notices={state.notices} />
      <BrowserViewport active={active} channelId={channelId} page={page} />
      <footer className="colony-browser-status" data-testid="browser-status">
        <span>
          {activeCommunity?.name ?? "This business"} · Separate browser profile
        </span>
        <span>Not shared with agents</span>
      </footer>
    </div>
  );
}
