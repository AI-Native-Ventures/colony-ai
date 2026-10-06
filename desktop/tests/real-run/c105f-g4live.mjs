// Final 1.0.5 gate, G4 live part: a REAL agent and a REAL signed-in profile on the throwaway, owner-shaped HOME.
//  1. launch profile A with COLONY_NEST_MIGRATION=0 so the real Scout agent is running with its cwd in ~/.buzz
//  2. SIGKILL only the Electron main process: an agent that survives is an orphan, a real running agent
//  3. launch with COLONY_NEST_MIGRATION=1: the migration must defer (deferred-running-agents), nothing moves, no journal
//  4. stop the orphan agent, launch again with the flag on: the migration runs; foreign entries identical
//  5. ask Scout where it works: expected ~/.colony, and it must still answer
// usage: node c105f-g4live.mjs   (needs profile A in AI_STATE; HOME is A's throwaway home, never the real one)
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  OUT,
  Rec,
  closeApp,
  instrument,
  launch,
  loadState,
  progress,
  redact,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";
import { descendants } from "./nest-migration/launch.mjs";
import { buildManifest } from "./nest-migration/manifest.mjs";
import { OWNED_TOP_LEVEL } from "./nest-migration/contract.mjs";

const run = promisify(execFile);
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const rec = new Rec("G4LIVE");
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const home = path.join(state.A.privateDir, "home");
if (path.resolve(home) === path.resolve(process.env.HOME ?? ""))
  throw new Error("Refusing to use the real home");
const hostLogFile = path.join(state.A.privateDir, "native-host.log");
const profile = { privateDir: state.A.privateDir, userDataDir: state.A.userDataDir };
const readLog = async () => (await readFile(hostLogFile, "utf8").catch(() => "")).split("\n");
const OWNED = new Set(OWNED_TOP_LEVEL);
const top = (p) => p.split("/")[1] ?? "";
const agentsBelow = async (rootPid) => {
  const found = [];
  for (const pid of await descendants(rootPid)) {
    const env = await run("ps", ["eww", "-p", String(pid)]).then((r) => r.stdout, () => "");
    const marker = env.match(/BUZZ_MANAGED_AGENT=\S+/u)?.[0];
    if (marker) {
      const cwd = await run("lsof", ["-a", "-d", "cwd", "-Fn", "-p", String(pid)]).then((r) => r.stdout.split("\n").find((l) => l.startsWith("n"))?.slice(1), () => null);
      found.push({ pid, marker: marker.slice(0, 40), cwd });
    }
  }
  return found;
};
const orphanAgents = async () => {
  // Processes with the managed-agent marker whose parent is launchd (pid 1).
  const out = await run("ps", ["-axo", "pid=,ppid="]).then((r) => r.stdout, () => "");
  const orphans = [];
  for (const line of out.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/u).map(Number);
    if (ppid !== 1 || !pid) continue;
    const env = await run("ps", ["eww", "-p", String(pid)]).then((r) => r.stdout, () => "");
    if (!env.includes("BUZZ_MANAGED_AGENT=") || !env.includes(home)) continue;
    const cwd = await run("lsof", ["-a", "-d", "cwd", "-Fn", "-p", String(pid)]).then((r) => r.stdout.split("\n").find((l) => l.startsWith("n"))?.slice(1), () => null);
    orphans.push({ pid, cwd });
  }
  return orphans;
};
const manifest = () => buildManifest(home, [".buzz", ".colony", ".colony.staging"], { hash: true });
const names = (m, nest) => [...new Set(m.entries.filter((e) => e.path.startsWith(`${nest}/`)).map((e) => top(e.path)))].sort();
const foreignChanges = (a, b, nestA, nestB) => {
  const idx = new Map(b.entries.map((e) => [e.path, e]));
  const out = [];
  for (const e of a.entries) {
    if (!e.path.startsWith(`${nestA}/`)) continue;
    const t = top(e.path.replace(nestA, nestA));
    if (OWNED.has(t) || /^\.(agents|claude|codex|goose)$/u.test(t)) continue;
    const after = idx.get(e.path.replace(nestA, nestB));
    if (!after) { out.push(`${e.path} missing`); continue; }
    for (const f of ["type", "mode", "size", "ino", "sha256", "target"])
      if (e[f] !== after[f] && !(e[f] == null && after[f] == null)) out.push(`${e.path} ${f}: ${e[f]} -> ${after[f]}`);
  }
  return out;
};

const start = async (label, flag) => {
  const load = await waitForLoad();
  const before = (await readLog()).length;
  await progress(`[G4LIVE] launch ${label}: HOME=${home} COLONY_NEST_MIGRATION=${flag} load ${load.toFixed(1)}`);
  const app = await launch({ ...profile, extraEnv: { COLONY_NEST_MIGRATION: flag } });
  instrument(app.page, rec, label);
  return { ...app, logFrom: before };
};
const migrationLines = async (from) =>
  (await readLog()).slice(from).filter((l) => /nest-folder|nest-migration/u.test(l)).map((l) => redact(l).slice(0, 320));

try {
  const m0 = await manifest();
  // 1. real agent running, flag off
  const one = await start("1-flag-off", "0");
  await one.page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(25000);
  const mainPid = one.application.process().pid;
  const agents = await agentsBelow(mainPid);
  rec.row("G4L-real-agent", "A real managed agent (Scout) is running with its cwd in ~/.buzz", agents.length && agents.some((a) => a.cwd?.includes(".buzz")) ? "PASS" : agents.length ? "FAIL" : "NOT OBSERVED", `Managed agents below the app: ${JSON.stringify(agents)}`, { screenshot: await shot(one.page, rec, "g4l-1-running") });
  // 2. kill only the main process
  process.kill(mainPid, "SIGKILL");
  await sleep(4000);
  const orphans = await orphanAgents();
  rec.row("G4L-orphan", "After SIGKILL of the app, a real agent process survives (running agent without an app)", orphans.length ? "PASS" : "NOT OBSERVED", `Orphan managed agents with this HOME: ${JSON.stringify(orphans)}`);
  await one.application.close().catch(() => undefined);
  // 3. flag on while the real agent is running
  const mBefore = await manifest();
  if (orphans.length) {
    const two = await start("2-flag-on-agent-running", "1");
    await two.page.getByTestId("app-sidebar").waitFor({ timeout: 60000 }).catch(() => undefined);
    await sleep(12000);
    const lines = await migrationLines(two.logFrom);
    const mDuring = await manifest();
    const deferred = lines.some((l) => /outcome=deferred-running-agents/u.test(l));
    const colonyNow = mDuring.entries.filter((e) => e.path === ".colony" || e.path.startsWith(".colony/")).length;
    const journal = (await run("find", [path.join(state.A.privateDir, "home", "Library"), "-name", "journal.json", "-path", "*nest-migration*"]).then((r) => r.stdout.trim(), () => ""));
    const changed = foreignChanges(mBefore, mDuring, ".buzz", ".buzz");
    rec.row("G4L-deferred", "Flag on with a real agent running: migration defers, nothing moves, no journal", deferred && colonyNow === 0 && !journal && names(mBefore, ".buzz").every((n) => names(mDuring, ".buzz").includes(n)) ? "PASS" : "FAIL", `Host lines: ${lines.join(" || ")}. ~/.colony entries: ${colonyNow}. Journal files: ${journal || "none"}. Top-level names before/after: ${names(mBefore, ".buzz").length}/${names(mDuring, ".buzz").length}. Foreign changes: ${changed.length ? changed.slice(0, 5).join("; ") : "none"}`, { screenshot: await shot(two.page, rec, "g4l-2-deferred") });
    await closeApp(two.application);
    for (const o of orphans) { try { process.kill(o.pid, "SIGTERM"); } catch { /* gone */ } }
    await sleep(3000);
  } else {
    rec.row("G4L-deferred", "Flag on with a real agent running: migration defers, nothing moves, no journal", "NOT OBSERVED", "No orphan real agent survived the SIGKILL of the app, so a running real agent could not be held while the app started with the flag on");
  }
  // 4. flag on, no agent running: migrates
  const mPre = await manifest();
  const three = await start("3-flag-on", "1");
  await three.page.getByTestId("app-sidebar").waitFor({ timeout: 60000 }).catch(() => undefined);
  await sleep(15000);
  const lines3 = await migrationLines(three.logFrom);
  const mPost = await manifest();
  const colonyNames = names(mPost, ".colony");
  const buzzNames = names(mPost, ".buzz");
  const ownedMoved = OWNED_TOP_LEVEL.filter((n) => names(mPre, ".buzz").includes(n));
  const stillOld = ownedMoved.filter((n) => buzzNames.includes(n));
  const notNew = ownedMoved.filter((n) => !colonyNames.includes(n));
  const changed3 = foreignChanges(mPre, mPost, ".buzz", ".buzz");
  rec.row("G4L-migrated", "Flag on, agent stopped: owned entries move to ~/.colony, foreign entries stay identical in ~/.buzz", /outcome=migrated/u.test(lines3.join("\n")) && !stillOld.length && !notNew.length && !changed3.length ? "PASS" : "FAIL", `Host lines: ${lines3.join(" || ")}. Owned entries expected in ~/.colony: ${ownedMoved.join(",")}; still in ~/.buzz: ${stillOld.join(",") || "none"}; missing in ~/.colony: ${notNew.join(",") || "none"}. Foreign changes: ${changed3.length ? changed3.slice(0, 6).join("; ") : "none"}. ~/.buzz now: ${buzzNames.join(",")}`, { screenshot: await shot(three.page, rec, "g4l-3-migrated") });
  // 5. Scout after migration
  const page = three.page;
  await page.getByTestId("channel-welcome").first().click({ timeout: 8000 }).catch(() => undefined);
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  const composer = page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
  await composer.click();
  await composer.fill("@");
  const menu = page.getByTestId("mention-autocomplete");
  await menu.waitFor({ timeout: 15000 });
  await menu.locator("[data-mention-suggestion-index]").filter({ hasText: /Scout/u }).first().click();
  await composer.press("End");
  await composer.pressSequentially(" what folder do you work in now? Give me the full path, and create a file named after-move.md there with one line.");
  await composer.press("Enter");
  const t0 = Date.now();
  let hits = [];
  while (Date.now() - t0 < 170000) {
    await sleep(5000);
    const all = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/gu, " ");
    hits = [...all.matchAll(/.{0,60}(\.colony|\.buzz)[^ ]*.{0,60}/giu)].map((m) => redact(m[0]));
    if (hits.some((h) => /after-move|\.colony/u.test(h)) && Date.now() - t0 > 25000) break;
  }
  const fileOnDisk = await stat(path.join(home, ".colony", "after-move.md")).then(() => true, () => false);
  const sawColony = hits.some((h) => /\.colony/u.test(h));
  const sawBuzz = hits.filter((h) => /\.buzz/iu.test(h));
  rec.row("G4L-scout-after", "Scout after the migration reports ~/.colony and still answers", sawColony && !sawBuzz.length ? "PASS" : sawColony || hits.length ? "FAIL" : "NOT OBSERVED", `After ${Date.now() - t0} ms. Path-like text: ${[...new Set(hits)].slice(0, 6).join(" | ") || "none"}. .buzz hits: ${sawBuzz.length}. after-move.md exists in ~/.colony on disk: ${fileOnDisk}`, { screenshot: await shot(page, rec, "g4l-4-scout") });
  await writeFile(path.join(OUT, "g4live-manifests.json"), JSON.stringify({ before: m0.entries.length, preMigrate: mPre.entries.length, post: mPost.entries.length, buzzNames, colonyNames }, null, 1));
  await closeApp(three.application);
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await progress(`[G4LIVE] done, ${rec.rows.length} rows`);
  void readdir;
}
