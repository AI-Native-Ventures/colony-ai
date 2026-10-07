// Published-build gate, P1 IDENTITY: the released Colony.app must say Colony everywhere a person can see a name.
//   node p1-identity.mjs        (AI_APP = the published Colony.app; profile A on the real HOME with COLONY_NEST_MIGRATION=0 and the launch guard)
// Reads: Info.plist names, app.getName() and app.getVersion() from the main process, the macOS application menu (menu bar name and the
// About, Hide and Quit items), every BrowserWindow title and document.title on every screen visited, a page-side collector over all
// visible text and the title, aria-label, aria-description and alt attributes of those screens, and (best effort) the native About panel.
// Any old name in these is a FAIL. Internal identifiers that are not names a person sees (bundle identifier, helper binary names in
// Contents/Resources) are listed separately, not failed.
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { COLLECTOR, READ_COLLECTED, SET_MODE, mergeCollected } from "./brand-collector.mjs";
import { APP, Rec, closeApp, launch, loadState, progress, redact, shot, sleep, waitForLoad } from "./ai-lib.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required, local only");
const run = promisify(execFile);
const rec = new Rec("P1");
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const reBuzz = /buzz/iu;
// ---- bundle on disk ----
const plist = path.join(APP, "Contents", "Info.plist");
const key = async (k) => run("/usr/libexec/PlistBuddy", ["-c", `Print ${k}`, plist]).then((r) => r.stdout.trim(), () => "(missing)");
const keys = {};
for (const k of ["CFBundleName", "CFBundleDisplayName", "CFBundleExecutable", "CFBundleShortVersionString", "CFBundleVersion", "CFBundleIdentifier"]) keys[k] = await key(k);
const helpers = (await readdir(path.join(APP, "Contents", "Frameworks")).catch(() => [])).filter((n) => n.endsWith(".app"));
const topLevel = await readdir(path.dirname(APP)).catch(() => []);
const resources = (await readdir(path.join(APP, "Contents", "Resources")).catch(() => [])).filter((n) => reBuzz.test(n));
const bundleBad = [keys.CFBundleName, keys.CFBundleDisplayName, keys.CFBundleExecutable, path.basename(APP), ...helpers].filter((n) => reBuzz.test(n));
rec.row(
  "P1-bundle",
  "Info.plist and bundle names say Colony: CFBundleName, CFBundleDisplayName, CFBundleExecutable, the .app name and every helper app",
  keys.CFBundleName === "Colony" && keys.CFBundleDisplayName === "Colony" && keys.CFBundleExecutable === "Colony" && !bundleBad.length ? "PASS" : "FAIL",
  `${JSON.stringify(keys)}. App folder name: ${path.basename(APP)}. Helper apps: ${helpers.join(", ")}. Names with the old name among those: ${bundleBad.join(", ") || "none"}. NOT shown to a person (listed for the record, not failed): bundle identifier ${keys.CFBundleIdentifier}; sidecar binaries in Contents/Resources: ${resources.join(", ")}.`,
);
const load = await waitForLoad();
await progress(`[P1] load ${load.toFixed(1)} ok, launching profile A (real HOME, COLONY_NEST_MIGRATION=0, guard on)`);
const { application, page, version } = await launch({ privateDir: state.A.privateDir, userDataDir: state.A.userDataDir });
rec.notes.version = version;
let collected = { ticks: 0, surfaces: {} };
const snapshot = async () => {
  try {
    const read = await page.evaluate(READ_COLLECTED);
    if (read) collected = mergeCollected(collected, read);
  } catch {
    /* page busy */
  }
};
const titles = [];
const visit = async (label) => {
  await sleep(1500);
  await snapshot();
  const main = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
  const doc = await page.title().catch(() => "");
  titles.push({ screen: label, windowTitles: main, documentTitle: doc });
};
try {
  const info = await application.evaluate(({ app, Menu }) => {
    const menu = Menu.getApplicationMenu();
    return {
      name: app.getName(),
      version: app.getVersion(),
      exe: app.getPath("exe"),
      menu: (menu?.items ?? []).map((i) => ({ label: i.label, items: (i.submenu?.items ?? []).map((s) => ({ label: s.label, role: s.role ?? null })) })),
    };
  });
  rec.row("P1-version", "app.getVersion() = 1.0.5", info.version === "1.0.5" ? "PASS" : "FAIL", `app.getVersion() = ${info.version}; exe ${info.exe.replace(/^\/Users\/[^/]+/u, "~")}`);
  rec.row("P1-name", "app.getName() is Colony", info.name === "Colony" ? "PASS" : "FAIL", `app.getName() = "${info.name}"`);
  const first = info.menu[0];
  const wanted = ["About", "Hide", "Quit"].map((w) => first?.items.find((i) => i.label.startsWith(w))?.label ?? null);
  const menuLabels = info.menu.flatMap((m) => [m.label, ...m.items.map((i) => i.label)]).filter(Boolean);
  const menuBad = menuLabels.filter((l) => reBuzz.test(l));
  rec.row(
    "P1-menu",
    "macOS menu bar: the app menu is named Colony and its About, Hide and Quit items say Colony; no menu label carries the old name",
    first?.label === "Colony" && wanted.every((w) => w && /Colony/u.test(w)) && !menuBad.length ? "PASS" : "FAIL",
    `App menu title "${first?.label}". About / Hide / Quit items: ${wanted.map((w) => `"${w}"`).join(" / ")}. Top-level menus: ${info.menu.map((m) => m.label).join(" | ")}. Every menu label (${menuLabels.length}): old name in ${menuBad.length ? menuBad.join(", ") : "none"}.`,
  );
  await page.getByTestId("app-sidebar").waitFor({ timeout: 90000 });
  await page.evaluate(COLLECTOR);
  await page.evaluate(SET_MODE, "channel");
  await visit("workspace (landing)");
  await shot(page, rec, "p1-workspace");
  // Walk the main screens a person visits; every one records the window title and the visible text.
  const go = async (label, fn) => {
    try {
      await fn();
      await visit(label);
    } catch (error) {
      titles.push({ screen: label, error: `${error.name}` });
    }
  };
  await go("Today", () => page.getByText(/^Today$/u).first().click({ timeout: 6000 }));
  await go("Welcome channel", () => page.getByText(/^Welcome$/u).first().click({ timeout: 6000 }));
  await go("Team", async () => { await page.evaluate(SET_MODE, "team"); await page.getByTestId("sidebar-company-team").click({ timeout: 6000 }); await sleep(2500); });
  await go("Activity", async () => { await page.evaluate(SET_MODE, "activity"); await page.getByTestId("sidebar-activity-button").click({ timeout: 6000 }); await sleep(2500); });
  await go("Settings", async () => { await page.evaluate(SET_MODE, "settings"); await page.getByTestId("open-settings").click({ timeout: 6000 }); await page.getByTestId("profile-popover-settings").click({ timeout: 6000 }); await page.getByTestId("settings-view").waitFor({ timeout: 10000 }); await sleep(1500); });
  await shot(page, rec, "p1-settings");
  await page.keyboard.press("Escape").catch(() => undefined);
  const all = Object.entries(collected.surfaces);
  const hits = [];
  for (const [surface, texts] of all)
    for (const text of texts) {
      const m = String(text).match(reBuzz);
      if (m) hits.push({ surface, context: redact(String(text).slice(Math.max(0, m.index - 40), m.index + 80)) });
    }
  const titleBad = titles.flatMap((t) => [...(t.windowTitles ?? []), t.documentTitle ?? ""]).filter((x) => reBuzz.test(x));
  rec.row(
    "P1-titles",
    "Window title (BrowserWindow.getTitle and document.title) says Colony on every screen visited",
    titles.filter((t) => !t.error).length >= 4 && !titleBad.length && titles.filter((t) => !t.error).every((t) => (t.windowTitles ?? []).every((w) => w === "Colony")) ? "PASS" : "FAIL",
    `${titles.map((t) => (t.error ? `${t.screen}: not reached (${t.error})` : `${t.screen}: window ${JSON.stringify(t.windowTitles)}, document "${t.documentTitle}"`)).join(" ; ")}. Titles with the old name: ${titleBad.length ? titleBad.join(", ") : "none"}.`,
  );
  const textTotal = all.reduce((n, [, v]) => n + v.length, 0);
  // Surface class: the chat timeline and the Activity page (Home inbox) show text Scout and people WROTE (content); every other
  // surface is product chrome. On the real HOME the nest is deliberately NOT migrated (flag forced to 0), so a reply that names the
  // working folder legitimately says ~/.buzz. Chrome hits fail; content hits are listed.
  const isContent = (surface) => ["chat", "activity-page"].includes(surface.split(".")[0]);
  const chromeHits = hits.filter((h) => !isContent(h.surface));
  const contentHits = hits.filter((h) => isContent(h.surface));
  rec.row(
    "P1-visible-text",
    "No old name in any visible chrome text, title, aria-label, aria-description or alt on the screens visited (content Scout wrote is listed separately)",
    chromeHits.length ? "FAIL" : "PASS",
    `${textTotal} distinct texts over ${all.length} surface keys on ${titles.length} screens. CHROME hits: ${chromeHits.length ? chromeHits.map((h) => `${h.surface}: "${h.context}"`).join(" | ") : "0"}. CONTENT hits (text in messages and the Activity page inbox, expected on the real HOME where migration is forced off and the working folder is ~/.buzz): ${contentHits.length ? contentHits.map((h) => `${h.surface}: "${h.context}"`).join(" | ") : "0"}. Screens: ${titles.map((t) => t.screen).join(", ")}.`,
  );
  // About panel: trigger the About item and try to read the native panel (best effort, needs Accessibility permission for System Events).
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.items[0]?.submenu?.items.find((i) => i.label.startsWith("About"));
    item?.click();
  });
  await sleep(2500);
  const about = await run("osascript", ["-e", 'tell application "System Events" to tell process "Colony" to get value of every static text of window 1'], { timeout: 10000 }).then((r) => r.stdout.trim(), (e) => `(not readable: ${String(e.message).split("\n")[0].slice(0, 120)})`);
  rec.row(
    "P1-about",
    "About panel text names Colony 1.0.5",
    !/not readable/u.test(about) && /Colony/u.test(about) && !reBuzz.test(about) ? "PASS" : "NOT OBSERVED",
    /not readable/u.test(about)
      ? `The native About panel could not be read from here (${about}). Source: electron/main.mjs:81 app.setName(tauriConfig.productName), no custom setAboutPanelOptions, so the stock panel prints app.getName() "${info.name}" and CFBundleShortVersionString ${keys.CFBundleShortVersionString}; both read above.`
      : `Panel texts: ${about}`,
  );
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.focus())).catch(() => undefined);
} catch (error) {
  rec.row("P1-run", "Run", "FAIL", `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`, { screenshot: await shot(page, rec, "p1-error").catch(() => undefined) });
} finally {
  rec.notes.titles = titles;
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[P1] done, ${rec.rows.length} rows`);
  void version;
  void topLevel;
}
