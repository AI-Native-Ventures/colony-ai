// Runs INSIDE Electron's main process (see run-browser-smoke.mjs). It drives the
// real browser host (`electron/browser-host.mjs`) over real Chromium sessions
// and a local fixture site, and proves what the mock-bridge spec cannot:
//
//   1. two businesses do not share cookies, localStorage or IndexedDB, while one
//      business keeps them across tabs and new windows;
//   2. pages see no desktop bridge and every permission request is denied;
//   3. file:, javascript:, data: and credentialed URLs never load, from the
//      address bar path or from window.open;
//   4. a download lands in the user's Downloads folder under a collision-free
//      name, with a visible result and Show in folder, and a window opened by
//      a page joins the same profile;
//   5. forgetting a business clears its storage but never the person's files;
//   6. the kill switch refuses tabs.
//
// Output is one PASS or FAIL line per check; the exit code is the verdict.
// It never touches the user's real Downloads folder or app data: both are
// redirected to a temporary directory before Electron is ready.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, WebContentsView, app, session } from "electron";

import { createBrowserHost } from "../../electron/browser-host.mjs";
import { startFixtureSite } from "./browser-fixture-site.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "colony-browser-smoke-"));
const userData = path.join(root, "user-data");
const downloads = path.join(root, "Downloads");
mkdirSync(userData, { recursive: true });
mkdirSync(downloads, { recursive: true });
app.setPath("userData", userData);
app.setPath("downloads", downloads);
app.disableHardwareAcceleration();
if (process.platform === "darwin") app.dock?.hide();

const results = [];
function pass(name) {
  results.push({ name, ok: true });
  console.log(`PASS ${name}`);
}
function fail(name, detail) {
  results.push({ name, ok: false });
  console.log(`FAIL ${name}: ${detail}`);
}
async function check(name, run) {
  try {
    await run();
    pass(name);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(read, label, timeoutMs = 25_000) {
  const started = Date.now();
  let last;
  for (;;) {
    last = await read();
    if (last) return last;
    if (Date.now() - started > timeoutMs)
      throw new Error(`timed out: ${label}`);
    await sleep(60);
  }
}

async function main() {
  await app.whenReady();
  const { server, base } = await startFixtureSite();
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  await window.loadURL("about:blank");

  const events = [];
  const sender = {
    id: window.webContents.id,
    isDestroyed: () => window.webContents.isDestroyed(),
    send: (_channel, event) => events.push(event),
    focus: () => {},
  };
  const revealed = [];
  const host = createBrowserHost({
    WebContentsView,
    session,
    userDataPath: userData,
    downloadsPath: downloads,
    showItemInFolder: (target) => revealed.push(target),
  });
  const request = (action, payload = {}) =>
    host.handleRequest(window, sender, action, payload);
  const bounds = { x: 0, y: 0, width: 640, height: 420 };

  async function openProbe(businessId, search = "") {
    const tab = await request("create", {
      businessId,
      url: `${base}/probe${search}`,
    });
    await request("attach", { tabId: tab.id, bounds, visible: true });
    const result = await waitFor(async () => {
      const [current] = (await request("list")).filter(
        (entry) => entry.id === tab.id,
      );
      if (!current?.title || current.title === "pending") return null;
      try {
        return JSON.parse(current.title);
      } catch {
        return null;
      }
    }, `probe result for ${businessId}${search}`);
    return { tab, result };
  }

  const a1 = {};
  await check(
    "business A stores a cookie, localStorage and IndexedDB",
    async () => {
      const opened = await openProbe("smoke-business-a", "?set=A");
      a1.tab = opened.tab;
      assert(
        opened.result.cookie.includes("scope=A"),
        `cookie ${opened.result.cookie}`,
      );
      assert(opened.result.local === "A", `local ${opened.result.local}`);
      assert(
        opened.result.dbs.includes("scopedb-A"),
        `dbs ${opened.result.dbs}`,
      );
    },
  );

  await check(
    "business B sees none of business A's cookie, localStorage or IndexedDB",
    async () => {
      const { result } = await openProbe("smoke-business-b");
      assert(
        !result.cookie.includes("scope="),
        `cookie leaked: ${result.cookie}`,
      );
      assert(result.local === null, `localStorage leaked: ${result.local}`);
      assert(result.dbs.length === 0, `IndexedDB leaked: ${result.dbs}`);
    },
  );

  await check("business A keeps its data in a second tab", async () => {
    const { result } = await openProbe("smoke-business-a");
    assert(result.cookie.includes("scope=A"), `cookie ${result.cookie}`);
    assert(result.local === "A", `local ${result.local}`);
    assert(result.dbs.includes("scopedb-A"), `dbs ${result.dbs}`);
  });

  await check(
    "pages see no desktop bridge and every permission is denied",
    async () => {
      const { result } = await openProbe("smoke-business-a");
      for (const name of ["tauri", "desktopBridge", "browserBridge"])
        assert(result[name] === "undefined", `${name} is ${result[name]}`);
      assert(
        result.notification !== "granted",
        `notification ${result.notification}`,
      );
      assert(
        result.geolocation !== "granted",
        `geolocation ${result.geolocation}`,
      );
    },
  );

  await check(
    "non-web and credentialed addresses are refused for create and navigate",
    async () => {
      const bad = [
        "file:///etc/hosts",
        "javascript:alert(1)",
        "data:text/html,<h1>x</h1>",
        "chrome://settings",
        `http://user:pass@127.0.0.1:${new URL(base).port}/probe`,
      ];
      for (const url of bad) {
        let refused = false;
        try {
          await request("create", { businessId: "smoke-business-a", url });
        } catch {
          refused = true;
        }
        assert(refused, `create accepted ${url}`);
      }
      const tab = await request("create", { businessId: "smoke-business-a" });
      for (const url of bad) {
        let refused = false;
        try {
          await request("navigate", { tabId: tab.id, url });
        } catch {
          refused = true;
        }
        assert(refused, `navigate accepted ${url}`);
      }
      const [current] = (await request("list")).filter(
        (entry) => entry.id === tab.id,
      );
      assert(current.url === "about:blank", `page moved to ${current.url}`);
      await request("close", { tabId: tab.id });
    },
  );

  await check(
    "a window opened by a page joins the same profile; file: and ftp: windows never open",
    async () => {
      const parent = await request("create", {
        businessId: "smoke-business-a",
        url: `${base}/popup`,
      });
      const opened = await waitFor(
        () =>
          events.find(
            (event) =>
              event.type === "new-tab" && event.openedFrom === parent.id,
          ),
        "new-tab event",
      );
      assert(
        opened.tab.businessId === "smoke-business-a",
        `business ${opened.tab.businessId}`,
      );
      const popped = await waitFor(async () => {
        const [current] = (await request("list")).filter(
          (entry) => entry.id === opened.tab.id,
        );
        if (!current?.title || current.title === "pending") return null;
        try {
          return JSON.parse(current.title);
        } catch {
          return null;
        }
      }, "popup probe result");
      assert(
        popped.cookie.includes("scope=A"),
        `popup cookie ${popped.cookie}`,
      );
      // The page opened its windows on load, before the probe finished. Let
      // anything late arrive, then require that only web tabs exist. Chromium
      // itself refuses a file: window from a web page, so the app's handler may
      // never be asked; either way nothing but http(s) may be open.
      await sleep(1500);
      const tabs = await request("list");
      const nonWeb = tabs.filter(
        (entry) => entry.url !== "about:blank" && !/^https?:/u.test(entry.url),
      );
      assert(
        nonWeb.length === 0,
        `non-web tabs exist: ${nonWeb.map((entry) => entry.url).join(", ")}`,
      );
      const blocked = events.filter(
        (event) =>
          event.type === "navigation-blocked" && event.tabId === parent.id,
      );
      console.log(
        `note: ${blocked.length} window request(s) reached the app's handler and were refused`,
      );
    },
  );

  const savedPaths = [];
  await check(
    "downloads go to the Downloads folder with a visible result and never overwrite",
    async () => {
      const tab = await request("create", { businessId: "smoke-business-a" });
      const finished = async (count) =>
        waitFor(() => {
          const done = events.filter(
            (event) =>
              event.type === "download" &&
              event.tabId === tab.id &&
              event.state === "completed",
          );
          return done.length >= count ? done[count - 1] : null;
        }, `download ${count} completed`);
      await request("navigate", { tabId: tab.id, url: `${base}/download.txt` });
      const first = await finished(1);
      assert(first.fileName === "report.txt", `name ${first.fileName}`);
      const firstPath = path.join(downloads, first.fileName);
      assert(existsSync(firstPath), "file missing from Downloads");
      assert(
        readFileSync(firstPath, "utf8") === "fixture download body",
        "file content differs",
      );
      await request("navigate", { tabId: tab.id, url: `${base}/download.txt` });
      const second = await finished(2);
      assert(
        second.fileName === "report (1).txt",
        `second name ${second.fileName}`,
      );
      assert(
        existsSync(path.join(downloads, "report.txt")),
        "first file was replaced",
      );
      const [current] = (await request("list")).filter(
        (entry) => entry.id === tab.id,
      );
      assert(
        current.url === "about:blank",
        `a download navigated the page to ${current.url}`,
      );
      assert(
        events.some(
          (event) =>
            event.type === "download" &&
            event.downloadId === first.downloadId &&
            event.state === "started",
        ),
        "no started event",
      );
      assert(
        (await request("reveal-download", { downloadId: first.downloadId }))
          .revealed === true,
        "reveal refused",
      );
      assert(revealed.at(-1) === firstPath, `revealed ${revealed.at(-1)}`);
      let unknownRefused = false;
      try {
        await request("reveal-download", { downloadId: "not-a-download" });
      } catch {
        unknownRefused = true;
      }
      assert(unknownRefused, "an unknown download id was revealed");
      savedPaths.push(firstPath, path.join(downloads, second.fileName));
      await request("close", { tabId: tab.id });
    },
  );

  await check(
    "forgetting a business clears its storage but keeps the person's files",
    async () => {
      await request("close-business", { businessId: "smoke-business-a" });
      const forgotten = await request("forget-business", {
        businessId: "smoke-business-a",
      });
      assert(
        forgotten.forgottenProfiles === 1,
        `forgotten ${forgotten.forgottenProfiles}`,
      );
      const { result } = await openProbe("smoke-business-a");
      assert(
        !result.cookie.includes("scope=A"),
        `cookie survived: ${result.cookie}`,
      );
      assert(result.local === null, `localStorage survived: ${result.local}`);
      for (const saved of savedPaths)
        assert(existsSync(saved), `forgetting deleted ${saved}`);
    },
  );

  await check("the kill switch refuses every tab", async () => {
    const off = createBrowserHost({
      WebContentsView,
      session,
      userDataPath: userData,
      downloadsPath: downloads,
      enabled: false,
    });
    let message = "";
    try {
      await off.handleRequest(window, sender, "create", {
        businessId: "smoke-off",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(/turned off/u.test(message), `message: ${message}`);
  });

  await check("closing a tab announces it and releases the view", async () => {
    const tab = await request("create", {
      businessId: "smoke-business-b",
      url: `${base}/probe`,
    });
    await request("attach", { tabId: tab.id, bounds, visible: true });
    await request("close", { tabId: tab.id });
    assert(
      events.some((event) => event.type === "closed" && event.tabId === tab.id),
      "no closed event",
    );
    assert(
      !(await request("list")).some((entry) => entry.id === tab.id),
      "tab still listed",
    );
  });

  host.disposeAll();
  await new Promise((resolve) => server.close(resolve));
  const failed = results.filter((entry) => !entry.ok);
  console.log(
    failed.length === 0
      ? `colony-browser-smoke: ok (${results.length} checks)`
      : `colony-browser-smoke: FAILED ${failed.length} of ${results.length}`,
  );
  return failed.length === 0 ? 0 : 1;
}

const watchdog = setTimeout(() => {
  console.log("FAIL watchdog: browser smoke did not finish in 150 seconds");
  app.exit(2);
}, 150_000);

main()
  .then((code) => {
    clearTimeout(watchdog);
    rmSync(root, { recursive: true, force: true });
    app.exit(code);
  })
  .catch((error) => {
    console.log(
      `FAIL harness: ${error instanceof Error ? error.stack : error}`,
    );
    clearTimeout(watchdog);
    app.exit(1);
  });
