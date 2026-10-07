import type { WorkAreaTab } from "@/features/workarea/dock/workAreaTypes";

import { browserPageKeyOf, browserTabId } from "./browserTabId";
import {
  closeBrowserPage,
  createBrowserPage,
  getBrowserPageLabel,
  subscribeBrowserTabs,
} from "./browserTabsStore";

/**
 * What the dock needs to know about the browser kind (see the registry): how
 * to mint a tab for a new page, what to release when the person closes a page's
 * tab, and how a tab is labelled (by its page's title, live).
 */

/** A new blank page for the channel; its address bar takes focus when shown. */
export function newBrowserTabId(channelId: string): string | null {
  const created = createBrowserPage(channelId, { focusAddress: true });
  return created.ok ? browserTabId(created.key) : null;
}

/** The dock closed a page's tab: end its host tab and forget its address. */
export function closeBrowserTab(_channelId: string, tab: WorkAreaTab) {
  closeBrowserPage(browserPageKeyOf(tab.id));
}

export const browserTabLabels = {
  subscribe: subscribeBrowserTabs,
  get: (tab: WorkAreaTab) => getBrowserPageLabel(browserPageKeyOf(tab.id)),
};
