import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import {
  type BrokerApp,
  closeServer,
  launchBrokerApp,
  listen,
  pngSize,
  taskFor,
  visibleTabs,
} from "./support/brokerApp";

/**
 * Agents work in the background. The page an agent drives is often not the
 * page the person is looking at: it sits behind the person's visible tab, the
 * dock is closed, the person is in another channel, or the whole Colony window
 * is hidden or minimized. Every tool still has to work, quickly, and nothing
 * the agent does may change what the person sees.
 */

const PAGE = `<!doctype html><title>Background fixture</title>
<body style="margin:0">
  <div style="height:120px;background:repeating-linear-gradient(45deg,#c00,#c00 10px,#fc0 10px,#fc0 20px)"></div>
  <h1>Footer test</h1>
  <button type="button" onclick="document.querySelector('#status').textContent='Changed'">Change</button>
  <p id="status">Ready</p>
  <label>Note<input aria-label="Note" id="note"></label>
  <div style="height:2400px">Scroll target</div>
  <footer id="footer">The footer says hello</footer>
</body>`;

type Reply = Record<string, unknown> & { ok: boolean; code?: string };

// Generous: a loaded CI machine is slow. The failures this guards are a 15 second
// hang, a wheel that does nothing and a click that is refused, not a slow second.
const TOOL_BUDGET_MS = 4000;

async function evaluateIn<T>(app: BrokerApp, tabId: string, code: string) {
  return app.application.evaluate(
    (_electron, { tabId, code }) =>
      (
        globalThis as unknown as {
          colonyBrowserFixture: {
            browser: {
              agentAdapter: {
                webContents(id: string): {
                  executeJavaScript(code: string): Promise<unknown>;
                };
              };
            };
          };
        }
      ).colonyBrowserFixture.browser.agentAdapter
        .webContents(tabId)
        .executeJavaScript(code),
    { tabId, code },
  ) as Promise<T>;
}

/** Every tool an agent has, on one tab, each within its budget. */
async function useEveryTool(
  app: BrokerApp,
  client: { callTool(tool: string, args: object): Promise<Reply> },
  tabId: string,
  origin: string,
  reference?: { screenshotBytes: number },
) {
  const timings: Record<string, number> = {};
  const call = async (tool: string, args: object = {}) => {
    const started = Date.now();
    const reply = await client.callTool(tool, { tab: tabId, ...args });
    timings[tool] = Date.now() - started;
    return reply;
  };
  const navigate = await call("browser_navigate", { url: origin });
  expect(navigate, JSON.stringify(navigate)).toMatchObject({ ok: true });
  const snapshot = (await call("browser_snapshot")) as Reply & {
    snapshot: string;
  };
  expect(snapshot.ok, JSON.stringify(snapshot)).toBe(true);
  expect(snapshot.snapshot).toContain("Footer test");
  const ref = (name: string) => {
    const line = snapshot.snapshot
      .split("\n")
      .find((entry) => entry.includes(name) && entry.includes("[ref="));
    const match = /\[ref=(e\d+)\]/u.exec(line ?? "");
    if (!match) throw new Error(`No ref for ${name}: ${snapshot.snapshot}`);
    return match[1];
  };
  const read = await call("browser_read");
  expect(read, JSON.stringify(read)).toMatchObject({ ok: true });
  expect(String(read.text)).toContain("The footer says hello");

  const click = await call("browser_click", { ref: ref("Change") });
  expect(click, JSON.stringify(click)).toMatchObject({ ok: true });
  const waited = await call("browser_wait", { text: "Changed", timeoutMs: 4000 });
  expect(waited, JSON.stringify(waited)).toMatchObject({ matched: true });

  const typed = await call("browser_type", { ref: ref("Note"), text: "hello" });
  expect(typed, JSON.stringify(typed)).toMatchObject({ ok: true });
  expect(await evaluateIn<string>(app, tabId, "document.querySelector('#note').value")).toBe("hello");

  const scrolled = await call("browser_scroll", { direction: "down", amount: 700 });
  expect(scrolled, JSON.stringify(scrolled)).toMatchObject({ ok: true });
  expect(await evaluateIn<number>(app, tabId, "window.scrollY")).toBeGreaterThan(300);
  const bottom = await call("browser_scroll", { direction: "bottom" });
  expect(bottom, JSON.stringify(bottom)).toMatchObject({ ok: true });

  const shot = (await call("browser_screenshot")) as Reply & {
    data: string;
    bytes: number;
  };
  expect(shot, JSON.stringify(shot).slice(0, 200)).toMatchObject({ ok: true });
  const size = pngSize(shot.data);
  expect(size?.width ?? 0).toBeGreaterThan(300);
  expect(size?.height ?? 0).toBeGreaterThan(200);
  // A frame that never rendered is a blank sheet: far smaller than the page.
  if (reference)
    expect(shot.bytes).toBeGreaterThan(reference.screenshotBytes * 0.5);

  for (const [tool, ms] of Object.entries(timings))
    expect(ms, `${tool} took ${ms}ms`).toBeLessThan(TOOL_BUDGET_MS);
  return { screenshotBytes: shot.bytes };
}

async function fixture() {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(PAGE);
  });
  const origin = await listen(server);
  const app = await launchBrokerApp({ origin });
  return {
    origin,
    app,
    async dispose() {
      await app.dispose();
      await closeServer(server);
    },
  };
}

/** What the person sees today, to compare with after the agent worked. */
const personView = async (app: BrokerApp) =>
  (await app.listTabs()).map(({ id, attached, visible, bounds }) => ({
    id,
    attached,
    visible,
    bounds,
  }));

test("real Electron background: an agent's tab that was never shown, shown then hidden, or behind the person's tab works and never changes what the person sees", async () => {
  test.setTimeout(180_000);
  const run = await fixture();
  try {
    const { app, origin } = run;
    // The person's own tab: attached and visible.
    const person = await app.createTab(origin, "visible");
    // A reference screenshot of the page while it is on screen.
    const reference = await app.agent(taskFor("0"), person.id, [origin]);
    const baseline = await useEveryTool(app, reference.client, person.id, origin);
    await app.request("agent-revoke", { grantId: reference.grant?.id });

    const cases = [
      // The dock never mounted this tab: the app made it for the agent only.
      { name: "never shown", tab: await app.createTab(origin, "never"), letter: "a" },
      // The person's tab is shown instead: the agent's tab is attached but hidden.
      { name: "hidden behind the person's tab", tab: await app.createTab(origin, "hidden"), letter: "b" },
    ];
    // Shown once, then the dock closed: the page keeps its size, detached.
    const closedDock = await app.createTab(origin, "never");
    cases.push({ name: "dock closed", tab: closedDock, letter: "c" });

    for (const { name, tab, letter } of cases) {
      if (name === "dock closed") {
        // The dock showed it, then closed.
        await app.attach(tab.id, true);
        await app.attach(person.id, true);
        await app.detach(tab.id);
      }
      const before = await personView(app);
      const agent = await app.agent(taskFor(letter), tab.id, [origin]);
      await test.step(name, async () => {
        await useEveryTool(app, agent.client, tab.id, origin, baseline);
      });
      expect(await personView(app), name).toEqual(before);
      expect(await visibleTabs(app), name).toEqual([person.id]);
      await app.request("agent-revoke", { grantId: agent.grant?.id });
    }
  } finally {
    await run.dispose();
  }
});

for (const state of ["hidden", "minimized"] as const) {
  test(`real Electron background: with the Colony window ${state}, an agent still reads, clicks, types, scrolls and takes a screenshot`, async () => {
    test.setTimeout(180_000);
    const run = await fixture();
    try {
      const { app, origin } = run;
      const person = await app.createTab(origin, "visible");
      const mine = await app.createTab(origin, "hidden");
      const agent = await app.agent(taskFor("d"), mine.id, [origin]);
      await app.windowState(state);
      const before = await personView(app);
      await useEveryTool(app, agent.client, mine.id, origin);
      expect(await personView(app)).toEqual(before);
      expect(await visibleTabs(app)).toEqual([person.id]);
      await app.windowState("shown");
    } finally {
      await run.dispose();
    }
  });
}

test("real Electron background: two agents work in two tabs at the same time, in the same channel and in different channels", async () => {
  test.setTimeout(180_000);
  const run = await fixture();
  try {
    const { app, origin } = run;
    const person = await app.createTab(origin, "visible");
    const tabs = [
      await app.createTab(origin, "never"),
      await app.createTab(origin, "hidden"),
      await app.createTab(origin, "never"),
      await app.createTab(origin, "hidden"),
    ];
    const other = "22222222-2222-4222-8222-222222222222";
    // Scout in two channels and Sage in one of them, all at once.
    const agents = [
      await app.agent(taskFor("e"), tabs[0].id, [origin]),
      await app.agent(taskFor("f"), tabs[1].id, [origin]),
      await app.agent(taskFor("e", other), tabs[2].id, [origin]),
    ];
    // A fourth agent is busy waiting on its own page the whole time.
    const waiter = await app.agent(taskFor("9"), tabs[3].id, [origin]);
    await waiter.client.callTool("browser_navigate", {
      tab: tabs[3].id,
      url: origin,
    });
    const before = await personView(app);
    let waiterDone = false;
    const waiting = waiter.client
      .callTool("browser_wait", {
        tab: tabs[3].id,
        text: "never appears",
        timeoutMs: 6000,
      })
      .then((reply) => {
        waiterDone = true;
        return reply;
      });
    await Promise.all(
      agents.map((agent, index) =>
        useEveryTool(app, agent.client, tabs[index].id, origin),
      ),
    );
    // Nobody queued behind the waiting agent or behind the visible tab.
    expect(waiterDone).toBe(false);
    expect(await waiting).toMatchObject({ ok: true, timedOut: true });
    expect(await personView(app)).toEqual(before);
    expect(await visibleTabs(app)).toEqual([person.id]);
    // Both of Scout's grants are still alive.
    const grants = await app.request<{ taskId: string }[]>("agent-grants");
    expect(grants.map((grant) => grant.taskId).sort()).toEqual(
      [
        taskFor("e").taskId,
        taskFor("e", other).taskId,
        taskFor("f").taskId,
        taskFor("9").taskId,
      ].sort(),
    );
  } finally {
    await run.dispose();
  }
});
