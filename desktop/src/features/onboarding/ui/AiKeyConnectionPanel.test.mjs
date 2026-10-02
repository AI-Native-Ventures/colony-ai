import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

// ── Global env setup ─────────────────────────────────────────────────────────
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: dom.window.localStorage,
  self: dom.window,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
  writable: true,
});
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
dom.window.matchMedia ??= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
globalThis.matchMedia = dom.window.matchMedia;
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key === "window" || key === "document" || key === "globalThis") continue;
  const value = dom.window[key];
  if (
    typeof value === "function" &&
    /^(HTML|SVG)|Element$|Event$|EventTarget$|^Node|^Document|Observer$/.test(
      key,
    )
  ) {
    globalThis[key] = value;
  }
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const _origDispatch = dom.window.EventTarget.prototype.dispatchEvent;
dom.window.EventTarget.prototype.dispatchEvent = function (event) {
  if (!(event instanceof dom.window.Event)) return false;
  return _origDispatch.call(this, event);
};
globalThis.EventTarget = dom.window.EventTarget;

let react, rtl, QueryClient, QueryClientProvider, Panel, Credits;
let result = "connected";
let probe = async () => result;
let saveFails = false;
let saves = [];
let gitBashPrerequisite = null;
const clients = [];
const initialConfig = {
  preferred_runtime: "buzz-agent",
  provider: "openrouter",
  model: "vendor/model",
  env_vars: { OPENROUTER_API_KEY: "test-fixture" },
};
const rawRuntime = {
  id: "buzz-agent",
  label: "Colony AI",
  availability: "available",
  command: "buzz-agent",
  avatar_url: "",
  binary_path: "/fixture/buzz-agent",
  default_args: [],
  mcp_command: null,
  model_env_var: "BUZZ_AGENT_MODEL",
  provider_env_var: "BUZZ_AGENT_PROVIDER",
  thinking_env_var: "BUZZ_AGENT_THINKING_EFFORT",
  install_hint: "",
  install_instructions_url: "",
  can_auto_install: false,
  requires_external_cli: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "not_applicable" },
  login_hint: null,
  source: "builtin",
};
globalThis.__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async (command, args) => {
    if (command === "get_global_agent_config") return initialConfig;
    if (command === "discover_git_bash_prerequisite")
      return gitBashPrerequisite;
    if (command === "discover_acp_providers") return [rawRuntime];
    if (command === "discover_agent_models")
      return {
        options: [{ id: "vendor/model", name: "Fixture model" }],
        is_optional: false,
      };
    if (command === "get_runtime_file_config") return null;
    if (command === "get_baked_build_env") return [];
    if (command === "test_ai_connection") return probe(args);
    if (command === "set_global_agent_config") {
      if (saveFails) throw new Error("fixture save failed");
      saves.push(args.config);
      return {
        config: args.config,
        restarted_count: 0,
        failed_restart_count: 0,
      };
    }
    throw new Error(`Unmocked command: ${command}`);
  },
};
dom.window.__TAURI_INTERNALS__ = globalThis.__TAURI_INTERNALS__;

before(async () => {
  react = await import("react");
  rtl = await import("@testing-library/react");
  ({ QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  ));
  ({ AiKeyConnectionPanel: Panel, CreditsComingSoon: Credits } = await import(
    "./AiKeyConnectionPanel.tsx"
  ));
});
afterEach(() => {
  rtl.cleanup();
  for (const client of clients.splice(0)) {
    client.cancelQueries();
    client.clear();
  }
  saves = [];
  saveFails = false;
  result = "connected";
  probe = async () => result;
  gitBashPrerequisite = null;
});
after(() => dom.window.close());
async function mount({ ready = true } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  rtl.render(
    react.createElement(
      QueryClientProvider,
      { client },
      react.createElement(Panel, { openRouter: true }),
    ),
  );
  await rtl.waitFor(() =>
    assert.equal(
      rtl.screen.getByRole("button", { name: "Test connection" }).disabled,
      !ready,
    ),
  );
}
async function click(name) {
  await rtl.act(async () =>
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name })),
  );
}

for (const [outcome, message] of [
  ["key-rejected", "rejected this key"],
  ["insufficient-balance", "insufficient balance"],
  ["network-failure", "Could not reach"],
  ["unknown-model", "model was not found"],
]) {
  test(`mounted provider form explains ${outcome} and blocks Save`, async () => {
    result = outcome;
    await mount();
    await click("Test connection");
    await rtl.waitFor(() =>
      assert.match(
        rtl.screen.getByRole("alert").textContent,
        new RegExp(message),
      ),
    );
    assert.equal(
      rtl.screen.getByRole("button", { name: "Save AI default" }).disabled,
      true,
    );
    assert.equal(saves.length, 0);
  });
}
test("mounted form saves one tested default and failed saves remain retryable", async () => {
  await mount();
  assert.equal(
    rtl.screen.getByRole("button", { name: "Save AI default" }).disabled,
    true,
  );
  await click("Test connection");
  saveFails = true;
  await click("Save AI default");
  assert.match(rtl.screen.getByRole("alert").textContent, /Could not save/);
  saveFails = false;
  await click("Save AI default");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].preferred_runtime, "buzz-agent");
  assert.equal(saves[0].provider, "openrouter");
  assert.equal(saves[0].model, "vendor/model");
  assert.match(
    rtl.screen.getByRole("status").textContent,
    /connected and saved/,
  );
});
test("editing key invalidates a passed connection test", async () => {
  await mount();
  await click("Test connection");
  assert.equal(
    rtl.screen.getByRole("button", { name: "Save AI default" }).disabled,
    false,
  );
  await rtl.act(async () =>
    rtl.fireEvent.change(rtl.screen.getByTestId("persona-provider-api-key"), {
      target: { value: "edited-fixture" },
    }),
  );
  assert.equal(
    rtl.screen.getByRole("button", { name: "Save AI default" }).disabled,
    true,
  );
  assert.equal(saves.length, 0);
});
test("pasted key whitespace is removed from both the tested and saved snapshot", async () => {
  let testedConfig;
  probe = async ({ config }) => {
    testedConfig = config;
    return "connected";
  };
  await mount();
  await rtl.act(async () =>
    rtl.fireEvent.change(rtl.screen.getByTestId("persona-provider-api-key"), {
      target: { value: "  pasted-fixture  " },
    }),
  );
  await click("Test connection");
  await click("Save AI default");
  assert.equal(testedConfig.env_vars.OPENROUTER_API_KEY, "pasted-fixture");
  assert.deepEqual(saves, [testedConfig]);
});
test("configured provider form preserves the Git for Windows prerequisite gate", async () => {
  gitBashPrerequisite = {
    available: false,
    path: null,
    install_instructions_url: "https://gitforwindows.org/",
    install_hint: "Install Git for Windows",
  };
  await mount({ ready: false });
  await rtl.waitFor(() =>
    assert.match(
      rtl.screen.getByRole("alert").textContent,
      /Install Git for Windows/,
    ),
  );
  assert.equal(
    rtl.screen.getByRole("button", { name: "Test connection" }).disabled,
    true,
  );
  assert.equal(
    rtl.screen.getByRole("button", { name: "Save AI default" }).disabled,
    true,
  );
  assert.equal(saves.length, 0);
});
test("an in-flight probe cannot authorize an edited draft", async () => {
  let finish;
  probe = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await mount();
  await click("Test connection");
  await rtl.act(async () =>
    rtl.fireEvent.change(rtl.screen.getByTestId("persona-provider-api-key"), {
      target: { value: "edited-fixture" },
    }),
  );
  await rtl.act(async () => finish("connected"));
  assert.equal(
    rtl.screen.getByRole("button", { name: "Save AI default" }).disabled,
    true,
  );
});
test("credits production component is coming soon with no balance or reload control", () => {
  rtl.render(react.createElement(Credits));
  assert.ok(rtl.screen.getByRole("heading", { name: "Coming soon" }));
  assert.doesNotMatch(
    document.body.textContent,
    /balance|Unavailable|Reload|12\.50/i,
  );
  assert.equal(rtl.screen.queryAllByRole("button").length, 0);
});
