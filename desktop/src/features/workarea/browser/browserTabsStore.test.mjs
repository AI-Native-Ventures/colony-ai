import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  browserStorageKey,
  closeBrowserPage,
  dismissBrowserNotice,
  ensureBrowserChannel,
  getBrowserBusinessId,
  getBrowserChannelState,
  getBrowserOrphansForTests,
  getBrowserPersistDirtyForTests,
  goBackBrowserPage,
  initBrowserTabsStore,
  navigateBrowserPage,
  onBrowserShortcut,
  openBrowserPage,
  parseBrowserSnapshotForTests,
  reloadBrowserPage,
  resetBrowserTabsStore,
  revealBrowserDownload,
  selectBrowserPage,
  setBrowserHostForTests,
  setBrowserKeysForTests,
  setBrowserStoreClockForTests,
} from "./browserTabsStore.ts";

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
const ids = (state) => state.pages.map((page) => page.key);
let storage;
let host;
let counter;

beforeEach(() => {
  resetBrowserTabsStore();
  storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  host = fakeHost();
  setBrowserHostForTests(host);
  counter = 0;
  setBrowserKeysForTests(() => `page-${++counter}`);
  setBrowserStoreClockForTests(() => counter);
});

test("a channel starts with one blank page and touches no host tab", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  await settle();
  const state = getBrowserChannelState("chan");
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].url, "");
  assert.equal(state.pages[0].hostId, null);
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab"),
    [],
  );
});

test("navigating a blank page opens a host tab in this business's profile", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  const result = navigateBrowserPage("chan", key, "example.com");
  assert.deepEqual(result, { ok: true, url: "https://example.com/" });
  await settle();
  const create = host.calls.find(([name]) => name === "createTab");
  assert.deepEqual(create[1], {
    businessId: "community-a",
    url: "https://example.com/",
  });
  const page = getBrowserChannelState("chan").pages[0];
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
  const updated = getBrowserChannelState("chan").pages[0];
  assert.equal(updated.url, "https://example.com/next");
  assert.equal(updated.title, "Example");
  assert.equal(updated.loading, true);
  assert.equal(updated.canGoBack, true);
  // The remembered address follows the page, in one stored snapshot.
  const saved = parseBrowserSnapshotForTests(
    storage.getItem(browserStorageKey("community-a")),
  );
  assert.equal(saved.chan.pages[0].url, "https://example.com/next");
});

test("an address the browser refuses never reaches the host", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  for (const input of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,x",
  ]) {
    const result = navigateBrowserPage("chan", key, input);
    assert.equal(result.ok, false);
  }
  assert.equal(openBrowserPage("chan", "file:///x").ok, false);
  await settle();
  assert.deepEqual(
    host.calls.filter(([name]) => ["createTab", "navigate"].includes(name)),
    [],
  );
  assert.equal(getBrowserChannelState("chan").pages.length, 1);
});

test("a live page navigates through the host and back and reload are forwarded", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  navigateBrowserPage("chan", key, "https://example.org/");
  goBackBrowserPage("chan", key);
  reloadBrowserPage("chan", key);
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
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  let release;
  host.holdCreate = new Promise((resolve) => {
    release = resolve;
  });
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  host.emit({
    type: "state",
    tab: tabState("host-1", { url: "https://example.com/", title: "Early" }),
  });
  release();
  await settle();
  assert.equal(getBrowserChannelState("chan").pages[0].title, "Early");
});

test("restored pages are dormant: only the active one loads, the rest on selection", async () => {
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
          activeKey: "p2",
          touchedAt: 1,
        },
      },
    }),
  );
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  await settle();
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab").map(([, o]) => o.url),
    ["https://two.test/"],
  );
  assert.equal(getBrowserChannelState("chan").pages[0].hostId, null);
  selectBrowserPage("chan", "p1");
  await settle();
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab").map(([, o]) => o.url),
    ["https://two.test/", "https://one.test/"],
  );
  selectBrowserPage("chan", "p3");
  await settle();
  assert.equal(
    host.calls.filter(([name]) => name === "createTab").length,
    2,
    "a blank page needs no host tab",
  );
});

test("closing pages closes host tabs, and the last page leaves a blank one", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const first = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", first, "example.com");
  await settle();
  openBrowserPage("chan", "example.org");
  await settle();
  const state = getBrowserChannelState("chan");
  assert.equal(state.pages.length, 2);
  assert.equal(state.activeKey, state.pages[1].key);
  closeBrowserPage("chan", state.pages[1].key);
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-2"),
  );
  assert.equal(getBrowserChannelState("chan").activeKey, first);
  closeBrowserPage("chan", first);
  await settle();
  const after = getBrowserChannelState("chan");
  assert.equal(after.pages.length, 1);
  assert.equal(after.pages[0].url, "");
  assert.equal(after.pages[0].hostId, null);
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-1"),
  );
});

test("a close the host refused is retried, not forgotten", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  host.failClose = true;
  closeBrowserPage("chan", key);
  await settle();
  assert.deepEqual(getBrowserOrphansForTests(), ["host-1"]);
  host.failClose = false;
  openBrowserPage("chan", "example.org");
  await settle();
  assert.deepEqual(getBrowserOrphansForTests(), []);
});

test("a popup from a page opens beside it; one from an unknown tab is closed", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  host.emit({
    type: "new-tab",
    openedFrom: "host-1",
    tab: tabState("host-9", { url: "https://popup.test/" }),
  });
  const state = getBrowserChannelState("chan");
  assert.equal(state.pages.length, 2);
  assert.equal(state.pages[1].hostId, "host-9");
  assert.equal(state.activeKey, state.pages[1].key);
  host.emit({
    type: "new-tab",
    openedFrom: "nobody",
    tab: tabState("host-10", { url: "https://stray.test/" }),
  });
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-10"),
  );
  assert.equal(getBrowserChannelState("chan").pages.length, 2);
});

test("downloads and refusals become notices with a way to show the file", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  host.emit({
    type: "download",
    tabId: "host-1",
    state: "started",
    downloadId: "d1",
    fileName: "report.pdf",
  });
  assert.equal(
    getBrowserChannelState("chan").notices[0].message,
    "Downloading report.pdf",
  );
  host.emit({
    type: "download",
    tabId: "host-1",
    state: "completed",
    downloadId: "d1",
    fileName: "report.pdf",
  });
  const notices = getBrowserChannelState("chan").notices;
  assert.equal(notices.length, 1, "the same download updates in place");
  assert.equal(notices[0].state, "completed");
  assert.match(
    notices[0].message,
    /Saved report\.pdf to your Downloads folder/u,
  );
  revealBrowserDownload("chan", "d1");
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
  assert.equal(getBrowserChannelState("chan").notices.length, 3);
  dismissBrowserNotice("chan", "d1");
  assert.equal(getBrowserChannelState("chan").notices.length, 2);
});

test("a blocked link keeps the page and reports once; a load failure is an error page", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  const blocked = tabState("host-1", {
    url: "https://example.com/",
    error: "Navigation to an unsupported URL was blocked",
  });
  host.emit({ type: "state", tab: blocked });
  assert.equal(getBrowserChannelState("chan").pages[0].error, null);
  assert.equal(getBrowserChannelState("chan").notices.length, 1);
  dismissBrowserNotice("chan", "blocked-address");
  host.emit({ type: "state", tab: blocked });
  assert.equal(
    getBrowserChannelState("chan").notices.length,
    0,
    "the same blocked link is not reported again after the person dismissed it",
  );
  host.emit({
    type: "state",
    tab: tabState("host-1", {
      error: "Navigation failed (ERR_NAME_NOT_RESOLVED)",
    }),
  });
  assert.match(
    getBrowserChannelState("chan").pages[0].error,
    /ERR_NAME_NOT_RESOLVED/u,
  );
});

test("when the host ends a tab the page is kept, dormant", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  host.emit({ type: "closed", tabId: "host-1" });
  const page = getBrowserChannelState("chan").pages[0];
  assert.equal(page.hostId, null);
  assert.equal(page.url, "https://example.com/");
  reloadBrowserPage("chan", key);
  await settle();
  assert.equal(host.calls.filter(([name]) => name === "createTab").length, 2);
});

test("relayed page shortcuts reach the listener with the channel and page", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
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
  ensureBrowserChannel("chan");
  const keyA = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", keyA, "example.com");
  await settle();
  assert.equal(getBrowserBusinessId(), "community-a");

  resetBrowserTabsStore();
  await settle();
  assert.equal(getBrowserBusinessId(), null);
  assert.deepEqual(getBrowserChannelState("chan").pages, []);
  assert.ok(
    host.calls.some(
      (call) => call[0] === "closeBusiness" && call[1] === "community-a",
    ),
  );

  initBrowserTabsStore("community-b");
  ensureBrowserChannel("chan");
  const stateB = getBrowserChannelState("chan");
  assert.equal(stateB.pages.length, 1);
  assert.equal(
    stateB.pages[0].url,
    "",
    "community B does not see community A's pages",
  );
  navigateBrowserPage("chan", stateB.activeKey, "example.com");
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
  assert.notEqual(
    getBrowserChannelState("chan").pages[0].title,
    "A's leftover",
  );
});

test("a tab created after the business changed is closed, never attached", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  let release;
  host.holdCreate = new Promise((resolve) => {
    release = resolve;
  });
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  resetBrowserTabsStore();
  initBrowserTabsStore("community-b");
  ensureBrowserChannel("chan");
  release();
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-1"),
  );
  assert.equal(getBrowserChannelState("chan").pages[0].hostId, null);
});

test("a page closed while its tab was opening does not keep the tab", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  let release;
  host.holdCreate = new Promise((resolve) => {
    release = resolve;
  });
  openBrowserPage("chan", "example.org");
  await settle();
  const opening = getBrowserChannelState("chan").pages[1].key;
  closeBrowserPage("chan", opening);
  release();
  await settle();
  assert.ok(
    host.calls.some((call) => call[0] === "closeTab" && call[1] === "host-1"),
  );
  assert.deepEqual(ids(getBrowserChannelState("chan")), [key]);
});

test("a host that cannot open a tab shows a sentence, not a stack", async () => {
  host.createTab = async () => {
    throw new Error("Browser tab limit reached");
  };
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  navigateBrowserPage("chan", key, "example.com");
  await settle();
  const page = getBrowserChannelState("chan").pages[0];
  assert.equal(page.opening, false);
  assert.match(page.error, /Too many browser tabs/u);
});

test("a failed save is retried on the next change (nothing is silently abandoned)", async () => {
  initBrowserTabsStore("community-a");
  ensureBrowserChannel("chan");
  const key = getBrowserChannelState("chan").activeKey;
  storage.failWrites = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    navigateBrowserPage("chan", key, "example.com");
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
          activeKey: "zzz",
        },
        empty: { pages: [] },
        junk: 7,
      },
    }),
  );
  assert.deepEqual(Object.keys(parsed), ["good"]);
  assert.equal(parsed.good.pages.length, 1);
  assert.equal(parsed.good.pages[0].title, "");
  assert.equal(parsed.good.activeKey, "a");
});
