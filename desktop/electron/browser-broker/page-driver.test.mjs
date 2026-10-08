import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createBroker } from "./broker-core.mjs";
import { createCapabilityStore } from "./capability.mjs";
import {
  ALLOWED_CDP_METHODS,
  ALLOWED_FUNCTION_DECLARATIONS,
  FUNCTIONS,
} from "./cdp-functions.mjs";
import { DriverError } from "./driver-errors.mjs";
import { createPageDriver, extrasFromDom } from "./page-driver.mjs";

const NAME_OF = new Map(
  Object.entries(FUNCTIONS).map(([name, source]) => [source, name]),
);

/** A scripted fake of webContents.debugger plus a tiny page model. */
function createRig({ url = "https://shop.example/cart" } = {}) {
  const state = {
    url,
    title: "Cart",
    loaderId: "loader-1",
    contextCounter: 100,
    boxes: new Map([
      [11, { x: 100, y: 200, width: 80, height: 30 }],
      [12, { x: 100, y: 300, width: 80, height: 30 }],
    ]),
    missing: new Set(),
    hit: true,
    maskFails: false,
    facts: {
      tag: "button",
      buttonType: "submit",
      label: "Pay now",
      inDialog: false,
      form: {
        action: "https://shop.example/pay",
        method: "post",
        fields: [{ role: "textbox", inputType: "text", name: "Note" }],
      },
    },
    ax: [
      {
        nodeId: "1",
        role: { value: "RootWebArea" },
        name: { value: "Cart" },
        childIds: [],
      },
    ],
    domChildren: [],
    screenshotFails: false,
    pageHasText: false,
    connected: true,
  };
  const calls = [];
  let attached = false;
  const listeners = new Map();
  const debuggerFake = {
    isAttached: () => attached,
    attach: () => {
      if (state.attachFails)
        throw new Error("Another debugger is already attached");
      attached = true;
    },
    detach: () => {
      attached = false;
    },
    on: (event, callback) => listeners.set(event, callback),
    emit: (event, ...args) => listeners.get(event)?.(...args),
    async sendCommand(method, params) {
      calls.push({ method, params });
      switch (method) {
        case "Page.getFrameTree":
          return {
            frameTree: { frame: { id: "frame-1", loaderId: state.loaderId } },
          };
        case "Page.createIsolatedWorld":
          state.contextCounter += 1;
          return { executionContextId: state.contextCounter };
        case "DOM.getDocument":
          return {
            root: {
              nodeId: 1,
              backendNodeId: 1,
              nodeType: 9,
              nodeName: "#document",
              documentURL: state.url,
              children: state.domChildren,
            },
          };
        case "DOM.resolveNode":
          if (state.missing.has(params.backendNodeId))
            throw new Error("No node with given id found");
          return { object: { objectId: `obj-${params.backendNodeId}` } };
        case "DOM.getBoxModel": {
          const box = state.boxes.get(params.backendNodeId);
          if (!box) throw new Error("Could not compute box model");
          const { x, y, width, height } = box;
          return {
            model: {
              content: [
                x,
                y,
                x + width,
                y,
                x + width,
                y + height,
                x,
                y + height,
              ],
            },
          };
        }
        case "Runtime.callFunctionOn": {
          const name = NAME_OF.get(params.functionDeclaration);
          if (name === "describe") return { result: { value: state.facts } };
          if (name === "hitTest") return { result: { value: state.hit } };
          if (name === "maskCredentials") {
            if (state.maskFails) return { exceptionDetails: { text: "boom" } };
            return { result: { value: 1 } };
          }
          if (name === "selectOptions")
            return {
              result: { value: { ok: params.arguments[0].value.length > 0 } },
            };
          if (name === "readText") return { result: { value: "visible text" } };
          if (name === "pageHasText")
            return { result: { value: state.pageHasText } };
          if (name === "isConnected")
            return { result: { value: state.connected } };
          return { result: { value: true } };
        }
        case "Accessibility.getFullAXTree":
          return { nodes: state.ax };
        case "Accessibility.getPartialAXTree":
          return {
            nodes: [
              {
                role: { value: "button" },
                name: { value: state.partialName ?? "Pay now" },
              },
            ],
          };
        case "Page.getLayoutMetrics":
          return {
            cssVisualViewport: { clientWidth: 1280, clientHeight: 800 },
            cssContentSize: { width: 1280, height: 6000 },
          };
        case "Page.captureScreenshot":
          if (state.screenshotFails) throw new Error("capture failed");
          return { data: "QUJD" };
        default:
          return {};
      }
    },
  };
  const tab = {
    id: "tab-1",
    businessId: "biz-1",
    clientId: null,
    url,
    title: "Cart",
    loading: false,
    controlOwner: "agent",
  };
  const contents = { debugger: debuggerFake };
  const adapterCalls = [];
  const hooks = {};
  let blocked = null;
  const adapter = {
    getTab: (id) => (id === "tab-1" ? tab : null),
    webContents: (id) => (id === "tab-1" ? contents : null),
    async createTab(options) {
      adapterCalls.push(["createTab", options.url]);
      return { id: "tab-1" };
    },
    async closeTab(id) {
      adapterCalls.push(["closeTab", id]);
    },
    async loadUrl(id, target) {
      adapterCalls.push(["loadUrl", id, target]);
      tab.url = target;
    },
    async history(id, action) {
      adapterCalls.push(["history", id, action]);
    },
    stop: async (id) => {
      adapterCalls.push(["stop", id]);
    },
    setControlOwner: async (id, owner) => {
      adapterCalls.push(["setControlOwner", id, owner]);
      tab.controlOwner = owner;
    },
    consumeBlocked: () => {
      const value = blocked;
      blocked = null;
      return value;
    },
    setBlocked: (value) => {
      blocked = value;
    },
    onDocumentChanged: (callback) => {
      hooks.documentChanged = callback;
    },
    onTabClosed: (callback) => {
      hooks.tabClosed = callback;
    },
    setNavigationGate: (gate) => {
      hooks.gate = gate;
    },
  };
  const driver = createPageDriver({
    adapter,
    pollMs: 1,
    cdpTimeoutMs: 500,
    loadTimeoutMs: 100,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  return {
    state,
    calls,
    driver,
    adapter,
    adapterCalls,
    hooks,
    tab,
    debuggerFake,
    methods: () => calls.map((call) => call.method),
  };
}

test("every page function compiles and the allowlist holds no dangerous domains", () => {
  for (const [name, source] of Object.entries(FUNCTIONS)) {
    assert.doesNotThrow(() => new vm.Script(`(${source})`), name);
  }
  assert.equal(
    ALLOWED_FUNCTION_DECLARATIONS.size,
    Object.keys(FUNCTIONS).length,
  );
  for (const method of ALLOWED_CDP_METHODS) {
    assert.ok(
      !/^(Network|Storage|Fetch|Target|Browser|Emulation|Security|IndexedDB|CacheStorage|DOMStorage|Debugger|Overlay|Tracing|SystemInfo|Page\.navigate|Runtime\.evaluate|Runtime\.compileScript|Runtime\.runScript)/u.test(
        method,
      ),
      method,
    );
  }
  assert.ok(!ALLOWED_CDP_METHODS.has("Runtime.evaluate"));
  assert.ok(!ALLOWED_CDP_METHODS.has("Network.getCookies"));
  assert.ok(!ALLOWED_CDP_METHODS.has("Page.navigate"));
});

test("the driver refuses any CDP method outside the allowlist", async () => {
  const internals = {};
  const rig = createRig();
  const driver = createPageDriver({
    adapter: rig.adapter,
    internals,
    cdpTimeoutMs: 200,
  });
  assert.ok(driver);
  for (const method of [
    "Network.getCookies",
    "Network.getAllCookies",
    "Storage.getCookies",
    "DOMStorage.getDOMStorageItems",
    "Runtime.evaluate",
    "Page.navigate",
    "Target.createTarget",
    "Fetch.enable",
    "Browser.close",
    "Emulation.setUserAgentOverride",
    "Input.synthesizePinchGesture",
  ]) {
    await assert.rejects(
      internals.send("tab-1", method, {}),
      /not allowed/u,
      method,
    );
  }
  assert.ok(
    !rig
      .methods()
      .some((m) =>
        /^(Network|Storage|Runtime\.evaluate|Page\.navigate|Target)/u.test(m),
      ),
  );
  await internals.send("tab-1", "Page.getFrameTree", {});
});

test("a broad scenario only ever sends allowed methods and fixed functions in the isolated world", async () => {
  const rig = createRig();
  rig.state.facts = { ...rig.state.facts, inputType: "file", tag: "input" };
  await rig.driver.snapshot("tab-1");
  await rig.driver.describe("tab-1", 11);
  await rig.driver.click("tab-1", 11);
  await rig.driver.type("tab-1", 11, "hello", { submit: true });
  await rig.driver.select("tab-1", 11, ["a"]);
  await rig.driver.upload("tab-1", 11, "/tmp/x.pdf");
  await rig.driver.scroll("tab-1", { direction: "down" });
  await rig.driver.scroll("tab-1", { direction: "bottom" });
  await rig.driver.screenshot("tab-1", {});
  await rig.driver.readText("tab-1", {});
  await rig.driver.wait("tab-1", { text: "x" }, { timeoutMs: 20 });
  for (const { method, params } of rig.calls) {
    assert.ok(ALLOWED_CDP_METHODS.has(method), method);
    if (method === "Runtime.callFunctionOn")
      assert.ok(ALLOWED_FUNCTION_DECLARATIONS.has(params.functionDeclaration));
    if (method === "DOM.resolveNode")
      assert.ok(Number.isInteger(params.executionContextId));
  }
  assert.ok(
    rig.calls.some(
      (call) =>
        call.method === "Page.createIsolatedWorld" &&
        call.params.worldName === "colony-agent",
    ),
  );
  assert.ok(!rig.methods().includes("Runtime.evaluate"));
});

test("the isolated world is created once per document and again after navigation", async () => {
  const rig = createRig();
  await rig.driver.describe("tab-1", 11);
  await rig.driver.describe("tab-1", 11);
  assert.equal(
    rig.methods().filter((m) => m === "Page.createIsolatedWorld").length,
    1,
  );
  rig.state.loaderId = "loader-2";
  await rig.driver.describe("tab-1", 11);
  assert.equal(
    rig.methods().filter((m) => m === "Page.createIsolatedWorld").length,
    2,
  );
});

test("attach enables the domains once and survives repeated calls", async () => {
  const rig = createRig();
  await rig.driver.describe("tab-1", 11);
  await rig.driver.describe("tab-1", 11);
  assert.equal(rig.methods().filter((m) => m === "Page.enable").length, 1);
  assert.equal(rig.methods().filter((m) => m === "DOM.enable").length, 1);
  assert.equal(
    rig.methods().filter((m) => m === "Accessibility.enable").length,
    1,
  );
});

test("describe merges the accessibility node with page facts and never returns a value", async () => {
  const rig = createRig();
  const described = await rig.driver.describe("tab-1", 11);
  assert.equal(described.element.role, "button");
  assert.equal(described.element.name, "Pay now");
  assert.equal(described.element.buttonType, "submit");
  assert.equal(described.form.action, "https://shop.example/pay");
  assert.ok(!("value" in described.element));
  rig.state.missing.add(11);
  assert.equal(await rig.driver.describe("tab-1", 11), null);
});

test("click is a real mouse sequence at the element centre", async () => {
  const rig = createRig();
  const result = await rig.driver.click("tab-1", 11);
  assert.deepEqual(result, {});
  const events = rig.calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.deepEqual(
    events.map((e) => e.params.type),
    ["mouseMoved", "mousePressed", "mouseReleased"],
  );
  for (const event of events) {
    assert.equal(event.params.x, 140);
    assert.equal(event.params.y, 215);
  }
  const order = rig.methods();
  assert.ok(
    order.indexOf("DOM.scrollIntoViewIfNeeded") <
      order.indexOf("DOM.getBoxModel"),
  );
  assert.ok(
    order.indexOf("DOM.getBoxModel") <
      order.indexOf("Input.dispatchMouseEvent"),
  );
});

test("a covered element is not clicked", async () => {
  const rig = createRig();
  rig.state.hit = false;
  await assert.rejects(
    rig.driver.click("tab-1", 11),
    (error) =>
      error instanceof DriverError && error.driverCode === "click_intercepted",
  );
  assert.equal(rig.methods().includes("Input.dispatchMouseEvent"), false);
});

test("the fence runs right before input and stops the click when it throws", async () => {
  const rig = createRig();
  const seen = [];
  const check = () => {
    seen.push(rig.methods().includes("Input.dispatchMouseEvent"));
    if (seen.length === 2) throw new Error("revoked");
  };
  await assert.rejects(rig.driver.click("tab-1", 11, { check }), /revoked/u);
  assert.deepEqual(seen, [false, false]);
  assert.equal(rig.methods().includes("Input.dispatchMouseEvent"), false);
});

test("zero size, missing or unresolvable elements are not actionable", async () => {
  const rig = createRig();
  rig.state.boxes.set(11, { x: 0, y: 0, width: 0, height: 0 });
  await assert.rejects(
    rig.driver.click("tab-1", 11),
    (e) => e.driverCode === "element_not_actionable",
  );
  await assert.rejects(
    rig.driver.click("tab-1", 99),
    (e) => e.driverCode === "element_not_actionable",
  );
  rig.state.missing.add(12);
  await assert.rejects(
    rig.driver.click("tab-1", 12),
    (e) => e.driverCode === "element_not_actionable",
  );
  await assert.rejects(
    rig.driver.type("tab-1", 12, "x"),
    (e) => e.driverCode === "element_not_actionable",
  );
  assert.equal(rig.methods().includes("Input.dispatchMouseEvent"), false);
});

test("click reports a navigation the host gate blocked", async () => {
  const rig = createRig();
  rig.adapter.setBlocked({
    code: "origin_approval_required",
    origin: "https://evil.example",
  });
  const result = await rig.driver.click("tab-1", 11);
  assert.deepEqual(result, {});
  // The stale block is cleared before input; a block recorded after input is reported.
  const original = rig.debuggerFake.sendCommand;
  rig.debuggerFake.sendCommand = async (method, params) => {
    if (
      method === "Input.dispatchMouseEvent" &&
      params.type === "mouseReleased"
    )
      rig.adapter.setBlocked({
        code: "origin_approval_required",
        origin: "https://evil.example",
      });
    return original(method, params);
  };
  const blocked = await rig.driver.click("tab-1", 11);
  assert.deepEqual(blocked, {
    blocked: {
      code: "origin_approval_required",
      origin: "https://evil.example",
    },
  });
});

test("typing focuses, selects, inserts text and can submit with Enter", async () => {
  const rig = createRig();
  await rig.driver.type("tab-1", 11, "kettle", { submit: true });
  const order = rig.methods();
  assert.ok(order.indexOf("DOM.focus") < order.indexOf("Input.insertText"));
  assert.equal(
    rig.calls.find((c) => c.method === "Input.insertText").params.text,
    "kettle",
  );
  const keys = rig.calls
    .filter((c) => c.method === "Input.dispatchKeyEvent")
    .map((c) => `${c.params.type}:${c.params.key}`);
  assert.deepEqual(keys, ["keyDown:Enter", "keyUp:Enter"]);
  const cleared = createRig();
  await cleared.driver.type("tab-1", 11, "");
  assert.deepEqual(
    cleared.calls
      .filter((c) => c.method === "Input.dispatchKeyEvent")
      .map((c) => c.params.key),
    ["Delete", "Delete"],
  );
  assert.equal(cleared.methods().includes("Input.insertText"), false);
});

test("typing is fenced before text and again before Enter", async () => {
  const rig = createRig();
  let count = 0;
  await assert.rejects(
    rig.driver.type("tab-1", 11, "x", {
      submit: true,
      check: () => {
        count += 1;
        if (count === 2) throw new Error("revoked");
      },
    }),
    /revoked/u,
  );
  assert.ok(rig.methods().includes("Input.insertText"));
  assert.equal(
    rig.calls.filter((c) => c.method === "Input.dispatchKeyEvent").length,
    0,
  );
});

test("select and upload validate the element", async () => {
  const rig = createRig();
  assert.deepEqual(await rig.driver.select("tab-1", 11, ["a"]), {});
  await assert.rejects(
    rig.driver.select("tab-1", 11, []),
    (e) => e.driverCode === "element_not_actionable",
  );
  await assert.rejects(
    rig.driver.upload("tab-1", 11, "/tmp/a.pdf"),
    (e) => e.driverCode === "element_not_actionable",
  );
  rig.state.facts = { ...rig.state.facts, tag: "input", inputType: "file" };
  await rig.driver.upload("tab-1", 11, "/tmp/a.pdf");
  const call = rig.calls.find((c) => c.method === "DOM.setFileInputFiles");
  assert.deepEqual(call.params, { files: ["/tmp/a.pdf"], backendNodeId: 11 });
});

test("screenshots mask credential fields first and unmask afterwards", async () => {
  const rig = createRig();
  const shot = await rig.driver.screenshot("tab-1", {
    maskCredentialFields: true,
  });
  assert.deepEqual(shot, { mimeType: "image/png", data: "QUJD" });
  const fnOrder = rig.calls
    .filter(
      (c) =>
        c.method === "Runtime.callFunctionOn" ||
        c.method === "Page.captureScreenshot",
    )
    .map((c) =>
      c.method === "Page.captureScreenshot"
        ? "capture"
        : NAME_OF.get(c.params.functionDeclaration),
    );
  assert.deepEqual(fnOrder, [
    "maskCredentials",
    "capture",
    "unmaskCredentials",
  ]);
});

test("a failed capture still unmasks, and a failed mask means no capture at all", async () => {
  const failing = createRig();
  failing.state.screenshotFails = true;
  await assert.rejects(failing.driver.screenshot("tab-1", {}));
  assert.ok(
    failing.calls.some(
      (c) =>
        c.method === "Runtime.callFunctionOn" &&
        NAME_OF.get(c.params.functionDeclaration) === "unmaskCredentials",
    ),
  );
  const noMask = createRig();
  noMask.state.maskFails = true;
  await assert.rejects(
    noMask.driver.screenshot("tab-1", {}),
    (e) => e.driverCode === "element_not_actionable",
  );
  assert.equal(noMask.methods().includes("Page.captureScreenshot"), false);
});

test("screenshot clips are scaled to the longest edge limit and fullPage uses the content size", async () => {
  const viewport = createRig();
  await viewport.driver.screenshot("tab-1", {});
  const clip = viewport.calls.find((c) => c.method === "Page.captureScreenshot")
    .params.clip;
  assert.deepEqual([clip.width, clip.height], [1280, 800]);
  assert.ok(Math.abs(clip.scale - 1568 / 1568) <= 1);
  const full = createRig();
  await full.driver.screenshot("tab-1", { fullPage: true });
  const params = full.calls.find(
    (c) => c.method === "Page.captureScreenshot",
  ).params;
  assert.equal(params.clip.height, 6000);
  assert.ok(params.clip.scale < 0.27);
  assert.equal(params.captureBeyondViewport, true);
  const element = createRig();
  await element.driver.screenshot("tab-1", { backendNodeId: 11 });
  assert.deepEqual(
    (({ x, y, width, height }) => ({ x, y, width, height }))(
      element.calls.find((c) => c.method === "Page.captureScreenshot").params
        .clip,
    ),
    { x: 100, y: 200, width: 80, height: 30 },
  );
});

test("snapshot returns the tree, DOM derived extras and the document id", async () => {
  const rig = createRig();
  rig.state.domChildren = [
    {
      nodeType: 1,
      nodeName: "HTML",
      backendNodeId: 2,
      children: [
        {
          nodeType: 1,
          nodeName: "INPUT",
          backendNodeId: 20,
          attributes: ["type", "PASSWORD", "autocomplete", "Current-Password"],
        },
        {
          nodeType: 1,
          nodeName: "A",
          backendNodeId: 21,
          attributes: ["href", "/next?token=abc"],
        },
        {
          nodeType: 1,
          nodeName: "A",
          backendNodeId: 22,
          attributes: ["href", "mailto:a@b.co"],
        },
        {
          nodeType: 1,
          nodeName: "IFRAME",
          backendNodeId: 23,
          attributes: ["src", "https://ads.example/frame"],
        },
        {
          nodeType: 1,
          nodeName: "TEXTAREA",
          backendNodeId: 24,
          attributes: [],
        },
        {
          nodeType: 1,
          nodeName: "DIV",
          backendNodeId: 25,
          attributes: ["type", "x"],
        },
      ],
    },
  ];
  const snap = await rig.driver.snapshot("tab-1");
  assert.equal(snap.documentId, "loader-1");
  assert.equal(snap.url, "https://shop.example/cart");
  assert.equal(snap.nodes.length, 1);
  assert.deepEqual(snap.extras.get(20), {
    type: "password",
    autocomplete: "current-password",
  });
  assert.equal(snap.extras.get(21).href, "https://shop.example/next?token=abc");
  assert.equal(snap.extras.get(22).href, "mailto:a@b.co");
  assert.equal(snap.extras.get(23).origin, "https://ads.example");
  assert.equal(snap.extras.get(24).type, "textarea");
  assert.equal(snap.extras.has(25), false);
});

test("extrasFromDom is bounded and tolerates odd input", () => {
  assert.equal(extrasFromDom(undefined, "https://a.example").size, 0);
  const children = Array.from({ length: 200 }, (_, i) => ({
    nodeType: 1,
    nodeName: "A",
    backendNodeId: i + 10,
    attributes: ["href", "/x"],
  }));
  assert.equal(
    extrasFromDom(
      { nodeType: 9, backendNodeId: 1, children },
      "https://a.example",
      50,
    ).size,
    49,
  );
  const shadow = {
    nodeType: 9,
    backendNodeId: 1,
    children: [],
    shadowRoots: [
      {
        nodeType: 11,
        backendNodeId: 5,
        children: [
          { nodeType: 1, nodeName: "BUTTON", backendNodeId: 6, attributes: [] },
        ],
      },
    ],
  };
  assert.equal(extrasFromDom(shadow, "https://a.example").has(6), true);
  const odd = {
    nodeType: 9,
    backendNodeId: 1,
    children: [
      { nodeType: 1, nodeName: "A", backendNodeId: 7, attributes: ["href"] },
      {
        nodeType: 1,
        nodeName: "A",
        backendNodeId: 8,
        attributes: ["href", "http://[bad"],
      },
    ],
  };
  assert.ok(extrasFromDom(odd, "https://a.example").has(8));
});

test("wait supports text, textGone, ref, url and idle, honours the fence and times out", async () => {
  const rig = createRig();
  rig.state.pageHasText = true;
  assert.deepEqual(
    await rig.driver.wait("tab-1", { text: "Done" }, { timeoutMs: 200 }),
    { matched: true },
  );
  assert.deepEqual(
    await rig.driver.wait("tab-1", { textGone: "Spinner" }, { timeoutMs: 20 }),
    { matched: false },
  );
  rig.state.pageHasText = false;
  assert.deepEqual(
    await rig.driver.wait("tab-1", { textGone: "Spinner" }, { timeoutMs: 200 }),
    { matched: true },
  );
  assert.deepEqual(
    await rig.driver.wait("tab-1", { backendNodeId: 11 }, { timeoutMs: 200 }),
    { matched: true },
  );
  rig.state.missing.add(11);
  assert.deepEqual(
    await rig.driver.wait("tab-1", { backendNodeId: 11 }, { timeoutMs: 20 }),
    { matched: false },
  );
  assert.deepEqual(
    await rig.driver.wait("tab-1", { url: "/cart" }, { timeoutMs: 200 }),
    { matched: true },
  );
  assert.deepEqual(
    await rig.driver.wait("tab-1", { url: "/nope" }, { timeoutMs: 20 }),
    { matched: false },
  );
  assert.deepEqual(
    await rig.driver.wait("tab-1", { idleMs: 5 }, { timeoutMs: 300 }),
    { matched: true },
  );
  rig.tab.loading = true;
  assert.deepEqual(
    await rig.driver.wait("tab-1", { idleMs: 5 }, { timeoutMs: 30 }),
    { matched: false },
  );
  await assert.rejects(
    rig.driver.wait(
      "tab-1",
      { text: "x" },
      {
        timeoutMs: 1_000,
        check: () => {
          throw new Error("fenced");
        },
      },
    ),
    /fenced/u,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    rig.driver.wait(
      "tab-1",
      { text: "x" },
      { timeoutMs: 1_000, signal: controller.signal },
    ),
  );
});

test("read and scroll use real input and bounded text", async () => {
  const rig = createRig();
  assert.deepEqual(await rig.driver.readText("tab-1", { maxChars: 100 }), {
    text: "visible text",
  });
  assert.deepEqual(await rig.driver.readText("tab-1", { backendNodeId: 11 }), {
    text: "visible text",
  });
  await rig.driver.scroll("tab-1", { direction: "down", amount: 300 });
  const wheel = rig.calls.find((c) => c.method === "Input.dispatchMouseEvent");
  assert.deepEqual(
    [wheel.params.type, wheel.params.deltaY, wheel.params.x, wheel.params.y],
    ["mouseWheel", 300, 640, 400],
  );
  await rig.driver.scroll("tab-1", {
    direction: "up",
    backendNodeId: 11,
    amount: 50,
  });
  const second = rig.calls.filter(
    (c) => c.method === "Input.dispatchMouseEvent",
  )[1];
  assert.deepEqual(
    [second.params.deltaY, second.params.x, second.params.y],
    [-50, 140, 215],
  );
});

test("navigation goes through the host adapter and reports blocked redirects", async () => {
  const rig = createRig();
  const ok = await rig.driver.navigate("tab-1", "https://shop.example/k");
  assert.deepEqual(ok, { url: "https://shop.example/k" });
  assert.deepEqual(rig.adapterCalls.at(-1), [
    "loadUrl",
    "tab-1",
    "https://shop.example/k",
  ]);
  assert.equal(rig.methods().includes("Page.navigate"), false);
  const origin = rig.adapter.loadUrl;
  rig.adapter.loadUrl = async (id, target) => {
    await origin(id, target);
    rig.adapter.setBlocked({
      code: "origin_approval_required",
      origin: "https://login.example",
    });
  };
  const blocked = await rig.driver.navigate("tab-1", "https://shop.example/go");
  assert.deepEqual(blocked, {
    blocked: {
      code: "origin_approval_required",
      origin: "https://login.example",
    },
  });
  assert.deepEqual(await rig.driver.history("tab-1", "back"), {});
  assert.deepEqual(rig.adapterCalls.at(-1), ["history", "tab-1", "back"]);
});

test("aborting a navigation stops the tab", async () => {
  const rig = createRig();
  const controller = new AbortController();
  rig.adapter.loadUrl = async () => {
    controller.abort();
  };
  await rig.driver.navigate("tab-1", "https://shop.example/slow", {
    signal: controller.signal,
  });
  assert.ok(rig.adapterCalls.some((call) => call[0] === "stop"));
});

test("open waits for load, close drops the session", async () => {
  const rig = createRig();
  rig.tab.loading = true;
  setTimeout(() => {
    rig.tab.loading = false;
  }, 10);
  const opened = await rig.driver.openTab({
    businessId: "biz-1",
    clientId: null,
    url: "https://shop.example/p",
  });
  assert.equal(opened.id, "tab-1");
  assert.equal(opened.loading, false);
  await rig.driver.describe("tab-1", 11);
  await rig.driver.closeTab("tab-1");
  assert.deepEqual(rig.adapterCalls.at(-1), ["closeTab", "tab-1"]);
  await rig.driver.describe("tab-1", 11);
  assert.equal(rig.methods().filter((m) => m === "Page.enable").length, 2);
});

test("a debugger that cannot attach or has detached fails closed", async () => {
  const rig = createRig();
  rig.state.attachFails = true;
  await assert.rejects(
    rig.driver.snapshot("tab-1"),
    (e) => e.driverCode === "debugger_detached",
  );
  assert.equal(rig.methods().length, 0);
  rig.state.attachFails = false;
  await rig.driver.describe("tab-1", 11);
  rig.debuggerFake.detach();
  rig.debuggerFake.emit("detach", {}, "target closed");
  rig.state.attachFails = true;
  await assert.rejects(
    rig.driver.describe("tab-1", 11),
    (e) => e.driverCode === "debugger_detached",
  );
  await assert.rejects(
    rig.driver.describe("tab-missing", 11),
    (e) => e.driverCode === "tab_crashed",
  );
});

test("a CDP call that never answers times out", async () => {
  const rig = createRig();
  rig.debuggerFake.sendCommand = () => new Promise(() => {});
  await assert.rejects(
    rig.driver.snapshot("tab-1"),
    (e) => e.driverCode === "cdp_timeout",
  );
});

test("attach wires document changes, tab closes and the main frame navigation gate to the broker", () => {
  const rig = createRig();
  const seen = [];
  rig.driver.attach({
    notifyDocumentChanged: (id) => seen.push(["doc", id]),
    notifyTabClosed: (id) => seen.push(["closed", id]),
    checkNavigationSync: (id, url) => {
      seen.push(["gate", id, url]);
      return { allow: false, code: "origin_approval_required" };
    },
  });
  rig.hooks.documentChanged("tab-1");
  rig.hooks.tabClosed("tab-1");
  assert.deepEqual(rig.hooks.gate("tab-1", "https://x.example/", true), {
    allow: false,
    code: "origin_approval_required",
  });
  assert.deepEqual(rig.hooks.gate("tab-1", "https://x.example/", false), {
    allow: true,
  });
  assert.deepEqual(seen, [
    ["doc", "tab-1"],
    ["closed", "tab-1"],
    ["gate", "tab-1", "https://x.example/"],
  ]);
});

test("driver errors reach the agent as their own code through the broker", async () => {
  const rig = createRig();
  rig.state.hit = false;
  const capabilities = createCapabilityStore();
  const broker = createBroker({
    capabilities,
    driver: rig.driver,
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  rig.driver.attach(broker);
  broker.onEvent(() => {});
  rig.state.ax = [
    {
      nodeId: "1",
      role: { value: "RootWebArea" },
      name: { value: "Cart" },
      childIds: ["2"],
    },
    {
      nodeId: "2",
      parentId: "1",
      role: { value: "button" },
      name: { value: "Add to cart" },
      backendDOMNodeId: 11,
      childIds: [],
    },
  ];
  rig.state.facts = {
    tag: "button",
    buttonType: "button",
    label: "Add to cart",
    form: null,
  };
  rig.state.partialName = "Add to cart";
  const { token } = capabilities.issue({
    agentId: "a",
    taskId: "t",
    businessId: "biz-1",
    tabId: "tab-1",
    allowedOrigins: ["https://shop.example"],
  });
  const snap = await broker.call(token, "browser_snapshot", { tab: "tab-1" });
  assert.equal(snap.ok, true, JSON.stringify(snap));
  const ref = /\[ref=(e\d+)\]/u.exec(snap.snapshot)[1];
  const result = await broker.call(token, "browser_click", {
    tab: "tab-1",
    ref,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "click_intercepted");
  assert.ok(!/obj-|stack|node_modules/u.test(JSON.stringify(result)));
  assert.equal(rig.methods().includes("Input.dispatchMouseEvent"), false);
});

test("already aborted input cannot dispatch another CDP command", async () => {
  const rig = createRig();
  await rig.driver.snapshot("tab-1");
  const before = rig.calls.length;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    rig.driver.click("tab-1", 11, { signal: controller.signal }),
  );
  assert.equal(rig.calls.length, before);
});

test("revocation after mouse movement fences the press and release", async () => {
  const rig = createRig();
  await assert.rejects(
    rig.driver.click("tab-1", 11, {
      check() {
        if (
          rig.calls.some((call) => call.method === "Input.dispatchMouseEvent")
        )
          throw new Error("revoked");
      },
    }),
    /revoked/u,
  );
  assert.deepEqual(
    rig.calls
      .filter((call) => call.method === "Input.dispatchMouseEvent")
      .map((call) => call.params.type),
    ["mouseMoved"],
  );
});

test("the production screenshot function masks labelled card and API fields without autocomplete", () => {
  const input = (label, attrs = {}) => {
    const style = new Map();
    return {
      type: "text",
      labels: [{ textContent: label }],
      getAttribute: (key) => attrs[key] ?? null,
      style: {
        getPropertyValue: (key) => style.get(key)?.value ?? "",
        getPropertyPriority: (key) => style.get(key)?.priority ?? "",
        setProperty: (key, value, priority) =>
          style.set(key, { value, priority }),
        removeProperty: (key) => style.delete(key),
      },
    };
  };
  const fields = [
    input("Card number"),
    input("API key"),
    input("Name on card"),
    input("Note"),
  ];
  const doc = { querySelectorAll: () => fields };
  const mask = vm.runInNewContext(`(${FUNCTIONS.maskCredentials})`);
  const unmask = vm.runInNewContext(`(${FUNCTIONS.unmaskCredentials})`);
  mask.call(doc);
  assert.deepEqual(
    fields.map((field) => field.style.getPropertyValue("visibility")),
    ["hidden", "hidden", "hidden", ""],
  );
  unmask.call(doc);
  assert.ok(
    fields.every((field) => field.style.getPropertyValue("visibility") === ""),
  );
});
