import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDeepLinkRouter,
  deepLinkSchemesFromConfig,
  isDeepLinkUrl,
  registerDeepLinkSchemes,
} from "./deep-links.mjs";

const desktopRoot = new URL("../", import.meta.url);
const config = JSON.parse(
  await readFile(new URL("src-tauri/tauri.conf.json", desktopRoot), "utf8"),
);
const schemes = deepLinkSchemesFromConfig(config);

function fakeHost() {
  const calls = [];
  return {
    calls,
    request: async (...args) => calls.push(args),
  };
}

test("reads and validates the app URL schemes from the Tauri config", () => {
  assert.deepEqual(schemes, ["buzz"]);
  assert.deepEqual(
    deepLinkSchemesFromConfig({
      plugins: {
        "deep-link": {
          desktop: { schemes: ["Colony", "bad value", 4, "colony"] },
        },
      },
    }),
    ["colony"],
  );
  assert.equal(isDeepLinkUrl("buzz://message?channel=1&id=2", schemes), true);
  assert.equal(isDeepLinkUrl("https://example.test", schemes), false);
  assert.equal(isDeepLinkUrl("buzz:/message", schemes), false);
  assert.equal(isDeepLinkUrl("javascript:alert(1)", schemes), false);
});

test("registers URL schemes for packaged and development Electron apps", () => {
  const calls = [];
  const app = {
    setAsDefaultProtocolClient: (...args) => {
      calls.push(args);
      return true;
    },
  };

  assert.deepEqual(registerDeepLinkSchemes(app, schemes), [true]);
  assert.deepEqual(
    registerDeepLinkSchemes(app, schemes, {
      isDefaultApp: true,
      executablePath: "/Applications/Electron.app/Contents/MacOS/Electron",
      appPath: "/work/desktop",
    }),
    [true],
  );
  assert.deepEqual(calls, [
    ["buzz"],
    [
      "buzz",
      "/Applications/Electron.app/Contents/MacOS/Electron",
      ["/work/desktop"],
    ],
  ]);
  assert.throws(
    () => registerDeepLinkSchemes(app, schemes, { isDefaultApp: true }),
    /needs an app path/,
  );
});

test("forwards initial, open-url, and second-instance links through the host command", async () => {
  const host = fakeHost();
  let reveals = 0;
  const errors = [];
  const router = createDeepLinkRouter({
    schemes,
    revealWindow: () => reveals++,
    onError: (error) => errors.push(error),
  });

  router.handleInitialArgv([
    "/work/desktop/electron/main.mjs",
    "buzz://message?channel=first&id=event-a",
  ]);
  const prevented = [];
  router.handleOpenUrl(
    { preventDefault: () => prevented.push(true) },
    "buzz://connect?relay=wss%3A%2F%2Fcanary.example",
  );
  router.handleSecondInstance([
    "/Applications/Colony.app",
    "buzz://message?channel=second&id=event-b",
  ]);

  await router.setHost(host);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(prevented, [true]);
  assert.deepEqual(
    host.calls.map(([, payload]) => payload),
    [
      {
        command: "handle_electron_deep_link",
        args: { url: "buzz://message?channel=first&id=event-a" },
      },
      {
        command: "handle_electron_deep_link",
        args: { url: "buzz://connect?relay=wss%3A%2F%2Fcanary.example" },
      },
      {
        command: "handle_electron_deep_link",
        args: { url: "buzz://message?channel=second&id=event-b" },
      },
    ],
  );
  assert.equal(reveals, 3);
  assert.deepEqual(errors, []);
});

test("deduplicates a macOS open-url delivery that also arrived in initial argv", async () => {
  const host = fakeHost();
  const router = createDeepLinkRouter({ schemes, revealWindow() {} });
  const url = "buzz://join?relay=wss%3A%2F%2Fcanary.example&code=abc";
  router.handleInitialArgv([url]);
  router.handleOpenUrl({ preventDefault() {} }, url);
  await router.setHost(host);

  assert.equal(host.calls.length, 1);
  assert.deepEqual(host.calls[0][1], {
    command: "handle_electron_deep_link",
    args: { url },
  });
});

test("does not queue the same deep link twice while the native host is starting", async () => {
  const host = fakeHost();
  let time = 0;
  const router = createDeepLinkRouter({
    schemes,
    revealWindow() {},
    now: () => time,
  });
  const url = "buzz://message?channel=first&id=event-a";

  router.handleInitialArgv([url]);
  time = 2000;
  router.handleSecondInstance([url]);
  await router.setHost(host);

  assert.equal(host.calls.length, 1);
});

test("keeps a failed route pending so an explicit retry can deliver it", async () => {
  const failed = new Error("host disconnected");
  let shouldFail = true;
  const calls = [];
  const host = {
    request: async (...args) => {
      calls.push(args);
      if (shouldFail) throw failed;
    },
  };
  const errors = [];
  const router = createDeepLinkRouter({
    host,
    schemes,
    revealWindow() {},
    onError: (error) => errors.push(error),
  });
  const url = "buzz://channel/01234567-89ab-cdef-0123-456789abcdef";

  router.handleOpenUrl({ preventDefault() {} }, url);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, [failed]);

  shouldFail = false;
  await router.retryPending();
  assert.equal(calls.length, 2);
});
