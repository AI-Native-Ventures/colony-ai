// Control for the DOCK-scroll check: does the timeline stay where the person was reading after the Work area dock is opened and closed?
//   AI_APP_OVERRIDE=<Buzz.app> node dockscroll.mjs <label> <channel> [fillers]
// Profile A on the real HOME with COLONY_NEST_MIGRATION=0 (the usual launch guard). The channel is selected by name; a missing channel is
// created through the app (Cmd+Shift+N dialog) and filled with filler messages until its scroll range reaches about 1600 px (the gate 1
// height). The primary assertion is ANCHOR based: the first message row visible before the dock opens must still be visible, at about the
// same place, after the dock closes (reflow tolerated). The pixel triple (before, open, closed scrollTop) is recorded as secondary.
// It also records whether any message arrived while the dock was open (row count and last message id before, during and after).
import {
  Rec,
  closeApp,
  launch,
  loadState,
  progress,
  redact,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required, local only");
const [label = "run", channelName = "general", fillerTarget = "1600"] = process.argv.slice(2);
const LIVE = Number(process.env.DS_LIVE ?? "0");
const rec = new Rec(`DS-${label}-${channelName}${LIVE ? "-live" : ""}`);
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const load = await waitForLoad();
await progress(`[DS-${label}-${channelName}] load ${load.toFixed(1)} ok, relaunching profile A`);
const { application, page, version } = await launch({ privateDir: state.A.privateDir, userDataDir: state.A.userDataDir });
rec.notes.version = version;
rec.notes.app = process.env.AI_APP ?? "(default)";
const channel = (name) => page.locator(`[data-testid="channel-${name}" i]`).first();
const dockOpen = () => page.getByTestId("work-area-panel").isVisible().catch(() => false);
const openDock = async () => {
  if (await dockOpen()) return;
  await page.getByTestId("channel-work-area-trigger").click({ timeout: 8000 });
  await page.getByTestId("work-area-panel").waitFor({ timeout: 8000 });
};
const closeDock = async () => {
  if (!(await dockOpen())) return;
  await page.getByTestId("work-area-close").click({ timeout: 8000 });
  await page.getByTestId("work-area-panel").waitFor({ state: "hidden", timeout: 8000 });
};
const SCROLLER = () => {
  const tl = document.querySelector('[data-testid="message-timeline"]');
  const sc = tl ? ([tl, ...tl.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 50 && getComputedStyle(n).overflowY !== "visible") ?? tl) : null;
  if (sc) sc.dataset.dockScroll = "1";
  return !!sc;
};
const READ = () => {
  const sc = document.querySelector('[data-dock-scroll="1"]');
  if (!sc) return null;
  const sr = sc.getBoundingClientRect();
  const rows = [...document.querySelectorAll('[data-testid="message-row"]')];
  const visible = rows
    .map((r) => {
      const b = r.getBoundingClientRect();
      return { id: r.dataset.messageId ?? null, top: Math.round(b.top - sr.top), h: Math.round(b.height), text: (r.innerText ?? "").replace(/\s+/gu, " ").slice(0, 36) };
    })
    .filter((x) => x.top + x.h > 0 && x.top < sr.height);
  return {
    top: Math.round(sc.scrollTop),
    max: Math.round(sc.scrollHeight - sc.clientHeight),
    client: Math.round(sc.clientHeight),
    totalRows: rows.length,
    lastId: rows.at(-1)?.dataset.messageId ?? null,
    firstVisible: visible[0] ?? null,
    visibleIds: visible.map((v) => v.id),
    visibleCount: visible.length,
  };
};
const setScroll = (fraction) =>
  page.evaluate((f) => {
    const sc = document.querySelector('[data-dock-scroll="1"]');
    sc.scrollTop = Math.max(0, Math.floor(sc.scrollHeight * f));
  }, fraction);
try {
  rec.row("DS-version", "App reports version", "PASS", `app.getVersion() = ${version} (${rec.notes.app})`);
  await page.getByTestId("app-sidebar").waitFor({ timeout: 90000 });
  await sleep(5000);
  // Same starting point as the dock gate: persisted dock state cleared, dock closed.
  await page.evaluate(() => {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && /work.?area/iu.test(key)) localStorage.removeItem(key);
    }
  });
  await page.reload();
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(3000);
  await page.keyboard.press("Escape").catch(() => undefined);
  // Select the channel; create and fill it when it does not exist (the short control).
  let exists = (await channel(channelName).count().catch(() => 0)) > 0;
  if (!exists) {
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, metaKey: true, shiftKey: true, key: "N" }));
    });
    await page.getByTestId("create-channel-name").fill(channelName, { timeout: 15000 });
    await page.getByTestId("create-channel-submit").click();
    await channel(channelName).waitFor({ timeout: 20000 });
    exists = true;
    rec.notes.createdChannel = true;
  }
  await channel(channelName).click({ timeout: 8000 });
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  await sleep(2500);
  const composer = page.locator('[data-testid="message-composer"] [contenteditable="true"]').first();
  const target = Number(fillerTarget);
  // Fill a new (short) channel until its scroll range is about the target; never touches an existing long channel.
  if (rec.notes.createdChannel) {
    for (let i = 1; i <= 70; i += 1) {
      await page.evaluate(SCROLLER);
      const cur = await page.evaluate(READ);
      if (cur && cur.max >= target) break;
      await composer.click();
      await page.keyboard.type(`dock scroll filler ${i} ${"lorem ipsum ".repeat(6)}`);
      await page.keyboard.press("Enter");
      await sleep(350);
    }
    await sleep(2000);
  }
  // DS_LIVE=N reproduces the dock gate: N filler messages are posted in this session right before the test, so the timeline holds
  // freshly appended rows on top of the rows loaded at launch.
  if (LIVE) {
    for (let i = 1; i <= LIVE; i += 1) {
      await composer.click();
      await page.keyboard.type(`dock scroll filler ${i} ${"lorem ipsum ".repeat(6)}`);
      await page.keyboard.press("Enter");
      await sleep(250);
    }
    await sleep(2000);
  }
  await page.evaluate(SCROLLER);
  await sleep(500);
  await closeDock();
  await composer.click();
  await page.keyboard.type("draft that must survive the dock");
  // The anchor is the row at the top of the viewport after scrolling a third of the way down (the gate's position).
  await setScroll(1 / 3);
  await sleep(900);
  const before = await page.evaluate(READ);
  await openDock();
  await sleep(1200);
  const during = await page.evaluate(READ);
  await shot(page, rec, `ds-${label}-${channelName}-open`);
  await closeDock();
  await sleep(1200);
  const after = await page.evaluate(READ);
  await shot(page, rec, `ds-${label}-${channelName}-closed`);
  // Primary: the anchor row is still on screen after the close, at about the same place; reflow is tolerated.
  const anchor = before?.firstVisible;
  const stillVisible = anchor ? after?.visibleIds?.includes(anchor.id) : false;
  const sameFirst = anchor && after?.firstVisible ? anchor.id === after.firstVisible.id : false;
  const idxBefore = before?.visibleIds?.indexOf(anchor?.id) ?? -1;
  const idxAfter = after?.visibleIds?.indexOf(anchor?.id) ?? -1;
  const arrivedOpen = during && before ? during.totalRows !== before.totalRows || during.lastId !== before.lastId : null;
  const arrivedClosed = after && before ? after.totalRows !== before.totalRows || after.lastId !== before.lastId : null;
  rec.row(
    "DS-anchor",
    "PRIMARY: the message at the top of the viewport before the dock opens is still on screen after the dock closes",
    !anchor ? "NOT OBSERVED" : stillVisible ? "PASS" : "FAIL",
    `Channel ${channelName}, scroll range ${before?.max} px (client ${before?.client}). Anchor before: ${JSON.stringify(anchor)}. First visible after close: ${JSON.stringify(after?.firstVisible)}. Anchor still on screen after close: ${stillVisible} (position in the visible list ${idxBefore} before, ${idxAfter} after). Same first row: ${sameFirst}. Visible rows before ${before?.visibleCount}, open ${during?.visibleCount}, closed ${after?.visibleCount}. Anchor visible while the dock was open: ${anchor ? during?.visibleIds?.includes(anchor.id) : "n/a"}.`,
  );
  const px = before && after && before.max > 100 && Math.abs(before.top - after.top) <= 40;
  rec.row(
    "DS-pixels",
    "SECONDARY: scrollTop before and after closing within 40 px",
    px ? "PASS" : "FAIL",
    `Triple (before, open, closed) = (${before?.top}, ${during?.top}, ${after?.top}); scroll range ${before?.max} before, ${during?.max} open, ${after?.max} closed. Tolerance 40 px.`,
  );
  rec.row(
    "DS-arrivals",
    "Did any message arrive while the dock was open or between before and closed?",
    "PASS",
    `Rows rendered: ${before?.totalRows} before, ${during?.totalRows} open, ${after?.totalRows} closed. Last row id: before ${before?.lastId}, open ${during?.lastId}, closed ${after?.lastId}. Arrived while open: ${arrivedOpen}. Arrived by the end: ${arrivedClosed}. The timeline renders ${before?.totalRows} message rows in this channel (all rows present means no virtualisation of rows).`,
  );
  rec.notes.triple = { before: before?.top, open: during?.top, closed: after?.top, max: [before?.max, during?.max, after?.max] };
  void redact;
} catch (error) {
  rec.row("DS-run", "Run", "FAIL", `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`, { screenshot: await shot(page, rec, "ds-error").catch(() => undefined) });
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[DS-${label}-${channelName}] done, ${rec.rows.length} rows`);
}
