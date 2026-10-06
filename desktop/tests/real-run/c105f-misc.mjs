// Final 1.0.5 gate: window title, application menu (About), every Settings page, Team and Activity pages scanned for the
// legacy names (Buzz, Fizz, Honey, Pollen, bee). Profile A, real HOME with COLONY_NEST_MIGRATION=0.
import {
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

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required");
const rec = new Rec("MISC");
const state = await loadState();
await waitForLoad();
const { application, page, version } = await launch({ privateDir: state.A.privateDir, userDataDir: state.A.userDataDir });
instrument(page, rec, "A");
const re = /(buzz|fizz|honey|pollen|\u{1f41d})/iu;
const scan = (label, text) => {
  const hits = [...String(text).matchAll(/.{0,50}(buzz|fizz|honey|pollen|\u{1f41d}).{0,50}/giu)].map((m) => redact(m[0].replace(/\s+/gu, " ")));
  return { label, hits: [...new Set(hits)].slice(0, 6) };
};
const visited = [];
try {
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(2500);
  const titles = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
  const menu = await application.evaluate(({ Menu, app }) => ({
    appName: app.getName(),
    items: (Menu.getApplicationMenu()?.items ?? []).map((i) => ({ label: i.label, sub: (i.submenu?.items ?? []).map((s) => s.label).filter(Boolean) })),
  }));
  rec.row("MISC-title", "Window title text", re.test(titles.join(" ")) ? "FAIL" : "PASS", `Window titles: ${JSON.stringify(titles)}. document.title: ${JSON.stringify(await page.title())}`, { screenshot: await shot(page, rec, "m1-main") });
  const menuText = JSON.stringify(menu);
  rec.row("MISC-menu", "Application menu and About label", re.test(menuText) ? "FAIL" : "PASS", `app.getName() = ${menu.appName}. Menu: ${menuText.slice(0, 900)}`);
  visited.push(scan("main workspace", await page.locator("body").innerText()));
  await page.getByTestId("open-settings").click({ timeout: 8000 });
  await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
  await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
  await sleep(800);
  const nav = page.getByTestId("settings-sidebar").getByRole("button");
  const n = await nav.count();
  let aboutText = "";
  for (let i = 0; i < n && i < 30; i += 1) {
    const label = redact(((await nav.nth(i).innerText().catch(() => "")) || `button ${i}`).replace(/\s+/gu, " ").trim());
    await nav.nth(i).click({ timeout: 4000 }).catch(() => undefined);
    await sleep(700);
    const text = await page.getByTestId("settings-view").innerText().catch(() => "");
    visited.push(scan(`settings: ${label}`, text));
    if (/about|version/iu.test(label) || /Colony\s+\d+\.\d+\.\d+|Version\s+\d/iu.test(text)) aboutText += `[${label}] ${redact(text.replace(/\s+/gu, " ").slice(0, 500))} `;
  }
  await shot(page, rec, "m2-settings");
  await page.keyboard.press("Escape");
  await sleep(600);
  for (const [label, id] of [["Team page", "sidebar-company-team"], ["Activity page", "sidebar-activity-button"]]) {
    await page.getByTestId(id).click({ timeout: 6000 }).catch(() => undefined);
    await sleep(2500);
    visited.push(scan(label, await page.locator("body").innerText().catch(() => "")));
  }
  const hits = visited.filter((v) => v.hits.length);
  rec.row("MISC-pages", "Legacy-name scan of the workspace, every Settings page, Team and Activity", hits.length ? "FAIL" : "PASS", `${visited.length} pages scanned: ${visited.map((v) => v.label).join(", ")}. Hits: ${JSON.stringify(hits)}`, { screenshot: await shot(page, rec, "m3-end") });
  rec.row("MISC-about", "About text, if reachable in Settings", aboutText ? "PASS" : "NOT OBSERVED", aboutText || "No Settings page with About or a version string was found by label or text");
  rec.notes.visited = visited;
  rec.notes.version = version;
} finally {
  await rec.write();
  await closeApp(application);
  await progress(`[MISC] done, ${rec.rows.length} rows`);
}
