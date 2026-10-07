import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  getWorkAreaState,
  initWorkAreaStore,
  resetWorkAreaStore,
} from "../dock/workAreaStore.ts";
import {
  browserStorageKey,
  closeBrowserPage,
  createBrowserPage,
  dismissBrowserNotice,
  ensureBrowserPage,
  getBrowserBusinessId,
  getBrowserNotices,
  getBrowserOrphansForTests,
  getBrowserPage,
  getBrowserPageLabel,
  getBrowserPersistDirtyForTests,
  goBackBrowserPage,
  initBrowserTabsStore,
  navigateBrowserPage,
  onBrowserShortcut,
  parseBrowserSnapshotForTests,
  reloadBrowserPage,
  resetBrowserTabsStore,
  revealBrowserDownload,
  setBrowserHostForTests,
  setBrowserKeysForTests,
  setBrowserStoreClockForTests,
  takeBrowserAddressFocus,
} from "./browserTabsStore.ts";
import { browserPageKeyOf, browserTabId } from "./browserTabId.ts";

class MemoryStorage {
  data = new Map();
  failWrites = false;
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
  get length() {
    return this.data.size;
  }
  key(index) {
    return [...this.data.keys()][index] ?? null;
  }
}

function tabState(id, overrides = {}) {
  return {
    id,
    businessId: "x",
    clientId: null,
    url: "about:blank",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    controlOwner: "human",
    attached: false,
    visible: false,
    bounds: null,
    ...overrides,
  };
}

function fakeHost() {
  const calls = [];
  let listener = null;
  let counter = 0;
  const api = {
    calls,
    failClose: false,
    holdCreate: null,
    emit: (event) => listener?.(event),
    async createTab(options) {
      calls.push(["createTab", options]);
      if (api.holdCreate) await api.holdCreate;
      counter += 1;
      return tabState(`host-${counter}`, { url: options.url ?? "about:blank" });
    },
    async closeTab(id) {
      calls.push(["closeTab", id]);
      if (api.failClose) throw new Error("close failed");
      return { closed: true };
    },
    async closeBusiness(id) {
      calls.push(["closeBusiness", id]);
      return { closedTabs: 0 };
    },
    async navigate(id, url) {
      calls.push(["navigate", id, url]);
      return tabState(id);
    },
    async back(id) {
      calls.push(["back", id]);
      return tabState(id);
    },
    async reload(id) {
      calls.push(["reload", id]);
      return tabState(id);
    },
    async revealDownload(id) {
      calls.push(["revealDownload", id]);
      return { revealed: true };
    },
    onEvent(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
  };
  return api;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
let storage;
let host;
let counter;

beforeEach(() => {
  resetBrowserTabsStore();
  resetWorkAreaStore();
  storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  host = fakeHost();
  setBrowserHostForTests(host);
  counter = 0;
  setBrowserKeysForTests(() => `page-${++counter}`);
  setBrowserStoreClockForTests(() => counter);
});

/** A page in a channel, created the way the dock does: record first, then shown. */
function openPage(channelId, address) {
  const created = createBrowserPage(channelId, { address });
  assert.equal(created.ok, true);
  ensureBrowserPage(channelId, created.key);
  return created.key;
}

test("a new tab is a blank page in memory and touches no host tab", async () => {
  initBrowserTabsStore("community-a");
  const created = createBrowserPage("chan", { focusAddress: true });
  assert.deepEqual(created, { ok: true, key: "page-1", url: "" });
  ensureBrowserPage("chan", "page-1");
  await settle();
  const page = getBrowserPage("page-1");
  assert.equal(page.url, "");
  assert.equal(page.hostId, null);
  assert.equal(getBrowserPageLabel("page-1"), "New tab");
  assert.equal(takeBrowserAddressFocus("page-1"), true, "asked for once");
  assert.equal(takeBrowserAddressFocus("page-1"), false);
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab"),
    [],
  );
});

test("navigating a blank page opens a host tab in this business's profile", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan");
  const result = navigateBrowserPage(key, "example.com");
  assert.deepEqual(result, { ok: true, url: "https://example.com/" });
  await settle();
  const create = host.calls.find(([name]) => name === "createTab");
  assert.deepEqual(create[1], {
    businessId: "community-a",
    url: "https://example.com/",
  });
  const page = getBrowserPage(key);
  assert.equal(page.hostId, "host-1");
  assert.equal(page.url, "https://example.com/");
  assert.equal(page.opening, false);

  host.emit({
    type: "state",
    tab: tabState("host-1", {
      url: "https://example.com/next",
      title: "Example",
      loading: true,
      canGoBack: true,
    }),
  });
  const updated = getBrowserPage(key);
  assert.equal(updated.url, "https://example.com/next");
  assert.equal(updated.title, "Example");
  assert.equal(updated.loading, true);
  assert.equal(updated.canGoBack, true);
  assert.equal(
    getBrowserPageLabel(key),
    "Example",
    "the dock tab is titled by the page",
  );
  // The remembered address follows the page, in one stored snapshot.
  const saved = parseBrowserSnapshotForTests(
    storage.getItem(browserStorageKey("community-a")),
  );
  assert.equal(saved.chan.pages[0].url, "https://example.com/next");
  assert.equal(saved.chan.pages[0].title, "Example");
});

test("an address the browser refuses never reaches the host", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan");
  for (const input of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,x",
  ]) {
    assert.equal(navigateBrowserPage(key, input).ok, false);
  }
  assert.equal(createBrowserPage("chan", { address: "file:///x" }).ok, false);
  await settle();
  assert.deepEqual(
    host.calls.filter(([name]) => ["createTab", "navigate"].includes(name)),
    [],
  );
  assert.deepEqual(
    parseBrowserSnapshotForTests(
      storage.getItem(browserStorageKey("community-a")),
    ).chan.pages.map((page) => page.key),
    [key],
    "a refused address makes no page",
  );
});

test("a live page navigates through the host and back and reload are forwarded", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan", "example.com");
  await settle();
  navigateBrowserPage(key, "https://example.org/");
  goBackBrowserPage(key);
  reloadBrowserPage(key);
  await settle();
  assert.deepEqual(
    host.calls.filter(([name]) =>
      ["navigate", "back", "reload"].includes(name),
    ),
    [
      ["navigate", "host-1", "https://example.org/"],
      ["back", "host-1"],
      ["reload", "host-1"],
    ],
  );
});

test("a state that arrives before createTab returns is not lost", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan");
  let release;
  host.holdCreate = new Promise((resolve) => {
    release = resolve;
  });
  navigateBrowserPage(key, "example.com");
  await settle();
  host.emit({
    type: "state",
    tab: tabState("host-1", { url: "https://example.com/", title: "Early" }),
  });
  release();
  await settle();
  assert.equal(getBrowserPage(key).title, "Early");
});

test("restored pages are dormant: a tab's page loads only when it is shown", async () => {
  storage.setItem(
    browserStorageKey("community-a"),
    JSON.stringify({
      version: 1,
      channels: {
        chan: {
          pages: [
            { key: "p1", url: "https://one.test/", title: "One" },
            { key: "p2", url: "https://two.test/", title: "Two" },
            { key: "p3", url: "", title: "" },
          ],
          touchedAt: 1,
        },
      },
    }),
  );
  initBrowserTabsStore("community-a");
  // Labels come from the remembered pages before any tab is shown.
  assert.equal(getBrowserPageLabel("p1"), "One");
  assert.equal(getBrowserPageLabel("p2"), "Two");
  assert.equal(getBrowserPage("p1"), null, "not in memory until shown");
  ensureBrowserPage("chan", "p2");
  await settle();
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab").map(([, o]) => o.url),
    ["https://two.test/"],
  );
  ensureBrowserPage("chan", "p1");
  await settle();
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab").map(([, o]) => o.url),
    ["https://two.test/", "https://one.test/"],
  );
  ensureBrowserPage("chan", "p3");
  ensureBrowserPage("chan", "p2");
  await settle();
  assert.equal(
    host.calls.filter(([name]) => name === "createTab").length,
    2,
    "a blank page needs no host tab, and a loaded one is not loaded twice",
  );
});

test("a dock tab whose page was never remembered gets a blank page", () => {
  initBrowserTabsStore("community-a");
  ensureBrowserPage("chan", "ghost");
  assert.equal(getBrowserPage("ghost").url, "");
  const saved = parseBrowserSnapshotForTests(
    storage.getItem(browserStorageKey("community-a")),
  );
  assert.deepEqual(
    saved.chan.pages.map((page) => page.key),
    ["ghost"],
  );
});

test("closing a page closes its host tab and forgets its address", async () => {
  initBrowserTabsStore("community-a");
  const a = openPage("chan", "example.com");
  const b = openPage("chan", "example.org");
  await settle();
  closeBrowserPage(b);
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-2"),
  );
  assert.equal(getBrowserPage(b), null);
  const saved = parseBrowserSnapshotForTests(
    storage.getItem(browserStorageKey("community-a")),
  );
  assert.deepEqual(
    saved.chan.pages.map((page) => page.key),
    [a],
  );
  closeBrowserPage(a);
  assert.deepEqual(
    parseBrowserSnapshotForTests(
      storage.getItem(browserStorageKey("community-a")),
    ),
    {},
    "a channel with no pages is not kept",
  );
});

test("a dormant page can be closed without ever loading", () => {
  storage.setItem(
    browserStorageKey("community-a"),
    JSON.stringify({
      version: 1,
      channels: {
        chan: {
          pages: [{ key: "p1", url: "https://one.test/", title: "One" }],
          touchedAt: 1,
        },
      },
    }),
  );
  initBrowserTabsStore("community-a");
  closeBrowserPage("p1");
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab"),
    [],
  );
  assert.equal(getBrowserPageLabel("p1"), "New tab");
});

test("a close the host refused is retried, not forgotten", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan", "example.com");
  await settle();
  host.failClose = true;
  closeBrowserPage(key);
  await settle();
  assert.deepEqual(getBrowserOrphansForTests(), ["host-1"]);
  host.failClose = false;
  openPage("chan", "example.org");
  await settle();
  assert.deepEqual(getBrowserOrphansForTests(), []);
});

test("a popup opens beside its page as a dock tab in front; one from an unknown tab is closed", async () => {
  initBrowserTabsStore("community-a");
  initWorkAreaStore("ws://a.example");
  const key = openPage("chan", "example.com");
  await settle();
  host.emit({
    type: "new-tab",
    openedFrom: "host-1",
    tab: tabState("host-9", { url: "https://popup.test/" }),
  });
  const dock = getWorkAreaState("chan");
  assert.equal(dock.open, true);
  assert.equal(dock.tabs.length, 1);
  assert.equal(dock.tabs[0].kind, "browser");
  assert.equal(dock.activeTabId, dock.tabs[0].id);
  const popup = getBrowserPage(browserPageKeyOf(dock.tabs[0].id));
  assert.equal(popup.hostId, "host-9");
  assert.equal(popup.channelId, "chan");
  assert.notEqual(popup.key, key);
  host.emit({
    type: "new-tab",
    openedFrom: "nobody",
    tab: tabState("host-10", { url: "https://stray.test/" }),
  });
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-10"),
  );
  assert.equal(getWorkAreaState("chan").tabs.length, 1);
});

test("a popup beyond the dock's tab limit is closed, not orphaned", async () => {
  initBrowserTabsStore("community-a");
  initWorkAreaStore("ws://a.example");
  const key = openPage("chan", "example.com");
  await settle();
  // Fill the dock to its limit with other tabs.
  const { openWorkArea } = await import("../dock/workAreaStore.ts");
  for (let index = 0; index < 12; index += 1)
    openWorkArea("chan", "browser", browserTabId(`filler-${index}`));
  host.emit({
    type: "new-tab",
    openedFrom: "host-1",
    tab: tabState("host-9", { url: "https://popup.test/" }),
  });
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-9"),
  );
  assert.equal(getBrowserPage(key).channelId, "chan");
});

test("downloads and refusals become notices on their page, with a way to show the file", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan", "example.com");
  const other = openPage("chan", "example.org");
  await settle();
  host.emit({
    type: "download",
    tabId: "host-1",
    state: "started",
    downloadId: "d1",
    fileName: "report.pdf",
  });
  assert.equal(getBrowserNotices(key)[0].message, "Downloading report.pdf");
  assert.equal(
    getBrowserNotices(other).length,
    0,
    "another page's tab shows nothing",
  );
  host.emit({
    type: "download",
    tabId: "host-1",
    state: "completed",
    downloadId: "d1",
    fileName: "report.pdf",
  });
  const list = getBrowserNotices(key);
  assert.equal(list.length, 1, "the same download updates in place");
  assert.equal(list[0].state, "completed");
  assert.match(list[0].message, /Saved report\.pdf to your Downloads folder/u);
  revealBrowserDownload(key, "d1");
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "revealDownload" && call[1] === "d1"),
  );
  host.emit({
    type: "download-blocked",
    tabId: "host-1",
    reason: "download-size-limit",
  });
  host.emit({
    type: "navigation-blocked",
    tabId: "host-1",
    reason: "unsupported-link",
  });
  assert.equal(getBrowserNotices(key).length, 3);
  dismissBrowserNotice(key, "d1");
  assert.equal(getBrowserNotices(key).length, 2);
});

test("a blocked link keeps the page and reports once; a load failure is an error page", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan", "example.com");
  await settle();
  const blocked = tabState("host-1", {
    url: "https://example.com/",
    error: "Navigation to an unsupported URL was blocked",
  });
  host.emit({ type: "state", tab: blocked });
  assert.equal(getBrowserPage(key).error, null);
  assert.equal(getBrowserNotices(key).length, 1);
  dismissBrowserNotice(key, "blocked-address");
  host.emit({ type: "state", tab: blocked });
  assert.equal(
    getBrowserNotices(key).length,
    0,
    "not reported again after it was dismissed",
  );
  host.emit({
    type: "state",
    tab: tabState("host-1", {
      error: "Navigation failed (ERR_NAME_NOT_RESOLVED)",
    }),
  });
  assert.match(getBrowserPage(key).error, /ERR_NAME_NOT_RESOLVED/u);
});

test("when the host ends a tab the page is kept, dormant, and reloads on request", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan", "example.com");
  await settle();
  host.emit({ type: "closed", tabId: "host-1" });
  const page = getBrowserPage(key);
  assert.equal(page.hostId, null);
  assert.equal(page.url, "https://example.com/");
  reloadBrowserPage(key);
  await settle();
  assert.equal(host.calls.filter(([name]) => name === "createTab").length, 2);
});

test("relayed page shortcuts reach the listener with the channel and page", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan", "example.com");
  await settle();
  const seen = [];
  const stop = onBrowserShortcut((request) => seen.push(request));
  host.emit({ type: "shortcut", tabId: "host-1", action: "focus-address" });
  host.emit({ type: "shortcut", tabId: "unknown", action: "reload" });
  stop();
  host.emit({ type: "shortcut", tabId: "host-1", action: "back" });
  assert.deepEqual(seen, [
    { channelId: "chan", pageKey: key, action: "focus-address" },
  ]);
});

test("switching business closes the old tabs and shares nothing with the next", async () => {
  initBrowserTabsStore("community-a");
  const keyA = openPage("chan", "example.com");
  await settle();
  assert.equal(getBrowserBusinessId(), "community-a");

  resetBrowserTabsStore();
  await settle();
  assert.equal(getBrowserBusinessId(), null);
  assert.equal(getBrowserPage(keyA), null);
  assert.ok(
    host.calls.some(
      (call) => call[0] === "closeBusiness" && call[1] === "community-a",
    ),
  );

  initBrowserTabsStore("community-b");
  assert.equal(
    getBrowserPageLabel(keyA),
    "New tab",
    "community B does not know community A's pages",
  );
  const keyB = openPage("chan", "example.com");
  await settle();
  const creates = host.calls
    .filter(([name]) => name === "createTab")
    .map(([, o]) => o.businessId);
  // The same site in two businesses is two different profiles.
  assert.deepEqual(creates, ["community-a", "community-b"]);
  assert.notEqual(
    storage.getItem(browserStorageKey("community-a")),
    storage.getItem(browserStorageKey("community-b")),
  );
  // And a host event for A's old tab cannot touch B's pages.
  host.emit({
    type: "state",
    tab: tabState("host-1", { title: "A's leftover" }),
  });
  assert.notEqual(getBrowserPage(keyB).title, "A's leftover");
});

test("a tab created after the business changed is closed, never attached", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan");
  let release;
  host.holdCreate = new Promise((resolve) => {
    release = resolve;
  });
  navigateBrowserPage(key, "example.com");
  await settle();
  resetBrowserTabsStore();
  initBrowserTabsStore("community-b");
  ensureBrowserPage("chan", key);
  release();
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-1"),
  );
  assert.equal(getBrowserPage(key).hostId, null);
});

test("a page closed while its tab was opening does not keep the tab", async () => {
  initBrowserTabsStore("community-a");
  let release;
  host.holdCreate = new Promise((resolve) => {
    release = resolve;
  });
  const key = openPage("chan", "example.org");
  await settle();
  closeBrowserPage(key);
  release();
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-1"),
  );
  assert.equal(getBrowserPage(key), null);
});

test("a host that cannot open a tab shows a sentence, not a stack", async () => {
  host.createTab = async () => {
    throw new Error("Browser tab limit reached");
  };
  initBrowserTabsStore("community-a");
  const key = openPage("chan");
  navigateBrowserPage(key, "example.com");
  await settle();
  const page = getBrowserPage(key);
  assert.equal(page.opening, false);
  assert.match(page.error, /Too many browser tabs/u);
});

test("a channel holds at most twelve pages", () => {
  initBrowserTabsStore("community-a");
  for (let index = 0; index < 12; index += 1)
    assert.equal(createBrowserPage("chan").ok, true);
  const refused = createBrowserPage("chan");
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Too many browser tabs/u);
  assert.equal(createBrowserPage("other-chan").ok, true);
});

test("nothing can be created before a business is active", () => {
  const refused = createBrowserPage("chan");
  assert.equal(refused.ok, false);
});

test("a failed save is retried on the next change (nothing is silently abandoned)", async () => {
  initBrowserTabsStore("community-a");
  const key = openPage("chan");
  storage.failWrites = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    navigateBrowserPage(key, "example.com");
    await settle();
  } finally {
    console.warn = warn;
  }
  assert.equal(getBrowserPersistDirtyForTests(), true);
  storage.failWrites = false;
  host.emit({
    type: "state",
    tab: tabState("host-1", { url: "https://example.com/", title: "T" }),
  });
  assert.equal(getBrowserPersistDirtyForTests(), false);
  const saved = parseBrowserSnapshotForTests(
    storage.getItem(browserStorageKey("community-a")),
  );
  assert.equal(saved.chan.pages[0].url, "https://example.com/");
});

test("stored snapshots from other versions or with bad rows are ignored, not trusted", () => {
  assert.deepEqual(parseBrowserSnapshotForTests(null), {});
  assert.deepEqual(parseBrowserSnapshotForTests("not json"), {});
  assert.deepEqual(
    parseBrowserSnapshotForTests(JSON.stringify({ version: 2, channels: {} })),
    {},
  );
  const parsed = parseBrowserSnapshotForTests(
    JSON.stringify({
      version: 1,
      channels: {
        good: {
          pages: [
            { key: "a", url: "https://a.test/", title: 5 },
            { key: "a" },
            { nokey: 1 },
          ],
        },
        empty: { pages: [] },
        junk: 7,
        dup: { pages: [{ key: "a", url: "https://dup.test/", title: "x" }] },
      },
    }),
  );
  assert.deepEqual(
    Object.keys(parsed),
    ["good"],
    "empty, junk and a key already used are dropped",
  );
  assert.equal(parsed.good.pages.length, 1);
  assert.equal(parsed.good.pages[0].title, "");
});

test("dock tab ids and page keys round-trip", () => {
  assert.equal(browserTabId("k1"), "browser:k1");
  assert.equal(browserPageKeyOf("browser:k1"), "k1");
  assert.equal(browserPageKeyOf("k2"), "k2");
});
