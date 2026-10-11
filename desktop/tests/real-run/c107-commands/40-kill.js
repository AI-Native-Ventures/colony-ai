// shared helpers, prepended to row scripts
const DM = state.G.dmChannel;
const openDm = async () => {
  const page = S.page;
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await page.evaluate((dm) => { location.hash = "#/channels/" + dm; }, DM);
  await sleep(2500);
  const dock = page.getByTestId("work-area-panel");
  if (!(await dock.isVisible().catch(() => false))) await page.getByTestId("channel-work-area-trigger").click().catch(() => {});
  await sleep(1000);
  return dock;
};
const openBrowser = async (url) => {
  const page = S.page;
  const dock = page.getByTestId("work-area-panel");
  const address = dock.locator('section[role="tabpanel"]:not([hidden])').getByTestId("browser-address");
  if (!(await address.isVisible().catch(() => false))) {
    if (await page.getByTestId("work-area-open-browser").isVisible().catch(() => false)) await page.getByTestId("work-area-open-browser").click();
    else { await page.getByTestId("work-area-add-tab").click(); await sleep(600); await page.getByRole("menuitem", { name: /Browser/ }).first().click().catch(() => {}); }
  }
  await address.waitFor({ timeout: 15000 });
  if (url) {
    await address.fill(url); await address.press("Enter");
    const end = Date.now() + 20000;
    while (Date.now() < end) { const tabs = await page.evaluate(() => window.colonyBrowserHost?.listTabs?.() ?? []).catch(() => []); if (tabs.some(t => t.url?.startsWith(url) && !t.loading)) break; await sleep(300); }
  }
  return address;
};
const sendDm = async (text) => {
  const page = S.page;
  const composer = page.getByTestId("message-composer").locator('[contenteditable="true"]').first();
  await composer.fill("@");
  const menu = page.getByTestId("mention-autocomplete");
  await menu.waitFor({ timeout: 10000 });
  await menu.locator("[data-mention-suggestion-index]").filter({ hasText: /Scout/ }).first().click();
  await composer.press("End");
  await composer.pressSequentially(" " + text);
  await composer.press("Enter");
  return Date.now();
};
const fakeTurns = async (since, scenario) => {
  const lines = (await readFile(path.join(OUT, rec.phase + "-fake.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  return lines.filter(e => e.kind === "turn" && Date.parse(e.at) >= since - 1500 && (!scenario || e.scenario === scenario));
};
const waitTurns = async (since, scenario, pred, ms = 60000) => {
  const end = Date.now() + ms; let t = [];
  while (Date.now() < end) { t = await fakeTurns(since, scenario); if (pred(t)) return t; await sleep(700); }
  return t;
};
const controls = () => S.page.getByTestId("browser-agent-controls");
const task = () => ({ agentId: state.G.scoutPubkey, taskId: "conversation:" + state.G.dmChannel, businessId: state.G.businessId, communityOrigin: "https://candidate-107-gate-co.colony.ainative.ventures", clientId: null });
await launchApp({ flag: "0" });
const dock = await openDm();
await openBrowser(null);
await sleep(2000);
const ctl = await controls().isVisible().catch(() => false);
const anyAgentUi = await S.page.evaluate(() => [...document.querySelectorAll('[data-testid*="browser-agent"]')].filter(e => e.getClientRects().length).map(e => e.getAttribute("data-testid")));
await shot(S.page, rec, "20-killswitch-browser");
const sent = await sendDm("Fixture unapproved row: kill switch check. candidate107k");
const turns = await waitTurns(sent, "browser-unapproved", t => t.some(x => x.step >= 0), 60000);
const tools = turns[0]?.tools ?? [];
return { ctl, anyAgentUi, nTurns: turns.length, tools, browserTools: tools.filter(x => /browser/.test(x)) };
