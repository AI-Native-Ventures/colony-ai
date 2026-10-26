import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  readdir,
  symlink,
} from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GATE_MARKER, GATE_HOME_PREFIX } from "./packaged-gate.mjs";
import { DEFAULT_TAB_BOUNDS, createBrowserHost } from "../browser-host.mjs";
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
  const views = [];
  const browser = createBrowserHost({
    userDataPath: dir,
    downloadsPath: path.join(dir, "downloads"),
    session: { fromPartition: () => profile },
    BrowserWindow: options.BrowserWindow,
    WebContentsView: class {
      constructor(viewOptions) {
        this.options = viewOptions;
        this.webContents = new Contents();
        this.webContents.session = profile;
        this.bounds = { x: 0, y: 0, width: 0, height: 0 };
        this.shown = true;
        views.push(this);
      }
      setBounds(bounds) {
        this.bounds = bounds;
      }
      getBounds() {
        return this.bounds;
      }
      setVisible(value) {
        this.shown = value;
      }
    },
  });
  const sender = new Contents();
  const owner = {
    isDestroyed: () => false,
    isVisible: () => options.ownerVisible ?? true,
    isMinimized: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    contentView: {
      children: new Set(),
      addChildView(view) {
        this.children.add(view);
      },
      removeChildView(view) {
        this.children.delete(view);
      },
    },
  };
  const tab = await browser.handleRequest(owner, sender, "create", {
    businessId: "business-a",
  });
  const host = await createElectronBrowserAgentHost({
    browserHost: browser,
    enabled: true,
    uploadStagingRoot: path.join(dir, "uploads"),
    chooseFile: options.chooseFile ?? (async () => null),
    uploadStagingOptions: options.uploadStagingOptions ?? {},
    socketPath: path.join(dir, "s", "b.sock"),
    gateEnvironment: options.gateEnvironment ?? {},
    hostOptions: options.hostOptions ?? {},
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
  return { browser, host, sender, owner, tab, grant, network, dir, views };
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
    { enabled: true, defaultAccess: false },
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

test("after the host stops, the window's polling gets an empty answer, not an error in the app log", async (t) => {
  // The 25 Oct run logged "The agent browser is stopped" four times at quit:
  // the window still refreshed its controls while the host was shutting down.
  const f = await fixture(t);
  const frame = { url: "colony://app/" };
  const windows = new Map([
    [
      f.sender.id,
      { label: "main", window: { webContents: { mainFrame: frame } } },
    ],
  ]);
  const sender = { id: f.sender.id, mainFrame: frame };
  windows.get(f.sender.id).window.webContents = sender;
  const ipc = createBrowserBrokerIpcHandler({
    windows,
    trusted: (url) => url === frame.url,
    getHost: () => f.host,
  });
  const ask = (action, payload = {}) =>
    ipc({ sender, senderFrame: frame }, action, payload);
  assert.deepEqual(await ask("agent-status", { tabId: f.tab.id }), {
    enabled: true,
    defaultAccess: true,
    recoveryRequired: false,
  });
  await f.host.stop();
  assert.deepEqual(await ask("agent-status", { tabId: f.tab.id }), {
    enabled: false,
  });
  for (const action of ["agent-grants", "agent-pending", "agent-log"])
    assert.deepEqual(await ask(action), [], action);
  // Nothing that changes a grant or the page is answered after the stop.
  await assert.rejects(
    ask("agent-grant", { tabId: f.tab.id }),
    /agent browser is stopped/u,
  );
});

test("a redirect the gate stops leaves a notice, never an error page, and a real failure still shows one", async (t) => {
  // The 25 Oct run: the site redirected to an address nobody approved, the
  // gate stopped it, and Chromium's ERR_FAILED for the stopped load became
  // "This page could not be opened" on a page that was only waiting.
  const f = await fixture(t);
  await f.grant();
  const contents = f.browser.agentAdapter.webContents(f.tab.id);
  const sent = [];
  // Host events go to the app window that owns the tab.
  f.sender.send = (_channel, event) => sent.push(event);
  const redirected = { prevented: false };
  contents.loadURL = async (url) => {
    contents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url,
    });
    contents.emit("will-redirect", {
      url: "https://other.example/",
      isMainFrame: true,
      preventDefault: () => {
        redirected.prevented = true;
      },
    });
    contents.emit("did-fail-load", {}, -2, "ERR_FAILED", url, true);
    throw new Error(`ERR_FAILED (-2) loading '${url}'`);
  };
  await f.browser.agentAdapter.loadUrl(f.tab.id, "https://example.com/");
  assert.equal(redirected.prevented, true);
  assert.equal(
    f.browser.agentAdapter.consumeBlocked(f.tab.id).code,
    "origin_approval_required",
  );
  assert.equal(f.browser.agentAdapter.getTab(f.tab.id).error, null);
  assert.equal(
    sent.some(
      (event) =>
        event.type === "navigation-blocked" &&
        event.reason === "origin_approval_required",
    ),
    true,
  );
  assert.equal(
    sent.some((event) => event.type === "state" && event.tab.error),
    false,
  );
  // A load that really fails, on an address the grant allows, still says so.
  contents.loadURL = async (url) => {
    contents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url,
    });
    contents.emit(
      "did-fail-load",
      {},
      -102,
      "ERR_CONNECTION_REFUSED",
      url,
      true,
    );
    throw new Error(`ERR_CONNECTION_REFUSED (-102) loading '${url}'`);
  };
  await assert.rejects(
    f.browser.agentAdapter.loadUrl(f.tab.id, "https://example.com/down"),
    /failed/u,
  );
  assert.match(
    f.browser.agentAdapter.getTab(f.tab.id).error,
    /ERR_CONNECTION_REFUSED/u,
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
    { enabled: true, defaultAccess: true, recoveryRequired: true },
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
    { enabled: true, defaultAccess: true, recoveryRequired: false },
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
    { enabled: true, defaultAccess: true, recoveryRequired: true },
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
    { enabled: true, defaultAccess: true, recoveryRequired: false },
  );
});

async function selectedCopy(f) {
  const [id] = await readdir(path.join(f.dir, "uploads", "payloads"));
  const directory = path.join(f.dir, "uploads", "payloads", id);
  const [name] = await readdir(directory);
  return path.join(directory, name);
}

test("production person selection stages immutable bytes and exposes only an opaque ID", async (t) => {
  let selected;
  const f = await fixture(t, { chooseFile: async () => selected });
  selected = path.join(f.dir, "original.txt");
  await writeFile(selected, "person-approved-original");
  const grant = await f.grant();
  const result = await f.host.handleRequest(
    "agent-choose-upload",
    { grantId: grant.id },
    f.sender.id,
  );
  assert.deepEqual(Object.keys(result).sort(), ["name", "size", "uploadId"]);
  assert.equal(result.name, "original.txt");
  const staged = await selectedCopy(f);
  await writeFile(selected, "replaced-after-selection");
  assert.equal(await readFile(staged, "utf8"), "person-approved-original");
  assert.ok(!JSON.stringify(result).includes(f.dir));
  await f.host.handleRequest(
    "agent-revoke",
    { grantId: grant.id },
    f.sender.id,
  );
  await assert.rejects(readFile(staged), { code: "ENOENT" });
  assert.equal(await readFile(selected, "utf8"), "replaced-after-selection");
  assert.deepEqual(await readdir(path.join(f.dir, "uploads", "records")), []);
});

test("failed staged cleanup survives native and network recovery events until person retries", async (t) => {
  let selected;
  let fail = false;
  const f = await fixture(t, {
    chooseFile: async () => selected,
    uploadStagingOptions: {
      fs: {
        ...filesystem,
        rmdir: async (directory) => {
          if (fail) throw new Error("private-fixture-cleanup-error");
          await filesystem.rmdir(directory);
        },
      },
    },
  });
  selected = path.join(f.dir, "original.txt");
  await writeFile(selected, "approved");
  const grant = await f.grant();
  await f.host.handleRequest(
    "agent-choose-upload",
    { grantId: grant.id },
    f.sender.id,
  );
  const events = [];
  const unsubscribe = f.host.onEvent((event) => events.push(event));
  fail = true;
  await f.host.handleRequest(
    "agent-revoke",
    { grantId: grant.id },
    f.sender.id,
  );
  assert.equal(
    (
      await f.host.handleRequest(
        "agent-status",
        { tabId: f.tab.id },
        f.sender.id,
      )
    ).recoveryRequired,
    true,
  );
  assert.equal(
    (await readdir(path.join(f.dir, "uploads", "records"))).length,
    1,
  );
  const recovery = events.filter((event) => event.type === "control-recovery");
  assert.equal(recovery.at(-1).required, true);
  const failureIndex = events.findIndex(
    (event) =>
      event.type === "agent-action" &&
      event.entry.code === "upload_recovery_required",
  );
  assert.ok(failureIndex >= 0);
  assert.ok(
    events
      .slice(failureIndex)
      .filter((event) => event.type === "control-recovery")
      .every((event) => event.required === true),
    "file cleanup recovery must never disappear after its failure",
  );
  assert.ok(
    !JSON.stringify(f.host.broker.getLog()).includes("private-fixture"),
  );
  await assert.rejects(
    f.host.handleRequest(
      "agent-recover-control",
      { tabId: f.tab.id },
      f.sender.id,
    ),
    /upload recovery/u,
  );
  fail = false;
  await f.host.handleRequest(
    "agent-recover-control",
    { tabId: f.tab.id },
    f.sender.id,
  );
  assert.deepEqual(await readdir(path.join(f.dir, "uploads", "records")), []);
  assert.equal(
    (
      await f.host.handleRequest(
        "agent-status",
        { tabId: f.tab.id },
        f.sender.id,
      )
    ).recoveryRequired,
    false,
  );
  unsubscribe();
});

test("revocation while the person chooses a file prevents staging or issuing upload authority", async (t) => {
  let finish;
  const f = await fixture(t, {
    chooseFile: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const selected = path.join(f.dir, "original.txt");
  await writeFile(selected, "approved");
  const grant = await f.grant();
  const pending = f.host.handleRequest(
    "agent-choose-upload",
    { grantId: grant.id },
    f.sender.id,
  );
  await f.host.handleRequest(
    "agent-revoke",
    { grantId: grant.id },
    f.sender.id,
  );
  finish(selected);
  await assert.rejects(pending, /active grant/u);
  assert.deepEqual(await readdir(path.join(f.dir, "uploads", "records")), []);
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

test("default access is on in the app and an empty default grant is made on the window's own tab", async (t) => {
  const f = await fixture(t);
  assert.equal(f.host.defaultAccess, true);
  const grant = await f.grant({
    allowedOrigins: [],
    defaultAccess: true,
    ttlMs: 60 * 60_000,
  });
  assert.equal(grant.state, "active");
  assert.equal(grant.defaultAccess, true);
  assert.deepEqual(grant.allowedOrigins, []);
  // Containment still precedes the grant, exactly as for a person made grant.
  assert.equal(f.network[0].proxyBypassRules, "<-loopback>");
  // Another window cannot give itself a default grant on this tab.
  await assert.rejects(
    f.host.handleRequest(
      "agent-grant",
      {
        agentId: "b".repeat(64),
        taskId: "conversation:22222222-2222-4222-8222-222222222222",
        communityOrigin: "https://relay.example",
        businessId: "business-a",
        tabId: f.tab.id,
        allowedOrigins: [],
        defaultAccess: true,
      },
      111111,
    ),
    /unavailable/u,
  );
});

test("the packaged gate keeps grants person made: no default access, no empty grant", async (t) => {
  const gate = await gateFixture(t);
  const f = await fixture(t, gate);
  assert.equal(f.host.defaultAccess, false);
  await assert.rejects(
    f.grant({ allowedOrigins: [], defaultAccess: true }),
    /Default browser access is not enabled/u,
  );
  assert.equal(f.host.capabilities.grantsForAgent("a".repeat(64)).length, 0);
});

test("a host built without default access (the Electron fixture) refuses default grants", async (t) => {
  const f = await fixture(t, { hostOptions: { defaultAccess: false } });
  assert.equal(f.host.defaultAccess, false);
  await assert.rejects(
    f.grant({ allowedOrigins: [], defaultAccess: true }),
    /Default browser access is not enabled/u,
  );
});

// ---- shared tabs: the real host and adapter, with a fake page ----

const defaultGrant = (f) =>
  f.grant({ allowedOrigins: [], defaultAccess: true, ttlMs: 60 * 60_000 });

test("the person's key or click in a page is the person; the agent's own input is not", async (t) => {
  const f = await fixture(t);
  const contents = f.browser.agentAdapter.webContents(f.tab.id);
  const seen = [];
  f.browser.agentAdapter.onHumanInput((id) => seen.push(id));
  // A pointer move is not use.
  contents.emit("input-event", {}, { type: "mouseMove" });
  assert.deepEqual(seen, []);
  assert.equal(f.browser.agentAdapter.getTab(f.tab.id).humanInputAt, null);
  // While the agent is the one pressing, nothing counts.
  f.browser.agentAdapter.markAgentInput(f.tab.id, 1);
  contents.emit("input-event", {}, { type: "mouseDown" });
  contents.emit("input-event", {}, { type: "keyDown" });
  f.browser.agentAdapter.markAgentInput(f.tab.id, -1);
  // The page can report the agent's own press just after the command returned.
  contents.emit("input-event", {}, { type: "mouseDown" });
  assert.deepEqual(seen, []);
  await new Promise((resolve) => setTimeout(resolve, 200));
  // The person.
  for (const type of ["mouseDown", "mouseWheel", "keyDown", "char"]) {
    contents.emit("input-event", {}, { type });
  }
  assert.deepEqual(seen, [f.tab.id, f.tab.id, f.tab.id, f.tab.id]);
  assert.equal(
    typeof f.browser.agentAdapter.getTab(f.tab.id).humanInputAt,
    "number",
  );
  // The count never goes below zero, so a stray decrement cannot hide the person.
  f.browser.agentAdapter.markAgentInput(f.tab.id, -1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  contents.emit("input-event", {}, { type: "mouseDown" });
  assert.equal(seen.length, 5);
});

test("the person typing in a tab takes back only that tab from a default task", async (t) => {
  const f = await fixture(t);
  const grant = await defaultGrant(f);
  const second = await f.browser.handleRequest(f.owner, f.sender, "create", {
    businessId: "business-a",
  });
  // The task takes the person's second tab the way an agent call does.
  f.host.broker.notifyHumanInput(second.id);
  const contents = f.browser.agentAdapter.webContents(f.tab.id);
  contents.emit("input-event", {}, { type: "keyDown" });
  assert.equal(f.host.capabilities.getGrant(grant.id).state, "active");
  assert.deepEqual(f.host.capabilities.getGrant(grant.id).tabIds, []);
  assert.equal(f.browser.agentAdapter.getTab(f.tab.id).controlOwner, "human");
});

test("a person's navigation in a default task's tab releases that tab; in a person made task it still ends the task", async (t) => {
  const f = await fixture(t);
  const grant = await defaultGrant(f);
  await f.browser.handleRequest(f.owner, f.sender, "stop", {
    tabId: f.tab.id,
  });
  assert.equal(f.host.capabilities.getGrant(grant.id).state, "active");
  assert.deepEqual(f.host.capabilities.getGrant(grant.id).tabIds, []);

  const g = await fixture(t);
  const manual = await g.grant();
  await g.browser.handleRequest(g.owner, g.sender, "stop", {
    tabId: g.tab.id,
  });
  assert.equal(g.host.capabilities.getGrant(manual.id).state, "taken-over");
});

test("Take over on one tab releases it and the window can only do that for its own tabs", async (t) => {
  const f = await fixture(t);
  const grant = await defaultGrant(f);
  await assert.rejects(
    f.host.handleRequest(
      "agent-release-tab",
      { grantId: grant.id, tabId: f.tab.id },
      111111,
    ),
    /unavailable/u,
  );
  assert.deepEqual(
    await f.host.handleRequest(
      "agent-release-tab",
      { grantId: grant.id, tabId: f.tab.id },
      f.sender.id,
    ),
    { released: true },
  );
  assert.equal(f.host.capabilities.getGrant(grant.id).state, "active");
  assert.equal(f.browser.agentAdapter.getTab(f.tab.id).controlOwner, "human");
});

test("Keep private is a per tab switch the host reports and the broker honours", async (t) => {
  const f = await fixture(t);
  const grant = await defaultGrant(f);
  const state = await f.browser.handleRequest(
    f.owner,
    f.sender,
    "set-private",
    {
      tabId: f.tab.id,
      private: true,
    },
  );
  assert.equal(state.private, true);
  assert.equal(f.browser.agentAdapter.getTab(f.tab.id).private, true);
  assert.deepEqual(f.host.capabilities.getGrant(grant.id).tabIds, []);
  await assert.rejects(
    f.browser.handleRequest(f.owner, f.sender, "set-private", {
      tabId: f.tab.id,
      private: "yes",
    }),
    /Invalid browser privacy setting/u,
  );
  const back = await f.browser.handleRequest(f.owner, f.sender, "set-private", {
    tabId: f.tab.id,
    private: false,
  });
  assert.equal(back.private, false);
  // Only the owning window can change it.
  await assert.rejects(
    f.browser.handleRequest(f.owner, { ...f.sender, id: 999 }, "set-private", {
      tabId: f.tab.id,
      private: true,
    }),
  );
});

test("a tab a window listed is shared with the business's agents only through the adapter, never the renderer view", async (t) => {
  const f = await fixture(t);
  const second = await f.browser.handleRequest(f.owner, f.sender, "create", {
    businessId: "business-b",
  });
  const tabs = f.browser.agentAdapter.listTabs("business-a", null);
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [f.tab.id],
  );
  assert.ok(Object.hasOwn(tabs[0], "humanInputAt"));
  // The window's own list carries the privacy flag but not input timing.
  const listed = await f.browser.handleRequest(f.owner, f.sender, "list", {});
  assert.equal(
    listed.every((tab) => tab.private === false),
    true,
  );
  assert.equal(
    listed.some((tab) => Object.hasOwn(tab, "humanInputAt")),
    false,
  );
  assert.ok(second.id);
});

test("a view the dock never mounted still has a real size, and views never throttle in the background", async (t) => {
  const f = await fixture(t);
  const [view] = f.views;
  assert.equal(view.options.webPreferences.backgroundThrottling, false);
  assert.deepEqual(view.bounds, DEFAULT_TAB_BOUNDS);
  assert.equal(f.tab.attached, false);
});

class FakeStage {
  static made = [];
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.opacity = 1;
    this.shown = false;
    this.contentView = {
      children: new Set(),
      addChildView: (view) => this.contentView.children.add(view),
      removeChildView: (view) => this.contentView.children.delete(view),
    };
    FakeStage.made.push(this);
  }
  setIgnoreMouseEvents(value) {
    this.clickThrough = value;
  }
  setOpacity(value) {
    this.opacity = value;
  }
  showInactive() {
    this.shown = true;
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}

test("a page that is not on screen is drawn on a transparent click through stage for a screenshot, then goes back exactly where it was", async (t) => {
  FakeStage.made = [];
  const f = await fixture(t, { BrowserWindow: FakeStage });
  const view = f.views[0];
  const bounds = { x: 10, y: 20, width: 640, height: 480 };
  await f.browser.handleRequest(f.owner, f.sender, "attach", {
    tabId: f.tab.id,
    bounds,
    visible: false,
  });
  assert.ok(f.owner.contentView.children.has(view));
  const lease = await f.browser.agentAdapter.renderLease(f.tab.id);
  assert.equal(lease.staged, true);
  const [stage] = FakeStage.made;
  assert.equal(stage.opacity, 0);
  assert.equal(stage.clickThrough, true);
  assert.equal(stage.options.focusable, false);
  assert.equal(stage.options.skipTaskbar, true);
  assert.equal(stage.shown, true);
  assert.ok(stage.contentView.children.has(view));
  assert.equal(f.owner.contentView.children.has(view), false);
  assert.equal(view.shown, true);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 640, height: 480 });
  // The app's show or hide arrives while it is out: it waits for the page to return.
  let attached = false;
  const attaching = f.browser
    .handleRequest(f.owner, f.sender, "attach", {
      tabId: f.tab.id,
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      visible: true,
    })
    .then(() => {
      attached = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attached, false);
  await lease.release();
  await lease.release();
  await attaching;
  assert.equal(stage.destroyed, true);
  assert.ok(f.owner.contentView.children.has(view));
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 300, height: 200 });
  assert.equal(view.shown, true);
});

test("a page that is already on screen is left alone unless the caller asks for the stage", async (t) => {
  FakeStage.made = [];
  const f = await fixture(t, { BrowserWindow: FakeStage });
  await f.browser.handleRequest(f.owner, f.sender, "attach", {
    tabId: f.tab.id,
    bounds: { x: 0, y: 0, width: 640, height: 480 },
    visible: true,
  });
  const lease = await f.browser.agentAdapter.renderLease(f.tab.id);
  assert.equal(lease.staged, false);
  assert.equal(FakeStage.made.length, 0);
  await lease.release();
  const forced = await f.browser.agentAdapter.renderLease(f.tab.id, {
    force: true,
  });
  assert.equal(forced.staged, true);
  await forced.release();
  assert.ok(f.owner.contentView.children.has(f.views[0]));
});

test("a page in a hidden window is staged even though the app thinks it is visible", async (t) => {
  FakeStage.made = [];
  const f = await fixture(t, { BrowserWindow: FakeStage, ownerVisible: false });
  await f.browser.handleRequest(f.owner, f.sender, "attach", {
    tabId: f.tab.id,
    bounds: { x: 0, y: 0, width: 640, height: 480 },
    visible: true,
  });
  const lease = await f.browser.agentAdapter.renderLease(f.tab.id);
  assert.equal(lease.staged, true);
  await lease.release();
});

test("two screenshots take the stage one after the other and a closed page ends its turn", async (t) => {
  FakeStage.made = [];
  const f = await fixture(t, { BrowserWindow: FakeStage });
  const second = await f.browser.handleRequest(f.owner, f.sender, "create", {
    businessId: "business-a",
  });
  const first = await f.browser.agentAdapter.renderLease(f.tab.id);
  let secondStarted = false;
  const waiting = f.browser.agentAdapter
    .renderLease(second.id)
    .then((lease) => {
      secondStarted = true;
      return lease;
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(secondStarted, false);
  // The first page is closed while it is out.
  await f.browser.handleRequest(f.owner, f.sender, "close", {
    tabId: f.tab.id,
  });
  await first.release();
  const lease = await waiting;
  assert.equal(lease.staged, true);
  await lease.release();
  assert.equal(
    FakeStage.made.every((stage) => stage.destroyed),
    true,
  );
});
