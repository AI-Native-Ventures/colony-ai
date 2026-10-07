// Real-run proof of the visible browser tab's host on the PACKAGED app.
//
// Local-only, like the first-run gate: it launches the unchanged packaged
// Colony under the same no-keychain process sandbox (safety.mjs), takes its
// real main window, and drives the real `window.colonyBrowserHost` bridge
// against a local fixture site (tests/electron/browser-fixture-site.mjs):
//
//   1. two businesses share no cookie, localStorage or IndexedDB; one business
//      keeps them across tabs and across a window opened by a page;
//   2. pages see no desktop bridge and every permission request is denied;
//   3. file:, javascript:, data: and credentialed URLs are refused, and file:
//      and ftp: windows opened by a page never become tabs;
//   4. a download lands in the real Downloads folder under a collision-free
//      name with a visible result (the files it made are removed afterwards);
//   5. forgetting a business clears its storage but not the person's files.
//
// The mock-bridge spec and the CI Electron smoke prove the same host logic;
// this proves it in the shipped artifact, with its real preload and IPC.
//
//   cd desktop
//   COLONY_REAL_RUN=1 node tests/real-run/browser-tab.mjs \
//     --app '/Applications/Colony.app' \
//     --output /Users/mac/worktrees/.lanes/phase2/real-run-browser-tab

import { _electron as electron } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureSite } from "../electron/browser-fixture-site.mjs";
import {
  assertSafeDiagnostics,
  cleanEnvironment,
  outsideRepo,
  sandboxPolicy,
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
if (!options.app || !options.output)
  throw new Error("Supply --app and --output.");

const output = path.resolve(options.output);
await mkdir(output, { recursive: true });
outsideRepo(output, repo);
const appPath = path.resolve(options.app);
const executable = path.join(appPath, "Contents", "MacOS", "Colony");
const privateDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-real-run-browser-")),
);
await chmod(privateDir, 0o700);
const userDataDir = path.join(privateDir, "user-data");
await mkdir(userDataDir, { mode: 0o700 });
const probeDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-real-run-deny-probe-")),
);
const { policy } = sandboxPolicy(userDataDir, probeDir);
const sandboxPath = path.join(privateDir, "sandbox.sb");
await writeFile(sandboxPath, policy, { mode: 0o600 });
const quote = (value) => `'${value.replace(/'/gu, `'\\''`)}'`;
const launcher = path.join(privateDir, "launch.sh");
await writeFile(
  launcher,
  `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(sandboxPath)} ${quote(executable)} "$@"\n`,
  { mode: 0o700 },
);

const rows = [];
async function check(name, run) {
  try {
    await run();
    rows.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    rows.push({ name, status: "FAIL", reason });
    console.log(`FAIL ${name}: ${reason}`);
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const downloadsDir = path.join(os.homedir(), "Downloads");
const madeFiles = new Set();
const { server, base } = await startFixtureSite();
let application;
try {
  application = await electron.launch({
    executablePath: launcher,
    args: ["--no-sandbox", `--user-data-dir=${userDataDir}`],
    env: cleanEnvironment(process.env, userDataDir, "https://127.0.0.1"),
    timeout: 45_000,
  });
  const provenance = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    userDataDir: app.getPath("userData"),
  }));
  assert(provenance.packaged, "the launched app is not packaged");
  assert(provenance.userDataDir === userDataDir, "profile isolation failed");
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
  const events = () => page.evaluate(() => window.__browserEvents);
  const waitForEvent = async (predicate, label, nth = 1) => {
    const started = Date.now();
    for (;;) {
      const found = (await events()).filter(predicate);
      if (found.length >= nth) return found[nth - 1];
      if (Date.now() - started > 25_000) throw new Error(`timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  };

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
  await check("non-web and credentialed addresses are refused", async () => {
    for (const url of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "data:text/html,x",
      `http://user:pass@127.0.0.1:${new URL(base).port}/probe`,
    ]) {
      let refused = false;
      try {
        await bridge("createTab", { businessId: "real-run-business-a", url });
      } catch {
        refused = true;
      }
      assert(refused, `createTab accepted ${url}`);
    }
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
      // Chromium refuses a file: window from a web page before the app is
      // asked, so only the invariant is checked: nothing but web tabs exist.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const tabs = await bridge("listTabs");
      const nonWeb = tabs.filter(
        (entry) => entry.url !== "about:blank" && !/^https?:/u.test(entry.url),
      );
      assert(
        nonWeb.length === 0,
        `non-web tabs exist: ${nonWeb.map((entry) => entry.url).join(", ")}`,
      );
    },
  );
  await check(
    "a download lands in Downloads, collision-free, with a visible result",
    async () => {
      const tab = await bridge("createTab", {
        businessId: "real-run-business-a",
      });
      const finished = (count) =>
        waitForEvent(
          (event) =>
            event.type === "download" &&
            event.tabId === tab.id &&
            event.state === "completed",
          `download ${count}`,
          count,
        );
      await bridge("navigate", tab.id, `${base}/download.txt`);
      const first = await finished(1);
      madeFiles.add(path.join(downloadsDir, first.fileName));
      const firstPath = path.join(downloadsDir, first.fileName);
      assert(existsSync(firstPath), `${firstPath} missing`);
      assert(
        readFileSync(firstPath, "utf8") === "fixture download body",
        "content differs",
      );
      await bridge("navigate", tab.id, `${base}/download.txt`);
      const second = await finished(2);
      madeFiles.add(path.join(downloadsDir, second.fileName));
      assert(
        second.fileName !== first.fileName,
        "the second download overwrote the first",
      );
      assert(existsSync(firstPath), "the first file was replaced");
    },
  );
  await check(
    "forgetting a business clears its storage and keeps downloads",
    async () => {
      await bridge("closeBusiness", "real-run-business-a");
      const forgotten = await bridge("forgetBusiness", "real-run-business-a");
      assert(
        forgotten.forgottenProfiles === 1,
        `forgotten ${forgotten.forgottenProfiles}`,
      );
      const { result } = await probe("real-run-business-a");
      assert(!result.cookie.includes("scope=A"), `cookie ${result.cookie}`);
      assert(result.local === null, `local ${result.local}`);
      for (const file of madeFiles)
        assert(existsSync(file), `${file} was deleted`);
    },
  );
} catch (error) {
  rows.push({
    name: "Launch the packaged app",
    status: "FAIL",
    reason: error instanceof Error ? error.message : String(error),
  });
  console.log(`FAIL launch: ${rows.at(-1).reason}`);
} finally {
  for (const file of madeFiles) rmSync(file, { force: true });
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
const failed = rows.filter((row) => row.status !== "PASS");
await writeFile(
  path.join(output, "browser-tab-results.json"),
  JSON.stringify({ app: appPath, rows }, null, 2),
);
console.log(
  failed.length === 0
    ? `Browser tab real run: PASS (${rows.length} checks). Report: ${output}`
    : `Browser tab real run: ${failed.length} of ${rows.length} FAILED. Report: ${output}`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
