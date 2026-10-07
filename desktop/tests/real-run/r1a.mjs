// Delta gate 2, R1a (PR 251): plain tool names on the real packaged app, driven by the scripted fake model (no Claude, no credential).
// The signed-in throwaway PROFILE of the earlier fake-model run (account, business "Brand Proof 44fdd5", the bundled Colony Agent
// "Scout" on the fake provider) is copied with its host app-data into a fresh throwaway HOME (owner-shaped by default, R1A_VARIANT=empty for an empty one). No new business is created.
// The fake model makes the bundled agent call all five dev tools (shell, read_file, str_replace, todo, view_image). A page-side
// collector (brand-collector.mjs) records every visible text plus title, aria-label, aria-description and alt on the chat, the
// activity strip, the agent session panel and its transcript, the Show details popover, the Team page, Scout's profile, the
// Activity page and every aria-live region. Default surfaces must carry no old name, no double-underscore id and no server prefix,
// and must show the plain words. The opt-in surfaces (Show details, expanded tool group) are read only to record that the raw id is
// still reachable there.
//   node r1a.mjs --app <Buzz.app> --profile <profile.json>
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Rec, progress, redact, shot, sleep } from "./ai-lib.mjs";
import { COLLECTOR, READ_COLLECTED, SET_MODE, mergeCollected } from "./brand-collector.mjs";
import { OPT_IN_SURFACES, surfaceGroup } from "./brand-scan.mjs";
import { startFakeProvider } from "./fake-provider.mjs";
import { buildFixture } from "./nest-migration/fixture.mjs";
import { launchPackaged } from "./nest-migration/launch.mjs";

process.env.NEST_STRICT = "1"; // sandbox without the web block: the profile's community lives on the production relay
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required");
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APP = path.resolve(arg("app"));
const old = JSON.parse(await readFile(arg("profile"), "utf8"));
const rec = new Rec("R1A");
const hashOf = (dir) => createHash("sha256").update(dir).digest("hex").slice(0, 16);
const work = await mkdtemp(path.join(os.tmpdir(), "colony-r1a-"));
const spec = await buildFixture({ root: path.join(work, "fixture"), variant: process.env.R1A_VARIANT ?? "owner" });
const home = spec.home;
const privateDir = path.join(work, "private");
const userDataDir = path.join(privateDir, "user-data");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await cp(old.userDataDir, userDataDir, { recursive: true });
for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) await rm(path.join(userDataDir, lock), { force: true });
const oldAppData = path.join(old.home, "Library", "Application Support", `xyz.block.buzz.app.electron.${hashOf(old.userDataDir)}`);
const newAppData = path.join(home, "Library", "Application Support", `xyz.block.buzz.app.electron.${hashOf(userDataDir)}`);
await cp(oldAppData, newAppData, { recursive: true });
const providerLog = path.join(process.env.AI_OUT, "r1a-fake-provider.jsonl");
await rm(providerLog, { force: true });
await rm(`${providerLog}.first-request.json`, { force: true });
const fake = await startFakeProvider({ logFile: providerLog, port: old.fakePort });
await progress(`[R1A] work ${work}; empty throwaway HOME ${home}; profile copied from the fake-model run; fake provider ${fake.url}`);

let collected = { ticks: 0, surfaces: {} };
let frozenDefault = null; // snapshot taken before any tool group or system prompt is expanded
let afterExpansion = null; // snapshot taken right after the groups were collapsed again
let reading = false;
let page;
const snapshot = async () => {
  if (reading || !page) return;
  reading = true;
  try {
    const read = await page.evaluate(READ_COLLECTED);
    if (read) collected = mergeCollected(collected, read);
  } catch {
    /* page busy or reloading */
  } finally {
    reading = false;
  }
};
const setMode = (mode) => page.evaluate(SET_MODE, mode).catch(() => undefined);
const composer = () => page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
const rowState = () =>
  page.evaluate(() => {
    const vis = (el) => !!el && el.getClientRects().length > 0;
    const activity = document.querySelector('[data-testid="channel-composer-activity-row"]');
    return {
      row: vis(activity) ? (activity.innerText ?? "").replace(/\s+/gu, " ").trim() : "",
      trigger: vis(document.querySelector('[data-testid="bot-activity-composer-trigger"]')),
      details: vis(document.querySelector('[data-testid="bot-activity-details-trigger"]')),
      panel: vis(document.querySelector('[data-testid="agent-session-thread-panel"]')),
    };
  });
const openPanel = async () => {
  await page.getByTestId("bot-activity-composer-trigger").evaluate((el) => el.click());
  const item = page.locator('[data-testid^="bot-activity-composer-item-"]').first();
  await item.waitFor({ timeout: 4000 });
  await item.evaluate((el) => el.click());
  await page.getByTestId("agent-session-thread-panel").waitFor({ state: "visible", timeout: 6000 });
};
const closePanel = async () => {
  const back = page.getByTestId("agent-session-back");
  if (await back.isVisible().catch(() => false)) await back.click().catch(() => undefined);
  else if (await page.getByTestId("agent-session-thread-panel").isVisible().catch(() => false)) await page.keyboard.press("Escape");
  await sleep(500);
};
const ask = async (text) => {
  const box = composer();
  await box.click();
  await box.fill("@");
  const menu = page.getByTestId("mention-autocomplete");
  await menu.waitFor({ timeout: 15000 });
  await menu.locator("[data-mention-suggestion-index]").filter({ hasText: /Scout/u }).first().click();
  await box.press("End");
  await box.pressSequentially(text);
  await box.press("Enter");
  await sleep(1200);
  if ((await box.innerText().catch(() => "")).trim().length > 20) await box.press("Meta+Enter");
};
const guard = async (id, label, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(id, label, "FAIL", `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`, { screenshot: await shot(page, rec, `${id}-error`).catch(() => undefined) });
    return undefined;
  }
};

const app = await launchPackaged({ app: APP, fixtureRoot: spec.root, home, userDataDir, privateDir, relayUrl: "https://relay.colony.ainative.ventures" });
page = await app.window(90000);
await page.setViewportSize({ width: 1440, height: 960 }).catch(() => undefined);
let poller;
try {
  const version = await app.version().catch(() => "?");
  rec.row("R1A-version", "App reports version 1.0.5", version === "1.0.5" ? "PASS" : "FAIL", `app.getVersion() = ${version}`);
  const reached = await page.getByTestId("app-sidebar").waitFor({ timeout: 150000 }).then(() => true, () => false);
  if (!reached) throw new Error("workspace never opened");
  await sleep(6000);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.evaluate(COLLECTOR);
  await setMode("channel");
  poller = setInterval(() => void snapshot(), 1500);
  await page.getByText(/^Welcome$/u).first().click({ timeout: 15000 });
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  await sleep(2000);

  // ---- the five-tool tour ----
  const sentAt = Date.now();
  await ask(" use every one of your tools once so I can see how they work, then tell me when you are done.");
  let firstRow = null;
  let idleSince = null;
  let panelOpen = false;
  let detailsOpened = false;
  const rowTexts = [];
  let shots = 0;
  while (Date.now() - sentAt < 240000) {
    await sleep(500);
    const st = await rowState();
    if (st.row) {
      firstRow ??= Date.now() - sentAt;
      idleSince = null;
      if (!rowTexts.includes(st.row)) {
        rowTexts.push(st.row);
        if (shots < 4) {
          shots += 1;
          await shot(page, rec, `r1a-row-${shots}`);
        }
      }
      if (!panelOpen && st.trigger) {
        panelOpen = true;
        await guard("R1A-panel-open", "Open the agent session panel while the tools run", async () => {
          await setMode("channel");
          await openPanel();
          await sleep(2000);
          await shot(page, rec, "r1a-panel-live");
        });
      }
      if (!detailsOpened && st.details) {
        detailsOpened = true;
        await guard("R1A-details", "Open the Show details popover", async () => {
          await setMode("channel");
          await page.getByTestId("bot-activity-details-trigger").click({ timeout: 4000 });
          await page.getByTestId("bot-activity-details").waitFor({ state: "visible", timeout: 4000 });
          await sleep(900);
          await shot(page, rec, "r1a-details-open");
          await page.getByTestId("bot-activity-details-trigger").click({ timeout: 4000 });
          await page.getByTestId("bot-activity-details").waitFor({ state: "detached", timeout: 4000 });
        });
      }
    } else if (firstRow !== null) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > 9000) break;
    } else if (Date.now() - sentAt > 90000) break;
  }
  await page.getByTestId("message-typing-indicator").waitFor({ state: "hidden", timeout: 20000 }).catch(() => undefined);
  await sleep(2000);
  await snapshot();
  rec.row(
    "R1A-ran",
    "The scripted model made Scout run the tour (activity row seen)",
    firstRow === null ? "NOT OBSERVED" : "PASS",
    firstRow === null ? "No activity row within 90 s" : `Activity first seen ${firstRow} ms after send. Row texts: ${rowTexts.slice(0, 8).join(" || ")}`,
    { screenshot: await shot(page, rec, "r1a-after-tour") },
  );

  // ---- the session panel after the run: default view, then the opt-in expanded tool groups ----
  await guard("R1A-panel-final", "Session panel default view after the tour", async () => {
    await setMode("channel");
    if (!(await rowState()).panel) {
      const trigger = page.getByTestId("bot-activity-composer-trigger");
      if (await trigger.isVisible().catch(() => false)) await openPanel();
    }
    await sleep(2500);
    await shot(page, rec, "r1a-panel-default");
    await snapshot();
    const panelNow = await rowState();
    if (panelNow.panel) {
      // Freeze everything recorded so far: it is the DEFAULT view. Expansion below is opt-in raw text.
      await snapshot();
      frozenDefault = structuredClone(collected);
      const summaries = page.locator('[data-testid="agent-session-thread-panel"] summary');
      const n = await summaries.count();
      await setMode("panel-expanded");
      for (let i = 0; i < n; i += 1) await summaries.nth(i).evaluate((el) => el.click()).catch(() => undefined);
      await sleep(1500);
      await shot(page, rec, "r1a-panel-expanded");
      await snapshot();
      // Collapse again so nothing opt-in stays on screen for the rest of the run.
      for (let i = 0; i < n; i += 1) await summaries.nth(i).evaluate((el) => { if (el.parentElement?.open) el.click(); }).catch(() => undefined);
      await sleep(1000);
      await setMode("channel");
      await sleep(1500);
      await snapshot();
      afterExpansion = structuredClone(collected);
    }
  });
  await closePanel();

  // ---- Team page, Scout's profile, Activity page ----
  await guard("R1A-pages", "Visit the Team page, Scout's profile activity and the Activity page", async () => {
    await setMode("team");
    await page.getByTestId("sidebar-company-team").click({ timeout: 8000 });
    await sleep(3500);
    await shot(page, rec, "r1a-team-page");
    const scout = page.getByText(/^Scout$/u).first();
    if (await scout.isVisible().catch(() => false)) {
      await setMode("scout-profile");
      await scout.click({ timeout: 5000 }).catch(() => undefined);
      await sleep(3500);
      if (!(await page.getByTestId("agent-activity").isVisible().catch(() => false)))
        await page.getByRole("tab", { name: /activity|history/iu }).first().click({ timeout: 3000 }).catch(() => undefined);
      await sleep(2500);
      await shot(page, rec, "r1a-scout-profile");
    }
    await setMode("activity");
    await page.getByTestId("sidebar-activity-button").click({ timeout: 5000 });
    await sleep(3500);
    await shot(page, rec, "r1a-activity-page");
    await setMode("channel");
    await snapshot();
  });
} catch (error) {
  rec.row("R1A-run", "Run the tour", "FAIL", `Run threw ${error.name}: ${redact(error.message).split("\n")[0]}`, { screenshot: await shot(page, rec, "r1a-run-error").catch(() => undefined) });
} finally {
  if (poller) clearInterval(poller);
  await snapshot();
}

// ---- judge ----
// Three snapshots keep the opt-in views out of the default verdict: S1 right before the tool groups and the system prompt were
// expanded, S2 right after they were collapsed again, S3 at the end (Team page, Scout profile and Activity page were visited last).
const S1 = frozenDefault?.surfaces ?? null;
const S2 = afterExpansion?.surfaces ?? null;
const S3 = collected.surfaces;
const minus = (x, y) => {
  const out = {};
  for (const [k, texts] of Object.entries(x ?? {})) {
    const seen = new Set(y?.[k] ?? []);
    const d = texts.filter((t) => !seen.has(t));
    if (d.length) out[k] = d;
  }
  return out;
};
let surfaces = S3;
let optIn = {};
if (S1 && S2) {
  const late = minus(S3, S2);
  surfaces = {};
  for (const k of new Set([...Object.keys(S1), ...Object.keys(late)])) surfaces[k] = [...new Set([...(S1[k] ?? []), ...(late[k] ?? [])])];
  optIn = minus(S2, S1);
}
const titles = await app.window(1000).then((p) => p.title(), () => "").catch(() => "");
const isDefault = (key) => !OPT_IN_SURFACES.includes(surfaceGroup(key)) && surfaceGroup(key) !== "window-title";
const FORBIDDEN = [
  { kind: "old name (any case)", re: /buzz/iu },
  { kind: "double-underscore id", re: /\w__\w/u },
  { kind: "server prefix", re: /dev[-_]mcp|\bmcp\b/iu },
];
const hits = [];
for (const [key, texts] of Object.entries(surfaces).filter(([k]) => isDefault(k)))
  for (const text of texts)
    for (const f of FORBIDDEN) {
      const m = String(text).match(f.re);
      if (m) hits.push({ surface: key, kind: f.kind, match: m[0], context: String(text).slice(Math.max(0, m.index - 40), m.index + 90) });
    }
const counts = Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, v.length]));
const defaultKeys = Object.keys(surfaces).filter(isDefault);
const observedSurfaces = ["chat", "activity-strip", "session-panel", "transcript", "activity-page", "team-page", "toast-or-live-region"].map((g) => [g, defaultKeys.filter((k) => surfaceGroup(k) === g).reduce((n, k) => n + surfaces[k].length, 0)]);
const unseen = observedSurfaces.filter(([, n]) => n === 0).map(([g]) => g);
rec.row(
  "R1A-default-zero",
  "Default view only (no Show details, no expanded group): zero old name (any case), zero double-underscore ids, zero server prefix on every recorded surface (text, title, aria-label, aria-description, alt, aria-live)",
  hits.length ? "FAIL" : unseen.length || !(S1 && S2) ? "NOT OBSERVED" : "PASS",
  `${hits.length} hits across ${defaultKeys.length} default keys (${defaultKeys.reduce((n, k) => n + surfaces[k].length, 0)} distinct texts). Texts per surface group: ${observedSurfaces.map(([g, n]) => `${g} ${n}`).join(", ")}. ${unseen.length ? `NEVER OBSERVED: ${unseen.join(", ")}. ` : ""}${S1 && S2 ? "Opt-in expansion was isolated from the default verdict by snapshots before and after it." : "The expansion snapshots were not taken, so the default view is not isolated."} ${hits.slice(0, 12).map((h) => `${h.surface} ${h.kind} "${h.match}" in "${redact(h.context)}"`).join(" | ")}`,
);
const plainWords = ["Run a command", "Read a file", "Edit a file", "Update the to-do list", "View an image"];
const defaultJoined = defaultKeys.flatMap((k) => surfaces[k].map((t) => ({ k, t })));
const where = Object.fromEntries(plainWords.map((w) => [w, [...new Set(defaultJoined.filter((x) => x.t.includes(w)).map((x) => surfaceGroup(x.k)))]]));
const optInJoined = Object.entries(optIn).flatMap(([k, ts]) => ts.map((t) => ({ k, t })));
const whereOptIn = Object.fromEntries(plainWords.map((w) => [w, optInJoined.some((x) => x.t.includes(w))]));
rec.row(
  "R1A-plain-words",
  "The exact plain titles appear in the default view: Run a command, Read a file, Edit a file, Update the to-do list, View an image",
  plainWords.every((w) => where[w].length) ? "PASS" : "NOT OBSERVED",
  `Surfaces per exact title (default view): ${plainWords.map((w) => `"${w}": ${where[w].join("+") || "NOT SEEN"}`).join("; ")}. Seen only in the opt-in expansion: ${plainWords.map((w) => `"${w}": ${whereOptIn[w]}`).join("; ")}. NOT a defect by itself: the exact titles are the fallback names used where a tool is announced by its raw id (permission request); the session rows of real tool calls carry the classifier's own plain labels, listed in R1A-plain-rows.`,
);
const trDefault = (surfaces.transcript ?? []).concat(surfaces["session-panel"] ?? []);
const labelOf = {
  shell: ["Ran", "command"],
  read_file: ["Read", "file"],
  str_replace: ["Edited", "tour.txt"],
  todo: ["Updated", "todo list"],
  view_image: ["Viewed", "image"],
};
const rowsFound = Object.fromEntries(Object.entries(labelOf).map(([tool, words]) => [tool, words.every((w) => trDefault.some((t) => t === w || t.includes(w)))]));
rec.row(
  "R1A-plain-rows",
  "Each of the five tools shows a plain row label in the default session panel and transcript",
  Object.values(rowsFound).every(Boolean) ? "PASS" : "FAIL",
  `Row labels looked for (verb and object as the transcript prints them): ${Object.entries(labelOf).map(([t, w]) => `${t}: "${w.join(" ")}" ${rowsFound[t] ? "seen" : "NOT SEEN"}`).join("; ")}. Tooltip titles recorded on the panel: ${(surfaces["session-panel.attr.title"] ?? []).filter((t) => t.length < 40).join(" / ")}`,
);
const permText = [...new Set((surfaces["toast-or-live-region"] ?? []).concat(surfaces.transcript ?? []).flatMap((t) => [...String(t).matchAll(/Permission requested[^]*?Options:[^.]{0,40}/gu)].map((m) => m[0])))];
rec.row(
  "R1A-permission",
  "The permission request for the shell tool (shown in the transcript and announced in the aria-live region) uses plain words",
  permText.length ? (permText.some((t) => /buzz|__|dev-mcp/iu.test(t)) ? "FAIL" : permText.some((t) => /Run a command/u.test(t)) ? "PASS" : "FAIL") : "NOT OBSERVED",
  permText.length ? `Permission announcements recorded: ${permText.slice(0, 4).map((t) => `"${redact(t).slice(0, 140)}"`).join(" ; ")}` : "No permission announcement was recorded in this run, so the announcement text is not proven here",
);
const rawOptIn = [
  ...Object.entries(optIn).flatMap(([k, ts]) => ts.filter((t) => /buzz-dev-mcp__\w+/u.test(t)).map((t) => `${k}: ${t.match(/buzz-dev-mcp__\w+/u)[0]}`)),
  ...(S3["details-popover"] ?? []).filter((t) => /buzz-dev-mcp__\w+/u.test(t)).map((t) => `details-popover: ${t.match(/buzz-dev-mcp__\w+/u)[0]}`),
];
rec.row(
  "R1A-optin-raw",
  "Opt-in details (Show details, expanded tool group) still reach the raw id (recorded, not failed)",
  "PASS",
  rawOptIn.length ? `Raw ids reachable in opt-in views: ${[...new Set(rawOptIn)].slice(0, 8).join(", ")}` : "The raw id was NOT found in the opt-in views in this run (recorded; the brief does not fail on it). Opt-in texts recorded: " + `${(S3["details-popover"] ?? []).length} in Show details, ${Object.values(optIn).reduce((n, ts) => n + ts.length, 0)} first recorded while the tool groups and the system prompt were expanded (the expanded groups show the tool by its classified label and arguments, not by an id)`,
);
// What the model was told and what ran.
const first = await readFile(`${providerLog}.first-request.json`, "utf8").then((t) => JSON.parse(t), () => null);
const toolIds = (first?.tools ?? []).map((t) => t?.function?.name);
const five = ["shell", "read_file", "str_replace", "todo", "view_image"].map((n) => `buzz-dev-mcp__${n}`);
rec.row(
  "R1A-model-ids",
  "The fake model request still carries the five buzz-dev-mcp__ tool ids (internal identifiers, unchanged for compatibility)",
  five.every((id) => toolIds.includes(id)) ? "PASS" : first ? "FAIL" : "NOT OBSERVED",
  `Tool ids in the first tools-carrying request: ${toolIds.join(", ") || "(request not captured)"}. KNOWN INTERNAL IDENTIFIER: sent to the model only, never shown in the default view.`,
);
const log = (await readFile(providerLog, "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const turns = log.filter((e) => e.kind === "turn" && e.scenario === "devtools");
const walk = async (dir, name, depth = 0) => {
  if (depth > 4) return null;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name === name && e.isFile()) return path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith("archive")) {
      const found = await walk(path.join(dir, e.name), name, depth + 1);
      if (found) return found;
    }
  }
  return null;
};
const tourFile = await walk(path.join(home, ".colony"), "tour.txt");
const tourText = tourFile ? await readFile(tourFile, "utf8").catch(() => "") : "";
const tourPng = tourFile ? await stat(path.join(path.dirname(tourFile), "tour.png")).then((s) => s.size, () => 0) : 0;
rec.row(
  "R1A-tools-ran",
  "All five dev tools really ran: the model took six turns, tour.txt holds the str_replace edit, tour.png exists",
  turns.length >= 5 && /tour line 1 edited/u.test(tourText) && tourPng > 0 ? "PASS" : "FAIL",
  `Devtools scenario turns logged: ${turns.length}. tour.txt at ${tourFile ? tourFile.replace(home, "<home>") : "(not found)"}: ${JSON.stringify(tourText.slice(0, 80))}. tour.png bytes: ${tourPng}. Window title: ${titles}`,
);
rec.notes.counts = counts;
rec.notes.surfaces = Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, v.slice(0, 120)]));
rec.notes.optIn = Object.fromEntries(Object.entries(optIn).map(([k, v]) => [k, v.slice(0, 60)]));
rec.notes.work = work;
rec.notes.endedAt = new Date().toISOString();
await rec.write();
await fake.close().catch(() => undefined);
await app.quit().catch(() => undefined);
await sleep(2000);
await app.kill?.().catch(() => undefined);
await progress(`[R1A] done, ${rec.rows.length} rows`);
