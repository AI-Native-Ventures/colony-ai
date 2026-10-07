import {
  getWorkAreaState,
  MAX_TABS_PER_CHANNEL,
  openWorkArea,
} from "@/features/workarea/dock/workAreaStore";
import {
  type BrowserDownloadState,
  type BrowserHostApi,
  type BrowserHostEvent,
  type BrowserShortcutAction,
  type BrowserTabState,
  browserHost,
} from "@/shared/api/browserHost";
import { setLocalStorageItemWithRecovery } from "@/shared/lib/localStorageQuota";

import {
  type BrowserAddressResult,
  normalizeBrowserAddress,
  pageLabel,
} from "./browserAddress";
import {
  BLOCKED_ADDRESS_NOTICE,
  describeDownloadBlock,
  describeHostFailure,
  describeNavigationBlock,
  isBlockedNavigationError,
} from "./browserPageError";
import { browserTabId } from "./browserTabId";

/**
 * The browser's pages for the active community (the business). Every page is a
 * tab in a channel's work area dock; this store holds what the dock does not:
 * each page's address, title and history state, its notices, and the link to
 * the Electron host's live tab (`window.colonyBrowserHost`). The two live in
 * different processes:
 *
 * - the renderer remembers each channel's pages (address and title), persisted
 *   as one snapshot per community, so a restart restores the tabs, and
 * - the host's live tabs die with the app and are created lazily, one per page,
 *   only when that page's tab is on screen.
 *
 * A page restored from disk is "dormant": it has an address and no host tab
 * until its tab is shown, so reopening a channel never loads a dozen sites.
 *
 * This is a community-scoped module singleton: `resetBrowserTabsStore` is wired
 * into `resetWorkAreaState()` (and so `resetCommunityState()`), closes every
 * live tab of the old business, and `initBrowserTabsStore` starts the next one.
 * The scope is also the host's `businessId`, which is what isolates cookies and
 * storage between businesses.
 */

export type BrowserPage = {
  /** Stable id for this page; the dock tab is `browser:<key>`. Persisted. */
  key: string;
  channelId: string;
  /** The live host tab, or null while dormant, blank or being opened. */
  hostId: string | null;
  /** The current address ("" for a new tab with nothing loaded). */
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The raw host error, shown as an error page in place of the page. */
  error: string | null;
  /** True while the host tab is being created. */
  opening: boolean;
};

export type BrowserNotice = {
  id: string;
  kind: "download" | "blocked";
  message: string;
  state?: BrowserDownloadState;
  downloadId?: string;
  fileName?: string;
};

export type BrowserShortcutRequest = {
  channelId: string;
  pageKey: string;
  action: BrowserShortcutAction;
};

type StoredPage = { key: string; url: string; title: string };
type StoredChannel = { pages: StoredPage[]; touchedAt: number };

const STORAGE_PREFIX = "colony-work-area-browser.v1:";
const SNAPSHOT_VERSION = 1;
/** The host allows 12 live tabs in all; the dock allows as many tabs a channel. */
export const MAX_BROWSER_PAGES_PER_CHANNEL = MAX_TABS_PER_CHANNEL;
const MAX_REMEMBERED_CHANNELS = 200;
const MAX_NOTICES = 5;
const MAX_PENDING_STATES = 24;
const MAX_STORED_URL = 2_048;
const MAX_STORED_TITLE = 200;

export const EMPTY_BROWSER_NOTICES: readonly BrowserNotice[] = Object.freeze(
  [],
);

let host: BrowserHostApi = browserHost;
let scope: string | null = null;
/** Bumped by every init and reset; a late async result checks it (rule 2). */
let generation = 0;
let ready: Promise<void> = Promise.resolve();
let stored: Record<string, StoredChannel> = {};
let persistDirty = false;
let pages = new Map<string, BrowserPage>();
let notices = new Map<string, readonly BrowserNotice[]>();
const hostIndex = new Map<string, string>();
/** Host states that arrived before `createTab` returned the tab's id. */
const pendingStates = new Map<string, BrowserTabState>();
/** Host tabs a failed close left behind; closed again on the next action. */
const orphans = new Set<string>();
/** Last blocked-link error already reported, per host tab. */
const reportedBlockedLinks = new Map<string, string>();
/** Pages whose address bar should take focus when their tab is shown. */
const addressFocusRequests = new Set<string>();
let unsubscribeHost: (() => void) | null = null;
let now: () => number = () => Date.now();
let newKey: () => string = () => crypto.randomUUID();
const listeners = new Set<() => void>();
const shortcutListeners = new Set<(request: BrowserShortcutRequest) => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeBrowserTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The page once its tab has been shown, else null. Stable between changes. */
export function getBrowserPage(key: string): BrowserPage | null {
  return pages.get(key) ?? null;
}

export function getBrowserNotices(key: string): readonly BrowserNotice[] {
  return notices.get(key) ?? EMPTY_BROWSER_NOTICES;
}

/** The active community's business id, or null before `initBrowserTabsStore`. */
export function getBrowserBusinessId(): string | null {
  return scope;
}

/** A tab's label: its page's title, else the site, else "New tab". */
export function getBrowserPageLabel(key: string): string {
  const live = pages.get(key);
  if (live) return pageLabel(live);
  for (const channel of Object.values(stored)) {
    const remembered = channel.pages.find((page) => page.key === key);
    if (remembered) return pageLabel(remembered);
  }
  return "New tab";
}

export function onBrowserShortcut(
  listener: (request: BrowserShortcutRequest) => void,
): () => void {
  shortcutListeners.add(listener);
  return () => {
    shortcutListeners.delete(listener);
  };
}

/** True once, if the page's address bar should take focus as its tab opens. */
export function takeBrowserAddressFocus(key: string): boolean {
  return addressFocusRequests.delete(key);
}

export function browserStorageKey(communityScope: string): string {
  return `${STORAGE_PREFIX}${communityScope}`;
}

// ---------------------------------------------------------------- persistence

function parseStored(raw: string | null): Record<string, StoredChannel> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !== SNAPSHOT_VERSION
    )
      return {};
    const source = (parsed as Record<string, unknown>).channels;
    if (typeof source !== "object" || source === null) return {};
    const result: Record<string, StoredChannel> = {};
    const seen = new Set<string>();
    for (const [channelId, value] of Object.entries(source)) {
      if (typeof value !== "object" || value === null) continue;
      const record = value as Record<string, unknown>;
      const remembered: StoredPage[] = [];
      if (Array.isArray(record.pages)) {
        for (const entry of record.pages) {
          if (typeof entry !== "object" || entry === null) continue;
          const page = entry as Record<string, unknown>;
          if (typeof page.key !== "string" || page.key.length === 0) continue;
          if (page.key.length > 64 || seen.has(page.key)) continue;
          seen.add(page.key);
          remembered.push({
            key: page.key,
            url:
              typeof page.url === "string" && page.url.length <= MAX_STORED_URL
                ? page.url
                : "",
            title:
              typeof page.title === "string"
                ? page.title.slice(0, MAX_STORED_TITLE)
                : "",
          });
          if (remembered.length >= MAX_BROWSER_PAGES_PER_CHANNEL) break;
        }
      }
      if (remembered.length === 0) continue;
      result[channelId] = {
        pages: remembered,
        touchedAt: typeof record.touchedAt === "number" ? record.touchedAt : 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/** Exported for tests: the only path that turns stored text back into state. */
export function parseBrowserSnapshotForTests(raw: string | null) {
  return parseStored(raw);
}

function pruneStored(next: Record<string, StoredChannel>) {
  const ids = Object.keys(next);
  if (ids.length <= MAX_REMEMBERED_CHANNELS) return next;
  ids.sort((a, b) => next[b].touchedAt - next[a].touchedAt);
  const kept: Record<string, StoredChannel> = {};
  for (const id of ids.slice(0, MAX_REMEMBERED_CHANNELS)) kept[id] = next[id];
  return kept;
}

/**
 * One write path, one snapshot: every change to what is remembered ends here,
 * so the stored value is always complete (rule 5). A failed write leaves the
 * store dirty and the next change rewrites it (rule 1).
 */
function persistRemembered(
  channelId: string,
  update: (current: StoredPage[]) => StoredPage[],
) {
  if (scope === null) return;
  const remembered = update(stored[channelId]?.pages ?? []);
  const next = { ...stored };
  if (remembered.length > 0)
    next[channelId] = { pages: remembered, touchedAt: now() };
  else delete next[channelId];
  stored = pruneStored(next);
  writeSnapshot();
}

function writeSnapshot() {
  if (scope === null) return;
  const ok = setLocalStorageItemWithRecovery(
    browserStorageKey(scope),
    JSON.stringify({ version: SNAPSHOT_VERSION, channels: stored }),
  );
  persistDirty = !ok;
  if (!ok) {
    console.warn(
      "[work-area] could not save the browser tabs; they will be saved on the next change",
    );
  }
}

function rememberPage(page: BrowserPage) {
  persistRemembered(page.channelId, (current) => {
    const entry: StoredPage = {
      key: page.key,
      url: page.url.slice(0, MAX_STORED_URL),
      title: page.title.slice(0, MAX_STORED_TITLE),
    };
    return current.some((item) => item.key === page.key)
      ? current.map((item) => (item.key === page.key ? entry : item))
      : [...current, entry].slice(-MAX_BROWSER_PAGES_PER_CHANNEL);
  });
}

function forgetPage(channelId: string, key: string) {
  persistRemembered(channelId, (current) =>
    current.filter((item) => item.key !== key),
  );
}

export function getBrowserPersistDirtyForTests() {
  return persistDirty;
}

// ------------------------------------------------------------------ lifecycle

function blankPage(key: string, channelId: string): BrowserPage {
  return {
    key,
    channelId,
    hostId: null,
    url: "",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    opening: false,
  };
}

function setPage(page: BrowserPage, options: { persist: boolean }) {
  pages = new Map(pages).set(page.key, page);
  if (options.persist || persistDirty) rememberPage(page);
  notify();
}

function updatePage(
  key: string,
  update: (page: BrowserPage) => BrowserPage,
  options: { persist: boolean } = { persist: false },
) {
  const current = pages.get(key);
  if (!current) return;
  const next = update(current);
  if (next === current) return;
  setPage(next, options);
}

/** Run a host call so a synchronous throw (no bridge) is a rejection too. */
function callHost<T>(run: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(run);
}

function closeHostTab(hostId: string) {
  void callHost(() => host.closeTab(hostId)).then(
    () => orphans.delete(hostId),
    () => orphans.add(hostId),
  );
}

function retryOrphans() {
  for (const hostId of [...orphans]) closeHostTab(hostId);
}

/**
 * Load this community's remembered pages and start listening to the host. Call
 * once per community, after `resetBrowserTabsStore`.
 */
export function initBrowserTabsStore(communityScope: string) {
  generation += 1;
  scope = communityScope;
  persistDirty = false;
  pages = new Map();
  notices = new Map();
  hostIndex.clear();
  pendingStates.clear();
  reportedBlockedLinks.clear();
  addressFocusRequests.clear();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(browserStorageKey(communityScope));
  } catch {
    raw = null;
  }
  stored = parseStored(raw);
  const mine = generation;
  // A renderer reload leaves the previous run's tabs alive in the host. They
  // belong to no remembered page, so end them before any page is opened.
  ready = Promise.resolve().then(async () => {
    try {
      await host.closeBusiness(communityScope);
    } catch {
      // The host may be unavailable (killed, or a plain browser); opening a
      // page reports that clearly when it is actually asked for.
    }
  });
  unsubscribeHost?.();
  unsubscribeHost = null;
  try {
    unsubscribeHost = host.onEvent((event) => {
      if (mine === generation) handleHostEvent(event);
    });
  } catch {
    unsubscribeHost = null;
  }
  notify();
}

/**
 * Drop everything held for the current community and close its live tabs.
 * Remembered pages stay on disk under the community's own key. If the host is
 * unreachable the tabs are not abandoned silently: they are invisible (a view
 * is only attached while its page is on screen) and the next `closeBusiness`
 * at init ends them.
 */
export function resetBrowserTabsStore() {
  const closing = scope;
  generation += 1;
  scope = null;
  persistDirty = false;
  unsubscribeHost?.();
  unsubscribeHost = null;
  pages = new Map();
  notices = new Map();
  stored = {};
  hostIndex.clear();
  pendingStates.clear();
  reportedBlockedLinks.clear();
  addressFocusRequests.clear();
  orphans.clear();
  if (closing !== null) {
    void callHost(() => host.closeBusiness(closing)).catch(() => {
      // Retried by `initBrowserTabsStore` for this business on the next start.
    });
  }
  notify();
}

/**
 * Make a page exist in memory when its tab is shown: restored from disk, or
 * blank if nothing was remembered. A restored page with an address loads now,
 * and only now.
 */
export function ensureBrowserPage(channelId: string, key: string) {
  if (scope === null) return;
  let page = pages.get(key);
  if (!page) {
    const remembered = stored[channelId]?.pages.find(
      (item) => item.key === key,
    );
    page = {
      ...blankPage(key, channelId),
      url: remembered?.url ?? "",
      title: remembered?.title ?? "",
    };
    setPage(page, { persist: !remembered });
  }
  if (page.url && !page.hostId && !page.opening && !page.error)
    void startHostTab(key, page.url);
}

// ------------------------------------------------------------------ host tabs

function applyTabState(page: BrowserPage, tab: BrowserTabState): BrowserPage {
  const blockedLink = isBlockedNavigationError(tab.error);
  const next: BrowserPage = {
    ...page,
    hostId: tab.id,
    opening: false,
    url: tab.url === "about:blank" ? page.url : tab.url,
    title: tab.title,
    loading: tab.loading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    // A blocked link leaves the current page on screen; it is a notice, not
    // an error page, and is reported once through `applyBlockedLinkNotice`.
    error: blockedLink ? null : tab.error,
  };
  return samePage(page, next) ? page : next;
}

function samePage(a: BrowserPage, b: BrowserPage) {
  return (
    a.hostId === b.hostId &&
    a.url === b.url &&
    a.title === b.title &&
    a.loading === b.loading &&
    a.canGoBack === b.canGoBack &&
    a.canGoForward === b.canGoForward &&
    a.error === b.error &&
    a.opening === b.opening
  );
}

function pushNotice(key: string, notice: BrowserNotice) {
  const current = notices.get(key) ?? EMPTY_BROWSER_NOTICES;
  const rest = current.filter((entry) => entry.id !== notice.id);
  notices = new Map(notices).set(key, [...rest, notice].slice(-MAX_NOTICES));
  notify();
}

function applyBlockedLinkNotice(key: string, tab: BrowserTabState) {
  if (!isBlockedNavigationError(tab.error)) {
    reportedBlockedLinks.delete(tab.id);
    return;
  }
  if (reportedBlockedLinks.get(tab.id) === tab.error) return;
  reportedBlockedLinks.set(tab.id, tab.error ?? "");
  pushNotice(key, {
    id: "blocked-address",
    kind: "blocked",
    message: BLOCKED_ADDRESS_NOTICE,
  });
}

function pageForHost(hostId: string): BrowserPage | null {
  const key = hostIndex.get(hostId);
  return key ? (pages.get(key) ?? null) : null;
}

function rememberPendingState(tab: BrowserTabState) {
  pendingStates.delete(tab.id);
  pendingStates.set(tab.id, tab);
  while (pendingStates.size > MAX_PENDING_STATES)
    pendingStates.delete(pendingStates.keys().next().value as string);
}

function handleTabState(tab: BrowserTabState) {
  const found = pageForHost(tab.id);
  if (!found) {
    rememberPendingState(tab);
    return;
  }
  // The tab's remembered label is its title, so a new title is worth saving too.
  const urlChanged = tab.url !== found.url && tab.url !== "about:blank";
  const titleChanged = tab.title !== "" && tab.title !== found.title;
  updatePage(found.key, (page) => applyTabState(page, tab), {
    persist: urlChanged || titleChanged,
  });
  applyBlockedLinkNotice(found.key, tab);
}

function downloadMessage(state: BrowserDownloadState, fileName: string) {
  switch (state) {
    case "started":
      return `Downloading ${fileName}`;
    case "completed":
      return `Saved ${fileName} to your Downloads folder`;
    case "interrupted":
      return `${fileName} did not finish downloading`;
    default:
      return `Download of ${fileName} was cancelled`;
  }
}

function handleHostEvent(event: BrowserHostEvent) {
  switch (event.type) {
    case "created":
      // Our own tabs are adopted from `createTab`'s reply.
      return;
    case "state":
      handleTabState(event.tab);
      return;
    case "new-tab": {
      const opener = event.openedFrom ? pageForHost(event.openedFrom) : null;
      if (!opener) {
        closeHostTab(event.tab.id);
        return;
      }
      adoptPopup(opener.channelId, event.tab);
      return;
    }
    case "closed": {
      const found = pageForHost(event.tabId);
      hostIndex.delete(event.tabId);
      reportedBlockedLinks.delete(event.tabId);
      if (!found) return;
      // The host ended this tab (not us): keep the page, dormant.
      updatePage(found.key, (page) => ({
        ...page,
        hostId: null,
        loading: false,
        canGoBack: false,
        canGoForward: false,
      }));
      return;
    }
    case "navigation-blocked": {
      const found = pageForHost(event.tabId);
      if (!found) return;
      pushNotice(found.key, {
        id: `blocked-${event.reason}`,
        kind: "blocked",
        message: describeNavigationBlock(event.reason),
      });
      return;
    }
    case "download-blocked": {
      const found = pageForHost(event.tabId);
      if (!found) return;
      pushNotice(found.key, {
        id: `download-blocked-${event.reason}`,
        kind: "blocked",
        message: describeDownloadBlock(event.reason),
      });
      return;
    }
    case "download": {
      const found = pageForHost(event.tabId);
      if (!found) return;
      pushNotice(found.key, {
        id: event.downloadId,
        kind: "download",
        state: event.state,
        downloadId: event.downloadId,
        fileName: event.fileName,
        message: downloadMessage(event.state, event.fileName),
      });
      return;
    }
    case "shortcut": {
      const found = pageForHost(event.tabId);
      if (!found) return;
      for (const listener of shortcutListeners)
        listener({
          channelId: found.channelId,
          pageKey: found.key,
          action: event.action,
        });
    }
  }
}

/** A window a page opened: a new page and dock tab beside it, in front. */
function adoptPopup(channelId: string, tab: BrowserTabState) {
  if (getWorkAreaState(channelId).tabs.length >= MAX_TABS_PER_CHANNEL) {
    closeHostTab(tab.id);
    return;
  }
  const latest = pendingStates.get(tab.id) ?? tab;
  pendingStates.delete(tab.id);
  const key = newKey();
  const page = applyTabState(blankPage(key, channelId), latest);
  hostIndex.set(tab.id, key);
  setPage(page, { persist: true });
  openWorkArea(channelId, "browser", browserTabId(key));
}

/**
 * Create the host tab for a page and adopt it. Everything after an await
 * re-checks that the community, the page and its intent are still current
 * (rule 2): a stale result closes the tab it created instead of attaching it.
 */
async function startHostTab(key: string, url: string) {
  const mine = generation;
  const businessId = scope;
  if (businessId === null) return;
  retryOrphans();
  updatePage(key, (page) =>
    page.opening ? page : { ...page, opening: true, error: null },
  );
  let tab: BrowserTabState;
  try {
    await ready;
    tab = await host.createTab({ businessId, url });
  } catch (error) {
    if (mine !== generation) return;
    updatePage(key, (page) => ({
      ...page,
      opening: false,
      loading: false,
      error: describeHostFailure(error),
    }));
    return;
  }
  const page = pages.get(key);
  if (mine !== generation || !page || !page.opening) {
    closeHostTab(tab.id);
    return;
  }
  hostIndex.set(tab.id, key);
  const latest = pendingStates.get(tab.id) ?? tab;
  pendingStates.delete(tab.id);
  updatePage(key, (current) => applyTabState(current, latest), {
    persist: true,
  });
  applyBlockedLinkNotice(key, latest);
}

// -------------------------------------------------------------------- actions

export type CreatedBrowserPage =
  | { ok: true; key: string; url: string }
  | { ok: false; message: string };

/**
 * Make a new page for a channel (blank, or at `address`). The caller adds the
 * dock tab, `browser:<key>`; the dock is the only place tabs are added.
 */
export function createBrowserPage(
  channelId: string,
  options: { address?: string; focusAddress?: boolean } = {},
): CreatedBrowserPage {
  if (scope === null)
    return { ok: false, message: "The browser is not ready yet." };
  const target = options.address
    ? normalizeBrowserAddress(options.address)
    : null;
  if (target && !target.ok) return target;
  if ((stored[channelId]?.pages.length ?? 0) >= MAX_BROWSER_PAGES_PER_CHANNEL) {
    return {
      ok: false,
      message: "Too many browser tabs are open. Close one to open another.",
    };
  }
  const key = newKey();
  setPage(blankPage(key, channelId), { persist: true });
  if (options.focusAddress) addressFocusRequests.add(key);
  if (target?.ok) void startHostTab(key, target.url);
  return { ok: true, key, url: target?.ok ? target.url : "" };
}

/** Navigate a page to what the person typed. Refusals come back as a message. */
export function navigateBrowserPage(
  key: string,
  address: string,
): BrowserAddressResult {
  const page = pages.get(key);
  if (!page) return { ok: false, message: "That tab is no longer open." };
  const result = normalizeBrowserAddress(address);
  if (!result.ok) return result;
  retryOrphans();
  if (page.hostId) {
    updatePage(key, (current) => ({ ...current, error: null, loading: true }));
    const hostId = page.hostId;
    void callHost(() => host.navigate(hostId, result.url)).catch((error) => {
      updatePage(key, (current) => ({
        ...current,
        loading: false,
        error: describeHostFailure(error),
      }));
    });
  } else if (!page.opening) {
    updatePage(key, (current) => ({ ...current, url: result.url }), {
      persist: true,
    });
    void startHostTab(key, result.url);
  }
  return result;
}

/**
 * Release a page whose dock tab the person closed: its host tab, notices and
 * remembered address. The dock has already removed the tab.
 */
export function closeBrowserPage(key: string) {
  const page = pages.get(key);
  let channelId = page?.channelId;
  if (!channelId) {
    for (const [id, channel] of Object.entries(stored))
      if (channel.pages.some((item) => item.key === key)) channelId = id;
  }
  if (page?.hostId) {
    hostIndex.delete(page.hostId);
    reportedBlockedLinks.delete(page.hostId);
    closeHostTab(page.hostId);
  }
  if (page) {
    const next = new Map(pages);
    next.delete(key);
    pages = next;
  }
  if (notices.has(key)) {
    const next = new Map(notices);
    next.delete(key);
    notices = next;
  }
  addressFocusRequests.delete(key);
  if (channelId) forgetPage(channelId, key);
  notify();
}

function hostCall(key: string, run: (hostId: string) => Promise<unknown>) {
  const page = pages.get(key);
  if (!page?.hostId) return;
  const hostId = page.hostId;
  void callHost(() => run(hostId)).catch((error) => {
    updatePage(key, (current) => ({
      ...current,
      loading: false,
      error: describeHostFailure(error),
    }));
  });
}

export const goBackBrowserPage = (key: string) =>
  hostCall(key, (hostId) => host.back(hostId));
export const goForwardBrowserPage = (key: string) =>
  hostCall(key, (hostId) => host.forward(hostId));
export const stopBrowserPage = (key: string) =>
  hostCall(key, (hostId) => host.stop(hostId));
export const focusBrowserPage = (key: string) =>
  hostCall(key, (hostId) => host.focus(hostId));

/** Reload a live page, or load a page that has an address but no live tab. */
export function reloadBrowserPage(key: string) {
  const page = pages.get(key);
  if (!page) return;
  if (page.hostId) {
    updatePage(key, (current) => ({ ...current, error: null }));
    hostCall(key, (hostId) => host.reload(hostId));
  } else if (page.url && !page.opening) {
    void startHostTab(key, page.url);
  }
}

export function dismissBrowserNotice(key: string, noticeId: string) {
  const current = notices.get(key);
  if (!current?.some((notice) => notice.id === noticeId)) return;
  notices = new Map(notices).set(
    key,
    current.filter((notice) => notice.id !== noticeId),
  );
  notify();
}

/** Show a finished download in the file manager; say so if that fails. */
export function revealBrowserDownload(key: string, downloadId: string) {
  void callHost(() => host.revealDownload(downloadId)).catch(() => {
    pushNotice(key, {
      id: downloadId,
      kind: "download",
      state: "completed",
      downloadId,
      message:
        "That file could not be shown. Open your Downloads folder to find it.",
    });
  });
}

// ---------------------------------------------------------------------- tests

export function setBrowserHostForTests(next: BrowserHostApi | null) {
  host = next ?? browserHost;
}

export function setBrowserStoreClockForTests(clock: () => number) {
  now = clock;
}

export function setBrowserKeysForTests(next: () => string) {
  newKey = next;
}

export function getBrowserOrphansForTests() {
  return [...orphans];
}
