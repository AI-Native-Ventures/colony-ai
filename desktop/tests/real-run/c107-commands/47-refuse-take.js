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
const sendUntilTurn = async (text, scenario, ms = 45000) => {
  for (let k = 0; k < 3; k++) {
    const sent = await sendDm(text + " try" + (k + 1));
    const t = await waitTurns(sent, scenario, x => x.length > 0, ms);
    if (t.length) return { sent, tries: k + 1 };
  }
  return { sent: null, tries: 3 };
};
const prepRow = async (id) => {
  if (S.fx) await S.fx.close().catch(() => {});
  S.fx = createAgentBrowserFixtures({ modelPlan: [{}] });
  S.origins = await S.fx.start();
  await launchApp({ gate: { task: task(), origin: S.origins.fixtureOrigin } });
  await openDm();
  await openBrowser(S.origins.fixtureOrigin + "/");
  await sleep(1500);
  return S.origins;
};
const grant = async () => {
  const c = controls();
  await c.getByRole("button", { name: "Allow an agent", exact: true }).click({ timeout: 15000 });
  const sel = c.getByLabel("Agent", { exact: true });
  await sel.waitFor({ timeout: 10000 });
  const options = await sel.locator("option").allInnerTexts();
  await sel.selectOption(state.G.scoutPubkey);
  await c.getByRole("button", { name: "Allow for this task", exact: true }).click({ timeout: 15000 });
  await S.page.getByTestId("browser-controller").getByText(/has control/u).waitFor({ timeout: 15000 });
  return options;
};
const controlRound = async (label, action) => {
  const c = controls();
  const before = S.fx.counters().submissions;
  const r = await sendUntilTurn("Fixture control row: snapshot this approved tab and click Send message. Wait for the person's confirmation. " + label, "browser-control", 60000);
  const dlg = c.getByRole("alertdialog");
  let dialog = false; const e2 = Date.now() + 90000;
  while (Date.now() < e2) { if (await dlg.isVisible().catch(() => false)) { dialog = true; break; } await sleep(400); }
  const atDialog = S.fx.counters().submissions;
  const dialogText = dialog ? (await dlg.innerText()).replace(/\n+/g, " | ") : null;
  if (dialog) await shot(S.page, rec, label + "-dialog");
  if (dialog && action === "confirm") await dlg.getByRole("button", { name: "Confirm action", exact: true }).click();
  if (dialog && action === "reject") await dlg.getByRole("button", { name: "Reject", exact: true }).click();
  if (dialog && (action === "stop" || action === "takeover")) await c.getByRole("button", { name: action === "stop" ? "Stop" : "Take over", exact: true }).click();
  const turns = await waitTurns(r.sent ?? Date.now(), "browser-control", x => x.some(y => y.step >= 3), 45000);
  await sleep(1500);
  const after = S.fx.counters().submissions;
  const clickResult = turns.find(t => t.step >= 3)?.results?.[2] ?? null;
  await shot(S.page, rec, label + "-after");
  const controller = await S.page.getByTestId("browser-controller").innerText().catch(() => null);
  return { label, tries: r.tries, before, atDialog, after, dialog, dialogText, clickResult: clickResult?.slice(0, 400), controller };
};
const clearStale = async () => {
  const dock = S.page.getByTestId("work-area-panel");
  const stale = await dock.getByText("This page could not be opened").isVisible().catch(() => false);
  if (stale) { await dock.getByRole("button", { name: "Try again", exact: true }).click(); await sleep(3000); }
  return stale;
};
const grantWithWake = async () => {
  const c = controls();
  const sel = c.getByLabel("Agent", { exact: true });
  if (!(await sel.isVisible().catch(() => false))) await c.getByRole("button", { name: "Allow an agent", exact: true }).click({ timeout: 15000 });
  const wake = await sendDm("what commands and tools did you use? wake candidate107");
  let opts = []; const end = Date.now() + 120000;
  while (Date.now() < end) { opts = await sel.locator("option").evaluateAll(os => os.map(o => o.textContent)).catch(() => []); if (opts.some(o => /Scout/.test(o))) break; await sleep(700); }
  if (!opts.some(o => /Scout/.test(o))) throw new Error("Scout never eligible: " + JSON.stringify(opts));
  await sel.selectOption(state.G.scoutPubkey);
  await c.getByRole("button", { name: "Allow for this task", exact: true }).click({ timeout: 15000 });
  await S.page.getByTestId("browser-controller").getByText(/has control/u).waitFor({ timeout: 15000 });
  return { wakeMs: Date.now() - wake, opts };
};
const out = {};
const o = S.origins;
const before = S.fx.counters();
const r = await sendUntilTurn(`Fixture refusal row: try ${o.forbiddenOrigin}/private, http://192.168.1.1/, http://169.254.169.254/latest, file:///private/fixture, then ${o.fixtureOrigin}/redirect-private.`, "browser-refusal", 60000);
const t = await waitTurns(r.sent ?? Date.now(), "browser-refusal", x => x.some(y => y.step >= 6), 60000);
const last = t.reduce((a, b) => (b.step > (a?.step ?? -1) ? b : a), null);
out.refusal = { tries: r.tries, results: (last?.results ?? []).map(x => x.slice(0, 260)), forbiddenRequests: S.fx.counters().forbiddenRequests, controller: await S.page.getByTestId("browser-controller").innerText().catch(() => null) };
await shot(S.page, rec, "30-refusal");
out.takeover = await controlRound("31-takeover", "takeover");
const sent2 = await sendDm("Fixture ended-control row: attempt another browser snapshot in this same task.");
const t2 = await waitTurns(sent2, "browser-ended", x => x.some(y => y.step >= 2) || x.some(y => y.step >= 0 && (y.tools ?? []).every(n => !/browser/.test(n))), 60000);
out.ended = t2.map(x => ({ step: x.step, browserTools: (x.tools ?? []).filter(n => /browser/.test(n)).length, r: (x.results ?? []).map(y => y.slice(0, 300)) }));
out.finalCounters = S.fx.counters();
await shot(S.page, rec, "32-after-takeover");
return out;
