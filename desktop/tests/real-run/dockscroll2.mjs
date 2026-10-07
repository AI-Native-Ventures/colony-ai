// Controlled DOCK-scroll test. The first control (dockscroll.mjs) was not like for like: rows arrived at different times and in different
// amounts per binary. This version fixes the arrivals and records WHAT arrives and WHEN.
//   AI_APP_OVERRIDE=<Buzz.app> node dockscroll2.mjs <label> <variant>
// Variants (profile A, real HOME, COLONY_NEST_MIGRATION=0 launch guard):
//   during2 like during, but the reader is put back at one third of the open range after the arrivals (the own-send jump to the bottom
//           is a separate, baseline behaviour)
//   base    fresh channel, 32 fillers, reader at one third of the way down, 20 messages posted through the composer, NO dock at all.
//           Records whether the scroll position moves by itself (own send, timeline backfill).
//   pre     fresh channel, 32 fillers, 20 more posted and settled, THEN the reader is put at one third, dock open, dock close.
//           No row arrives during the open and close interval.
//   during  fresh channel, 32 fillers, reader at one third, dock open, 20 messages posted while the dock is open, dock close.
//   hist    channel general with its long history: 28 messages posted live (as the dock gate does), reader at one third, dock open, close.
//           Used only to see what the arriving rows are (prepended older history or appended new rows) and when they arrive.
// A page-side recorder samples the row list every 100 ms (row count, first and last row id, scrollTop, scroll range) and marks the
// moments of every step, so every arrival is placed on the timeline: prepended (above the old first row), appended (below the old
// last row), and before, during or after the dock was open.
import { Rec, closeApp, launch, loadState, progress, redact, shot, sleep, waitForLoad } from "./ai-lib.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required, local only");
const [label = "run", variant = "pre"] = process.argv.slice(2);
const rec = new Rec(`DS2-${label}-${variant}`);
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const load = await waitForLoad();
const tag = `[DS2-${label}-${variant}]`;
await progress(`${tag} load ${load.toFixed(1)} ok, relaunching profile A`);
const { application, page, version } = await launch({ privateDir: state.A.privateDir, userDataDir: state.A.userDataDir });
rec.notes.version = version;
rec.notes.app = process.env.AI_APP ?? "(default)";
const FILLERS = 32;
const POSTS = 20;
const channelLocator = (name) => page.locator(`[data-testid="channel-${name}" i]`).first();
const dockOpen = () => page.getByTestId("work-area-panel").isVisible().catch(() => false);
const mark = (name) => page.evaluate((n) => window.__dsMark?.(n), name).catch(() => undefined);
const openDock = async () => {
  if (await dockOpen()) return;
  await mark("open-start");
  await page.getByTestId("channel-work-area-trigger").click({ timeout: 8000 });
  await page.getByTestId("work-area-panel").waitFor({ timeout: 8000 });
  await sleep(1200);
  await mark("open-done");
};
const closeDock = async () => {
  if (!(await dockOpen())) return;
  await mark("close-start");
  await page.getByTestId("work-area-close").click({ timeout: 8000 });
  await page.getByTestId("work-area-panel").waitFor({ state: "hidden", timeout: 8000 });
  await sleep(1500);
  await mark("close-done");
};
const SETUP = () => {
  const tl = document.querySelector('[data-testid="message-timeline"]');
  const sc = tl ? ([tl, ...tl.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 50 && getComputedStyle(n).overflowY !== "visible") ?? tl) : null;
  if (!sc) return false;
  sc.dataset.dockScroll = "1";
  if (!window.__dsTimer) {
    window.__dsRec = [];
    window.__dsT0 = performance.now();
    window.__dsMark = (name) => window.__dsRec.push({ t: Math.round(performance.now() - window.__dsT0), mark: name });
    window.__dsTimer = setInterval(() => {
      const s = document.querySelector('[data-dock-scroll="1"]');
      const rows = [...document.querySelectorAll('[data-testid="message-row"]')];
      window.__dsRec.push({ t: Math.round(performance.now() - window.__dsT0), n: rows.length, first: rows[0]?.dataset.messageId ?? null, last: rows.at(-1)?.dataset.messageId ?? null, top: s ? Math.round(s.scrollTop) : null, max: s ? Math.round(s.scrollHeight - s.clientHeight) : null });
    }, 100);
  }
  return true;
};
const READ = () => {
  const sc = document.querySelector('[data-dock-scroll="1"]');
  if (!sc) return null;
  const sr = sc.getBoundingClientRect();
  const rows = [...document.querySelectorAll('[data-testid="message-row"]')];
  const all = rows.map((r) => r.dataset.messageId ?? null);
  const visible = rows
    .map((r) => {
      const b = r.getBoundingClientRect();
      return { id: r.dataset.messageId ?? null, top: Math.round(b.top - sr.top), h: Math.round(b.height), text: (r.innerText ?? "").replace(/\s+/gu, " ").slice(0, 40) };
    })
    .filter((x) => x.top + x.h > 0 && x.top < sr.height);
  return { top: Math.round(sc.scrollTop), max: Math.round(sc.scrollHeight - sc.clientHeight), client: Math.round(sc.clientHeight), all, firstVisible: visible[0] ?? null, visible };
};
const setScroll = (fraction) =>
  page.evaluate((f) => {
    const sc = document.querySelector('[data-dock-scroll="1"]');
    sc.scrollTop = Math.max(0, Math.floor(sc.scrollHeight * f));
  }, fraction);
const composer = () => page.locator('[data-testid="message-composer"] [contenteditable="true"]').first();
const post = async (count, prefix) => {
  for (let i = 1; i <= count; i += 1) {
    await composer().click();
    await page.keyboard.type(`${prefix} ${i} ${"lorem ipsum ".repeat(6)}`);
    await page.keyboard.press("Enter");
    await sleep(250);
  }
};
const summarise = (a, b) => {
  // What changed between two ordered id lists: ids above the old first row (prepended), below the old last row (appended).
  if (!a?.all?.length || !b?.all?.length) return { prepended: null, appended: null, lost: null };
  const iFirst = b.all.indexOf(a.all[0]);
  const iLast = b.all.indexOf(a.all.at(-1));
  return {
    prepended: iFirst >= 0 ? iFirst : null,
    appended: iLast >= 0 ? b.all.length - 1 - iLast : null,
    lost: a.all.filter((id) => !b.all.includes(id)).length,
  };
};
try {
  rec.row("DS2-version", "App reports version", "PASS", `app.getVersion() = ${version} (${rec.notes.app})`);
  await page.getByTestId("app-sidebar").waitFor({ timeout: 90000 });
  await sleep(5000);
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
  let channelName = "general";
  if (variant !== "hist") {
    channelName = `dsc-${variant}-${label}-${Date.now() % 100000}`.toLowerCase();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, metaKey: true, shiftKey: true, key: "N" })));
    await page.getByTestId("create-channel-name").fill(channelName, { timeout: 15000 });
    await page.getByTestId("create-channel-submit").click();
    await channelLocator(channelName).waitFor({ timeout: 20000 });
  }
  await channelLocator(channelName).click({ timeout: 8000 });
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  await sleep(2500);
  rec.notes.channel = channelName;
  if (variant !== "hist") await post(FILLERS, "dock scroll filler");
  await sleep(2000);
  await page.evaluate(SETUP);
  await sleep(800);
  await composer().click();
  await page.keyboard.type("draft that must survive the dock");
  let ref;
  let preClose; // state right before the dock closes (the dock-only comparison)
  if (variant === "pre") {
    await mark("posts-start");
    await post(POSTS, "pre-arrival");
    await mark("posts-end");
    await sleep(3500);
    await setScroll(1 / 3);
    await sleep(1000);
    ref = await page.evaluate(READ);
    await openDock();
    preClose = await page.evaluate(READ);
    await closeDock();
  } else if (variant === "during") {
    await setScroll(1 / 3);
    await sleep(1000);
    ref = await page.evaluate(READ);
    await openDock();
    await mark("posts-start");
    await post(POSTS, "during-arrival");
    await mark("posts-end");
    await sleep(3500);
    preClose = await page.evaluate(READ);
    await closeDock();
  } else if (variant === "during2") {
    // Like during, but the reader is put back at one third of the open range after the 20 arrivals, so the own-send jump to the
    // bottom (seen in the baseline) does not hide what the dock close does with rows that arrived while it was open.
    await setScroll(1 / 3);
    await sleep(1000);
    ref = await page.evaluate(READ);
    await openDock();
    await mark("posts-start");
    await post(POSTS, "during-arrival");
    await mark("posts-end");
    await sleep(3500);
    await setScroll(1 / 3);
    await sleep(1200);
    preClose = await page.evaluate(READ);
    await closeDock();
  } else if (variant === "base") {
    await setScroll(1 / 3);
    await sleep(1000);
    ref = await page.evaluate(READ);
    await mark("posts-start");
    await post(POSTS, "base-arrival");
    await mark("posts-end");
    await sleep(3500);
    preClose = await page.evaluate(READ);
  } else {
    // hist: as the dock gate does, with the channel's long history behind the viewport
    await mark("posts-start");
    await post(28, "dock scroll filler");
    await mark("posts-end");
    await sleep(2500);
    await setScroll(1 / 3);
    await sleep(1000);
    ref = await page.evaluate(READ);
    await openDock();
    preClose = await page.evaluate(READ);
    await closeDock();
  }
  await sleep(1500);
  const end = await page.evaluate(READ);
  await shot(page, rec, `ds2-${label}-${variant}-end`);
  const recorder = await page.evaluate(() => window.__dsRec ?? []);
  // The arrivals timeline: every change of the row count with the phase it happened in and which end of the list grew.
  const events = [];
  let phase = "start";
  let prev = null;
  for (const s of recorder) {
    if (s.mark) { phase = s.mark; events.push({ t: s.t, mark: s.mark }); continue; }
    if (prev && s.n !== prev.n) events.push({ t: s.t, phase, rows: `${prev.n}->${s.n}`, firstChanged: s.first !== prev.first, lastChanged: s.last !== prev.last, top: s.top, max: s.max });
    prev = s;
  }
  const phaseOf = (e) => e.phase;
  const arrivalsByPhase = {};
  for (const e of events.filter((x) => x.rows)) arrivalsByPhase[phaseOf(e)] = (arrivalsByPhase[phaseOf(e)] ?? 0) + (Number(e.rows.split("->")[1]) - Number(e.rows.split("->")[0]));
  const anchor = ref?.firstVisible;
  const keptVsRef = anchor ? end.visible.some((v) => v.id === anchor.id) : false;
  const shiftVsRef = anchor ? (end.visible.find((v) => v.id === anchor.id)?.top ?? null) : null;
  const anchorPre = preClose?.firstVisible;
  const keptVsPre = anchorPre ? end.visible.some((v) => v.id === anchorPre.id) : false;
  const shiftVsPre = anchorPre ? (end.visible.find((v) => v.id === anchorPre.id)?.top ?? null) : null;
  const changeRef = summarise(ref, end);
  const changePre = summarise(preClose, end);
  const changeBeforeDock = summarise(ref, preClose);
  const pixelRef = Math.abs((ref?.top ?? 0) - (end?.top ?? 0));
  rec.notes.summary = {
    variant,
    channel: channelName,
    triple: { reference: ref?.top, beforeClose: preClose?.top, end: end?.top },
    range: { reference: ref?.max, beforeClose: preClose?.max, end: end?.max },
    rows: { reference: ref?.all.length, beforeClose: preClose?.all.length, end: end?.all.length },
    anchorRef: anchor ? { id: anchor.id, topAtRef: anchor.top, topAtEnd: shiftVsRef } : null,
    anchorKeptVsReference: keptVsRef,
    anchorKeptVsBeforeClose: keptVsPre,
    changeReferenceToEnd: changeRef,
    changeBeforeCloseToEnd: changePre,
    changeReferenceToBeforeClose: changeBeforeDock,
    arrivalsByPhase,
    pixelDeltaVsReference: pixelRef,
  };
  rec.notes.events = events.slice(0, 80);
  const dockPart = variant === "base" ? "no dock in this variant" : `dock-only comparison (before close vs end): anchor kept ${keptVsPre}, moved ${shiftVsPre === null ? "n/a" : (shiftVsPre - (anchorPre?.top ?? 0)) + " px"}; rows prepended ${changePre.prepended}, appended ${changePre.appended}, lost ${changePre.lost}`;
  rec.row(
    "DS2-anchor",
    variant === "base" ? "NO-DOCK baseline: does the reader's place move by itself while 20 messages arrive?" : "PRIMARY: the reader's place (anchor row) is kept across the dock close; arrivals fixed",
    !anchor ? "NOT OBSERVED" : variant === "base" ? (keptVsRef && pixelRef <= 40 ? "PASS" : "FAIL") : keptVsPre && Math.abs((shiftVsPre ?? 0) - (anchorPre?.top ?? 0)) <= 60 ? "PASS" : "FAIL",
    `Variant ${variant}, channel ${channelName}. Scroll triple (reference, before close, end) = (${ref?.top}, ${preClose?.top}, ${end?.top}); ranges (${ref?.max}, ${preClose?.max}, ${end?.max}); rows (${ref?.all.length}, ${preClose?.all.length}, ${end?.all.length}). Anchor at reference ${JSON.stringify(anchor)}; kept vs reference ${keptVsRef} (top now ${shiftVsRef}); ${dockPart}. Reference to end: prepended ${changeRef.prepended}, appended ${changeRef.appended}, lost ${changeRef.lost}. Row changes before the dock action: prepended ${changeBeforeDock.prepended}, appended ${changeBeforeDock.appended}. Arrivals by phase (rows): ${JSON.stringify(arrivalsByPhase)}.`,
  );
  rec.row(
    "DS2-arrivals",
    "WHAT arrives and WHEN: each change of the row count, with the phase and which end of the list grew",
    "PASS",
    events.filter((x) => x.rows || x.mark).slice(0, 40).map((e) => (e.mark ? `[${e.t} ms ${e.mark}]` : `${e.t} ms ${e.phase}: ${e.rows} rows, ${e.firstChanged ? "TOP changed (prepended)" : ""}${e.lastChanged ? " BOTTOM changed (appended)" : ""}, scrollTop ${e.top}/${e.max}`)).join(" ; ") || "no row count change recorded",
  );
  void redact;
} catch (error) {
  rec.row("DS2-run", "Run", "FAIL", `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`, { screenshot: await shot(page, rec, "ds2-error").catch(() => undefined) });
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`${tag} done, ${rec.rows.length} rows`);
}
