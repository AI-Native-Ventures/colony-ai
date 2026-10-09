import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GATE_MARKER, GATE_HOME_PREFIX } from "./packaged-gate.mjs";
import { createBrowserHost } from "../browser-host.mjs";
import {
  createElectronBrowserAgentHost,
  createBrowserBrokerIpcHandler,
} from "./electron-host.mjs";

let nextId = 100;
class Contents extends EventEmitter {
  id = nextId++;
  url = "about:blank";
  destroyed = false;
  title = "Fixture";
  navigationHistory = { canGoBack: () => false, canGoForward: () => false };
  getURL() {
    return this.url;
  }
  getTitle() {
    return this.title;
  }
  isLoading() {
    return false;
  }
  isDestroyed() {
    return this.destroyed;
  }
  send() {}
  setWindowOpenHandler(handler) {
    this.popup = handler;
  }
  async loadURL(url) {
    this.url = url;
  }
  stop() {
    this.stops = (this.stops ?? 0) + 1;
  }
  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cab-"));
  const network = [];
  const profile = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    setDevicePermissionHandler() {},
    setDisplayMediaRequestHandler() {},
    // The profile's request filter (metadata and link-local addresses) is part
    // of session setup, so a session without one is not a valid profile.
    webRequest: { onBeforeRequest() {} },
    async setProxy(config) {
      network.push(config);
      if (options.failProxy) throw new Error("failed");
    },
    async closeAllConnections() {
      if (options.failDrain) throw new Error("cleanup failed password=hunter2");
      network.push("drain");
    },
    async clearCache() {
      network.push("clear");
    },
  });
  const browser = createBrowserHost({
    userDataPath: dir,
    downloadsPath: path.join(dir, "downloads"),
    session: { fromPartition: () => profile },
    WebContentsView: class {
      constructor() {
        this.webContents = new Contents();
        this.webContents.session = profile;
      }
    },
  });
  const sender = new Contents();
  const owner = {
    isDestroyed: () => false,
    contentView: { removeChildView() {} },
  };
  const tab = await browser.handleRequest(owner, sender, "create", {
    businessId: "business-a",
  });
  const host = await createElectronBrowserAgentHost({
    browserHost: browser,
    enabled: true,
    socketPath: path.join(dir, "s", "b.sock"),
    gateEnvironment: options.gateEnvironment ?? {},
    proxyFactory: () => ({
      start: async () => 9999,
      stop: async () => network.push("stop-proxy"),
    }),
  });
  t.after(async () => {
    options.failProxy = false;
    await host.stop();
    browser.disposeAll();
    await rm(dir, { recursive: true, force: true });
  });
  const grant = (payload = {}) =>
    host.handleRequest(
      "agent-grant",
      {
        agentId: "a".repeat(64),
        taskId: "conversation:11111111-1111-4111-8111-111111111111",
        communityOrigin: "https://relay.example",
        businessId: "business-a",
        tabId: tab.id,
        allowedOrigins: ["https://example.com"],
        ...payload,
      },
      sender.id,
    );
  return { browser, host, sender, owner, tab, grant, network };
}

test("flag off creates no adapter, proxy or socket and denies grants", async () => {
  const off = await createElectronBrowserAgentHost();
  assert.equal(off.enabled, false);
  assert.deepEqual(off.env, {});
  await assert.rejects(off.handleRequest("agent-grant", {}));
});

test("containment precedes grant visibility; failed installation creates no rights", async (t) => {
  const f = await fixture(t);
  const grant = await f.grant();
  assert.equal(grant.state, "active");
  assert.equal(f.network[0].proxyBypassRules, "<-loopback>");
  assert.deepEqual(f.network.slice(1), ["drain", "clear"]);
  await assert.rejects(f.grant(), /already/u);
  const broken = await fixture(t, { failProxy: true });
  await assert.rejects(broken.grant(), /containment/u);
  assert.deepEqual(broken.host.capabilities.grantsForAgent("agent-a"), []);
});

test("grant is bound to window and exact business/client; private exception cannot be supplied", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.grant({ businessId: "business-b" }), /profile/u);
  await assert.rejects(f.grant({ clientId: "client-b" }), /profile/u);
  await assert.rejects(
    f.grant({ privateExceptions: ["127.0.0.1:80"] }),
    /Private/u,
  );
  await assert.rejects(
    f.host.handleRequest("agent-grant", { tabId: f.tab.id }, 111111),
    /unavailable/u,
  );
  assert.equal(f.host.capabilities.grantsForAgent("agent-a").length, 0);
});

test("production navigation hooks block cross-site redirects, private and file destinations", async (t) => {
  const f = await fixture(t);
  await f.grant();
  const contents = f.browser.agentAdapter.webContents(f.tab.id);
  for (const event of ["will-frame-navigate", "will-redirect"]) {
    for (const url of [
      "https://other.example",
      "http://127.0.0.1/",
      "file:///private/secret",
    ]) {
      let cancelled = false;
      contents.emit(event, {
        url,
        isMainFrame: true,
        preventDefault() {
          cancelled = true;
        },
      });
      assert.equal(cancelled, true, `${event} ${url}`);
    }
    let cancelled = false;
    contents.emit(event, {
      url: "https://example.com/ok",
      isMainFrame: true,
      preventDefault() {
        cancelled = true;
      },
    });
    assert.equal(cancelled, false);
  }
  await assert.rejects(
    f.browser.agentAdapter.loadUrl(f.tab.id, "https://other.example"),
    /blocked/u,
  );
  assert.equal(contents.popup({ url: "https://example.com" }).action, "deny");
});

test("human navigation revokes synchronously and restores direct networking after drain", async (t) => {
  const f = await fixture(t);
  const grant = await f.grant();
  await f.browser.handleRequest(f.owner, f.sender, "navigate", {
    tabId: f.tab.id,
    url: "https://human.example",
  });
  assert.equal(f.host.capabilities.getGrant(grant.id).state, "taken-over");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.network.slice(-3), [
    "drain",
    { mode: "direct" },
    "stop-proxy",
  ]);
  assert.equal(f.browser.agentAdapter.getTab(f.tab.id).controlOwner, "human");
});

test("closing the primary tab revokes and removes refs at the production seam", async (t) => {
  const f = await fixture(t);
  const grant = await f.grant();
  f.browser.agentAdapter.closeTab(f.tab.id);
  assert.equal(f.host.capabilities.getGrant(grant.id).state, "revoked");
});

test("broker IPC accepts only the registered main window main frame", async () => {
  const frame = { url: "colony://app/" };
  const contents = { id: 1, mainFrame: frame };
  const windows = new Map([
    [1, { label: "main", window: { webContents: contents } }],
  ]);
  const ipc = createBrowserBrokerIpcHandler({
    windows,
    trusted: (url) => url === "colony://app/",
    getHost: () => ({ enabled: true, handleRequest: async (_, __, id) => id }),
  });
  assert.deepEqual(
    await ipc({ sender: contents, senderFrame: frame }, "agent-status"),
    { enabled: true },
  );
  assert.equal(
    await ipc({ sender: contents, senderFrame: frame }, "agent-grants"),
    1,
  );
  for (const event of [
    { sender: { id: 2 }, senderFrame: frame },
    { sender: contents, senderFrame: { url: frame.url } },
    { sender: contents, senderFrame: null },
  ])
    await assert.rejects(ipc(event, "agent-grant"), /Untrusted/u);
  frame.url = "https://untrusted.example";
  await assert.rejects(
    ipc({ sender: contents, senderFrame: frame }, "agent-grant"),
    /Untrusted/u,
  );
});

test("history checks the target entry before dispatch and navigation failures propagate", async (t) => {
  const f = await fixture(t);
  await f.grant();
  const contents = f.browser.agentAdapter.webContents(f.tab.id);
  let historyCalls = 0;
  contents.navigationHistory = {
    canGoBack: () => true,
    canGoForward: () => false,
    getAllEntries: () => [
      { url: "https://other.example/" },
      { url: "https://example.com/" },
    ],
    getActiveIndex: () => 1,
    goBack() {
      historyCalls += 1;
    },
  };
  await f.browser.agentAdapter.history(f.tab.id, "back");
  assert.equal(historyCalls, 0);
  assert.equal(
    f.browser.agentAdapter.consumeBlocked(f.tab.id).code,
    "origin_approval_required",
  );
  contents.loadURL = async () => {
    throw new Error("ERR_CONNECTION_REFUSED");
  };
  await assert.rejects(
    f.browser.agentAdapter.loadUrl(f.tab.id, "https://example.com/"),
    /failed/u,
  );
});

test("native Stop failure propagates with revoked access and recovery is window owned", async (t) => {
  const f = await fixture(t);
  const grant = await f.grant();
  const contents = f.browser.agentAdapter.webContents(f.tab.id);
  let unavailable = true;
  contents.stop = () => {
    if (unavailable) throw new Error("native failure");
  };
  await assert.rejects(
    f.host.handleRequest("agent-revoke", { grantId: grant.id }, f.sender.id),
    /recovery/iu,
  );
  assert.equal(f.host.capabilities.getGrant(grant.id).state, "revoked");
  assert.deepEqual(
    await f.host.handleRequest(
      "agent-status",
      { tabId: f.tab.id },
      f.sender.id,
    ),
    { enabled: true, recoveryRequired: true },
  );
  await assert.rejects(
    f.host.handleRequest(
      "agent-recover-control",
      { tabId: f.tab.id },
      f.sender.id + 1000,
    ),
    /unavailable/iu,
  );
  await assert.rejects(f.grant(), /recovery/iu);
  assert.equal(
    f.network.some((item) => item?.mode === "direct"),
    false,
  );
  unavailable = false;
  await f.host.handleRequest(
    "agent-recover-control",
    { tabId: f.tab.id },
    f.sender.id,
  );
  assert.deepEqual(
    await f.host.handleRequest(
      "agent-status",
      { tabId: f.tab.id },
      f.sender.id,
    ),
    { enabled: true, recoveryRequired: false },
  );
  assert.equal((await f.grant()).state, "active");
});

test("failed network cleanup is visible and retained for explicit person recovery", async (t) => {
  const options = {};
  const f = await fixture(t, options);
  const grant = await f.grant();
  options.failDrain = true;
  await f.host.handleRequest(
    "agent-revoke",
    { grantId: grant.id },
    f.sender.id,
  );
  assert.equal(f.host.capabilities.getGrant(grant.id).state, "revoked");
  assert.deepEqual(
    await f.host.handleRequest(
      "agent-status",
      { tabId: f.tab.id },
      f.sender.id,
    ),
    { enabled: true, recoveryRequired: true },
  );
  assert.equal(
    f.network.some((item) => item?.mode === "direct"),
    false,
  );
  assert.equal(
    JSON.stringify(f.host.broker.getLog()).includes("hunter2"),
    false,
  );
  options.failDrain = false;
  await f.host.handleRequest(
    "agent-recover-control",
    { tabId: f.tab.id },
    f.sender.id,
  );
  assert.equal(
    f.network.some((item) => item?.mode === "direct"),
    true,
  );
  assert.deepEqual(
    await f.host.handleRequest(
      "agent-status",
      { tabId: f.tab.id },
      f.sender.id,
    ),
    { enabled: true, recoveryRequired: false },
  );
});

async function gateFixture(t, changes = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), GATE_HOME_PREFIX));
  await chmod(home, 0o700);
  t.after(() => rm(home, { recursive: true, force: true }));
  const config = {
    schema: 1,
    nonce: "c".repeat(64),
    provider: "FAKE",
    expiresAt: Date.now() + 60_000,
    origin: "http://127.0.0.1:43210",
    agentId: "a".repeat(64),
    taskId: "conversation:11111111-1111-4111-8111-111111111111",
    communityOrigin: "https://relay.example",
    businessId: "business-a",
    clientId: null,
    ...changes,
  };
  const marker = path.join(home, GATE_MARKER);
  await writeFile(marker, JSON.stringify(config), { mode: 0o600 });
  const gateEnvironment = {
    HOME: home,
    COLONY_BROWSER_PACKAGED_GATE: "c".repeat(64),
  };
  return { home, marker, config, gateEnvironment };
}

test("packaged production grant needs BOTH gate opt-ins", async (t) => {
  const gate = await gateFixture(t);
  const absent = await fixture(t, { gateEnvironment: { HOME: gate.home } });
  await assert.rejects(
    absent.grant({ allowedOrigins: [gate.config.origin] }),
    /public internet address/iu,
  );
  await rm(gate.marker);
  await assert.rejects(fixture(t, gate), /ENOENT/u);
});

test("packaged gate rejects wrong nonce, provider, expiry, permissions and symlink marker", async (t) => {
  for (const changes of [
    { nonce: "d".repeat(64) },
    { provider: "openai" },
    { expiresAt: 0 },
    { expiresAt: Date.now() + 3600_000 },
    { origin: "http://localhost:43210" },
    { origin: "http://127.0.0.1:43210/path" },
  ]) {
    const gate = await gateFixture(t, changes);
    await assert.rejects(fixture(t, gate), /gate/iu);
  }
  const gate = await gateFixture(t);
  await chmod(gate.home, 0o755);
  await assert.rejects(fixture(t, gate), /private temporary HOME/u);
  await chmod(gate.home, 0o700);
  await chmod(gate.marker, 0o644);
  await assert.rejects(fixture(t, gate), /marker/u);
  await chmod(gate.marker, 0o600);
  const target = path.join(gate.home, "target");
  await writeFile(target, JSON.stringify(gate.config), { mode: 0o600 });
  await rm(gate.marker);
  await symlink(target, gate.marker);
  await assert.rejects(fixture(t, gate), /marker/u);
});

test("packaged grant seam binds one task and origin, preserves refusal hooks and consumes once", async (t) => {
  const gate = await gateFixture(t);
  const f = await fixture(t, gate);
  for (const changed of [
    { agentId: "b".repeat(64) },
    { taskId: "conversation:22222222-2222-4222-8222-222222222222" },
    { communityOrigin: "https://other.example" },
    { allowedOrigins: ["http://127.0.0.1:43211"] },
    { allowedOrigins: [gate.config.origin, "https://example.com"] },
  ])
    await assert.rejects(
      f.grant({ allowedOrigins: [gate.config.origin], ...changed }),
      /exact fixture/u,
    );
  const grant = await f.grant({ allowedOrigins: [gate.config.origin] });
  assert.deepEqual(grant.privateExceptions, ["127.0.0.1:43210"]);
  for (const origin of ["https://127.0.0.1:43210", "https://other.example"]) {
    await assert.rejects(
      f.host.handleRequest(
        "agent-approve-origin",
        { grantId: grant.id, url: origin },
        f.sender.id,
      ),
      /cannot be widened/u,
    );
  }
  assert.deepEqual(f.host.capabilities.getGrant(grant.id).allowedOrigins, [
    gate.config.origin,
  ]);
  const contents = f.browser.agentAdapter.webContents(f.tab.id);
  for (const event of ["will-frame-navigate", "will-redirect"]) {
    for (const [url, blocked] of [
      [gate.config.origin + "/ok", false],
      ["http://127.0.0.1:43211/private", true],
      ["http://192.168.1.1/", true],
      ["file:///private/secret", true],
    ]) {
      let cancelled = false;
      contents.emit(event, {
        url,
        isMainFrame: true,
        preventDefault() {
          cancelled = true;
        },
      });
      assert.equal(cancelled, blocked, `${event} ${url}`);
    }
  }
  await f.host.handleRequest(
    "agent-revoke",
    { grantId: grant.id },
    f.sender.id,
  );
  await assert.rejects(
    f.grant({ allowedOrigins: [gate.config.origin] }),
    /one exact/u,
  );
});
