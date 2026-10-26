import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  getWorkAreaState,
  initWorkAreaStore,
  resetWorkAreaStore,
} from "../dock/workAreaStore.ts";
import {
  DEFAULT_ACCESS_TTL_MS,
  allowAgentAccess,
  dismissAgentAccessRequest,
  getWaitingAgentAccess,
  resetAgentBrowserAccess,
  startAgentBrowserAccess,
} from "./agentBrowserAccess.ts";
import { browserTabId } from "./browserTabId.ts";
import {
  closeBrowserPage,
  getBrowserPage,
  initBrowserTabsStore,
  resetBrowserTabsStore,
  setBrowserHostForTests,
  setBrowserKeysForTests,
  setBrowserStoreClockForTests,
} from "./browserTabsStore.ts";

class MemoryStorage {
  data = new Map();
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

const tabState = (id, overrides = {}) => ({
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
});

function fakeHost() {
  const calls = [];
  let counter = 0;
  return {
    calls,
    async createTab(options) {
      calls.push(["createTab", options]);
      counter += 1;
      return tabState(`host-${counter}`, { url: options.url ?? "about:blank" });
    },
    async closeTab(id) {
      calls.push(["closeTab", id]);
      return { closed: true };
    },
    async closeBusiness(id) {
      calls.push(["closeBusiness", id]);
      return { closedTabs: 0 };
    },
    onEvent: () => () => {},
  };
}

function fakeBroker() {
  let listener = null;
  const grants = [];
  const api = {
    grants,
    failNext: 0,
    onEvent(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
    async grant(payload) {
      grants.push(structuredClone(payload));
      if (api.failNext > 0) {
        api.failNext -= 1;
        throw new Error("This tab already has an active browser task");
      }
      return { id: `grant-${grants.length}` };
    },
    emit: (event) => listener?.(event),
    listening: () => listener !== null,
  };
  return api;
}

const AGENT = "a".repeat(64);
const CHANNEL = "12345678-1234-4234-8234-123456789abc";
const COMMUNITY = "https://relay.example";
const ask = (overrides = {}) => ({
  type: "access-requested",
  agentId: AGENT,
  taskId: `conversation:${CHANNEL}`,
  communityOrigin: COMMUNITY,
  resume: false,
  ...overrides,
});
const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1)
    await new Promise((resolve) => setImmediate(resolve));
};

let host;
let broker;
let counter;

beforeEach(() => {
  resetAgentBrowserAccess();
  resetBrowserTabsStore();
  resetWorkAreaStore();
  globalThis.window = { localStorage: new MemoryStorage() };
  host = fakeHost();
  setBrowserHostForTests(host);
  counter = 0;
  setBrowserKeysForTests(() => `page-${++counter}`);
  setBrowserStoreClockForTests(() => counter);
  initWorkAreaStore(COMMUNITY);
  initBrowserTabsStore("community-a");
  broker = fakeBroker();
  startAgentBrowserAccess({
    businessId: "community-a",
    communityOrigin: COMMUNITY,
    api: broker,
  });
});

test("an agent's first browser call opens the work area browser and grants it that page", async () => {
  broker.emit(ask());
  await settle();

  const state = getWorkAreaState(CHANNEL);
  assert.equal(state.open, true, "the panel is open for the person");
  assert.equal(state.activeTabId, browserTabId("page-1"));
  assert.deepEqual(
    state.tabs.map((tab) => tab.kind),
    ["browser"],
  );

  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab"),
    [["createTab", { businessId: "community-a" }]],
    "an empty page: nothing loads before the grant's network rules exist",
  );
  assert.equal(getBrowserPage("page-1").hostId, "host-1");

  assert.deepEqual(broker.grants, [
    {
      agentId: AGENT,
      taskId: `conversation:${CHANNEL}`,
      communityOrigin: COMMUNITY,
      businessId: "community-a",
      tabId: "host-1",
      allowedOrigins: [],
      defaultAccess: true,
      ttlMs: DEFAULT_ACCESS_TTL_MS,
    },
  ]);
});

test("a thread task opens the browser in its channel", async () => {
  const root = "cd".repeat(32);
  broker.emit(ask({ taskId: `thread:${CHANNEL}:${root}` }));
  await settle();
  assert.equal(getWorkAreaState(CHANNEL).open, true);
  assert.equal(broker.grants[0].taskId, `thread:${CHANNEL}:${root}`);
});

test("one request at a time per task, and the same page is reused when the grant is renewed", async () => {
  broker.emit(ask());
  broker.emit(ask());
  await settle();
  assert.equal(broker.grants.length, 1);
  assert.equal(host.calls.filter(([name]) => name === "createTab").length, 1);

  broker.emit(ask());
  await settle();
  assert.equal(broker.grants.length, 2);
  assert.equal(broker.grants[1].tabId, "host-1", "renewed on the same page");
  assert.equal(host.calls.filter(([name]) => name === "createTab").length, 1);
  assert.equal(getWorkAreaState(CHANNEL).tabs.length, 1);
});

test("a page the person closed is replaced, not reused", async () => {
  broker.emit(ask());
  await settle();
  closeBrowserPage("page-1");
  broker.emit(ask());
  await settle();
  assert.equal(broker.grants[1].tabId, "host-2");
});

test("a reused page that is busy gets one fresh page", async () => {
  broker.emit(ask());
  await settle();
  broker.failNext = 1;
  broker.emit(ask());
  await settle();
  assert.deepEqual(
    broker.grants.map((grant) => grant.tabId),
    ["host-1", "host-1", "host-2"],
  );
});

test("a brand new page that cannot be granted is not retried in a loop", async () => {
  broker.failNext = 5;
  broker.emit(ask());
  await settle();
  assert.equal(broker.grants.length, 1);
  assert.equal(host.calls.filter(([name]) => name === "createTab").length, 1);
});

test("requests for another community, another agent shape or a bad task are ignored", async () => {
  broker.emit(ask({ communityOrigin: "https://other.example" }));
  broker.emit(ask({ agentId: "short" }));
  broker.emit(ask({ taskId: "conversation:not-a-channel" }));
  broker.emit(ask({ taskId: `thread:${CHANNEL}:nothex` }));
  broker.emit({ type: "grant-changed", grantId: "x", state: "active" });
  await settle();
  assert.deepEqual(broker.grants, []);
  assert.deepEqual(
    host.calls.filter(([name]) => name === "createTab"),
    [],
  );
  assert.equal(getWorkAreaState(CHANNEL).open, false);
});

test("after the person stopped the agent the panel opens with one Allow card and no grant", async () => {
  broker.emit(ask({ resume: true }));
  await settle();
  assert.deepEqual(broker.grants, [], "never granted without the person");
  assert.equal(getWorkAreaState(CHANNEL).open, true);
  const [card] = getWaitingAgentAccess();
  assert.deepEqual(
    [card.agentId, card.taskId, card.channelId, card.hostId],
    [AGENT, `conversation:${CHANNEL}`, CHANNEL, "host-1"],
  );

  await allowAgentAccess(card);
  assert.equal(broker.grants.length, 1);
  assert.equal(broker.grants[0].tabId, "host-1");
  assert.equal(broker.grants[0].defaultAccess, true);
  assert.deepEqual(getWaitingAgentAccess(), []);
});

test("Not now clears the card and grants nothing", async () => {
  broker.emit(ask({ resume: true }));
  await settle();
  dismissAgentAccessRequest(getWaitingAgentAccess()[0]);
  assert.deepEqual(getWaitingAgentAccess(), []);
  assert.deepEqual(broker.grants, []);
});

test("an Allow on a page the person closed meanwhile opens a fresh page", async () => {
  broker.emit(ask({ resume: true }));
  await settle();
  const [card] = getWaitingAgentAccess();
  closeBrowserPage("page-1");
  await allowAgentAccess(card);
  assert.equal(broker.grants[0].tabId, "host-2");
});

test("switching community stops listening and drops waiting cards", async () => {
  broker.emit(ask({ resume: true }));
  await settle();
  assert.equal(getWaitingAgentAccess().length, 1);
  resetAgentBrowserAccess();
  assert.equal(broker.listening(), false);
  assert.deepEqual(getWaitingAgentAccess(), []);
  broker.emit(ask());
  await settle();
  assert.deepEqual(broker.grants, []);
});

test("a late result from an old community never grants", async () => {
  let release;
  host.createTab = async (options) => {
    host.calls.push(["createTab", options]);
    await new Promise((resolve) => {
      release = resolve;
    });
    return tabState("host-late");
  };
  broker.emit(ask());
  await settle();
  resetAgentBrowserAccess();
  release();
  await settle();
  assert.deepEqual(broker.grants, []);
});
