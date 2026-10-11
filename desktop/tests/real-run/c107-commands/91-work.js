const { pageContext } = await import("file:///Users/mac/.superset/worktrees/Colony/codex/104d-real-run/desktop/tests/real-run/work-knowledge-page.mjs");
const ctx = pageContext(S.page, { shot: (n) => shot(S.page, rec, n) });
await ctx.openDockTab("work");
let t = ""; const end = Date.now() + 20000;
while (Date.now() < end) { t = await S.page.getByTestId("work-area-panel").innerText(); if (!/Loading/.test(t)) break; await sleep(500); }
await shot(S.page, rec, "WK-work-settled");
const k = await S.page.getByTestId("work-area-panel").locator("[data-testid]").evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => e.getAttribute("data-testid")).slice(0, 25));
return { text: t.slice(0, 700), testids: k };
