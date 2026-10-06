// Page-side collector for the fresh-HOME brand proof.
//
// COLLECTOR runs inside the renderer (page.evaluate(COLLECTOR)). It only COLLECTS: every distinct
// visible text on each user-facing surface, keyed by surface name, with no judgement. The verdicts
// are made in Node by brand-scan.mjs, which is unit tested. This is the same recording approach the
// 1.0.5 activity gate used (100 ms poll plus a MutationObserver, text nodes and the title,
// aria-label, aria-description and alt attributes), so a label that flashes for one frame is kept.
//
// Surface keys (the part before the first dot is the surface group the scanner judges):
//   chat                  message timeline
//   activity-strip        composer activity row and its trigger
//   session-panel         whole agent session panel (default, collapsed view)
//   transcript            panel text inside transcript elements (whole panel when none exist)
//   transcript-expanded   panel text while the runner has opened tool groups (opt-in raw text)
//   details-popover       the Show details popover (opt-in raw text)
//   activity-page         Activity page (runner sets mode "activity")
//   team-page, scout-profile, overlay.*, toast-or-live-region, notification.renderer.*, window-title
//
// Keys may carry a suffix such as ".attr.aria-label".

/** Serializable: no closure variables. Returns "installed" or "exists". */
export const COLLECTOR = () => {
  if (window.__brand) return "exists";
  window.__brand = { t0: Date.now(), mode: "channel", surfaces: {}, ticks: 0 };
  const R = window.__brand;
  const ATTRS = ["title", "aria-label", "aria-description", "alt"];
  const LIMIT = 600;
  const clip = (s) =>
    String(s ?? "")
      .replace(/\s+/gu, " ")
      .trim();
  const inClosedDetails = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (a.tagName === "DETAILS" && !a.open) {
        const summary = Array.from(a.children).find(
          (c) => c.tagName === "SUMMARY",
        );
        if (!summary?.contains(el)) return true;
      }
    }
    return false;
  };
  const vis = (el) => {
    if (!el?.getClientRects || el.getClientRects().length === 0) return false;
    if (inClosedDetails(el)) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const note = (surface, rawText) => {
    const text = clip(rawText);
    if (!text) return;
    if (!R.surfaces[surface]) R.surfaces[surface] = new Set();
    const bucket = R.surfaces[surface];
    if (bucket.size < LIMIT) bucket.add(text);
  };
  const attrsOf = (root, surface) => {
    for (const el of [root, ...root.querySelectorAll("*")])
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) note(`${surface}.attr.${a}`, v);
      }
  };
  const textNodes = (root, pick, limit = 900) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (w.nextNode() && n < limit) {
      n += 1;
      const el = w.currentNode.parentElement;
      if (el && vis(el)) pick(w.currentNode.textContent, el);
    }
  };
  const byId = (id) => document.querySelector(`[data-testid="${id}"]`);

  const scan = () => {
    const timeline = byId("message-timeline");
    if (timeline && R.mode === "channel") {
      textNodes(timeline, (t) => note("chat", t));
      attrsOf(timeline, "chat");
    }
    const row = byId("channel-composer-activity-row");
    if (row) {
      note("activity-strip", row.innerText);
      note("activity-strip", row.textContent);
      attrsOf(row, "activity-strip");
    }
    const trigger = byId("bot-activity-composer-trigger");
    if (trigger) {
      note("activity-strip", trigger.innerText);
      note(
        "activity-strip.attr.aria-label",
        trigger.getAttribute("aria-label"),
      );
    }
    const panel = byId("agent-session-thread-panel");
    if (panel && vis(panel)) {
      const expanded = R.mode === "panel-expanded";
      const transcriptEls = [
        ...panel.querySelectorAll('[data-testid^="transcript"]'),
      ];
      textNodes(panel, (t, el) => {
        if (!expanded) note("session-panel", t);
        const inTranscript =
          transcriptEls.length === 0 ||
          transcriptEls.some((x) => x.contains(el));
        if (inTranscript)
          note(expanded ? "transcript-expanded" : "transcript", t);
      });
      attrsOf(panel, expanded ? "transcript-expanded" : "session-panel");
    }
    for (const overlay of document.querySelectorAll(
      "[data-radix-popper-content-wrapper], [role=dialog], [role=menu], [role=tooltip]",
    )) {
      if (!vis(overlay)) continue;
      const isDetails =
        overlay.querySelector('[data-testid="bot-activity-details"]') ||
        overlay.getAttribute("data-testid") === "bot-activity-details";
      const surface = isDetails
        ? "details-popover"
        : `overlay.${overlay.getAttribute("data-testid") ?? overlay.getAttribute("role") ?? "popper"}`;
      textNodes(overlay, (t) => note(surface, t), 200);
      attrsOf(overlay, surface);
    }
    for (const live of document.querySelectorAll(
      "[data-sonner-toast], [role=status], [role=alert], [aria-live]",
    ))
      if (vis(live)) note("toast-or-live-region", live.innerText);
    if (["activity", "team", "scout-profile"].includes(R.mode)) {
      const surface = {
        activity: "activity-page",
        team: "team-page",
        "scout-profile": "scout-profile",
      }[R.mode];
      const main = document.querySelector("main") ?? document.body;
      textNodes(main, (t) => note(surface, t));
      attrsOf(main, surface);
    }
    note("window-title", document.title);
  };
  const safe = () => {
    try {
      scan();
    } catch {
      /* element removed mid-scan */
    }
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      safe();
    });
  }).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "aria-expanded"],
  });
  setInterval(() => {
    R.ticks += 1;
    safe();
  }, 150);
  try {
    const Original = window.Notification;
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

/** Serializable: read the collected surfaces as plain arrays. */
export const READ_COLLECTED = () =>
  window.__brand
    ? {
        ticks: window.__brand.ticks,
        surfaces: Object.fromEntries(
          Object.entries(window.__brand.surfaces).map(([key, set]) => [
            key,
            [...set],
          ]),
        ),
      }
    : null;

/** Serializable with an argument: switch what the page-level scans attribute text to. */
export const SET_MODE = (mode) => {
  if (window.__brand) window.__brand.mode = mode;
};

/** Merge two reads taken at different times: the page may reload and lose earlier text. */
export function mergeCollected(previous, next) {
  const surfaces = {};
  for (const source of [previous, next])
    for (const [key, texts] of Object.entries(source?.surfaces ?? {})) {
      const merged = new Set(surfaces[key] ?? []);
      for (const text of texts) merged.add(text);
      surfaces[key] = [...merged];
    }
  return { ticks: Math.max(previous?.ticks ?? 0, next?.ticks ?? 0), surfaces };
}
