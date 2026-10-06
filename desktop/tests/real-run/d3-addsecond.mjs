// Delta gate D3 setup: an existing member adds a SECOND community by invite (Add community), no new business is created.
//   node d3-addsecond.mjs <profile label> <invite.json written by the fake-model run>
import { readFile } from "node:fs/promises";
import { Rec, closeApp, instrument, launch, loadState, progress, redact, shot, sleep, waitForLoad } from "./ai-lib.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required");
const [label, inviteFile] = process.argv.slice(2);
const rec = new Rec(`D3ADD-${label}`);
const state = await loadState();
const { link } = JSON.parse(await readFile(inviteFile, "utf8"));
await waitForLoad();
const { application, page, version } = await launch({ privateDir: state[label].privateDir, userDataDir: state[label].userDataDir });
instrument(page, rec, label);
const stored = () =>
  page.evaluate(() => {
    try {
      const list = JSON.parse(localStorage.getItem("buzz-communities") ?? "[]");
      const active = localStorage.getItem("buzz-active-community-id");
      return { count: list.length, active: list.find((c) => c.id === active)?.name ?? null, names: list.map((c) => c.name) };
    } catch {
      return null;
    }
  });
try {
  await page.getByTestId("app-sidebar").waitFor({ timeout: 90000 });
  await sleep(3000);
  const before = await stored();
  await page.getByTestId("sidebar-profile-avatar-button").click({ timeout: 8000 });
  await sleep(700);
  await page.locator('[data-testid="profile-popover"] [data-testid="community-switcher"]').first().click({ timeout: 8000 });
  await sleep(600);
  await page.getByRole("menuitem", { name: /add (a )?community/iu }).first().click({ timeout: 8000 });
  await page.getByTestId("add-community-dialog").waitFor({ timeout: 8000 });
  await page.getByTestId("add-community-join").click({ timeout: 6000 });
  const input = page.getByTestId("invite-redeem-input").first();
  await input.waitFor({ timeout: 8000 });
  await input.fill(link);
  await page.getByTestId("invite-redeem-submit").click();
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 60000) {
    const join = page.getByTestId("invite-join");
    if (await join.isVisible().catch(() => false)) {
      for (const box of await page.locator('input[type="checkbox"],[role="checkbox"]').all()) await box.click().catch(() => undefined);
      await join.click().catch(() => undefined);
    }
    const st = await stored();
    if (st?.count === 2 && (await page.getByTestId("app-sidebar").isVisible().catch(() => false))) { ok = true; break; }
    await sleep(1500);
  }
  const after = await stored();
  rec.row("D3ADD", "Existing member adds a second community by invite, no business form, no create request", ok ? "PASS" : "FAIL", `App ${version}. Before ${JSON.stringify(before)}. After ${JSON.stringify(after)}. Took ${Math.round((Date.now() - t0) / 1000)} s. Page: ${redact((await page.locator("body").innerText().catch(() => "")).replace(/\s+/gu, " ").slice(0, 250))}`, { screenshot: await shot(page, rec, "d3add") });
} finally {
  await rec.write();
  await closeApp(application);
  await progress(`[D3ADD-${label}] done, ${rec.rows.length} rows`);
}
