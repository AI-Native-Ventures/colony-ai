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
} from "./browserAddress";
import {
  BLOCKED_ADDRESS_NOTICE,
  describeDownloadBlock,
  describeHostFailure,
  describeNavigationBlock,
  isBlockedNavigationError,
} from "./browserPageError";

/**
 * The browser tab's pages, per channel, for the active community (the
 * business). It joins two things that live in different processes:
 *
 * - the renderer's remembered list of pages (URL, title, which is active),
 *   persisted as one snapshot per community so a restart restores the tabs, and
 * - the Electron host's live tabs (`window.colonyBrowserHost`), which die with
 *   the app and are created lazily, one per page, only when a page is shown.
 *
 * A page restored from disk is "dormant": it has a URL and no host tab until
 * the person selects it, so reopening a channel never loads a dozen sites.
 *
 * This is a community-scoped module singleton: `resetBrowserTabsStore` is wired
 * into `resetWorkAreaState()` (and so `resetCommunityState()`), closes every
 * live tab of the old business, and `initBrowserTabsStore` starts the next one.
 * The scope is also the host's `businessId`, which is what isolates cookies and
 * storage between businesses.
 */

export type BrowserPage = {
  /** Stable id for this page in the renderer, persisted. */
  key: string;
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

export type BrowserChannelState = {
  pages: readonly BrowserPage[];
  activeKey: string | null;
  notices: readonly BrowserNotice[];
};

export type BrowserShortcutRequest = {
  channelId: string;
  pageKey: string;
  action: BrowserShortcutAction;
};

type StoredPage = { key: string; url: string; title: string };
type StoredChannel = {
  pages: StoredPage[];
  activeKey: string | null;
  touchedAt: number;
};

const STORAGE_PREFIX = "colony-work-area-browser.v1:";
const SNAPSHOT_VERSION = 1;
/** The host allows 12 live tabs in all; one channel can remember as many. */
export const MAX_BROWSER_PAGES_PER_CHANNEL = 12;
const MAX_REMEMBERED_CHANNELS = 200;
const MAX_NOTICES = 5;
const MAX_PENDING_STATES = 24;
const MAX_STORED_URL = 2_048;
const MAX_STORED_TITLE = 200;

export const EMPTY_BROWSER_CHANNEL: BrowserChannelState = Object.freeze({
  pages: Object.freeze([]) as readonly BrowserPage[],
  activeKey: null,
  notices: Object.freeze([]) as readonly BrowserNotice[],
});

let host: BrowserHostApi = browserHost;
let scope: string | null = null;
/** Bumped by every init and reset; a late async result checks it (rule 2). */
let generation = 0;
let ready: Promise<void> = Promise.resolve();
let stored: Record<string, StoredChannel> = {};
let persistDirty = false;
let channels = new Map<string, BrowserChannelState>();
const hostIndex = new Map<string, string>();
/** Host states that arrived before `createTab` returned the tab's id. */
const pendingStates = new Map<string, BrowserTabState>();
/** Host tabs a failed close left behind; closed again on the next action. */
const orphans = new Set<string>();
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

export function getBrowserChannelState(channelId: string): BrowserChannelState {
  return channels.get(channelId) ?? EMPTY_BROWSER_CHANNEL;
}

/** The active community's business id, or null before `initBrowserTabsStore`. */
export function getBrowserBusinessId(): string | null {
  return scope;
}

export function onBrowserShortcut(
  listener: (request: BrowserShortcutRequest) => void,
): () => void {
  shortcutListeners.add(listener);
  return () => {
    shortcutListeners.delete(listener);
  };
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
    for (const [channelId, value] of Object.entries(source)) {
      if (typeof value !== "object" || value === null) continue;
      const record = value as Record<string, unknown>;
      const pages: StoredPage[] = [];
      if (Array.isArray(record.pages)) {
        for (const entry of record.pages) {
          if (typeof entry !== "object" || entry === null) continue;
          const page = entry as Record<string, unknown>;
          if (typeof page.key !== "string" || page.key.length === 0) continue;
          if (page.key.length > 64) continue;
          if (pages.some((existing) => existing.key === page.key)) continue;
          pages.push({
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
          if (pages.length >= MAX_BROWSER_PAGES_PER_CHANNEL) break;
        }
      }
      if (pages.length === 0) continue;
      result[channelId] = {
        pages,
        activeKey:
          typeof record.activeKey === "string" &&
          pages.some((page) => page.key === record.activeKey)
            ? record.activeKey
            : pages[0].key,
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
 * One write path, one snapshot: every user action that changes what is
 * remembered ends here, so the stored value is always complete (rule 5). A
 * failed write leaves the store dirty and the next change rewrites it (rule 1).
 */
function persistChannel(channelId: string) {
  if (scope === null) return;
  const state = channels.get(channelId);
  const next = { ...stored };
  if (state && state.pages.length > 0) {
    next[channelId] = {
      pages: state.pages.map((page) => ({
        key: page.key,
        url: page.url.slice(0, MAX_STORED_URL),
        title: page.title.slice(0, MAX_STORED_TITLE),
      })),
      activeKey: state.activeKey,
      touchedAt: now(),
    };
  } else {
    delete next[channelId];
  }
  stored = pruneStored(next);
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

export function getBrowserPersistDirtyForTests() {
  return persistDirty;
}

// ------------------------------------------------------------------ lifecycle

function blankPage(): BrowserPage {
  return {
    key: newKey(),
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

function setChannel(
  channelId: string,
  next: BrowserChannelState,
  options: { persist: boolean },
) {
  channels = new Map(channels).set(channelId, next);
  if (options.persist || persistDirty) persistChannel(channelId);
  notify();
}

function updateChannel(
  channelId: string,
  update: (current: BrowserChannelState) => BrowserChannelState,
  options: { persist: boolean } = { persist: false },
) {
  const current = channels.get(channelId);
  if (!current) return;
  const next = update(current);
  if (next === current) return;
  setChannel(channelId, next, options);
}

function updatePage(
  channelId: string,
  key: string,
  update: (page: BrowserPage) => BrowserPage,
  options: { persist: boolean } = { persist: false },
) {
  updateChannel(
    channelId,
    (current) => {
      let changed = false;
      const pages = current.pages.map((page) => {
        if (page.key !== key) return page;
        const next = update(page);
        if (next !== page) changed = true;
        return next;
      });
      return changed ? { ...current, pages } : current;
    },
    options,
  );
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
  channels = new Map();
  hostIndex.clear();
  pendingStates.clear();
  reportedBlockedLinks.clear();
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
  channels = new Map();
  stored = {};
  hostIndex.clear();
  pendingStates.clear();
  reportedBlockedLinks.clear();
  orphans.clear();
  if (closing !== null) {
    void callHost(() => host.closeBusiness(closing)).catch(() => {
      // Retried by `initBrowserTabsStore` for this business on the next start.
    });
  }
  notify();
}

/** Make this channel's pages exist: restored from disk, or one blank page. */
export function ensureBrowserChannel(channelId: string) {
  if (scope === null || channels.has(channelId)) return;
  const remembered = stored[channelId];
  const pages: BrowserPage[] = remembered
    ? remembered.pages.map((page) => ({
        ...blankPage(),
        key: page.key,
        url: page.url,
        title: page.title,
      }))
    : [blankPage()];
  const activeKey =
    remembered?.activeKey && pages.some((p) => p.key === remembered.activeKey)
      ? remembered.activeKey
      : pages[0].key;
  channels = new Map(channels).set(channelId, {
    pages,
    activeKey,
    notices: EMPTY_BROWSER_CHANNEL.notices,
  });
  notify();
  const active = pages.find((page) => page.key === activeKey);
  if (active?.url) void startHostTab(channelId, active.key, active.url);
}

// ------------------------------------------------------------------ host tabs

function applyTabState(page: BrowserPage, tab: BrowserTabState): BrowserPage {
  const blockedLink = isBlockedNavigationError(tab.error);
  const next: BrowserPage = {
    ...page,
    hostId: tab.id,
    opening: false,
    // A blocked link leaves the current page on screen; it is a notice, not
    // an error page, and is reported once through `applyBlockedLinkNotice`.
    url: tab.url === "about:blank" ? page.url : tab.url,
    title: tab.title,
    loading: tab.loading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
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

function pushNotice(channelId: string, notice: BrowserNotice) {
  updateChannel(channelId, (current) => {
    const rest = current.notices.filter((entry) => entry.id !== notice.id);
    const notices = [...rest, notice].slice(-MAX_NOTICES);
    return { ...current, notices };
  });
}

/** Last blocked-link error already reported, per host tab. */
const reportedBlockedLinks = new Map<string, string>();

function applyBlockedLinkNotice(channelId: string, tab: BrowserTabState) {
  if (!isBlockedNavigationError(tab.error)) {
    reportedBlockedLinks.delete(tab.id);
    return;
  }
  if (reportedBlockedLinks.get(tab.id) === tab.error) return;
  reportedBlockedLinks.set(tab.id, tab.error ?? "");
  pushNotice(channelId, {
    id: "blocked-address",
    kind: "blocked",
    message: BLOCKED_ADDRESS_NOTICE,
  });
}

function findPageByHostId(hostId: string) {
  const channelId = hostIndex.get(hostId);
  if (!channelId) return null;
  const state = channels.get(channelId);
  const page = state?.pages.find((entry) => entry.hostId === hostId);
  return page ? { channelId, page } : null;
}

function rememberPendingState(tab: BrowserTabState) {
  pendingStates.delete(tab.id);
  pendingStates.set(tab.id, tab);
  while (pendingStates.size > MAX_PENDING_STATES)
    pendingStates.delete(pendingStates.keys().next().value as string);
}

function handleTabState(tab: BrowserTabState) {
  const found = findPageByHostId(tab.id);
  if (!found) {
    rememberPendingState(tab);
    return;
  }
  const urlChanged = tab.url !== found.page.url && tab.url !== "about:blank";
  updatePage(
    found.channelId,
    found.page.key,
    (page) => applyTabState(page, tab),
    { persist: urlChanged },
  );
  applyBlockedLinkNotice(found.channelId, tab);
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
      const opener = event.openedFrom
        ? findPageByHostId(event.openedFrom)
        : null;
      if (!opener) {
        closeHostTab(event.tab.id);
        return;
      }
      adoptPopup(opener.channelId, event.tab);
      return;
    }
    case "closed": {
      const found = findPageByHostId(event.tabId);
      hostIndex.delete(event.tabId);
      reportedBlockedLinks.delete(event.tabId);
      if (!found) return;
      // The host ended this tab (not us): keep the page, dormant.
      updatePage(found.channelId, found.page.key, (page) => ({
        ...page,
        hostId: null,
        loading: false,
        canGoBack: false,
        canGoForward: false,
      }));
      return;
    }
    case "navigation-blocked": {
      const found = findPageByHostId(event.tabId);
      if (!found) return;
      pushNotice(found.channelId, {
        id: `blocked-${event.reason}`,
        kind: "blocked",
        message: describeNavigationBlock(event.reason),
      });
      return;
    }
    case "download-blocked": {
      const found = findPageByHostId(event.tabId);
      if (!found) return;
      pushNotice(found.channelId, {
        id: `download-blocked-${event.reason}`,
        kind: "blocked",
        message: describeDownloadBlock(event.reason),
      });
      return;
    }
    case "download": {
      const found = findPageByHostId(event.tabId);
      if (!found) return;
      pushNotice(found.channelId, {
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
      const found = findPageByHostId(event.tabId);
      if (!found) return;
      for (const listener of shortcutListeners)
        listener({
          channelId: found.channelId,
          pageKey: found.page.key,
          action: event.action,
        });
    }
  }
}

function adoptPopup(channelId: string, tab: BrowserTabState) {
  const current = channels.get(channelId);
  if (!current || current.pages.length >= MAX_BROWSER_PAGES_PER_CHANNEL) {
    closeHostTab(tab.id);
    return;
  }
  const latest = pendingStates.get(tab.id) ?? tab;
  pendingStates.delete(tab.id);
  const page = applyTabState({ ...blankPage() }, latest);
  hostIndex.set(tab.id, channelId);
  setChannel(
    channelId,
    { ...current, pages: [...current.pages, page], activeKey: page.key },
    { persist: true },
  );
}

/**
 * Create the host tab for a page and adopt it. Everything after an await
 * re-checks that the community, the page and its intent are still current
 * (rule 2): a stale result closes the tab it created instead of attaching it.
 */
async function startHostTab(channelId: string, pageKey: string, url: string) {
  const mine = generation;
  const businessId = scope;
  if (businessId === null) return;
  retryOrphans();
  updatePage(channelId, pageKey, (page) =>
    page.opening ? page : { ...page, opening: true, error: null },
  );
  let tab: BrowserTabState;
  try {
    await ready;
    tab = await host.createTab({ businessId, url });
  } catch (error) {
    if (mine !== generation) return;
    updatePage(channelId, pageKey, (page) => ({
      ...page,
      opening: false,
      loading: false,
      error: describeHostFailure(error),
    }));
    return;
  }
  const page = channels
    .get(channelId)
    ?.pages.find((entry) => entry.key === pageKey);
  if (mine !== generation || !page || !page.opening) {
    closeHostTab(tab.id);
    return;
  }
  hostIndex.set(tab.id, channelId);
  const latest = pendingStates.get(tab.id) ?? tab;
  pendingStates.delete(tab.id);
  updatePage(channelId, pageKey, (current) => applyTabState(current, latest), {
    persist: true,
  });
  applyBlockedLinkNotice(channelId, latest);
}

// -------------------------------------------------------------------- actions

function requirePage(channelId: string, pageKey: string) {
  return (
    channels.get(channelId)?.pages.find((page) => page.key === pageKey) ?? null
  );
}

/** Open a new page (blank, or at `address`) and make it the active one. */
export function openBrowserPage(
  channelId: string,
  address?: string,
): BrowserAddressResult {
  ensureBrowserChannel(channelId);
  const current = channels.get(channelId);
  if (!current) return { ok: false, message: "The browser is not ready yet." };
  const target = address ? normalizeBrowserAddress(address) : null;
  if (target && !target.ok) return target;
  if (current.pages.length >= MAX_BROWSER_PAGES_PER_CHANNEL) {
    return {
      ok: false,
      message: "Too many browser tabs are open. Close one to open another.",
    };
  }
  const page = blankPage();
  setChannel(
    channelId,
    { ...current, pages: [...current.pages, page], activeKey: page.key },
    { persist: true },
  );
  if (target?.ok) void startHostTab(channelId, page.key, target.url);
  return { ok: true, url: target?.ok ? target.url : "" };
}

/** Navigate a page to what the person typed. Refusals come back as a message. */
export function navigateBrowserPage(
  channelId: string,
  pageKey: string,
  address: string,
): BrowserAddressResult {
  const page = requirePage(channelId, pageKey);
  if (!page) return { ok: false, message: "That tab is no longer open." };
  const result = normalizeBrowserAddress(address);
  if (!result.ok) return result;
  retryOrphans();
  if (page.hostId) {
    updatePage(channelId, pageKey, (current) => ({
      ...current,
      error: null,
      loading: true,
    }));
    const hostId = page.hostId;
    void callHost(() => host.navigate(hostId, result.url)).catch((error) => {
      updatePage(channelId, pageKey, (current) => ({
        ...current,
        loading: false,
        error: describeHostFailure(error),
      }));
    });
  } else if (!page.opening) {
    updatePage(
      channelId,
      pageKey,
      (current) => ({ ...current, url: result.url }),
      {
        persist: true,
      },
    );
    void startHostTab(channelId, pageKey, result.url);
  }
  return result;
}

export function selectBrowserPage(channelId: string, pageKey: string) {
  const page = requirePage(channelId, pageKey);
  if (!page) return;
  updateChannel(
    channelId,
    (current) =>
      current.activeKey === pageKey
        ? current
        : { ...current, activeKey: pageKey },
    { persist: true },
  );
  // A page restored from disk loads only now that it is on screen.
  if (!page.hostId && !page.opening && page.url)
    void startHostTab(channelId, pageKey, page.url);
}

/** Close a page. Closing the last one leaves a blank page, never an empty dock. */
export function closeBrowserPage(channelId: string, pageKey: string) {
  const current = channels.get(channelId);
  const index = current?.pages.findIndex((page) => page.key === pageKey) ?? -1;
  if (!current || index < 0) return;
  const closing = current.pages[index];
  let pages = current.pages.filter((page) => page.key !== pageKey);
  if (pages.length === 0) pages = [blankPage()];
  const activeKey =
    current.activeKey === pageKey
      ? pages[Math.max(0, index - 1)].key
      : current.activeKey;
  if (closing.hostId) {
    hostIndex.delete(closing.hostId);
    reportedBlockedLinks.delete(closing.hostId);
    closeHostTab(closing.hostId);
  }
  setChannel(channelId, { ...current, pages, activeKey }, { persist: true });
  const next = pages.find((page) => page.key === activeKey);
  if (next && !next.hostId && !next.opening && next.url)
    void startHostTab(channelId, next.key, next.url);
}

function hostCall(
  channelId: string,
  pageKey: string,
  run: (hostId: string) => Promise<unknown>,
) {
  const page = requirePage(channelId, pageKey);
  if (!page?.hostId) return;
  const hostId = page.hostId;
  void callHost(() => run(hostId)).catch((error) => {
    updatePage(channelId, pageKey, (current) => ({
      ...current,
      loading: false,
      error: describeHostFailure(error),
    }));
  });
}

export const goBackBrowserPage = (channelId: string, pageKey: string) =>
  hostCall(channelId, pageKey, (hostId) => host.back(hostId));
export const goForwardBrowserPage = (channelId: string, pageKey: string) =>
  hostCall(channelId, pageKey, (hostId) => host.forward(hostId));
export const stopBrowserPage = (channelId: string, pageKey: string) =>
  hostCall(channelId, pageKey, (hostId) => host.stop(hostId));
export const focusBrowserPage = (channelId: string, pageKey: string) =>
  hostCall(channelId, pageKey, (hostId) => host.focus(hostId));

/** Reload a live page, or load a page that has an address but no live tab. */
export function reloadBrowserPage(channelId: string, pageKey: string) {
  const page = requirePage(channelId, pageKey);
  if (!page) return;
  if (page.hostId) {
    updatePage(channelId, pageKey, (current) => ({ ...current, error: null }));
    hostCall(channelId, pageKey, (hostId) => host.reload(hostId));
  } else if (page.url && !page.opening) {
    void startHostTab(channelId, pageKey, page.url);
  }
}

export function dismissBrowserNotice(channelId: string, noticeId: string) {
  updateChannel(channelId, (current) =>
    current.notices.some((notice) => notice.id === noticeId)
      ? {
          ...current,
          notices: current.notices.filter((notice) => notice.id !== noticeId),
        }
      : current,
  );
}

/** Show a finished download in the file manager; say so if that fails. */
export function revealBrowserDownload(channelId: string, downloadId: string) {
  void callHost(() => host.revealDownload(downloadId)).catch(() => {
    pushNotice(channelId, {
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
