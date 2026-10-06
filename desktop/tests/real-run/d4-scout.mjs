// Delta gate D4 on profile A (an existing, signed-in business) on the REAL HOME with COLONY_NEST_MIGRATION=0 and the launch guard:
// Scout answers the business question in the thread within 180 s, Settings Appearance Apply and Revert, window count, clean close.
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
const rec = new Rec("D4SCOUT");
const state = await loadState();
await waitForLoad();
const { application, page, version } = await launch({ privateDir: state.A.privateDir, userDataDir: state.A.userDataDir });
instrument(page, rec, "A");
const windows = new Set();
application.on("window", (w) => windows.add(w.url().slice(0, 40)));
const body = async (n = 500) => redact((await page.locator("body").innerText().catch(() => "")).replace(/\s+/gu, " ").slice(0, n));
const guard = async (id, name, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(id, name, "FAIL", `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}. Page: ${await body(300)}`, { screenshot: await shot(page, rec, `${id}-error`) });
    return undefined;
  }
};
try {
  rec.row("D4-version", "App reports version 1.0.5", version === "1.0.5" ? "PASS" : "FAIL", `app.getVersion() = ${version}`);
  await page.getByTestId("app-sidebar").waitFor({ timeout: 90000 });
  await sleep(3000);
  await guard("D4-reply", "Scout answers the business question in the thread within 180 s", async () => {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.getByText(/^Welcome$/u).first().click({ timeout: 15000 });
    await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
    const marker = `what do you know about our business? ${Date.now() % 100000}`;
    const composer = page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
    await composer.click();
    await composer.fill("@");
    const menu = page.getByTestId("mention-autocomplete");
    await menu.waitFor({ timeout: 15000 });
    await menu.locator("[data-mention-suggestion-index]").filter({ hasText: /Scout/u }).first().click();
    await composer.press("End");
    await composer.pressSequentially(` ${marker}`);
    await composer.press("Enter");
    const t0 = Date.now();
    let ms = null;
    // The reply counter of THIS message row (its own thread chip), not a page-wide counter.
    while (Date.now() - t0 < 180000) {
      await sleep(2000);
      const chip = await page.evaluate((m) => {
        const text = document.body.innerText;
        const i = text.lastIndexOf(m);
        if (i < 0) return null;
        return text.slice(i, i + 160).match(/(\d+) repl(?:y|ies)/u)?.[0] ?? "";
      }, marker);
      if (chip) { ms = Date.now() - t0; break; }
    }
    rec.row("D4-reply", "Scout answers the business question in the thread within 180 s", ms === null ? "FAIL" : "PASS", ms === null ? "No reply within 180 s" : `Thread chip under the sent message appeared after ${(ms / 1000).toFixed(1)} s`, { screenshot: await shot(page, rec, "d4-reply") });
  });
  await guard("D4-appearance", "Settings Appearance Apply and Revert", async () => {
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
    rec.row("D4-appearance", "Settings Appearance Apply and Revert", preview === "Preview only" && applied === "Applied" && nowP === target && reverted === before ? "PASS" : "FAIL", `Before ${before}; picked ${target}, status "${preview}"; Apply status "${applied}", mode ${nowP}; Revert mode ${reverted} (expected ${before})`, { screenshot: await shot(page, rec, "d4-appearance") });
    await page.keyboard.press("Escape");
  });
  const open = application.windows().length;
  rec.row("D4-windows", "One window, no unexpected extra windows", open <= 1 && windows.size === 0 ? "PASS" : "FAIL", `Windows open: ${open}; new windows during the run: ${windows.size}`);
} finally {
  const proc = application.process();
  await closeApp(application);
  rec.row("D4-exit", "Clean exit when the harness closes the app", proc.exitCode === 0 || proc.signalCode === null ? "PASS" : "FAIL", `exit code ${proc.exitCode}, signal ${proc.signalCode}`);
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await progress(`[D4SCOUT] done, ${rec.rows.length} rows`);
}
