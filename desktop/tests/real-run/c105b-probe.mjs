// Colony 1.0.5 second candidate gate, R1 diagnosis: where does Scout's working signal show while it runs tools?
// Relaunch profile A, ask Scout for a multi-tool job, sample every 500 ms every element whose test id looks like
// activity, working, typing or bot, plus the Team page status and the thread panel composer.
// usage: node c105b-probe.mjs
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

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const rec = new Rec("PROBE");
const state = await loadState();
const load = await waitForLoad();
await progress(`[PROBE] load ${load.toFixed(1)} ok, relaunching profile A`);
const { application, page, version } = await launch({
  privateDir: state.A.privateDir,
  userDataDir: state.A.userDataDir,
});
rec.notes.version = version;
instrument(page, rec, "A");
const t0 = Date.now();
const seen = new Map();
const sample = async () => {
  const items = await page.evaluate(() => {
    const vis = (el) => el.getClientRects().length > 0;
    const out = [];
    for (const el of document.querySelectorAll(
      '[data-testid*="activity"],[data-testid*="working"],[data-testid*="typing"],[data-testid*="bot-"],[data-testid*="agent-session"]',
    )) {
      if (!vis(el)) continue;
      out.push({
        testid: el.getAttribute("data-testid"),
        text: (el.innerText ?? "").replace(/\s+/gu, " ").trim().slice(0, 160),
        h: Math.round(el.getBoundingClientRect().height),
      });
      if (out.length > 30) break;
    }
    return out;
  });
  for (const item of items) {
    const key = `${item.testid}|${item.text}`;
    if (!seen.has(key)) seen.set(key, { firstMs: Date.now() - t0, ...item });
  }
  return items.length;
};

try {
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(3000);
  await page
    .locator('[data-testid="channel-welcome" i]')
    .first()
    .click({ timeout: 8000 });
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  const box = page
    .getByTestId("message-composer")
    .locator('[contenteditable="true"]')
    .first();
  await box.click();
  await box.fill("@");
  const menu = page.getByTestId("mention-autocomplete");
  await menu.waitFor({ timeout: 15000 });
  await menu
    .locator("[data-mention-suggestion-index]")
    .filter({ hasText: /Scout/u })
    .first()
    .click();
  await box.press("End");
  await box.pressSequentially(
    " do this in order and tell me each step: first list all channels, then post the words gate probe hello in the general channel, then create a file called probe-note.md with one heading in your workspace and read it back, then search messages for welcome.",
  );
  await box.press("Enter");
  const sentAt = Date.now();
  let shots = 0;
  let nextShot = 4000;
  while (Date.now() - sentAt < 100000) {
    const n = await sample().catch(() => -1);
    if (Date.now() - sentAt > nextShot && shots < 8) {
      shots += 1;
      nextShot += 9000;
      await shot(page, rec, `probe-${shots}`);
    }
    await sleep(500);
    if (n < 0) break;
  }
  rec.notes.elements = [...seen.values()];
  // Thread panel: open the newest thread and look at its composer area.
  const summary = page.getByText(/\d+ repl(y|ies)/u).last();
  if (await summary.isVisible().catch(() => false)) {
    await summary.click().catch(() => undefined);
    await sleep(2500);
    rec.notes.threadElements = [];
    const before = seen.size;
    await sample();
    rec.notes.threadNewElements = [...seen.values()].slice(before);
    await shot(page, rec, "probe-thread");
  }
  await page.getByTestId("sidebar-company-team").click().catch(() => undefined);
  await sleep(3000);
  rec.notes.teamText = redact(
    (await page.locator("main").innerText().catch(() => "")).replace(/\s+/gu, " ").slice(0, 900),
  );
  await shot(page, rec, "probe-team");
  rec.row(
    "PROBE-elements",
    "Elements with activity/working/typing/bot test ids seen while Scout worked",
    "PASS",
    JSON.stringify(rec.notes.elements).slice(0, 2400),
  );
} finally {
  await rec.write();
  await closeApp(application);
  await progress(`[PROBE] done, ${rec.rows.length} rows`);
}
