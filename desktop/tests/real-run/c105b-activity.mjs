// Colony 1.0.5 second candidate gate, R1: agent activity must show plain labels, never raw commands.
// Relaunch profile A (the first-run business), make Scout run tools several different ways and watch,
// for the whole time, the composer activity row (every 100 ms plus a MutationObserver), the agent session
// panel and transcript, overlays, toasts, notifications, the Team page and Scout's profile activity.
// Then open "Show details" with mouse and keyboard, confirm the raw command lives only there, collapse it.
// usage: node c105b-activity.mjs   (env PROMPTS=1,2,3 selects prompts, DEADLINE_MIN caps total minutes)
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
const rec = new Rec(process.env.PHASE ?? "R1");
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const load = await waitForLoad();
await progress(`[R1] load ${load.toFixed(1)} ok, relaunching profile A`);
const startedAt = Date.now();
const deadlineAt = startedAt + Number(process.env.DEADLINE_MIN ?? 22) * 60000;
const { application, page, version } = await launch({
  privateDir: state.A.privateDir,
  userDataDir: state.A.userDataDir,
});
rec.notes.version = version;
instrument(page, rec, "A");
const { execFile } = await import("node:child_process");
const harnessProcesses = () =>
  new Promise((resolve) =>
    execFile(
      "/bin/ps",
      ["-eo", "pid,ppid,lstart,command"],
      { maxBuffer: 4 * 1024 * 1024 },
      (_error, out) =>
        resolve(
          String(out ?? "")
            .split("\n")
            .filter((l) => /buzz-acp|colony-native-host|claude-agent-acp/u.test(l) && !/grep/u.test(l))
            .map((l) => l.replace(/\/Users\/mac\/Downloads\/[^ ]*\/Contents\//u, "<app>/").slice(0, 200)),
        ),
    ),
  );
rec.notes.processesAtLaunch = await harnessProcesses();
const lifecycle = [];
application
  .process()
  .on("exit", (code, signal) =>
    lifecycle.push({ sinceLaunchMs: Date.now() - startedAt, code, signal }),
  );

// Main-process native notifications (best effort): record title and body of every shown notification.
const noHook = process.env.NOHOOK === "1";
const nativeHook = noHook
  ? "disabled (NOHOOK=1)"
  : await application
  .evaluate(({ Notification }) => {
    globalThis.__r1Notifications = [];
    const original = Notification.prototype.show;
    Notification.prototype.show = function show(...args) {
      globalThis.__r1Notifications.push({
        title: String(this.title ?? ""),
        body: String(this.body ?? ""),
      });
      return original.apply(this, args);
    };
    return "hooked";
  })
  .catch((error) => `not hooked: ${error.message}`);
rec.notes.nativeNotificationHook = nativeHook;

// Page-side recorder. Runs inside the renderer so it sees every transient label.
const RECORDER = () => {
  if (window.__r1) return "exists";
  const R = (window.__r1 = {
    t0: Date.now(),
    mode: "channel",
    surfaces: {},
    hits: [],
    legacy: [],
    ticks: 0,
  });
  const ATTRS = ["title", "aria-label", "aria-description", "alt"];
  const BAD = [
    ["buzz", /buzz/iu],
    ["pipe", /\|/u],
    ["flag", /(^|\s)--?[a-z][\w-]*/iu],
    [
      "uuid",
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    ],
    ["redirect", /\d?>&\d|\s2>/u],
  ];
  const LEGACY = /(buzz|fizz|honey|pollen|\bbees?\b|\u{1f41d})/iu;
  const ms = () => Date.now() - R.t0;
  const vis = (el) => {
    if (!el || !el.getClientRects || el.getClientRects().length === 0)
      return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const chainOf = (el) => {
    const out = [];
    for (let e = el; e && out.length < 7; e = e.parentElement)
      out.push(
        `${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? `[${e.getAttribute("data-testid")}]` : ""}`,
      );
    return out.join(" < ");
  };
  const clip = (s) => s.replace(/\s+/gu, " ").trim();
  // Surfaces whose raw text is opt-in (the Show details popover) are recorded but never flagged.
  const note = (surface, rawText, el) => {
    const text = clip(rawText ?? "");
    if (!text) return;
    const bucket = (R.surfaces[surface] ??= {});
    const known = bucket[text];
    if (known) {
      known.last = ms();
      known.n += 1;
      return;
    }
    if (Object.keys(bucket).length >= 400) return;
    bucket[text] = { first: ms(), last: ms(), n: 1 };
    if (surface.startsWith("details-popover")) return;
    for (const [name, re] of BAD)
      if (re.test(text))
        R.hits.push({
          surface,
          kind: name,
          text: text.slice(0, 300),
          atMs: ms(),
          chain: el ? chainOf(el) : "",
        });
  };
  const attrsOf = (root, surface) => {
    for (const el of [root, ...root.querySelectorAll("*")])
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) note(`${surface}.attr.${a}`, v, el);
      }
  };
  const textNodes = (root, surface, limit = 600) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (w.nextNode() && n < limit) {
      n += 1;
      const el = w.currentNode.parentElement;
      if (el && vis(el)) note(surface, w.currentNode.textContent, el);
    }
  };
  const scanActivity = () => {
    const row = document.querySelector(
      '[data-testid="channel-composer-activity-row"]',
    );
    if (row) {
      note("row.innerText", row.innerText, row);
      note("row.textContent", row.textContent, row);
      attrsOf(row, "row");
    }
    const trig = document.querySelector(
      '[data-testid="bot-activity-composer-trigger"]',
    );
    if (trig) {
      note("trigger.innerText", trig.innerText, trig);
      note("trigger.aria-label", trig.getAttribute("aria-label"), trig);
    }
    const panel = document.querySelector(
      '[data-testid="agent-session-thread-panel"]',
    );
    if (panel && vis(panel)) {
      textNodes(panel, "session-panel");
      attrsOf(panel, "session-panel");
    }
    for (const overlay of document.querySelectorAll(
      "[data-radix-popper-content-wrapper], [role=dialog], [role=menu], [role=tooltip]",
    )) {
      if (!vis(overlay)) continue;
      const inner = overlay.querySelector('[data-testid="bot-activity-details"]');
      const isDetails =
        inner || overlay.getAttribute("data-testid") === "bot-activity-details";
      const surface = isDetails
        ? "details-popover"
        : `overlay.${overlay.getAttribute("data-testid") ?? overlay.getAttribute("role") ?? "popper"}`;
      textNodes(overlay, surface, 200);
      attrsOf(overlay, surface);
    }
    for (const live of document.querySelectorAll(
      "[data-sonner-toast], [role=status], [role=alert], [aria-live]",
    ))
      if (vis(live) && clip(live.innerText ?? ""))
        note("toast-or-live-region", live.innerText, live);
    if (R.mode !== "channel") {
      const main = document.querySelector("main") ?? document.body;
      textNodes(main, `page.${R.mode}`, 900);
    }
  };
  const scanLegacy = () => {
    const found = [];
    const text = document.body?.innerText ?? "";
    if (LEGACY.test(text)) {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode() && found.length < 6) {
        const t = w.currentNode.textContent ?? "";
        const el = w.currentNode.parentElement;
        if (LEGACY.test(t) && el && vis(el))
          found.push({ where: "visible text", context: clip(t).slice(0, 160), chain: chainOf(el) });
      }
    }
    for (const el of document.querySelectorAll("[aria-label],[title],[alt]")) {
      const v = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("alt") ?? ""}`;
      if (LEGACY.test(v) && found.length < 8)
        found.push({ where: "attribute", context: clip(v).slice(0, 160), chain: chainOf(el) });
    }
    if (LEGACY.test(document.title))
      found.push({ where: "window title", context: document.title, chain: "" });
    for (const f of found) {
      const key = `${f.where}|${f.context}|${f.chain}`;
      if (!R.legacy.some((x) => x.key === key))
        R.legacy.push({ key, atMs: ms(), mode: R.mode, ...f });
    }
  };
  const safe = (fn) => {
    try {
      fn();
    } catch {
      /* element removed mid-scan */
    }
  };
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      safe(scanActivity);
    });
  };
  new MutationObserver(queue).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "aria-expanded"],
  });
  setInterval(() => {
    R.ticks += 1;
    safe(scanActivity);
  }, 100);
  setInterval(() => safe(scanLegacy), 200);
  // Renderer notifications (HTML5 Notification API).
  try {
    const Original = window.__r1NoHook ? null : window.Notification;
    if (Original) {
      class Wrapped extends Original {
        constructor(title, options) {
          super(title, options);
          note("notification.renderer.title", String(title ?? ""));
          note("notification.renderer.body", String(options?.body ?? ""));
        }
      }
      Object.defineProperty(window, "Notification", {
        value: Wrapped,
        configurable: true,
        writable: true,
      });
    }
  } catch {
    /* notification API unavailable */
  }
  return "installed";
};

const install = async () => {
  if (noHook) await page.evaluate(() => (window.__r1NoHook = true));
  return page.evaluate(RECORDER);
};
const dump = () =>
  page.evaluate(() => (window.__r1 ? JSON.stringify(window.__r1) : null));
let lastDump = null;
const snapshot = async () => {
  try {
    const raw = await dump();
    if (raw) lastDump = JSON.parse(raw);
  } catch {
    /* page busy */
  }
};
const setMode = (mode) =>
  page.evaluate((m) => {
    if (window.__r1) window.__r1.mode = m;
  }, mode);

const guard = async (id, label, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(
      id,
      label,
      "FAIL",
      `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`,
      { screenshot: await shot(page, rec, `${id}-error`) },
    );
    return undefined;
  }
};

const rowState = () =>
  page.evaluate(() => {
    const vis = (el) => !!el && el.getClientRects().length > 0;
    const row = document.querySelector(
      '[data-testid="channel-composer-activity-row"]',
    );
    const trigger = document.querySelector(
      '[data-testid="bot-activity-composer-trigger"]',
    );
    return {
      row: vis(row) ? (row.innerText ?? "").replace(/\s+/gu, " ").trim() : "",
      trigger: vis(trigger),
      details: vis(
        document.querySelector('[data-testid="bot-activity-details-trigger"]'),
      ),
      panel: vis(
        document.querySelector('[data-testid="agent-session-thread-panel"]'),
      ),
    };
  });

const detailsProbe = () =>
  page.evaluate(() => {
    const clip = (s) => (s ?? "").replace(/\s+/gu, " ").trim();
    const trigger = document.querySelector(
      '[data-testid="bot-activity-details-trigger"]',
    );
    const pop = document.querySelector('[data-testid="bot-activity-details"]');
    const row = document.querySelector(
      '[data-testid="channel-composer-activity-row"]',
    );
    return {
      triggerText: clip(trigger?.innerText),
      expanded: trigger?.getAttribute("aria-expanded") ?? null,
      triggerTitle: trigger?.getAttribute("title") ?? null,
      triggerAria: trigger?.getAttribute("aria-label") ?? null,
      popoverPresent: Boolean(pop),
      popoverText: clip(pop?.innerText).slice(0, 700),
      codeLines: [...(pop?.querySelectorAll("code") ?? [])].map((c) =>
        clip(c.textContent).slice(0, 240),
      ),
      popoverAria: pop?.getAttribute("aria-label") ?? null,
      rowTextWhileOpen: clip(row?.innerText),
      activeTestid:
        document.activeElement?.getAttribute?.("data-testid") ??
        document.activeElement?.tagName?.toLowerCase() ??
        null,
    };
  });

const detailsResults = { mouse: null, keyboard: null };
const detailsMouse = async () => {
  const trigger = page.getByTestId("bot-activity-details-trigger");
  const before = await detailsProbe();
  await trigger.click({ timeout: 4000 });
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "visible", timeout: 4000 });
  await sleep(400);
  const open = await detailsProbe();
  const openShot = await shot(page, rec, "details-open-mouse");
  await trigger.click({ timeout: 4000 });
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "detached", timeout: 4000 });
  await sleep(300);
  const closed = await detailsProbe();
  detailsResults.mouse = { before, open, closed, openShot };
};
const detailsKeyboard = async () => {
  const trigger = page.getByTestId("bot-activity-details-trigger");
  // Natural Tab order: from the composer editor, count Tab presses until the trigger takes focus.
  const composer = page
    .getByTestId("message-composer")
    .locator('[contenteditable="true"]')
    .first();
  let tabs = null;
  await composer.focus();
  for (let i = 1; i <= 14 && tabs === null; i++) {
    await page.keyboard.press("Tab");
    if (
      (await page.evaluate(
        () =>
          document.activeElement?.getAttribute?.("data-testid") ===
          "bot-activity-details-trigger",
      )) === true
    )
      tabs = i;
  }
  let shiftTabs = null;
  if (tabs === null) {
    await composer.focus();
    for (let i = 1; i <= 14 && shiftTabs === null; i++) {
      await page.keyboard.press("Shift+Tab");
      if (
        (await page.evaluate(
          () =>
            document.activeElement?.getAttribute?.("data-testid") ===
            "bot-activity-details-trigger",
        )) === true
      )
        shiftTabs = i;
    }
  }
  await trigger.focus();
  const focused = await detailsProbe();
  await page.keyboard.press("Enter");
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "visible", timeout: 4000 });
  await sleep(300);
  const enterOpen = await detailsProbe();
  await page.keyboard.press("Escape");
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "detached", timeout: 4000 });
  await sleep(300);
  const escapeClosed = await detailsProbe();
  await trigger.focus();
  await page.keyboard.press("Space");
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "visible", timeout: 4000 });
  await sleep(300);
  const spaceOpen = await detailsProbe();
  const openShot = await shot(page, rec, "details-open-keyboard");
  await page.keyboard.press("Escape");
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "detached", timeout: 4000 });
  const spaceEscapeClosed = await detailsProbe();
  detailsResults.keyboard = {
    tabsFromComposer: tabs,
    shiftTabsFromComposer: shiftTabs,
    focused,
    enterOpen,
    escapeClosed,
    spaceOpen,
    spaceEscapeClosed,
    openShot,
  };
};

const composer = () =>
  page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
const closePanel = async () => {
  const back = page.getByTestId("agent-session-back");
  if (await back.isVisible().catch(() => false))
    await back.click().catch(() => undefined);
  else if (
    await page
      .getByTestId("agent-session-thread-panel")
      .isVisible()
      .catch(() => false)
  )
    await page.keyboard.press("Escape");
  await sleep(500);
};
const openPanel = async () => {
  await page.getByTestId("bot-activity-composer-trigger").click({ timeout: 4000 });
  const item = page.locator('[data-testid^="bot-activity-composer-item-"]').first();
  await item.waitFor({ timeout: 4000 });
  await item.click();
  await page
    .getByTestId("agent-session-thread-panel")
    .waitFor({ state: "visible", timeout: 6000 });
};

const PROMPTS = [
  {
    id: 1,
    name: "business",
    text: " what do you know about our business? answer in this thread.",
    max: 90,
  },
  {
    id: 2,
    name: "channels",
    text: " please list the channels in our workspace and tell me their names.",
    max: 90,
    panel: true,
  },
  {
    id: 3,
    name: "post",
    text: " please post a one line hello for the team in the general channel using your message tool, then tell me when it is done.",
    max: 100,
    mouse: true,
  },
  {
    id: 4,
    name: "file",
    text: " please create a file called gate-check.md in your workspace with one heading, then read it back to me.",
    max: 100,
    keyboard: true,
  },
  {
    id: 5,
    name: "search",
    text: " please search our messages for the word welcome and tell me what you find.",
    max: 90,
  },
  {
    id: 6,
    name: "people",
    text: " please look up who is on our team and what their roles are.",
    max: 80,
  },
  {
    id: 7,
    name: "note",
    text: " please save a note that our top goal this month is onboarding five customers, then confirm in one sentence.",
    max: 80,
  },
];
PROMPTS.push(
  {
    id: 8,
    name: "multi-step A: channels, post, file, search",
    text: " do this in order and tell me each step: first list all channels, then post the words gate hello in the general channel, then create a file called gate-note.md with one heading in your workspace and read it back, then search messages for welcome.",
    max: 115,
    panel: true,
    mouse: true,
  },
  {
    id: 9,
    name: "multi-step B: team lookup, note, history",
    text: " please do these in order: look up who is on our team, save a note that our top goal this month is onboarding five customers, then read the recent conversation in this channel and summarize what you know about our business.",
    max: 115,
    keyboard: true,
  },
  {
    id: 10,
    name: "multi-step C: read file, channels, post",
    text: " please read the file gate-note.md in your workspace and tell me its heading, then check the channels again and post a second hello in the general channel.",
    max: 100,
  },
);
const wantedPrompts = (process.env.PROMPTS ?? "1,2,3,4,5,6,7")
  .split(",")
  .map(Number);
const promptLog = [];

const ask = async (prompt) => {
  await closePanel();
  const box = composer();
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
  await box.pressSequentially(prompt.text);
  await box.press("Enter");
};

const runPrompt = async (prompt) => {
  const sentAt = Date.now();
  await ask(prompt);
  const log = {
    id: prompt.id,
    name: prompt.name,
    firstRowMs: null,
    lastRowMs: null,
    endedBecause: null,
    panelOpened: false,
    mouseDone: false,
    keyboardDone: false,
    rowTextsSeen: [],
  };
  let idleSince = null;
  let shots = 0;
  while (Date.now() - sentAt < prompt.max * 1000) {
    if (Date.now() > deadlineAt) {
      log.endedBecause = "global deadline";
      break;
    }
    await sleep(400);
    const s = await rowState();
    if (s.row) {
      log.firstRowMs ??= Date.now() - sentAt;
      log.lastRowMs = Date.now() - sentAt;
      idleSince = null;
      if (!log.rowTextsSeen.includes(s.row)) {
        log.rowTextsSeen.push(s.row);
        if (shots < 3) {
          shots += 1;
          await shot(page, rec, `p${prompt.id}-row-${shots}`);
        }
      }
      if (prompt.panel && !log.panelOpened && s.trigger) {
        log.panelOpened = true;
        await guard(`R1-panel-p${prompt.id}`, "Open the agent session panel", async () => {
          await setMode("channel");
          await openPanel();
          await sleep(2500);
          await shot(page, rec, `p${prompt.id}-session-panel`);
        });
      }
      if (prompt.mouse && !log.mouseDone && s.details) {
        log.mouseDone = true;
        await guard(`R1-details-mouse-p${prompt.id}`, "Show details with the mouse", detailsMouse);
      }
      if (prompt.keyboard && !log.keyboardDone && s.details) {
        log.keyboardDone = true;
        await guard(`R1-details-keyboard-p${prompt.id}`, "Show details with the keyboard", detailsKeyboard);
      }
    } else if (log.firstRowMs !== null) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > 7000) {
        log.endedBecause = "Scout idle 7 s after working";
        break;
      }
    } else if (Date.now() - sentAt > 50000 && !s.row) {
      log.endedBecause = "no activity row within 50 s";
      break;
    }
  }
  log.endedBecause ??= "time cap";
  log.elapsedMs = Date.now() - sentAt;
  log.lastMessage = redact(
    await page
      .getByTestId("message-timeline")
      .innerText()
      .then((t) => t.replace(/\s+/gu, " ").slice(-220))
      .catch(() => ""),
  );
  promptLog.push(log);
  await snapshot();
  await shot(page, rec, `p${prompt.id}-end`);
  return log;
};

try {
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  rec.row(
    "R1-version",
    "App reports version 1.0.5",
    version === "1.0.5" ? "PASS" : "FAIL",
    `app.getVersion() = ${version}`,
  );
  await sleep(3000);
  await install();
  await setMode("channel");
  const poller = setInterval(() => void snapshot(), 2000);
  setTimeout(async () => {
    rec.notes.processesAfter30s = await harnessProcesses();
  }, 30000);
  await page
    .locator('[data-testid="channel-welcome" i]')
    .first()
    .click({ timeout: 8000 });
  await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
  await sleep(1500 + Number(process.env.START_DELAY_S ?? 0) * 1000);
  rec.notes.firstAskAfterLaunchMs = Date.now() - startedAt;
  for (const prompt of PROMPTS.filter((p) => wantedPrompts.includes(p.id))) {
    if (Date.now() > deadlineAt) {
      rec.row(
        `R1-prompt-${prompt.id}`,
        `Prompt ${prompt.id} (${prompt.name})`,
        "NOT OBSERVED",
        "Global deadline reached before this prompt",
      );
      continue;
    }
    await guard(`R1-prompt-${prompt.id}`, `Prompt ${prompt.id} (${prompt.name})`, async () => {
      const log = await runPrompt(prompt);
      rec.row(
        `R1-prompt-${prompt.id}`,
        `Prompt ${prompt.id} (${prompt.name}): Scout worked, labels watched`,
        log.firstRowMs === null ? "NOT OBSERVED" : "PASS",
        log.firstRowMs === null
          ? `No activity row appeared within ${log.elapsedMs} ms (${log.endedBecause})`
          : `Row first seen ${log.firstRowMs} ms after send, last ${log.lastRowMs} ms, ended: ${log.endedBecause}. Row texts: ${JSON.stringify(log.rowTextsSeen).slice(0, 700)}`,
      );
    });
  }
  await closePanel();

  // Team page and Scout's profile activity.
  await guard("R1-team", "Team page and Scout profile activity", async () => {
    await setMode("team");
    await page.getByTestId("sidebar-company-team").click({ timeout: 8000 });
    await sleep(3500);
    await shot(page, rec, "team-page");
    const scout = page.getByText(/^Scout$/u).first();
    if (await scout.isVisible().catch(() => false)) {
      await setMode("scout-profile");
      await scout.click({ timeout: 5000 }).catch(() => undefined);
      await sleep(3500);
      const act = page.getByTestId("agent-activity");
      const present = await act.isVisible().catch(() => false);
      if (!present)
        await page
          .getByRole("tab", { name: /activity|history/iu })
          .first()
          .click({ timeout: 3000 })
          .catch(() => undefined);
      await sleep(2000);
      await shot(page, rec, "scout-profile");
    }
    await setMode("activity");
    await page
      .getByTestId("sidebar-activity-button")
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await sleep(3000);
    await shot(page, rec, "activity-page");
    await setMode("channel");
    await snapshot();
  });
  clearInterval(poller);
  await snapshot();

  const nativeNotes = await application
    .evaluate(() => globalThis.__r1Notifications ?? [])
    .catch(() => []);
  const titles = await application
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.getTitle()),
    )
    .catch(() => []);
  const r = lastDump ?? { surfaces: {}, hits: [], legacy: [] };
  rec.notes.labelsByTrigger = Object.keys(r.surfaces["trigger.innerText"] ?? {});
  rec.notes.rowInnerTexts = Object.keys(r.surfaces["row.innerText"] ?? {});
  rec.notes.rowTextContents = Object.keys(r.surfaces["row.textContent"] ?? {});
  rec.notes.rowAttrs = Object.fromEntries(
    Object.entries(r.surfaces).filter(([k]) => k.startsWith("row.attr.")).map(([k, v]) => [k, Object.keys(v)]),
  );
  rec.notes.triggerAria = Object.keys(r.surfaces["trigger.aria-label"] ?? {});
  rec.notes.sessionPanelLines = Object.keys(r.surfaces["session-panel"] ?? {});
  rec.notes.sessionPanelAttrs = Object.fromEntries(
    Object.entries(r.surfaces).filter(([k]) => k.startsWith("session-panel.attr.")).map(([k, v]) => [k, Object.keys(v)]),
  );
  rec.notes.overlays = Object.fromEntries(
    Object.entries(r.surfaces).filter(([k]) => k.startsWith("overlay.")).map(([k, v]) => [k, Object.keys(v).slice(0, 40)]),
  );
  rec.notes.detailsPopover = Object.keys(r.surfaces["details-popover"] ?? {});
  rec.notes.toasts = Object.keys(r.surfaces["toast-or-live-region"] ?? {});
  rec.notes.notificationsRenderer = Object.fromEntries(
    Object.entries(r.surfaces).filter(([k]) => k.startsWith("notification.")).map(([k, v]) => [k, Object.keys(v)]),
  );
  rec.notes.notificationsNative = nativeNotes;
  rec.notes.pages = Object.fromEntries(
    Object.entries(r.surfaces).filter(([k]) => k.startsWith("page.")).map(([k, v]) => [k, Object.keys(v).slice(0, 120)]),
  );
  rec.notes.hits = r.hits;
  rec.notes.legacy = r.legacy.map(({ key: _k, ...rest }) => rest);
  rec.notes.windowTitles = titles;
  rec.notes.prompts = promptLog;
  rec.notes.details = detailsResults;
  rec.notes.recorderTicks = r.ticks;
  rec.notes.lifecycle = lifecycle;

  const flagged = r.hits.filter(
    (h) =>
      h.surface.startsWith("row") ||
      h.surface.startsWith("trigger") ||
      h.surface.startsWith("toast") ||
      h.surface.startsWith("notification") ||
      h.surface.startsWith("overlay") ||
      h.surface.startsWith("page.") ||
      h.surface.startsWith("session-panel"),
  );
  const rowHits = flagged.filter((h) => /^(row|trigger)/u.test(h.surface));
  rec.row(
    "R1-labels-row",
    "Composer activity row: plain labels only, nothing with buzz, a pipe, a flag or a UUID (text, title, aria-label)",
    rec.notes.rowInnerTexts.length === 0
      ? "NOT OBSERVED"
      : rowHits.length === 0
        ? "PASS"
        : "FAIL",
    rec.notes.rowInnerTexts.length === 0
      ? "The activity row never showed text"
      : rowHits.length === 0
        ? `${rec.notes.rowInnerTexts.length} distinct row texts, 0 violations over ${r.ticks} recorder ticks`
        : `Violations: ${JSON.stringify(rowHits).slice(0, 1200)}`,
  );
  const panelHits = flagged.filter((h) => h.surface.startsWith("session-panel"));
  rec.row(
    "R1-labels-panel",
    "Agent session panel and transcript default view: no buzz, pipe, flag or UUID in text or attributes",
    rec.notes.sessionPanelLines.length === 0
      ? "NOT OBSERVED"
      : panelHits.length === 0
        ? "PASS"
        : "FAIL",
    rec.notes.sessionPanelLines.length === 0
      ? "The session panel never opened or showed text"
      : panelHits.length === 0
        ? `${rec.notes.sessionPanelLines.length} distinct panel lines, 0 violations`
        : `Violations: ${JSON.stringify(panelHits).slice(0, 1500)}`,
  );
  const otherHits = flagged.filter(
    (h) => !/^(row|trigger|session-panel)/u.test(h.surface),
  );
  rec.row(
    "R1-labels-other",
    "Toasts, overlays, notifications, Team page and Scout profile activity: no buzz, pipe, flag or UUID",
    otherHits.length === 0 ? "PASS" : "FAIL",
    otherHits.length === 0
      ? `Native notifications seen: ${nativeNotes.length}. Renderer notification texts: ${JSON.stringify(rec.notes.notificationsRenderer).slice(0, 200)}. Page surfaces scanned: ${Object.keys(rec.notes.pages).join(", ") || "none"}`
      : `Violations: ${JSON.stringify(otherHits).slice(0, 1500)}`,
  );
  rec.row(
    "R1-legacy-scan",
    "Visible text, attributes and window title: no Buzz, Fizz, Honey, Pollen or bee on any screen visited (200 ms scan)",
    r.legacy.length === 0 && !titles.some((t) => /buzz|fizz|honey|pollen|\bbees?\b/iu.test(t))
      ? "PASS"
      : "FAIL",
    r.legacy.length === 0
      ? `No hits. Window titles: ${JSON.stringify(titles)}`
      : `Hits: ${JSON.stringify(rec.notes.legacy).slice(0, 1500)}. Window titles: ${JSON.stringify(titles)}`,
  );

  const m = detailsResults.mouse;
  rec.row(
    "R1-details-mouse",
    'Show details (mouse): opens, raw command only inside it, collapses again',
    !m
      ? "NOT OBSERVED"
      : m.open.popoverPresent &&
          m.open.codeLines.length > 0 &&
          /^Hide details$/u.test(m.open.triggerText) &&
          m.open.expanded === "true" &&
          !/buzz|\|/iu.test(m.before.rowTextWhileOpen) &&
          !/buzz|\|/iu.test(m.open.rowTextWhileOpen) &&
          !m.before.popoverPresent &&
          !m.closed.popoverPresent &&
          /^Show details$/u.test(m.closed.triggerText)
        ? "PASS"
        : "FAIL",
    !m
      ? "Show details never appeared while Scout was working"
      : `Before: ${m.before.triggerText} expanded=${m.before.expanded} popover=${m.before.popoverPresent}. Open: ${m.open.triggerText} expanded=${m.open.expanded}, code lines ${JSON.stringify(m.open.codeLines).slice(0, 500)}, row text while open "${m.open.rowTextWhileOpen}". Closed: ${m.closed.triggerText} expanded=${m.closed.expanded} popover=${m.closed.popoverPresent}. Trigger title=${m.before.triggerTitle} aria-label=${m.before.triggerAria}`,
    m ? { screenshot: m.openShot } : {},
  );
  const k = detailsResults.keyboard;
  rec.row(
    "R1-details-keyboard",
    "Show details (keyboard): reachable, Enter and Space open it, Escape collapses it",
    !k
      ? "NOT OBSERVED"
      : k.enterOpen.popoverPresent &&
          k.enterOpen.codeLines.length > 0 &&
          !k.escapeClosed.popoverPresent &&
          k.spaceOpen.popoverPresent &&
          !k.spaceEscapeClosed.popoverPresent
        ? "PASS"
        : "FAIL",
    !k
      ? "Show details never appeared while Scout was working (keyboard prompt)"
      : `Tab presses from composer to reach it: ${k.tabsFromComposer ?? `not within 14 (Shift+Tab: ${k.shiftTabsFromComposer ?? "not within 14"})`}. Enter open=${k.enterOpen.popoverPresent} (expanded=${k.enterOpen.expanded}, code lines ${k.enterOpen.codeLines.length}); Escape closed=${!k.escapeClosed.popoverPresent}, focus after: ${k.escapeClosed.activeTestid}; Space open=${k.spaceOpen.popoverPresent}; Escape closed=${!k.spaceEscapeClosed.popoverPresent}`,
    k ? { screenshot: k.openShot } : {},
  );
  const rawAnywhereDefault = (() => {
    // Raw commands may exist only in the details popover (opt-in).
    const outside = Object.entries(r.surfaces)
      .filter(([s]) => !s.startsWith("details-popover"))
      .flatMap(([s, v]) => Object.keys(v).map((t) => [s, t]))
      .filter(([s, t]) => /buzz/iu.test(t) && !s.startsWith("page."))
      .slice(0, 5);
    return outside;
  })();
  rec.row(
    "R1-raw-only-in-details",
    "The raw command text (buzz) appears only inside the opt-in details popover",
    rec.notes.detailsPopover.length === 0
      ? "NOT OBSERVED"
      : rawAnywhereDefault.length === 0
        ? "PASS"
        : "FAIL",
    rec.notes.detailsPopover.length === 0
      ? "The details popover was never opened"
      : rawAnywhereDefault.length === 0
        ? `Popover texts seen: ${JSON.stringify(rec.notes.detailsPopover).slice(0, 600)}. No buzz text on any other recorded surface`
        : `Raw text also seen outside the popover: ${JSON.stringify(rawAnywhereDefault).slice(0, 800)}`,
  );
} finally {
  rec.notes.endedAt = new Date().toISOString();
  rec.notes.lifecycle = lifecycle;
  await rec.write();
  await closeApp(application);
  await progress(`[R1] done, ${rec.rows.length} rows`);
}
