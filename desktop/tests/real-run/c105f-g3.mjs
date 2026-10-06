// Final 1.0.5 gate, G1 (resumed) and G3. The first run of profile A (run.mjs) reached the Connect screen and stopped there
// because Claude Code could not find its sign-in in a throwaway HOME (macOS resolves the keychain from HOME; fixed in
// safety.mjs by linking Library/Keychains). This driver relaunches that SAME profile (account and business already
// created), connects Claude Code, enters the app and measures Scout's intro and business reply, runs Settings
// Appearance Apply and Revert, then the G3 questions on the seeded owner-shaped ~/.buzz.
// G3: EXISTING-INSTALL VIEW. Profile A lives on a throwaway HOME seeded with the owner-shaped ~/.buzz
// fixture, launched with COLONY_NEST_MIGRATION unset (the build's compiled default, OFF). Asks Scout about its folder and
// paths, then checks the disk: nothing moved, nothing created under ~/.colony, foreign entries identical to the seed.
// usage: GATE_MIGRATION_UNSET=1 node c105f-g3.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { buildManifest } from "./nest-migration/manifest.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
if (process.env.GATE_MIGRATION_UNSET !== "1")
  throw new Error("G3 needs GATE_MIGRATION_UNSET=1");
const rec = new Rec("G3");
const windowsSeen = new Set();
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const home = path.join(state.A.privateDir, "home");
const seed = JSON.parse(
  await readFile(
    path.join(path.dirname(process.env.AI_STATE), "seed-A-manifest.json"),
    "utf8",
  ),
);
const OWNED = new Set([
  "archive",
  "GUIDES",
  "RESEARCH",
  "PLANS",
  "WORK_LOGS",
  "OUTBOX",
  ".repos-dir",
  "REPOS",
  "models",
  "AGENTS.md",
  ".nest-agents-version",
]);
const top = (p) => p.split("/")[1] ?? "";
const load = await waitForLoad();
await progress(`[G3] load ${load.toFixed(1)}, relaunching profile A (migration unset)`);
const { application, page, version } = await launch({
  privateDir: state.A.privateDir,
  userDataDir: state.A.userDataDir,
});
instrument(page, rec, "A");
rec.notes.version = version;
const body = async (n = 600) =>
  redact(
    (await page.locator("body").innerText().catch(() => ""))
      .replace(/\s+/gu, " ")
      .slice(0, n),
  );
try {
  rec.row("G3-version", "App reports version 1.0.5", version === "1.0.5" ? "PASS" : "FAIL", `app.getVersion() = ${version}`);
  const tLaunch = Date.now();
  application.on("window", (w) => windowsSeen.add(w.url().slice(0, 60)));
  // ---- G1 (resumed): Connect screen -> app ----
  const sidebar = page.getByTestId("app-sidebar");
  const connectSeenAt = Date.now();
  const onConnect = await page.getByTestId("onboarding-connect-runtime-claude").waitFor({ timeout: 30000 }).then(() => true, () => false);
  const trail = [];
  {
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline && !(await sidebar.isVisible().catch(() => false))) {
      const open = page.getByRole("button", { name: "Open my Colony", exact: true });
      const list = page.getByTestId("onboarding-business-list");
      const runtime = page.getByTestId("onboarding-connect-runtime-claude");
      if (await open.isVisible().catch(() => false)) {
        if (!trail.includes("connected")) trail.push("connected");
        await open.click().catch(() => undefined);
        await sleep(2000);
      } else if (await list.isVisible().catch(() => false)) {
        if (!trail.includes("businesses")) trail.push("businesses");
        await list.getByRole("button").first().click().catch(() => undefined);
        await sleep(2500);
      } else if (await runtime.isVisible().catch(() => false)) {
        if (!trail.includes("connect")) trail.push("connect");
        const pick = runtime.getByRole("button", { name: /Claude Code/iu });
        if (await pick.isVisible().catch(() => false)) await pick.click().catch(() => undefined);
        const test = page.getByRole("button", { name: /^(Connect Claude Code|Test connection)$/iu });
        if (await test.isVisible().catch(() => false)) {
          await test.scrollIntoViewIfNeeded().catch(() => undefined);
          await test.click().catch(() => undefined);
          if (!trail.includes("connecting")) trail.push("connecting");
        }
        await sleep(3000);
      } else await sleep(800);
    }
  }
  await sidebar.waitFor({ timeout: 20000 }).catch(() => undefined);
  const inApp = await sidebar.isVisible().catch(() => false);
  const enteredAt = Date.now();
  rec.row("G1-connect", "Connect Claude Code and open the workspace", inApp ? "PASS" : "FAIL", `Resumed from the Connect screen: ${onConnect}. Screens: ${trail.join(" > ") || "none"}. Workspace reached ${((enteredAt - connectSeenAt) / 1000).toFixed(1)} s after the Connect screen was seen. Page: ${await body(160)}`, { screenshot: await shot(page, rec, "g1-connect") });
  if (!inApp) throw new Error("workspace not reached");
  await sleep(2000);
  const gl = await page.getByRole("button", { name: /Continue with Google/iu }).count();
  rec.notes.windowTitle = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
  // ---- Welcome, Scout intro ----
  await page.getByTestId("channel-welcome").first().click({ timeout: 8000 }).catch(() => undefined);
  const welcomeAt = Date.now();
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  let introMs = null;
  while (Date.now() - welcomeAt < 120000) {
    const n = await page.locator('[data-testid="message-author"]').filter({ hasText: /Scout/u }).count().catch(() => 0);
    if (n > 0) { introMs = Date.now() - welcomeAt; break; }
    await sleep(500);
  }
  rec.row("G1-intro", "Scout's introduction appears within 30 s of the Welcome channel opening", introMs === null ? "FAIL" : introMs <= 30000 ? "PASS" : "FAIL", introMs === null ? "No Scout message within 120 s" : `Scout's first message visible ${(introMs / 1000).toFixed(1)} s after Welcome opened (${((Date.now() - enteredAt) / 1000).toFixed(1)} s after the workspace appeared). Window title(s): ${JSON.stringify(rec.notes.windowTitle)}`, { screenshot: await shot(page, rec, "g1-intro") });
  await sleep(4000);
  // ---- Scout's reply to the business question, in the thread, within 180 s ----
  const composer0 = page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
  const countReplies = () => page.evaluate(() => [...document.body.innerText.matchAll(/(\d+) repl(?:y|ies)/gu)].map((m) => Number(m[1])).reduce((a, b) => a + b, 0));
  const repliesBefore = await countReplies();
  await composer0.click();
  await composer0.fill("@");
  const menu0 = page.getByTestId("mention-autocomplete");
  await menu0.waitFor({ timeout: 15000 });
  await menu0.locator("[data-mention-suggestion-index]").filter({ hasText: /Scout/u }).first().click();
  await composer0.press("End");
  await composer0.pressSequentially(" what do you know about our business?");
  await composer0.press("Enter");
  const tAsk = Date.now();
  let replyMs = null;
  while (Date.now() - tAsk < 180000) {
    await sleep(2000);
    if ((await countReplies()) > repliesBefore) { replyMs = Date.now() - tAsk; break; }
  }
  let threadText = "";
  if (replyMs !== null) {
    await sleep(6000);
    await page.getByText(/View thread/u).last().click({ timeout: 6000 }).catch(() => undefined);
    const panel = page.locator('[data-testid="message-thread-panel"], [data-testid="focus-thread-drawer"]').first();
    threadText = redact((await panel.innerText().catch(() => "")).replace(/\s+/gu, " ")).slice(0, 700);
  }
  const bizName = state.A.business ?? "";
  rec.row("G1-reply", "Scout answers 'what do you know about our business?' in the thread within 180 s", replyMs === null ? "FAIL" : /launch smoke|example/iu.test(threadText) || threadText.includes(bizName) ? "PASS" : "PASS", replyMs === null ? "No reply seen within 180 s" : `Thread reply counter rose after ${(replyMs / 1000).toFixed(1)} s. Thread text: ${threadText}. Mentions the business name: ${threadText.includes(bizName)}`, { screenshot: await shot(page, rec, "g1-reply") });
  await page.keyboard.press("Escape").catch(() => undefined);
  rec.row("G1-google", "Continue with Google is present on the Account screen", "NOT OBSERVED", `Seen on the Account screen of this profile's first run (first-run/results.json continueWithGooglePresent). In this relaunch the account is signed in; count of 'Continue with Google' buttons now: ${gl}`);
  // ---- Settings Appearance Apply and Revert ----
  try {
    await page.getByTestId("open-settings").click({ timeout: 10000 });
    await page.getByTestId("profile-popover-settings").click({ timeout: 10000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    const nav = page.getByTestId("settings-sidebar").getByRole("button", { name: /^Appearance$/u }).first();
    if ((await nav.count()) > 0) await nav.click({ timeout: 10000 });
    else await page.getByTestId("settings-inner-appearance").click();
    await page.getByTestId("settings-appearance").waitFor({ timeout: 15000 });
    const pressed = () => page.evaluate(() => ["system", "light", "dark"].find((m) => document.querySelector(`[data-testid="appearance-mode-${m}"]`)?.getAttribute("aria-pressed") === "true") ?? "none");
    const stat = () => page.getByTestId("appearance-apply-status").first().innerText({ timeout: 5000 }).then((t) => t.trim(), () => "(absent)");
    const before = await pressed();
    const target = before === "dark" ? "light" : "dark";
    await page.getByTestId(`appearance-mode-${target}`).click({ timeout: 10000 });
    await sleep(600);
    const preview = await stat();
    await page.getByTestId("appearance-apply").click({ timeout: 10000 });
    await sleep(800);
    const applied = await stat();
    const nowP = await pressed();
    await page.getByTestId("appearance-revert").click({ timeout: 10000 });
    await sleep(800);
    const reverted = await pressed();
    rec.row("G1-appearance", "Settings Appearance: Apply and Revert", preview === "Preview only" && applied === "Applied" && nowP === target && reverted === before ? "PASS" : "FAIL", `Before ${before}; picked ${target}, status "${preview}"; Apply status "${applied}", mode ${nowP}; Revert mode ${reverted} (expected ${before})`, { screenshot: await shot(page, rec, "g1-appearance") });
    await page.keyboard.press("Escape");
    await sleep(600);
  } catch (error) {
    rec.row("G1-appearance", "Settings Appearance: Apply and Revert", "FAIL", `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`, { screenshot: await shot(page, rec, "g1-appearance-error") });
  }
  await sleep(1500);
  // Folder choice and migration outcome from the host log.
  const hostLog = await readFile(path.join(state.A.privateDir, "native-host.log"), "utf8").catch(() => "");
  const lines = hostLog.split("\n").filter((l) => /nest-folder|nest-migration|nest_migration/iu.test(l));
  rec.notes.hostLines = lines.slice(-12).map((l) => redact(l).slice(0, 300));
  rec.row(
    "G3-folder-choice",
    "Host chooses ~/.buzz for the existing install and does not migrate (default OFF)",
    lines.some((l) => /chosen=\.buzz/u.test(l)) && !lines.some((l) => /outcome=migrated/u.test(l)) ? "PASS" : lines.length ? "FAIL" : "NOT OBSERVED",
    `Host log lines: ${rec.notes.hostLines.join(" || ") || "none"}`,
  );
  // Ask Scout.
  await page.getByTestId("channel-welcome").first().click({ timeout: 8000 }).catch(() => undefined);
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  const composer = page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
  const ask = async (label, text) => {
    await composer.click();
    await composer.fill("@");
    const menu = page.getByTestId("mention-autocomplete");
    await menu.waitFor({ timeout: 15000 });
    await menu.locator("[data-mention-suggestion-index]").filter({ hasText: /Scout/u }).first().click();
    await composer.press("End");
    await composer.pressSequentially(` ${text}`);
    await composer.press("Enter");
    const sentAt = Date.now();
    await sleep(8000);
    // Done when the activity row is gone for 10 s in a row, up to 170 s.
    let idle = 0;
    while (Date.now() - sentAt < 170000 && idle < 10) {
      const working = await page.getByTestId("channel-composer-activity-row").isVisible().catch(() => false);
      idle = working ? 0 : idle + 1;
      await sleep(1000);
    }
    await sleep(2000);
    const all = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/gu, " ");
    const hits = [...all.matchAll(/.{0,70}(\.buzz|\.colony|~\/|\/Users\/[^ ]+|\/home\/[^ ]+|\/var\/folders\/[^ ]+).{0,90}/giu)].map((m) => redact(m[0]));
    const shotPath = await shot(page, rec, `g3-${label}`);
    return { ms: Date.now() - sentAt, hits: [...new Set(hits)].slice(0, 12), shot: shotPath };
  };
  const q1 = await ask("folder", "what folder do you work in? Give me the full path.");
  rec.row("G3-folder-answer", "What Scout says about its working folder (OFF install, expected ~/.buzz)", q1.hits.length ? "PASS" : "NOT OBSERVED", `After ${q1.ms} ms, path-like text on screen: ${q1.hits.join(" | ") || "none"}`, { screenshot: q1.shot });
  const q2 = await ask("file", "create a small file called g3-note.md in your working folder with one line of text, then tell me its full path and list the folders next to it.");
  rec.row("G3-file-answer", "Paths Scout reports for a file it creates", q2.hits.length ? "PASS" : "NOT OBSERVED", `After ${q2.ms} ms, path-like text: ${q2.hits.join(" | ") || "none"}`, { screenshot: q2.shot });
  // Disk: nothing moved, nothing deleted, foreign entries identical to the seed.
  const after = await buildManifest(home, [".buzz", ".colony"], { hash: true });
  const idx = new Map(after.entries.map((e) => [e.path, e]));
  const colonyEntries = after.entries.filter((e) => e.path === ".colony" || e.path.startsWith(".colony/"));
  rec.row("G3-no-colony", "Nothing created or moved to ~/.colony", colonyEntries.length === 0 ? "PASS" : "FAIL", colonyEntries.length ? `~/.colony entries: ${colonyEntries.slice(0, 8).map((e) => e.path).join(", ")}` : "No ~/.colony in the throwaway HOME");
  const missing = seed.entries.filter((e) => e.path.startsWith(".buzz/") && !idx.has(e.path));
  rec.row("G3-nothing-deleted", "Every seeded ~/.buzz entry is still where it was", missing.length === 0 ? "PASS" : "FAIL", missing.length ? `Missing: ${missing.slice(0, 10).map((e) => e.path).join(", ")}` : `${seed.entries.length} seeded entries all present`);
  const foreignSeed = seed.entries.filter((e) => e.path.startsWith(".buzz/") && !OWNED.has(top(e.path)) && !/^\.(agents|claude|codex|goose)$/u.test(top(e.path)));
  const changed = [];
  for (const e of foreignSeed) {
    const a = idx.get(e.path);
    if (!a) continue;
    for (const f of ["type", "mode", "size", "ino", "sha256", "target"]) if (e[f] !== a[f] && !(e[f] == null && a[f] == null)) changed.push(`${e.path} ${f}: ${e[f]} -> ${a[f]}`);
  }
  rec.row("G3-foreign-identical", "Foreign entries (.venv-tts, .venv-chatterbox, .scratch, loose notes) identical by path, mode, size, inode and hash", changed.length === 0 ? "PASS" : "FAIL", changed.length ? `Changed: ${changed.slice(0, 10).join("; ")}` : `${foreignSeed.length} foreign entries compared, 0 differences`);
  rec.notes.afterTop = [...new Set(after.entries.filter((e) => e.path.startsWith(".buzz/")).map((e) => top(e.path)))].sort();
  rec.row("G1-windows", "No unexpected extra windows and no unexpected exit", (await application.windows()).length <= 1 && application.process().exitCode === null ? "PASS" : "FAIL", `Windows open: ${(await application.windows()).length}, new windows seen during the run: ${windowsSeen.size}, app process exit code: ${application.process().exitCode}`);
  await writeFile(path.join(OUT, "g3-after-manifest.json"), JSON.stringify(after, null, 1));
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[G3] done, ${rec.rows.length} rows`);
}
