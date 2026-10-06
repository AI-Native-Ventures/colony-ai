// Delta gate D1b: post-migration behaviour, with the signed-in throwaway PROFILE of the fake-model run (no new business, no Claude).
// A fresh owner-shaped seeded throwaway HOME (migration default ON, flag unset) gets a copy of that profile's user-data and of its
// host app-data folder (renamed to the new profile hash). One launch migrates at boot; then: Files tab lists the migrated entries,
// the restored agent runs with its working directory under ~/.colony (proved by the fake model's pwd, ls and AGENTS.md output),
// the fake-model Scout answers a message after the migration, and the second launch is a no-op.
//   node d1b.mjs --app <Buzz.app> --profile <d5-fake/profile.json>
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { Rec, progress, redact, shot, sleep } from "./ai-lib.mjs";
import { startFakeProvider } from "./fake-provider.mjs";
import { buildFixture } from "./nest-migration/fixture.mjs";
import { descendants, launchPackaged } from "./nest-migration/launch.mjs";
import { buildManifest } from "./nest-migration/manifest.mjs";
import { compareStable } from "./nest-migration/diff.mjs";

process.env.NEST_STRICT = "1"; // sandbox without the web block: the profile's community lives on the production relay
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required");
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APP = path.resolve(arg("app"));
const old = JSON.parse(await readFile(arg("profile"), "utf8"));
const run = promisify(execFile);
const rec = new Rec("D1B");
const hashOf = (dir) => createHash("sha256").update(dir).digest("hex").slice(0, 16);
const work = await mkdtemp(path.join(os.tmpdir(), "colony-d1b-"));
const spec = await buildFixture({ root: path.join(work, "fixture"), variant: "owner" });
const home = spec.home;
const privateDir = path.join(work, "private");
const userDataDir = path.join(privateDir, "user-data");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await cp(old.userDataDir, userDataDir, { recursive: true });
for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) await rm(path.join(userDataDir, lock), { force: true });
const oldAppData = path.join(old.home, "Library", "Application Support", `xyz.block.buzz.app.electron.${hashOf(old.userDataDir)}`);
const newAppData = path.join(home, "Library", "Application Support", `xyz.block.buzz.app.electron.${hashOf(userDataDir)}`);
await cp(oldAppData, newAppData, { recursive: true });
const fake = await startFakeProvider({ logFile: path.join(process.env.AI_OUT, "d1b-fake-provider.jsonl"), port: old.fakePort });
await progress(`[D1B] work ${work}; HOME ${home} (owner-shaped, ~/.buzz only); profile copied from the fake-model run; fake provider ${fake.url}; COLONY_NEST_MIGRATION unset (build default)`);
const nestNames = async (dir) => (await readdir(dir).catch(() => [])).sort();
const before = await buildManifest(home, [".buzz", ".colony", ".colony.staging"], { hash: false });
const launch = async (label) => {
  const app = await launchPackaged({ app: APP, fixtureRoot: spec.root, home, userDataDir, privateDir, relayUrl: "https://relay.colony.ainative.ventures" });
  const page = await app.window(90000);
  await page.setViewportSize({ width: 1440, height: 960 }).catch(() => undefined);
  await progress(`[D1B] ${label} launched, version ${await app.version().catch(() => "?")}`);
  return { app, page };
};
const body = async (page, n = 500) => redact((await page.locator("body").innerText().catch(() => "")).replace(/\s+/gu, " ").slice(0, n));
let first;
try {
  const logFrom = 0;
  first = await launch("launch 1");
  const { app, page } = first;
  rec.row("D1B-version", "App reports version 1.0.5", (await app.version()) === "1.0.5" ? "PASS" : "FAIL", `app.getVersion() = ${await app.version()}`);
  const reachedApp = await page.getByTestId("app-sidebar").waitFor({ timeout: 120000 }).then(() => true, () => false);
  await sleep(8000);
  const lines1 = (await app.hostLogLines()).filter((l) => /nest-folder|nest-migration/u.test(l)).map((l) => redact(l).slice(0, 300));
  rec.row(
    "D1B-migrated",
    "The migration ran at boot on the build default (flag unset) with the signed-in profile",
    reachedApp && lines1.some((l) => /outcome=migrated/u.test(l)) && lines1.some((l) => /chosen=\.colony/u.test(l)) ? "PASS" : "FAIL",
    `Workspace reached: ${reachedApp}. Host lines: ${lines1.join(" || ")}. ~/.colony now: ${(await nestNames(path.join(home, ".colony"))).join(", ")}. ~/.buzz now: ${(await nestNames(path.join(home, ".buzz"))).join(", ")}`,
    { screenshot: await shot(page, rec, "d1b-1-workspace") },
  );
  // Files tab: read the DOM
  let filesText = "";
  try {
    await page.getByTestId("channel-welcome").first().click({ timeout: 8000 }).catch(() => undefined);
    await page.getByTestId("channel-work-area-trigger").click({ timeout: 8000 });
    await page.getByTestId("work-area-panel").waitFor({ timeout: 8000 });
    const empty = page.getByTestId("work-area-open-files");
    if (await empty.isVisible().catch(() => false)) await empty.click();
    else {
      await page.getByTestId("work-area-add-tab").click({ timeout: 6000 });
      await page.getByTestId("work-area-add-files").click({ timeout: 6000 });
    }
    await sleep(2500);
    filesText = redact(await page.getByTestId("work-area-files").innerText().catch(() => ""));
  } catch (error) {
    filesText = `(Files tab not reached: ${error.name})`;
  }
  const names = filesText.split("\n").map((t) => t.trim()).filter(Boolean);
  const expected = (await nestNames(path.join(home, ".colony"))).filter((n) => !n.startsWith(".") || n === ".repos-dir");
  const missing = expected.filter((n) => !names.includes(n) && !["archive"].includes(n) ? !names.includes(n) : false);
  rec.row(
    "D1B-files-tab",
    "Files tab lists the migrated entries (read from the DOM)",
    names.length > 3 && ["GUIDES", "OUTBOX", "AGENTS.md"].every((n) => names.includes(n)) && !names.some((n) => /^\.buzz$/u.test(n)) ? "PASS" : "FAIL",
    `Entries shown: ${names.join(" | ")}. Migrated entries on disk: ${expected.join(", ")}. Not shown: ${missing.join(", ") || "none"}`,
    { screenshot: await shot(page, rec, "d1b-2-files") },
  );
  // Restored agent: processes carrying the managed-agent marker, with their cwd.
  const agents = [];
  for (const pid of await descendants(app.pid)) {
    const env = await run("ps", ["eww", "-p", String(pid)]).then((r) => r.stdout, () => "");
    if (!/BUZZ_MANAGED_AGENT=/u.test(env)) continue;
    const cwd = await run("lsof", ["-a", "-d", "cwd", "-Fn", "-p", String(pid)]).then((r) => r.stdout.split("\n").find((l) => l.startsWith("n"))?.slice(1), () => null);
    agents.push({ pid, cwd });
  }
  rec.row("D1B-agent-cwd", "The restored agent runs with its working directory under ~/.colony", agents.length && agents.every((a) => a.cwd?.startsWith(path.join(home, ".colony"))) ? "PASS" : agents.length ? "FAIL" : "NOT OBSERVED", `Managed agent processes: ${JSON.stringify(agents)}. Expected prefix: ${path.join(home, ".colony")}`);
  // The fake-model Scout answers after the migration; its tools show the nest it works in.
  const count = () => page.evaluate(() => [...document.body.innerText.matchAll(/(\d+) repl(?:y|ies)/gu)].map((m) => Number(m[1])).reduce((a, b) => a + b, 0));
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.getByTestId("channel-welcome").first().click({ timeout: 8000 }).catch(() => undefined);
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  const repliesBefore = await count();
  const composer = page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
  await composer.click();
  await composer.fill("@");
  const menu = page.getByTestId("mention-autocomplete");
  await menu.waitFor({ timeout: 15000 });
  await menu.locator("[data-mention-suggestion-index]").filter({ hasText: /Scout/u }).first().click();
  await composer.press("End");
  await composer.pressSequentially(" what do you know about our business? answer in this thread.");
  await composer.press("Enter");
  const t0 = Date.now();
  let answered = false;
  while (Date.now() - t0 < 170000) {
    await sleep(3000);
    if ((await count()) > repliesBefore) { answered = true; break; }
  }
  let thread = "";
  if (answered) {
    await sleep(6000);
    await page.getByText(/View thread/u).last().click({ timeout: 6000 }).catch(() => undefined);
    await sleep(1500);
    const panel = page.locator('[data-testid="message-thread-panel"], [data-testid="focus-thread-drawer"]').first();
    thread = redact((await panel.innerText().catch(() => "")).replace(/\s+/gu, " "));
  }
  const inColony = thread.includes(path.join(home, ".colony")) || /\.colony/u.test(thread);
  rec.row(
    "D1B-scout-answer",
    "The fake-model Scout answers after the migration and its tools run in ~/.colony and read AGENTS.md with COLONY markers",
    answered && inColony && /COLONY MANAGED/u.test(thread) && !/BUZZ MANAGED/u.test(thread) ? "PASS" : answered ? "FAIL" : "NOT OBSERVED",
    `Answered after ${Math.round((Date.now() - t0) / 1000)} s: ${answered}. pwd path contains .colony: ${inColony}. COLONY MANAGED seen: ${/COLONY MANAGED/u.test(thread)}. BUZZ MANAGED seen: ${/BUZZ MANAGED/u.test(thread)}. Thread text (first 1400 chars): ${thread.slice(0, 1400)}`,
    { screenshot: await shot(page, rec, "d1b-3-answer") },
  );
  await app.quit();
  await sleep(3000);
  const afterFirst = await buildManifest(home, [".buzz", ".colony", ".colony.staging"], { hash: true });
  // Second launch: a no-op.
  const second = await launch("launch 2");
  await second.page.getByTestId("app-sidebar").waitFor({ timeout: 120000 }).catch(() => undefined);
  await sleep(10000);
  const lines2 = (await second.app.hostLogLines()).filter((l) => /nest-migration/u.test(l)).map((l) => redact(l).slice(0, 200));
  const lastLine = lines2[lines2.length - 1] ?? "";
  await second.app.quit();
  await sleep(3000);
  const afterSecond = await buildManifest(home, [".buzz", ".colony", ".colony.staging"], { hash: true });
  const stable = compareStable(afterFirst, afterSecond);
  const meaningful = [...stable.added, ...stable.removed, ...stable.changed.map((c) => c.path)].filter((p) => !/archive\/|\.tmp|models\/|\.scratch\/|\/\.agents\/|nest-agents/u.test(p));
  rec.row(
    "D1B-second-noop",
    "The second launch is a no-op: outcome already-migrated, nothing moves, nothing is created or removed outside the host's own working files",
    /already-migrated/u.test(lastLine) && meaningful.length === 0 ? "PASS" : "FAIL",
    `Second launch migration line: ${lastLine}. Added ${stable.added.length}, removed ${stable.removed.length}, changed ${stable.changed.length}. Not host working files: ${meaningful.join(", ") || "none"}. Changed examples: ${stable.changed.slice(0, 5).map((c) => c.path).join(", ")}`,
  );
  void before;
  void logFrom;
} finally {
  rec.notes.work = work;
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await fake.close().catch(() => undefined);
  await first?.app?.kill?.().catch(() => undefined);
  await progress(`[D1B] done, ${rec.rows.length} rows`);
}
