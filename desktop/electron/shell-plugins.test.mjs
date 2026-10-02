import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createShellPlugins } from "./shell-plugins.mjs";

function createHarness({ withDock = true, backgroundMode = false } = {}) {
  const calls = [];
  const emitted = [];
  const window = new EventEmitter();
  window.getContentBounds = () => {
    calls.push(["getContentBounds"]);
    return { width: 800, height: 450 };
  };
  window.isFullScreen = () => {
    calls.push(["isFullScreen"]);
    return true;
  };
  window.setFullScreen = (value) => {
    calls.push(["setFullScreen", value]);
  };
  window.isMinimized = () => false;
  window.isDestroyed = () => false;
  window.isFocused = () => {
    calls.push(["isFocused"]);
    return false;
  };
  window.setTitle = (value) => calls.push(["setTitle", value]);
  window.show = () => calls.push(["show"]);
  window.showInactive = () => calls.push(["showInactive"]);
  window.hide = () => calls.push(["hide"]);
  window.minimize = () => calls.push(["minimize"]);
  window.restore = () => calls.push(["restore"]);
  window.focus = () => calls.push(["focus"]);
  window.close = () => calls.push(["close"]);
  window.flashFrame = (value) => calls.push(["flashFrame", value]);
  window.webContents = {
    executeJavaScript: async (source) => {
      calls.push(["executeJavaScript", source]);
      return 2;
    },
    setZoomFactor: (value) => calls.push(["setZoomFactor", value]),
  };

  const app = {
    getVersion: () => {
      calls.push(["getVersion"]);
      return "0.5.23";
    },
    getName: () => {
      calls.push(["getName"]);
      return "Colony";
    },
    setBadgeCount: (value) => calls.push(["setBadgeCount", value]),
    relaunch: () => calls.push(["relaunch"]),
    quit: () => calls.push(["quit"]),
    exit: (code) => calls.push(["exit", code]),
  };
  if (withDock) {
    app.dock = {
      setBadge: (value) => calls.push(["setBadge", value]),
      bounce: (type) => {
        calls.push(["bounce", type]);
        return 41;
      },
      cancelBounce: (id) => calls.push(["cancelBounce", id]),
    };
  }

  const shell = {
    openExternal: async (url) => calls.push(["openExternal", url]),
    openPath: (path) => calls.push(["openPath", path]),
    showItemInFolder: (path) => calls.push(["showItemInFolder", path]),
  };
  const clipboard = {
    write: (value) => calls.push(["clipboardWrite", value]),
    writeText: (value) => calls.push(["clipboardWriteText", value]),
    readText: () => {
      calls.push(["clipboardReadText"]);
      return "clipboard-value";
    },
  };
  const dialog = {
    showOpenDialog: async (...args) => {
      calls.push(["showOpenDialog", ...args]);
      return { canceled: true, filePaths: [] };
    },
    showSaveDialog: async (...args) => {
      calls.push(["showSaveDialog", ...args]);
      return { canceled: true, filePath: undefined };
    },
  };
  const notifications = [];
  class TestNotification extends EventEmitter {
    static isSupported() {
      return true;
    }

    constructor(options) {
      super();
      this.options = options;
      notifications.push(this);
      calls.push(["notification", options]);
    }

    show() {
      calls.push(["notificationShow"]);
    }
  }
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseDarkColors = true;
  const plugins = createShellPlugins({
    app,
    shell,
    clipboard,
    dialog,
    Notification: TestNotification,
    backgroundMode,
    nativeTheme,
    getWindow: () => window,
    emit: (eventName, payload) => emitted.push({ eventName, payload }),
  });

  return {
    app,
    calls,
    clipboard,
    dialog,
    emitted,
    nativeTheme,
    notifications,
    plugins,
    shell,
    window,
  };
}

const commandCases = [
  {
    command: "plugin:window|scale_factor",
    result: 2,
    calls: [["executeJavaScript", "window.devicePixelRatio"]],
  },
  {
    command: "plugin:window|inner_size",
    result: { width: 1600, height: 900 },
    calls: [
      ["getContentBounds"],
      ["executeJavaScript", "window.devicePixelRatio"],
    ],
  },
  {
    command: "plugin:window|is_fullscreen",
    result: true,
    calls: [["isFullScreen"]],
  },
  {
    command: "plugin:window|set_fullscreen",
    args: { value: true },
    result: null,
    calls: [["setFullScreen", true]],
  },
  {
    command: "plugin:window|is_focused",
    result: false,
    calls: [["isFocused"]],
  },
  { command: "plugin:window|theme", result: "dark", calls: [] },
  {
    command: "plugin:window|set_title",
    args: { value: "Colony" },
    result: null,
    calls: [["setTitle", "Colony"]],
  },
  {
    command: "plugin:window|show",
    result: null,
    calls: [["show"]],
  },
  {
    command: "plugin:window|hide",
    result: null,
    calls: [["hide"]],
  },
  {
    command: "plugin:window|minimize",
    result: null,
    calls: [["minimize"]],
  },
  {
    command: "plugin:window|unminimize",
    result: null,
    calls: [["restore"]],
  },
  {
    command: "plugin:window|set_focus",
    result: null,
    calls: [["focus"]],
  },
  {
    command: "plugin:window|close",
    result: null,
    calls: [["close"]],
  },
  {
    command: "plugin:window|start_dragging",
    result: null,
    calls: [],
  },
  {
    command: "plugin:window|set_badge_count",
    args: { value: 7 },
    result: null,
    calls: [["setBadgeCount", 7]],
  },
  {
    command: "plugin:window|set_badge_label",
    args: { value: " " },
    result: null,
    calls: [["setBadge", " "]],
  },
  {
    command: "plugin:window|request_user_attention",
    args: { value: { type: "Informational" } },
    result: null,
    calls: [["bounce", "informational"]],
  },
  {
    command: "plugin:webview|set_webview_zoom",
    args: { value: 1 },
    result: null,
    calls: [["setZoomFactor", 1]],
  },
  {
    command: "plugin:app|version",
    result: "0.5.23",
    calls: [["getVersion"]],
  },
  {
    command: "plugin:app|name",
    result: "Colony",
    calls: [["getName"]],
  },
  {
    command: "plugin:process|restart",
    result: null,
    calls: [["relaunch"], ["quit"]],
  },
  {
    command: "plugin:process|exit",
    args: { code: 9 },
    result: null,
    calls: [["exit", 9]],
  },
  {
    command: "plugin:opener|open_url",
    args: { url: "https://example.test/path" },
    result: null,
    calls: [["openExternal", "https://example.test/path"]],
  },
  {
    command: "copy_text_to_clipboard",
    args: { text: "plain", html: "<b>rich</b>" },
    result: null,
    calls: [["clipboardWrite", { text: "plain", html: "<b>rich</b>" }]],
  },
  {
    command: "read_clipboard_text",
    result: "clipboard-value",
    calls: [["clipboardReadText"]],
  },
];

for (const { command, args, result, calls } of commandCases) {
  test(`${command} maps to the Electron shell`, async () => {
    const harness = createHarness();
    assert.equal(harness.plugins.handles(command), true);
    assert.deepEqual(await harness.plugins.invoke(command, args), result);
    assert.deepEqual(harness.calls, calls);
  });
}

test("request_user_attention maps critical requests and clears them", async () => {
  const harness = createHarness();
  await harness.plugins.invoke("plugin:window|request_user_attention", {
    value: { type: "Critical" },
  });
  await harness.plugins.invoke("plugin:window|request_user_attention", {
    value: null,
  });
  assert.deepEqual(harness.calls, [
    ["bounce", "critical"],
    ["cancelBounce", 41],
  ]);
});

test("request_user_attention flashes non-macOS windows and can stop flashing", async () => {
  const harness = createHarness({ withDock: false });
  await harness.plugins.invoke("plugin:window|request_user_attention", {
    value: { type: "Informational" },
  });
  await harness.plugins.invoke("plugin:window|request_user_attention", {
    value: null,
  });
  assert.deepEqual(harness.calls, [
    ["flashFrame", true],
    ["flashFrame", false],
  ]);
});

test("badge commands clear their Electron badge values", async () => {
  const harness = createHarness();
  await harness.plugins.invoke("plugin:window|set_badge_count", {
    value: undefined,
  });
  await harness.plugins.invoke("plugin:window|set_badge_label", {
    value: undefined,
  });
  assert.deepEqual(harness.calls, [
    ["setBadgeCount", 0],
    ["setBadge", ""],
  ]);
});

test("process exit defaults to code zero", async () => {
  const harness = createHarness();
  await harness.plugins.invoke("plugin:process|exit");
  assert.deepEqual(harness.calls, [["exit", 0]]);
});

test("routes exact app services and the supported Electron shell families", () => {
  const { plugins } = createHarness();
  for (const command of [
    "plugin:window|unknown_window_call",
    "plugin:webview|unknown_webview_call",
    "plugin:app|unknown_app_call",
    "plugin:process|restart",
    "plugin:process|exit",
    "plugin:dialog|open",
    "plugin:dialog|save",
    "plugin:opener|open_url",
    "copy_text_to_clipboard",
    "read_clipboard_text",
    "show_native_notification",
  ]) {
    assert.equal(plugins.handles(command), true, command);
  }
  for (const command of [
    "plugin:process|unknown_process_call",
    "plugin:dialog|unknown",
    "plugin:opener|open_path",
    "plugin:opener|reveal_item_in_dir",
    "plugin:notification|is_permission_granted",
    "plugin:notification|request_permission",
    "plugin:updater|check",
    "plugin:updater|download",
    "plugin:updater|install",
    "plugin:updater|download_and_install",
    "plugin:path|resolve_directory",
  ]) {
    assert.equal(plugins.handles(command), false, command);
  }
});

test("updater and path plugin calls remain host-owned", () => {
  const { calls, plugins } = createHarness();
  assert.equal(plugins.handles("plugin:updater|check"), false);
  assert.equal(plugins.handles("plugin:path|resolve_directory"), false);
  assert.deepEqual(calls, []);
});

test("opener rejects unsafe URLs before asking Electron to launch them", async () => {
  const { calls, plugins } = createHarness();
  await assert.rejects(
    plugins.invoke("plugin:opener|open_url", { url: "javascript:alert(1)" }),
    /Unsupported external URL protocol/,
  );
  await assert.rejects(
    plugins.invoke("plugin:opener|open_url", { url: "not a URL" }),
    /Invalid external URL/,
  );
  assert.deepEqual(calls, []);
});

test("native message notification click reveals the window and forwards its target", async () => {
  const { calls, emitted, notifications, plugins } = createHarness();
  await plugins.invoke("show_native_notification", {
    title: "Message in #general",
    body: "Hello",
    target: { channelId: "channel-1", eventId: "event-1" },
  });
  assert.deepEqual(calls, [
    [
      "notification",
      { title: "Message in #general", body: "Hello", silent: true },
    ],
    ["notificationShow"],
  ]);
  notifications[0].emit("click");
  assert.deepEqual(calls.slice(2), [["show"], ["focus"]]);
  assert.deepEqual(emitted, [
    {
      eventName: "electron-shell:notification-activated",
      payload: { channelId: "channel-1", eventId: "event-1" },
    },
  ]);
});

test("notification click preserves background mode without focusing the app", async () => {
  const { calls, notifications, plugins } = createHarness({
    backgroundMode: true,
  });
  await plugins.invoke("show_native_notification", {
    title: "Background check",
    body: "No focus change",
  });

  notifications[0].emit("click");

  assert.deepEqual(calls.slice(2), [["showInactive"]]);
});

test("unknown shell commands fail with their command name", async () => {
  const { plugins } = createHarness();
  await assert.rejects(plugins.invoke("plugin:window|unknown_window_call"), {
    message: "Unsupported shell command: plugin:window|unknown_window_call",
  });
  await assert.rejects(plugins.invoke("plugin:webview|unknown_webview_call"), {
    message: "Unsupported shell command: plugin:webview|unknown_webview_call",
  });
  await assert.rejects(plugins.invoke("plugin:app|unknown_app_call"), {
    message: "Unsupported shell command: plugin:app|unknown_app_call",
  });
});

test("resize listener emits the Tauri physical size payload and disposes", async () => {
  const harness = createHarness();
  const dispose = harness.plugins.attachWindowEvents(harness.window);
  harness.window.emit("resize");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.emitted, [
    {
      eventName: "tauri://resize",
      payload: { width: 1600, height: 900 },
    },
  ]);

  dispose();
  harness.window.emit("resize");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.emitted.length, 1);
});

test("fullscreen enter and leave events update the Tauri resize subscribers", async () => {
  const harness = createHarness();
  const dispose = harness.plugins.attachWindowEvents(harness.window);
  harness.window.emit("enter-full-screen");
  await new Promise((resolve) => setImmediate(resolve));
  harness.window.emit("leave-full-screen");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.emitted, [
    {
      eventName: "tauri://resize",
      payload: { width: 1600, height: 900 },
    },
    {
      eventName: "tauri://resize",
      payload: { width: 1600, height: 900 },
    },
  ]);
  dispose();
});

test("theme listener emits the Tauri theme payload and disposes", () => {
  const harness = createHarness();
  const dispose = harness.plugins.attachWindowEvents(harness.window);
  harness.nativeTheme.shouldUseDarkColors = false;
  harness.nativeTheme.emit("updated");
  assert.deepEqual(harness.emitted, [
    { eventName: "tauri://theme-changed", payload: "light" },
  ]);

  dispose();
  harness.nativeTheme.shouldUseDarkColors = true;
  harness.nativeTheme.emit("updated");
  assert.equal(harness.emitted.length, 1);
});
