// Real-run proof of the visible browser tab's host on the PACKAGED app.
//
// Local-only, like the first-run gate: it launches the unchanged packaged
// Colony under the keychain-deny process sandbox (safety.mjs) on a THROWAWAY
// HOME (privateDir/home, never the owner's), takes its real main window, and
// drives the real `window.colonyBrowserHost` bridge against a local fixture
// site (tests/electron/browser-fixture-site.mjs). No account, no relay, no
// login: BUZZ_RELAY_URL points at a host that does not exist.
//
//   1. two businesses share no cookie, localStorage or IndexedDB; one business
//      keeps them across tabs and across a window opened by a page;
//   2. a cookie set in the visible browser is not in the app's own session,
//      and a cookie in the app's session is not in the visible browser;
//   3. pages see no desktop bridge and every permission request is denied;
//   4. file:, javascript:, data:, browser-internal, view-source:, ftp:, blob:,
//      app-scheme and credentialed addresses are refused for create and for
//      navigate, a redirect to file: does not land, and file:/ftp: windows
//      opened by a page never become tabs;
//   5. link-local and cloud metadata addresses (PR 263) are refused in every
//      spelling, a redirect to one fails, a page's fetch and window to one are
//      cancelled; ordinary loopback stays open;
//   6. downloads land only in the throwaway HOME's Downloads folder, under
//      collision-free bare names, and a hostile name cannot climb out of it;
//   7. forgetting a business, and forgetting everything (sign out), clear the
//      storage but never the person's downloaded files.
//
// The rows that need a signed-in workspace (an app reload keeps the page tab,
// Remove this community from this device forgets the profile) are in
// browser-tab-ui.mjs.
//
//   cd desktop
//   COLONY_REAL_RUN=1 node tests/real-run/browser-tab.mjs \
//     --app '/path/to/Colony.app' \
//     --output /Users/mac/worktrees/.lanes/phase2/real-run-browser-tab

import { _electron as electron } from "@playwright/test";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureSite } from "../electron/browser-fixture-site.mjs";
import {
  ESCAPE_MARKER,
  METADATA_ADDRESSES,
  cookieNames,
  downloadsVerdict,
  escapedFiles,
  findByName,
  newNames,
  refusedAddresses,
} from "./browser-tab-rows.mjs";
import {
  assertSafeDiagnostics,
  outsideRepo,
  realEnvSandboxPolicy,
  realEnvironment,
} from "./safety.mjs";

assertSafeDiagnostics(process.env);
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const options = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, args) => {
    if (index % 2 === 0 && value.startsWith("--"))
      pairs.push([value.slice(2), args[index + 1]]);
    return pairs;
  }, []),
);
if (process.env.CI || process.env.COLONY_REAL_RUN !== "1")
  throw new Error("This proof is local-only and requires COLONY_REAL_RUN=1.");
if (process.platform !== "darwin")
  throw new Error("This no-keychain process sandbox requires macOS.");
if (process.env.GATE_REAL_HOME === "1")
  throw new Error(
    "This proof runs on a throwaway HOME only; unset GATE_REAL_HOME.",
  );
if (!options.app || !options.output)
  throw new Error("Supply --app and --output.");

const output = path.resolve(options.output);
await mkdir(output, { recursive: true });
outsideRepo(output, repo);
const appPath = path.resolve(options.app);
const executable = path.join(
  appPath,
  "Contents",
  "MacOS",
  readdirSync(path.join(appPath, "Contents", "MacOS"))[0],
);
const privateDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-real-run-browser-")),
);
await chmod(privateDir, 0o700);
const userDataDir = path.join(privateDir, "user-data");
await mkdir(userDataDir, { mode: 0o700 });
const probeDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-real-run-deny-probe-")),
);
await writeFile(path.join(probeDir, "probe.txt"), "denied", { mode: 0o600 });
const sandboxPath = path.join(privateDir, "sandbox.sb");
await writeFile(sandboxPath, realEnvSandboxPolicy(undefined, probeDir), {
  mode: 0o600,
});
const quote = (value) => `'${value.replace(/'/gu, `'\\''`)}'`;
const launcher = path.join(privateDir, "launch.sh");
await writeFile(
  launcher,
  `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(sandboxPath)} ${quote(executable)} "$@"\n`,
  { mode: 0o700 },
);
// HOME is privateDir/home (created by realEnvironment); the guard inside it
// throws before any process exists if HOME were the owner's real home.
const launchEnv = realEnvironment(
  process.env,
  userDataDir,
  "https://127.0.0.1",
);
const home = launchEnv.HOME;
const downloadsDir = path.join(home, "Downloads");

const rows = [];
function record(name, status, detail = "") {
  rows.push({ name, status, ...(detail ? { detail } : {}) });
  console.log(`${status} ${name}${detail ? `: ${detail}` : ""}`);
}
async function check(name, run) {
  try {
    const note = await run();
    record(name, "PASS", typeof note === "string" ? note : "");
  } catch (error) {
    record(
      name,
      "FAIL",
      error instanceof Error ? error.message : String(error),
    );
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let downloadsTrusted = false;
const { server, base } = await startFixtureSite();
let application;
try {
  application = await electron.launch({
    executablePath: launcher,
    args: ["--no-sandbox", `--user-data-dir=${userDataDir}`],
    env: launchEnv,
    timeout: 45_000,
  });
  const provenance = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    userDataDir: app.getPath("userData"),
    home: app.getPath("home"),
    downloads: app.getPath("downloads"),
  }));
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.colonyBrowserHost), null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    window.__browserEvents = [];
    window.colonyBrowserHost.onEvent((event) =>
      window.__browserEvents.push(event),
    );
  });

  await check(
    "the launched app is the packaged one on a throwaway profile",
    () => {
      assert(provenance.packaged, "the launched app is not packaged");
      assert(
        provenance.userDataDir === userDataDir,
        "profile isolation failed",
      );
      return `version ${provenance.version}`;
    },
  );
  await check(
    "the app runs on a throwaway HOME, so its Downloads folder is not the owner's",
    async () => {
      const real = async (value) =>
        realpath(value).catch(() => path.resolve(value));
      assert(
        (await real(provenance.home)) === (await real(home)),
        `app HOME is ${provenance.home}, expected ${home}`,
      );
      assert(
        path.resolve(provenance.downloads) === path.resolve(downloadsDir),
        `app Downloads is ${provenance.downloads}, expected ${downloadsDir}`,
      );
      assert(
        !path
          .resolve(provenance.downloads)
          .startsWith(path.resolve(os.homedir())),
        "the app's Downloads folder is inside the owner's real home",
      );
      downloadsTrusted = true;
      return downloadsDir;
    },
  );
  await check(
    "the keychain-deny sandbox is active: a denied probe folder cannot be read",
    async () => {
      const outcome = await application.evaluate(({ app: _app }, target) => {
        try {
          const fs = typeof require === "function" ? require("node:fs") : null;
          if (!fs) return "no-fs";
          fs.readFileSync(`${target}/probe.txt`);
          return "readable";
        } catch (error) {
          return error?.code ?? "denied";
        }
      }, probeDir);
      assert(
        outcome !== "readable",
        "the sandbox did not deny the probe folder",
      );
      assert(
        outcome !== "no-fs",
        "BLOCKED: the main process has no fs to probe with",
      );
      return `read refused (${outcome})`;
    },
  );

  const probe = (businessId, search = "") =>
    page.evaluate(
      async ({ businessId: business, url }) => {
        const host = window.colonyBrowserHost;
        const tab = await host.createTab({ businessId: business, url });
        await host.attach(
          tab.id,
          { x: 0, y: 0, width: 640, height: 420 },
          true,
        );
        const started = Date.now();
        for (;;) {
          const current = (await host.listTabs()).find(
            (entry) => entry.id === tab.id,
          );
          if (current?.title && current.title !== "pending") {
            try {
              return { tabId: tab.id, result: JSON.parse(current.title) };
            } catch {
              // Not the probe's JSON yet.
            }
          }
          if (Date.now() - started > 25_000) throw new Error("probe timed out");
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      },
      { businessId, url: `${base}/probe${search}` },
    );
  const bridge = (name, ...args) =>
    page.evaluate(
      async ({ name: method, args: values }) =>
        window.colonyBrowserHost[method](...values),
      { name, args },
    );
  const refuses = async (name, ...args) => {
    try {
      await bridge(name, ...args);
      return false;
    } catch {
      return true;
    }
  };
  const events = () => page.evaluate(() => window.__browserEvents);
  const waitForEvent = async (predicate, label, nth = 1) => {
    const started = Date.now();
    for (;;) {
      const found = (await events()).filter(predicate);
      if (found.length >= nth) return found[nth - 1];
      if (Date.now() - started > 25_000) throw new Error(`timed out: ${label}`);
      await sleep(80);
    }
  };
  const waitForTab = async (tabId, label, accept) => {
    const started = Date.now();
    for (;;) {
      const current = (await bridge("listTabs")).find(
        (entry) => entry.id === tabId,
      );
      const value = current ? accept(current) : null;
      if (value) return value;
      if (Date.now() - started > 25_000) throw new Error(`timed out: ${label}`);
      await sleep(100);
    }
  };

  // ---- 1. two businesses share nothing -------------------------------------
  await check(
    "business A stores a cookie, localStorage and IndexedDB",
    async () => {
      const { result } = await probe("real-run-business-a", "?set=A");
      assert(result.cookie.includes("scope=A"), `cookie ${result.cookie}`);
      assert(result.local === "A", `local ${result.local}`);
      assert(result.dbs.includes("scopedb-A"), `dbs ${result.dbs}`);
    },
  );
  await check("business B sees none of business A's data", async () => {
    const { result } = await probe("real-run-business-b");
    assert(!result.cookie.includes("scope="), `cookie ${result.cookie}`);
    assert(result.local === null, `local ${result.local}`);
    assert(result.dbs.length === 0, `dbs ${result.dbs}`);
  });
  await check("business A keeps its data in a second tab", async () => {
    const { result } = await probe("real-run-business-a");
    assert(result.cookie.includes("scope=A"), `cookie ${result.cookie}`);
    assert(result.local === "A", `local ${result.local}`);
  });

  // ---- 2. visible browser and app session share nothing --------------------
  await check(
    "a cookie set in the visible browser is not in the app session, and the reverse",
    async () => {
      await probe("real-run-business-a", "?set=A");
      const inApp = await application.evaluate(async ({ session }, url) => {
        const all = await session.defaultSession.cookies.get({});
        const forFixture = await session.defaultSession.cookies.get({ url });
        return {
          all: all.map((cookie) => ({ name: cookie.name })),
          forFixture: forFixture.map((cookie) => ({ name: cookie.name })),
        };
      }, base);
      assert(
        !cookieNames(inApp.all).includes("scope"),
        `the app session holds the browser's cookie: ${JSON.stringify(inApp.all)}`,
      );
      assert(
        !cookieNames(inApp.forFixture).includes("scope"),
        "the app session sends the browser's cookie to the fixture origin",
      );
      // The app window's own storage never saw it either.
      const renderer = await page.evaluate(() => ({
        cookie: document.cookie,
        keys: Object.keys(localStorage),
      }));
      assert(!renderer.cookie.includes("scope="), "app window cookie");
      assert(!renderer.keys.includes("scope"), "app window localStorage");
      // And the other way: a cookie in the app session stays out of the browser.
      await application.evaluate(
        ({ session }, url) =>
          session.defaultSession.cookies.set({
            url,
            name: "appcookie",
            value: "1",
          }),
        base,
      );
      try {
        const { result } = await probe("real-run-business-a");
        assert(
          !result.cookie.includes("appcookie"),
          `the app's cookie reached the browser: ${result.cookie}`,
        );
      } finally {
        await application.evaluate(
          ({ session }, url) =>
            session.defaultSession.cookies.remove(url, "appcookie"),
          base,
        );
      }
    },
  );

  // ---- 3. no bridge, permissions denied ------------------------------------
  await check(
    "pages see no desktop bridge; every permission is denied",
    async () => {
      const { result } = await probe("real-run-business-a");
      for (const name of ["tauri", "desktopBridge", "browserBridge"])
        assert(result[name] === "undefined", `${name} is ${result[name]}`);
      assert(result.notification !== "granted", result.notification);
      assert(result.geolocation !== "granted", result.geolocation);
    },
  );

  // ---- 4. refusals ----------------------------------------------------------
  const refused = refusedAddresses(base);
  await check(
    "file, script, data, internal, ftp, blob, app-scheme and credentialed addresses are refused for create",
    async () => {
      for (const url of refused)
        assert(
          await refuses("createTab", {
            businessId: "real-run-business-a",
            url,
          }),
          `createTab accepted ${url}`,
        );
    },
  );
  await check(
    "the same addresses are refused for navigate and the open page stays",
    async () => {
      const tab = await bridge("createTab", {
        businessId: "real-run-business-a",
        url: `${base}/probe`,
      });
      const before = await waitForTab(tab.id, "page to load", (entry) =>
        entry.title && entry.title !== "pending" ? entry.url : null,
      );
      for (const url of refused)
        assert(
          await refuses("navigate", tab.id, url),
          `navigate accepted ${url}`,
        );
      const [after] = (await bridge("listTabs")).filter(
        (entry) => entry.id === tab.id,
      );
      assert(after.url === before, `page moved from ${before} to ${after.url}`);
      await bridge("closeTab", tab.id);
    },
  );
  await check("a redirect to a file: address does not land", async () => {
    const tab = await bridge("createTab", {
      businessId: "real-run-business-a",
      url: `${base}/redirect-file`,
    });
    await sleep(3000);
    const [after] = (await bridge("listTabs")).filter(
      (entry) => entry.id === tab.id,
    );
    assert(!/^file:/u.test(after.url), `the tab landed on ${after.url}`);
    await bridge("closeTab", tab.id);
  });
  await check(
    "a window opened by a page joins the profile; file: and ftp: windows never open",
    async () => {
      const parent = await bridge("createTab", {
        businessId: "real-run-business-a",
        url: `${base}/popup`,
      });
      const opened = await waitForEvent(
        (event) => event.type === "new-tab" && event.openedFrom === parent.id,
        "new-tab",
      );
      assert(opened.tab.businessId === "real-run-business-a", "wrong business");
      // Chromium refuses a file: window from a web page before the app is asked,
      // so only the invariant is checked: nothing but web tabs exists.
      await sleep(1500);
      const nonWeb = (await bridge("listTabs")).filter(
        (entry) => entry.url !== "about:blank" && !/^https?:/u.test(entry.url),
      );
      assert(
        nonWeb.length === 0,
        `non-web tabs exist: ${nonWeb.map((entry) => entry.url).join(", ")}`,
      );
    },
  );

  // ---- 5. metadata and link-local -------------------------------------------
  await check(
    "link-local and cloud metadata addresses are refused in every spelling, for create and navigate",
    async () => {
      for (const url of METADATA_ADDRESSES)
        assert(
          await refuses("createTab", {
            businessId: "real-run-business-a",
            url,
          }),
          `createTab accepted ${url}`,
        );
      const tab = await bridge("createTab", {
        businessId: "real-run-business-a",
      });
      for (const url of METADATA_ADDRESSES)
        assert(
          await refuses("navigate", tab.id, url),
          `navigate accepted ${url}`,
        );
      const [after] = (await bridge("listTabs")).filter(
        (entry) => entry.id === tab.id,
      );
      assert(after.url === "about:blank", `page moved to ${after.url}`);
      await bridge("closeTab", tab.id);
    },
  );
  await check(
    "a redirect to a metadata address fails at once and never lands",
    async () => {
      const tab = await bridge("createTab", {
        businessId: "real-run-business-a",
        url: `${base}/redirect-metadata`,
      });
      const failed = await waitForTab(
        tab.id,
        "the redirect to be refused",
        (entry) => (entry.error ? entry : null),
      );
      assert(
        !failed.url.includes("169.254"),
        `redirect landed on ${failed.url}`,
      );
      await bridge("closeTab", tab.id);
    },
  );
  await check(
    "a page's fetch and window to a metadata address are cancelled",
    async () => {
      const page2 = await bridge("createTab", {
        businessId: "real-run-business-a",
        url: `${base}/metadata-page`,
      });
      const reported = await waitForTab(
        page2.id,
        "the metadata page report",
        (entry) => {
          if (!entry.title || entry.title === "pending") return null;
          try {
            return JSON.parse(entry.title);
          } catch {
            return null;
          }
        },
      );
      assert(reported.fetched === "blocked", `fetch was ${reported.fetched}`);
      await sleep(1000);
      assert(
        !(await bridge("listTabs")).some((entry) =>
          entry.url.includes("169.254"),
        ),
        "a tab to a metadata address exists",
      );
      await bridge("closeTab", page2.id);
    },
  );
  await check(
    "ordinary private addresses stay open: the loopback fixture loads (INFO, by decision)",
    async () => {
      const { result } = await probe("real-run-business-a");
      assert(
        typeof result.cookie === "string",
        "the loopback page did not load",
      );
      return "loopback 127.0.0.1 opened; 192.168.x.x and 10.x.x.x are deliberately not probed (no LAN traffic)";
    },
  );

  // ---- 6. downloads ---------------------------------------------------------
  if (!downloadsTrusted) {
    record(
      "downloads land only in the allowed folder",
      "BLOCKED",
      "the app's Downloads folder is not the throwaway HOME's, so no download was started",
    );
  } else {
    const listing = () =>
      existsSync(downloadsDir) ? readdirSync(downloadsDir) : [];
    const before = listing();
    const finished = (tabId, nth) =>
      waitForEvent(
        (event) =>
          event.type === "download" &&
          event.tabId === tabId &&
          event.state === "completed",
        `download ${nth}`,
        nth,
      );
    await check(
      "a download lands in Downloads under a bare name and never overwrites",
      async () => {
        const tab = await bridge("createTab", {
          businessId: "real-run-business-a",
        });
        await bridge("navigate", tab.id, `${base}/download.txt`);
        const first = await finished(tab.id, 1);
        const firstPath = path.join(downloadsDir, first.fileName);
        assert(
          first.fileName === path.basename(first.fileName),
          "name has a path",
        );
        assert(existsSync(firstPath), `${firstPath} missing`);
        assert(
          readFileSync(firstPath, "utf8") === "fixture download body",
          "content differs",
        );
        await bridge("navigate", tab.id, `${base}/download.txt`);
        const second = await finished(tab.id, 2);
        assert(
          second.fileName !== first.fileName,
          "the second download overwrote the first",
        );
        assert(existsSync(firstPath), "the first file was replaced");
      },
    );
    await check(
      "a hostile file name cannot climb out of the Downloads folder",
      async () => {
        const tab = await bridge("createTab", {
          businessId: "real-run-business-a",
        });
        await bridge("navigate", tab.id, `${base}/download-traversal`);
        const done = await waitForEvent(
          (event) =>
            event.type === "download" &&
            event.tabId === tab.id &&
            event.state === "completed" &&
            String(event.fileName).includes(ESCAPE_MARKER),
          "traversal download",
        );
        const landed = path.join(downloadsDir, done.fileName);
        assert(
          done.fileName === path.basename(done.fileName) && existsSync(landed),
          `traversal download did not land inside Downloads (${done.fileName})`,
        );
      },
    );
    await check(
      "nothing was written outside the allowed folder, and nothing partial was left",
      async () => {
        const added = newNames(before, new Set(listing()));
        const sizes = Object.fromEntries(
          added.map((name) => [
            name,
            statSync(path.join(downloadsDir, name)).size,
          ]),
        );
        const verdict = downloadsVerdict({ added, sizes, expectedCount: 3 });
        assert(verdict.ok, verdict.problems.join("; "));
        const scan = findByName(privateDir, ESCAPE_MARKER);
        const climbed = escapedFiles(scan.hits, downloadsDir);
        assert(
          climbed.length === 0,
          `files outside Downloads: ${climbed.join(", ")}`,
        );
        const above = findByName(os.tmpdir(), ESCAPE_MARKER, { maxDepth: 0 });
        assert(
          above.hits.length === 0,
          `files in the temp folder: ${above.hits.join(", ")}`,
        );
        return `${added.length} files, all in ${downloadsDir}`;
      },
    );
  }

  // ---- 7. forgetting --------------------------------------------------------
  const keptFiles = () =>
    existsSync(downloadsDir) ? readdirSync(downloadsDir) : [];
  await check(
    "forgetting a business clears its storage and keeps downloads",
    async () => {
      const filesBefore = keptFiles();
      await bridge("closeBusiness", "real-run-business-a");
      const forgotten = await bridge("forgetBusiness", "real-run-business-a");
      assert(
        forgotten.forgottenProfiles === 1,
        `forgotten ${forgotten.forgottenProfiles}`,
      );
      const { result } = await probe("real-run-business-a");
      assert(!result.cookie.includes("scope=A"), `cookie ${result.cookie}`);
      assert(result.local === null, `local ${result.local}`);
      assert(
        filesBefore.every((name) => keptFiles().includes(name)),
        "forgetting deleted a downloaded file",
      );
    },
  );
  await check(
    "forgetting everything (sign out, account delete) ends every tab and clears every profile",
    async () => {
      const filesBefore = keptFiles();
      await probe("real-run-business-a", "?set=A2");
      await probe("real-run-business-b", "?set=B2");
      assert((await bridge("listTabs")).length > 0, "no live tabs to end");
      const forgotten = await bridge("forgetAll");
      assert(
        forgotten.forgottenProfiles >= 2,
        `forgotten ${forgotten.forgottenProfiles}`,
      );
      assert(
        (await bridge("listTabs")).length === 0,
        "tabs survived forgetting everything",
      );
      for (const business of ["real-run-business-a", "real-run-business-b"]) {
        const { result } = await probe(business);
        assert(
          !result.cookie.includes("scope="),
          `${business} cookie ${result.cookie}`,
        );
        assert(result.local === null, `${business} localStorage survived`);
      }
      assert(
        filesBefore.every((name) => keptFiles().includes(name)),
        "forgetting everything deleted a downloaded file",
      );
    },
  );
} catch (error) {
  record(
    "Launch the packaged app",
    "FAIL",
    error instanceof Error ? error.message : String(error),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (application) {
    try {
      await Promise.race([
        application.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Close deadline")), 10_000),
        ),
      ]);
    } catch {
      application.process().kill("SIGTERM");
    }
  }
}
const failed = rows.filter((row) => !["PASS", "INFO"].includes(row.status));
await writeFile(
  path.join(output, "browser-tab-results.json"),
  JSON.stringify({ app: appPath, home, rows }, null, 2),
);
// The throwaway HOME and profile go with their downloads; only this run's
// private folders under the system temp directory are ever removed.
for (const directory of [privateDir, probeDir]) {
  const tmp = await realpath(os.tmpdir());
  if (
    path.dirname(directory) === tmp &&
    path.basename(directory).startsWith("colony-real-run-")
  )
    rmSync(directory, { recursive: true, force: true });
}
console.log(
  failed.length === 0
    ? `Browser tab real run: PASS (${rows.length} checks). Report: ${output}`
    : `Browser tab real run: ${failed.length} of ${rows.length} FAILED or BLOCKED. Report: ${output}`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
