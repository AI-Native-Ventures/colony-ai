// Colony 1.0.5 candidate gate, Work area dock (item 6) on profile A, relaunched with the SAME user-data dir.
// usage: node c105-dock.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
const rec = new Rec(process.env.STEPS ? "DOCK2" : "DOCK");
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const load = await waitForLoad();
await progress(`[DOCK] load ${load.toFixed(1)} ok, relaunching profile A`);
const { application, page, version } = await launch({
  privateDir: state.A.privateDir,
  userDataDir: state.A.userDataDir,
});
rec.notes.version = version;
instrument(page, rec, "A");
const lifecycle = [];
const launchedAt = Date.now();
application
  .process()
  .on("exit", (code, signal) =>
    lifecycle.push({ sinceLaunchMs: Date.now() - launchedAt, code, signal }),
  );

// Legacy-name watcher: visible text, accessible names and window title, every 200 ms, with context.
const legacy = [];
const legacyWatcher = setInterval(async () => {
  try {
    const hits = await page.evaluate(() => {
      const re = /.{0,50}(buzz|fizz|honey|pollen|\u{1f41d}).{0,50}/iu;
      const out = [];
      const m = (document.body?.innerText ?? "").match(re);
      if (m) out.push({ where: "visible text", context: m[0] });
      for (const el of document.querySelectorAll(
        "[aria-label],[title],[alt]",
      )) {
        const v = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("alt") ?? ""}`;
        if (re.test(v))
          out.push({ where: "attribute", context: v.trim().slice(0, 120) });
        if (out.length > 3) break;
      }
      if (re.test(document.title))
        out.push({ where: "window title", context: document.title });
      return out;
    });
    for (const item of hits) {
      const key = `${item.where}|${item.context}`;
      if (!legacy.some((l) => l.key === key))
        legacy.push({ key, ...item, atMs: Date.now() - launchedAt });
    }
  } catch {
    /* page gone */
  }
}, 200);
const wanted = (id) =>
  !process.env.STEPS ||
  process.env.STEPS.split(",").some((w) => id.startsWith(w));
const guard = async (id, label, fn) => {
  if (!wanted(id)) return undefined;
  try {
    return await fn();
  } catch (error) {
    rec.row(
      id,
      label,
      "FAIL",
      `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`,
      {
        screenshot: await shot(page, rec, `${id}-error`),
      },
    );
    return undefined;
  }
};
const body = async (n = 300) =>
  redact(
    (
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/gu, " ")
      .slice(0, n),
  );
const dockOpen = () =>
  page
    .getByTestId("work-area-panel")
    .isVisible()
    .catch(() => false);
const divider = () => page.getByTestId("work-area-divider");
const width = async () =>
  Number(
    await divider()
      .getAttribute("aria-valuenow")
      .catch(() => "NaN"),
  );
const channel = (name) =>
  page.locator(`[data-testid="channel-${name}" i]`).first();
const openDock = async () => {
  if (await dockOpen()) return;
  await page.getByTestId("channel-work-area-trigger").click({ timeout: 8000 });
  await page.getByTestId("work-area-panel").waitFor({ timeout: 8000 });
  await sleep(500);
};
const closeDock = async () => {
  if (!(await dockOpen())) return;
  await page.getByTestId("work-area-close").click({ timeout: 8000 });
  await page
    .getByTestId("work-area-panel")
    .waitFor({ state: "hidden", timeout: 8000 });
  await sleep(400);
};
const tabIds = () =>
  page.locator('[data-testid^="work-area-tab-"]').evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("data-testid").replace("work-area-tab-", ""),
      text: e.textContent.trim(),
      selected: e.getAttribute("aria-selected"),
    })),
  );
const addTab = async (kind) => {
  const empty = page.getByTestId(`work-area-open-${kind}`);
  if (await empty.isVisible().catch(() => false)) {
    await empty.click();
  } else {
    await page.getByTestId("work-area-add-tab").click({ timeout: 6000 });
    await sleep(300);
    await page.getByTestId(`work-area-add-${kind}`).click({ timeout: 6000 });
  }
  await sleep(900);
};
const pidFile = (n) => path.join(state.A.privateDir, `terminal-pid-${n}.txt`);
const termPid = async (n) => {
  // The terminal substrate is a canvas: read the shell's PID from a file the shell writes.
  const slot = page.getByTestId("work-area-terminal-slot");
  await slot.click({ timeout: 6000, position: { x: 80, y: 60 } });
  await sleep(700);
  await page.keyboard.type(`echo $$ > '${pidFile(n)}'`);
  await page.keyboard.press("Enter");
  await sleep(1500);
  return (await readFile(pidFile(n), "utf8").catch(() => "")).trim();
};

try {
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(3000);
  rec.row(
    "DOCK-version",
    "App reports version 1.0.5",
    version === "1.0.5" ? "PASS" : "FAIL",
    `app.getVersion() = ${version}`,
  );
  // Persisted avatar from A2: item 5 relaunch persistence.
  const av = await page.evaluate(() => {
    const img = document.querySelector(
      '[data-testid="sidebar-profile-avatar-image"]',
    );
    return {
      image: Boolean(img),
      nat: img ? [img.naturalWidth, img.naturalHeight] : null,
    };
  });
  rec.row(
    "A5-persist",
    "Uploaded picture still in the sidebar after relaunch (same profile)",
    av.image && av.nat?.[0] > 0 ? "PASS" : "FAIL",
    JSON.stringify(av),
    {
      screenshot: await shot(page, rec, "d0-relaunch-avatar"),
    },
  );

  // Make #general scrollable (30 short messages), then set up a composer draft.
  await guard("DOCK-setup", "Make #general scrollable", async () => {
    await channel("general").click({ timeout: 8000 });
    await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
    const composer = page
      .locator('[data-testid="message-composer"] [contenteditable="true"]')
      .first();
    for (let i = 1; i <= 28; i += 1) {
      await composer.click();
      await page.keyboard.type(
        `dock scroll filler ${i} ${"lorem ipsum ".repeat(6)}`,
      );
      await page.keyboard.press("Enter");
      await sleep(250);
    }
    await sleep(2000);
    rec.row(
      "DOCK-setup",
      "28 filler messages posted in #general",
      "PASS",
      `Page: ${await body(120)}`,
      {},
    );
  });

  await guard("DOCK-open", "Open the dock in #general", async () => {
    const t = Date.now();
    await channel("general").click();
    await sleep(800);
    await openDock();
    const empty = await page
      .getByTestId("work-area-empty")
      .isVisible()
      .catch(() => false);
    const choices = await page
      .locator('[data-testid^="work-area-open-"]')
      .allInnerTexts();
    rec.notes.openChoices = choices;
    rec.row(
      "DOCK-open",
      "Work area button opens the dock; empty state offers tab kinds",
      (await dockOpen()) ? "PASS" : "FAIL",
      `Opened in ${Date.now() - t} ms. Empty state: ${empty}. Offered: ${choices.join(" | ")}. Width ${await width()}%`,
      {
        screenshot: await shot(page, rec, "d1-open"),
      },
    );
    rec.row(
      "DOCK-canvas-offered",
      "Canvas tab is offered in the dock",
      choices.some((c) => /Canvas/u.test(c)) ? "PASS" : "FAIL",
      `Dock offers: ${choices.join(" | ")}. (workAreaTabRegistry.tsx marks canvas available: false)`,
      {},
    );
  });

  // Draft and scroll survive opening and closing the dock.
  await guard(
    "DOCK-draft",
    "Composer draft and scroll survive the dock",
    async () => {
      await closeDock();
      const composer = page
        .locator('[data-testid="message-composer"] [contenteditable="true"]')
        .first();
      await composer.click();
      await page.keyboard.type("draft that must survive the dock");
      const tl = page.getByTestId("message-timeline");
      await tl.evaluate((el) => {
        const sc =
          [el, ...el.querySelectorAll("*")].find(
            (n) =>
              n.scrollHeight > n.clientHeight + 50 &&
              getComputedStyle(n).overflowY !== "visible",
          ) ?? el;
        sc.dataset.dockScroll = "1";
        sc.scrollTop = Math.max(0, Math.floor(sc.scrollHeight / 3));
      });
      await sleep(800);
      const read = () =>
        page.evaluate(() => {
          const sc = document.querySelector('[data-dock-scroll="1"]');
          return {
            top: sc ? Math.round(sc.scrollTop) : null,
            max: sc ? sc.scrollHeight - sc.clientHeight : null,
            draft:
              document.querySelector(
                '[data-testid="message-composer"] [contenteditable="true"]',
              )?.textContent ?? "",
          };
        });
      const before = await read();
      await openDock();
      await sleep(1000);
      const during = await read();
      await closeDock();
      await sleep(1000);
      const after = await read();
      const draftOk = [before, during, after].every((r) =>
        r.draft.includes("draft that must survive the dock"),
      );
      const scrollOk =
        before.max > 100 && Math.abs(before.top - after.top) <= 40;
      rec.row(
        "DOCK-draft",
        "Composer draft survives opening and closing the dock",
        draftOk ? "PASS" : "FAIL",
        `Before ${JSON.stringify(before)}; open ${JSON.stringify(during)}; closed ${JSON.stringify(after)}`,
        {
          screenshot: await shot(page, rec, "d2-draft"),
        },
      );
      rec.row(
        "DOCK-scroll",
        "Timeline scroll position survives opening and closing the dock",
        scrollOk ? "PASS" : before.max > 100 ? "FAIL" : "NOT OBSERVED",
        `Scrollable: ${before.max > 100}. Before ${before.top}/${before.max}; open ${during.top}; closed ${after.top}. Tolerance 40 px`,
        {},
      );
      // Clear the draft so it does not post later.
      await composer.click();
      await page.keyboard.press("Meta+A");
      await page.keyboard.press("Backspace");
    },
  );

  // Tabs: terminal, files; canvas if offered.
  await guard(
    "DOCK-tabs",
    "Open Terminal and Files tabs and switch",
    async () => {
      await openDock();
      await addTab("terminal");
      const slot = await page
        .getByTestId("work-area-terminal-slot")
        .isVisible()
        .catch(() => false);
      await sleep(1500);
      await shot(page, rec, "d3-terminal");
      await addTab("files");
      const files = await page
        .getByTestId("work-area-files")
        .isVisible()
        .catch(() => false);
      const filesText = redact(
        await page
          .getByTestId("work-area-files")
          .innerText()
          .catch(() => ""),
      );
      await shot(page, rec, "d4-files-empty");
      const tabs = await tabIds();
      const addMenu = await (async () => {
        await page
          .getByTestId("work-area-add-tab")
          .click({ timeout: 4000 })
          .catch(() => undefined);
        await sleep(300);
        const items = await page
          .locator('[data-testid^="work-area-add-"]')
          .allInnerTexts();
        await shot(page, rec, "d5-add-menu");
        await page.keyboard.press("Escape");
        return items;
      })();
      rec.notes.tabs = tabs;
      rec.row(
        "DOCK-tabs",
        "Terminal and Files tabs open and switch",
        slot && files ? "PASS" : "FAIL",
        `Terminal slot visible: ${slot}. Files tab visible: ${files} (text: ${filesText}). Tabs: ${JSON.stringify(tabs)}. Add menu offers: ${addMenu.join(" | ")}`,
        {},
      );
      const term = tabs.find((t) => /Terminal/u.test(t.text));
      if (term) await page.getByTestId(`work-area-tab-${term.id}`).click();
      await sleep(800);
    },
  );

  // Resize by drag and keyboard.
  await guard("DOCK-resize", "Resize by drag and by keyboard", async () => {
    await channel("general").click();
    await sleep(800);
    await openDock();
    const w0 = await width();
    const box = await divider().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 160, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await sleep(600);
    const wDrag = await width();
    await shot(page, rec, "d6-after-drag");
    await divider().focus();
    await page.keyboard.press("Home");
    await sleep(300);
    const w1 = await width();
    await page.keyboard.press("ArrowLeft");
    await sleep(300);
    const w2 = await width();
    await page.keyboard.press("Shift+ArrowRight");
    await sleep(300);
    const w3 = await width();
    await page.keyboard.press("Shift+ArrowLeft");
    await sleep(300);
    await page.keyboard.press("Shift+ArrowLeft");
    await sleep(300);
    const wMax = await width();
    await page.keyboard.press("Home");
    await sleep(300);
    const w4 = await width();
    rec.row(
      "DOCK-resize-drag",
      "Resize by pointer drag",
      wDrag !== w0 && Number.isFinite(wDrag) ? "PASS" : "FAIL",
      `Width ${w0}% -> ${wDrag}% after dragging the divider 160 px left`,
      {},
    );
    rec.row(
      "DOCK-resize-key",
      "Resize by keyboard (Left +2, Shift+Right -10, Home resets)",
      w1 === 64 && w2 === w1 + 2 && w3 === w2 - 10 && wMax === 75 && w4 === 64
        ? "PASS"
        : "FAIL",
      `Home ${w1} (expect 64); ArrowLeft ${w2} (expect ${w1 + 2}); Shift+ArrowRight ${w3} (expect ${w2 - 10}); Shift+ArrowLeft twice ${wMax} (clamped at 75); Home ${w4} (expect 64)`,
      {
        screenshot: await shot(page, rec, "d7-after-keys"),
      },
    );
    // Leave a distinctive width for the reload check.
    await page.keyboard.press("Shift+ArrowLeft");
    await sleep(300);
    rec.notes.widthForReload = await width();
  });

  // Terminal session survives close, reopen and channel switch.
  let pid1;
  await guard(
    "DOCK-terminal",
    "Terminal session survives dock close and channel switch",
    async () => {
      const tabs = await tabIds();
      const term = tabs.find((t) => /Terminal/u.test(t.text));
      if (term) await page.getByTestId(`work-area-tab-${term.id}`).click();
      await sleep(800);
      pid1 = await termPid(1);
      await closeDock();
      await openDock();
      const term2 = (await tabIds()).find((t) => /Terminal/u.test(t.text));
      if (term2) await page.getByTestId(`work-area-tab-${term2.id}`).click();
      await sleep(1200);
      const pid2 = await termPid(2);
      await channel("welcome").click();
      await sleep(1500);
      await channel("general").click();
      await sleep(1500);
      await openDock();
      const term3 = (await tabIds()).find((t) => /Terminal/u.test(t.text));
      if (term3) await page.getByTestId(`work-area-tab-${term3.id}`).click();
      await sleep(1200);
      const pid3 = await termPid(3);
      rec.notes.pids = [pid1, pid2, pid3];
      rec.row(
        "DOCK-terminal",
        "Terminal shell PID is the same after dock close/reopen and after a channel switch",
        pid1 && pid1 === pid2 && pid2 === pid3
          ? "PASS"
          : pid1
            ? "FAIL"
            : "NOT OBSERVED",
        `Shell PIDs read from files the shell wrote: ${[pid1, pid2, pid3].join(", ") || "none written"} (empty means typing into the canvas terminal did not reach a shell)`,
        {
          screenshot: await shot(page, rec, "d8-terminal"),
        },
      );
    },
  );

  // State per channel: Welcome has its own dock state.
  await guard("DOCK-per-channel", "Dock state is per channel", async () => {
    await channel("welcome").click();
    await sleep(1500);
    const welcomeOpen = await dockOpen();
    const welcomeTabs = welcomeOpen ? await tabIds() : [];
    await shot(page, rec, "d9-welcome-dock");
    if (!welcomeOpen) await openDock();
    await addTab("files");
    const wTabs = await tabIds();
    const wWidth = await width();
    await channel("general").click();
    await sleep(1500);
    const gOpen = await dockOpen();
    const gTabs = gOpen ? await tabIds() : [];
    const gWidth = gOpen ? await width() : null;
    rec.row(
      "DOCK-per-channel",
      "Welcome starts with its own state; general keeps its tabs and width",
      !welcomeOpen && gOpen && gTabs.length >= 2 ? "PASS" : "FAIL",
      `Welcome dock open on arrival: ${welcomeOpen} (tabs ${JSON.stringify(welcomeTabs)}). After adding in Welcome: tabs ${JSON.stringify(wTabs)}, width ${wWidth}. Back in general: open ${gOpen}, tabs ${JSON.stringify(gTabs)}, width ${gWidth}`,
      {
        screenshot: await shot(page, rec, "d10-general-again"),
      },
    );
  });

  // Reload: state survives per channel.
  await guard("DOCK-reload", "Dock state survives a reload", async () => {
    const before = {
      open: await dockOpen(),
      tabs: await tabIds(),
      width: await width(),
    };
    await page.reload();
    await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
    await sleep(4000);
    await channel("general").click();
    await sleep(1500);
    const after = {
      open: await dockOpen(),
      tabs: await tabIds().catch(() => []),
      width: (await dockOpen()) ? await width() : null,
    };
    const same =
      after.open === before.open &&
      JSON.stringify(after.tabs.map((t) => t.text)) ===
        JSON.stringify(before.tabs.map((t) => t.text)) &&
      after.width === before.width;
    rec.row(
      "DOCK-reload",
      "After reload the channel's dock is as it was (open, tabs, width)",
      same ? "PASS" : "FAIL",
      `Before ${JSON.stringify(before)}; after ${JSON.stringify(after)}`,
      {
        screenshot: await shot(page, rec, "d11-reload"),
      },
    );
  });

  // Narrow window: overlay and always closable.
  await guard(
    "DOCK-narrow",
    "Narrow window overlays the dock and it can be closed",
    async () => {
      await channel("general").click();
      await sleep(900);
      await openDock();
      await page.setViewportSize({ width: 900, height: 760 });
      await sleep(1500);
      const overlay = await page
        .getByTestId("work-area-layout")
        .getAttribute("data-overlay")
        .catch(() => null);
      const closeVisible = await page
        .getByTestId("work-area-close")
        .isVisible()
        .catch(() => false);
      await shot(page, rec, "d12-narrow");
      await page
        .getByTestId("work-area-close")
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await sleep(600);
      const closedByButton = !(await dockOpen());
      await openDock();
      const dividerPresent = await divider()
        .isVisible()
        .catch(() => false);
      await page.getByTestId("work-area-close").focus();
      const focusedBefore = await page.evaluate(
        () =>
          document.activeElement?.getAttribute("data-testid") ??
          document.activeElement?.tagName,
      );
      await page.keyboard.press("Escape");
      await sleep(900);
      const closedByEscape = !(await dockOpen());
      rec.notes.escapeProbe = { dividerPresent, focusedBefore, closedByEscape };
      if (!closedByEscape)
        await page
          .getByTestId("work-area-close")
          .click()
          .catch(() => undefined);
      await sleep(500);
      await page.setViewportSize({ width: 600, height: 760 });
      await sleep(1200);
      await openDock().catch(() => undefined);
      const veryNarrowClose = await page
        .getByTestId("work-area-close")
        .isVisible()
        .catch(() => false);
      await shot(page, rec, "d13-very-narrow");
      await page
        .getByTestId("work-area-close")
        .click({ timeout: 4000 })
        .catch(() => undefined);
      await sleep(500);
      const veryNarrowClosed = !(await dockOpen());
      await page.setViewportSize({ width: 1440, height: 960 });
      await sleep(1000);
      rec.row(
        "DOCK-narrow",
        "At 900 px the dock overlays, and the close button, Escape and 600 px close all work",
        overlay === "true" &&
          closeVisible &&
          closedByButton &&
          closedByEscape &&
          veryNarrowClose &&
          veryNarrowClosed
          ? "PASS"
          : "FAIL",
        `data-overlay at 900 px: ${overlay}. Close visible: ${closeVisible}. Closed by button: ${closedByButton}. Closed by Escape with focus on the close button: ${closedByEscape} (probe ${JSON.stringify(rec.notes.escapeProbe)}). At 600 px close visible ${veryNarrowClose}, closed ${veryNarrowClosed}`,
        {},
      );
    },
  );

  // Files tab: a file link from chat. Scout already authored dock-check.md and replied in a thread under the
  // request (earlier runs); open that thread and click the path in Scout's reply.
  await guard(
    "DOCK-files",
    "A file link from chat opens in the dock Files tab",
    async () => {
      await channel("welcome").click();
      await sleep(1500);
      // The last "View thread" chip in Welcome belongs to the dock-check.md request.
      await page
        .getByText(/View thread/u)
        .last()
        .click({ timeout: 8000 });
      const panel = page
        .locator(
          '[data-testid="message-thread-panel"], [data-testid="focus-thread-drawer"]',
        )
        .first();
      await panel.waitFor({ timeout: 10000 });
      await sleep(1500);
      const panelText = redact(
        (await panel.innerText().catch(() => "")).replace(/\s+/gu, " "),
      ).slice(0, 700);
      await shot(page, rec, "d14-thread");
      const link = panel
        .locator('[data-testid="message-row"]')
        .filter({
          has: page
            .getByTestId("message-author")
            .filter({ hasText: /^Scout$/u }),
        })
        .locator("code, a, button")
        .filter({ hasText: /dock-check\.md/u })
        .first();
      if (!(await link.count())) {
        rec.row(
          "DOCK-files",
          "A file link from chat opens in the dock Files tab",
          "NOT OBSERVED",
          `Scout's thread reply has no clickable dock-check.md path. Thread text: ${panelText}`,
          { screenshot: await shot(page, rec, "d14-no-link") },
        );
        return;
      }
      await link.click({ timeout: 6000 });
      await sleep(2500);
      const open = await dockOpen();
      const content = redact(
        await page
          .getByTestId("work-area-files")
          .innerText()
          .catch(() => ""),
      );
      const md = await page
        .getByTestId("work-area-markdown")
        .isVisible()
        .catch(() => false);
      rec.row(
        "DOCK-files",
        "A file link from chat opens in the dock Files tab",
        open && md && content.length > 20 ? "PASS" : "FAIL",
        `Dock open: ${open}. Markdown rendered: ${md}. Files tab text: ${content.slice(0, 300)}. Thread text: ${panelText}`,
        { screenshot: await shot(page, rec, "d15-file-in-dock") },
      );
    },
  );
} finally {
  clearInterval(legacyWatcher);
  rec.notes.legacyHits = legacy.map(({ key: _k, ...rest }) => rest);
  rec.row(
    "DOCK-legacy-names",
    "No visible Buzz, Fizz, Honey, Pollen or bee text during the whole dock run (incl. Scout tool activity)",
    legacy.length ? "FAIL" : "PASS",
    `Watched every 200 ms for ${Math.round((Date.now() - launchedAt) / 1000)} s. Hits: ${JSON.stringify(rec.notes.legacyHits)}`,
    {},
  );
  rec.notes.lifecycle = lifecycle;
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[DOCK] done, ${rec.rows.length} rows`);
  void writeFile;
}
