// Colony 1.0.5 candidate gate, item 7 follow-up: find WHERE the raw `buzz` CLI text becomes visible.
// Relaunch profile A, ask Scout to post a reply, and watch every 150 ms. On the first hit record the DOM path
// (nearest data-testid chain), the element tag and a screenshot, so the source component can be named.
// usage: node c105-legacy.mjs [profile label, default A]
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
const label = process.argv[2] ?? "A";
const rec = new Rec("LEGACY");
const state = await loadState();
const load = await waitForLoad();
await progress(`[LEGACY] load ${load.toFixed(1)} ok, relaunching ${label}`);
const { application, page, version } = await launch({
  privateDir: state[label].privateDir,
  userDataDir: state[label].userDataDir,
});
rec.notes.version = version;
instrument(page, rec, label);
const hits = [];
const t0 = Date.now();
let shots = 0;
const watcher = setInterval(async () => {
  try {
    const found = await page.evaluate(() => {
      const re = /(buzz|fizz|honey|pollen|\u{1f41d})/iu;
      const out = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!re.test(node.textContent ?? "")) continue;
        const el = node.parentElement;
        const chain = [];
        for (let e = el; e && chain.length < 8; e = e.parentElement) {
          chain.push(
            `${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? `[${e.getAttribute("data-testid")}]` : ""}${e.getAttribute("role") ? `{${e.getAttribute("role")}}` : ""}`,
          );
        }
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        out.push({
          text: (node.textContent ?? "").replace(/\s+/gu, " ").slice(0, 200),
          chain: chain.join(" < "),
          visible:
            r.width > 0 &&
            r.height > 0 &&
            s.visibility !== "hidden" &&
            s.display !== "none",
          rect: [
            Math.round(r.x),
            Math.round(r.y),
            Math.round(r.width),
            Math.round(r.height),
          ],
        });
        if (out.length > 3) break;
      }
      return { out, title: document.title };
    });
    for (const h of found.out) {
      const key = `${h.chain}|${h.text.slice(0, 60)}`;
      if (!hits.some((x) => x.key === key)) {
        hits.push({ key, atMs: Date.now() - t0, ...h });
        if (shots < 4 && h.visible) {
          shots += 1;
          await shot(page, rec, `hit-${shots}`);
        }
      }
    }
  } catch {
    /* page gone */
  }
}, 150);

try {
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(3000);
  await page
    .locator('[data-testid="channel-welcome" i]')
    .first()
    .click({ timeout: 8000 });
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  const composer = page
    .getByTestId("message-composer")
    .locator('[contenteditable="true"]')
    .first();
  const asks = [
    " please post a one line status update for the team in #general using your message tool, then reply here when done.",
    " please save a note that our top goal this month is onboarding five customers, then confirm in one sentence.",
  ];
  for (const [i, ask] of asks.entries()) {
    await composer.click();
    await composer.fill("@");
    const menu = page.getByTestId("mention-autocomplete");
    await menu.waitFor({ timeout: 15000 });
    await menu
      .locator("[data-mention-suggestion-index]")
      .filter({ hasText: /Scout/u })
      .first()
      .click();
    await composer.press("End");
    await composer.pressSequentially(ask);
    await composer.press("Enter");
    await sleep(i === 0 ? 75000 : 60000);
  }
  rec.notes.hits = hits.map(({ key: _k, ...rest }) => rest);
  rec.row(
    "LEGACY-where",
    "Where does legacy-name text show while Scout works (150 ms watcher over 2 requests)",
    hits.length ? "FAIL" : "PASS",
    hits.length
      ? `Hits: ${redact(JSON.stringify(rec.notes.hits)).slice(0, 2500)}`
      : "No legacy-name text seen in the DOM (visible or not) over about 135 s of Scout work",
    { screenshot: await shot(page, rec, "final") },
  );
} finally {
  clearInterval(watcher);
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[LEGACY] done, ${rec.rows.length} rows`);
}
