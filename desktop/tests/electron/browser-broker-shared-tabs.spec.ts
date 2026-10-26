import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import {
  type BrokerApp,
  closeServer,
  launchBrokerApp,
  listen,
  taskFor,
  visibleTabs,
} from "./support/brokerApp";

/**
 * Owner decision, 26 Oct: "even if I open a tab the agent should be able to
 * find it and control it." By default an AI employee can list every work area
 * tab of its own business, read and control any of them, with no Allow click.
 * What stays: one business only, credential fields blanked, sends and posts
 * still ask, one controller per tab, the person's own use of a tab always wins,
 * and a tab marked private is invisible.
 */

const PAGE = `<!doctype html><title>Colony home</title>
<body>
  <h1>Footer test</h1>
  <button type="button" onclick="document.querySelector('#status').textContent='Changed'">Change</button>
  <p id="status">Ready</p>
  <input id="password" type="password" value="credential-do-not-leak" aria-label="Password">
  <form action="/submit" method="post"><button>Send message</button></form>
  <div style="height:1500px">Scroll target</div>
  <footer>The footer says hello</footer>
</body>`;

type Reply = Record<string, unknown> & { ok: boolean; code?: string };
type TabRow = {
  id: string;
  title: string;
  url: string;
  shown: boolean;
  control: string;
};

async function fixture(options: { defaultAccess?: boolean } = {}) {
  const posts: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === "POST") {
      posts.push(request.url ?? "");
      response.end("Posted");
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(PAGE);
  });
  const origin = await listen(server);
  const app = await launchBrokerApp({
    origin,
    defaultAccess: options.defaultAccess ?? true,
  });
  return {
    app,
    origin,
    posts,
    async dispose() {
      await app.dispose();
      await closeServer(server);
    },
  };
}

const tabsOf = async (agent: {
  client: { callTool(t: string, a: object): Promise<Reply> };
}) =>
  ((await agent.client.callTool("browser_tabs", {})).tabs ?? []) as TabRow[];

/** An agent as the app sets it up: a blank home tab, default access, no sites. */
async function defaultAgent(app: BrokerApp, letter: string, channel?: string) {
  const home = await app.createTab(null, "never");
  const agent = await app.agent(taskFor(letter, channel), home.id, [], true);
  return { ...agent, home };
}

const controllerOf = async (app: BrokerApp, tabId: string) =>
  (await app.listTabs()).find((tab) => tab.id === tabId)?.controlOwner;

test("real Electron shared tabs: an AI employee finds the person's own tab and reads and controls it with no Allow click", async () => {
  test.setTimeout(120_000);
  const run = await fixture();
  try {
    const { app, origin } = run;
    // The person opened colony.global in their own tab and is looking at it.
    const person = await app.createTab(origin, "visible");
    await expect
      .poll(
        async () =>
          (await app.listTabs()).find((t) => t.id === person.id)?.title,
      )
      .toBe("Colony home");
    const scout = await defaultAgent(app, "a");
    const before = await app.listTabs();

    const rows = await tabsOf(scout);
    expect(rows.map((row) => row.id).sort()).toEqual(
      [person.id, scout.home.id].sort(),
    );
    const mine = rows.find((row) => row.id === person.id);
    expect(mine).toMatchObject({
      title: "Colony home",
      shown: true,
      control: "free",
    });
    expect(mine?.url).toBe(`${origin}/`);

    // No grant, no site approval, no click: the footer, straight away.
    const snapshot = (await scout.client.callTool("browser_snapshot", {
      tab: person.id,
    })) as Reply & { snapshot: string };
    expect(snapshot, JSON.stringify(snapshot)).toMatchObject({ ok: true });
    expect(snapshot.snapshot).toContain("Footer test");
    // Credential fields never reach the agent.
    expect(JSON.stringify(snapshot)).not.toContain("credential-do-not-leak");
    const read = await scout.client.callTool("browser_read", {
      tab: person.id,
    });
    expect(String(read.text)).toContain("The footer says hello");
    const scrolled = await scout.client.callTool("browser_scroll", {
      tab: person.id,
      direction: "bottom",
    });
    expect(scrolled).toMatchObject({ ok: true });

    // The tab says who has it, and it is still the page the person sees.
    expect(
      (await tabsOf(scout)).find((row) => row.id === person.id),
    ).toMatchObject({
      control: "you",
      shown: true,
    });
    expect(await controllerOf(app, person.id)).toBe("agent");
    expect(await visibleTabs(app)).toEqual([person.id]);
    expect(
      (await app.listTabs()).map(({ id, attached, visible, bounds }) => ({
        id,
        attached,
        visible,
        bounds,
      })),
    ).toEqual(
      before.map(({ id, attached, visible, bounds }) => ({
        id,
        attached,
        visible,
        bounds,
      })),
    );
    const grants =
      await app.request<{ tabIds: string[]; allowedOrigins: string[] }[]>(
        "agent-grants",
      );
    expect(grants[0].tabIds).toContain(person.id);
    expect(grants[0].allowedOrigins).toContain(origin);
  } finally {
    await run.dispose();
  }
});

test("real Electron shared tabs: a tab marked Keep private is not listed, cannot be used, and is let go if an agent had it", async () => {
  test.setTimeout(120_000);
  const run = await fixture();
  try {
    const { app, origin } = run;
    const person = await app.createTab(origin, "visible");
    const scout = await defaultAgent(app, "a");
    expect(
      await scout.client.callTool("browser_snapshot", { tab: person.id }),
    ).toMatchObject({ ok: true });
    expect(await controllerOf(app, person.id)).toBe("agent");

    await app.setPrivate(person.id, true);
    // Private at once: the agent lets go and cannot see it any more.
    await expect.poll(() => controllerOf(app, person.id)).toBe("human");
    expect((await tabsOf(scout)).map((row) => row.id)).toEqual([scout.home.id]);
    const refused = await scout.client.callTool("browser_snapshot", {
      tab: person.id,
    });
    expect(refused).toMatchObject({ ok: false, code: "not_found" });
    const grants = await app.request<{ tabIds: string[] }[]>("agent-grants");
    expect(grants.flatMap((grant) => grant.tabIds)).not.toContain(person.id);

    // Share again: it comes back.
    await app.setPrivate(person.id, false);
    expect((await tabsOf(scout)).map((row) => row.id)).toContain(person.id);
    expect(
      await scout.client.callTool("browser_snapshot", { tab: person.id }),
    ).toMatchObject({ ok: true });
  } finally {
    await run.dispose();
  }
});

test("real Electron shared tabs: one agent controls a tab at a time, and a tab from another business is never listed or reachable", async () => {
  test.setTimeout(120_000);
  const run = await fixture();
  try {
    const { app, origin } = run;
    const person = await app.createTab(origin, "visible");
    const elsewhere = await app.createTab(origin, "hidden", "another-business");
    const scout = await defaultAgent(app, "a");
    const sage = await defaultAgent(app, "b");
    expect(
      await scout.client.callTool("browser_snapshot", { tab: person.id }),
    ).toMatchObject({ ok: true });

    const sageRows = await tabsOf(sage);
    expect(sageRows.find((row) => row.id === person.id)?.control).toBe(
      "another AI employee",
    );
    expect(sageRows.map((row) => row.id)).not.toContain(elsewhere.id);
    expect(
      await sage.client.callTool("browser_snapshot", { tab: person.id }),
    ).toMatchObject({ ok: false, code: "tab_busy" });
    expect(
      await sage.client.callTool("browser_snapshot", { tab: elsewhere.id }),
    ).toMatchObject({ ok: false, code: "not_found" });
    // Sage did not take it, and the second agent's own tab still works.
    expect(await controllerOf(app, person.id)).toBe("agent");
    expect(
      await scout.client.callTool("browser_read", { tab: person.id }),
    ).toMatchObject({ ok: true });
    expect(await controllerOf(app, elsewhere.id)).toBe("human");
  } finally {
    await run.dispose();
  }
});

test("real Electron shared tabs: when the person uses a tab the agent loses it until it asks again; the agent's own clicks never count as the person", async () => {
  test.setTimeout(150_000);
  const run = await fixture();
  try {
    const { app, origin } = run;
    const person = await app.createTab(origin, "visible");
    const scout = await defaultAgent(app, "a");
    const snapshot = (await scout.client.callTool("browser_snapshot", {
      tab: person.id,
    })) as Reply & { snapshot: string };
    const button = /Change.*\[ref=(e\d+)\]|\[ref=(e\d+)\].*Change/u.exec(
      snapshot.snapshot,
    );
    const ref = button?.[1] ?? button?.[2];
    if (!ref) throw new Error(snapshot.snapshot);

    // The agent clicks, types and scrolls in the page: still its tab.
    expect(
      await scout.client.callTool("browser_click", { tab: person.id, ref }),
    ).toMatchObject({ ok: true });
    expect(
      await scout.client.callTool("browser_scroll", {
        tab: person.id,
        direction: "down",
      }),
    ).toMatchObject({ ok: true });
    await app.page.waitForTimeout(300);
    expect(await controllerOf(app, person.id)).toBe("agent");

    // The person clicks in it.
    await app.personActs(person.id);
    await expect.poll(() => controllerOf(app, person.id)).toBe("human");
    const grants =
      await app.request<{ tabIds: string[]; state: string }[]>("agent-grants");
    expect(grants[0].state).toBe("active");
    expect(grants[0].tabIds).not.toContain(person.id);
    expect(
      (await tabsOf(scout)).find((row) => row.id === person.id)?.control,
    ).toBe("free");

    // No fighting: right after the person's click the agent waits.
    const tooSoon = await scout.client.callTool("browser_read", {
      tab: person.id,
    });
    expect(tooSoon).toMatchObject({ ok: false, code: "person_active" });
    expect(await controllerOf(app, person.id)).toBe("human");

    // A moment later, when it asks again, it has the tab back.
    await app.page.waitForTimeout(4_300);
    expect(
      await scout.client.callTool("browser_read", { tab: person.id }),
    ).toMatchObject({ ok: true });
    expect(await controllerOf(app, person.id)).toBe("agent");
  } finally {
    await run.dispose();
  }
});

test("real Electron shared tabs: sends and posts on the person's tab still ask the person", async () => {
  test.setTimeout(120_000);
  const run = await fixture();
  try {
    const { app, origin, posts } = run;
    const person = await app.createTab(origin, "visible");
    const scout = await defaultAgent(app, "a");
    const snapshot = (await scout.client.callTool("browser_snapshot", {
      tab: person.id,
    })) as Reply & { snapshot: string };
    const send =
      /Send message.*\[ref=(e\d+)\]|\[ref=(e\d+)\].*Send message/u.exec(
        snapshot.snapshot,
      );
    const ref = send?.[1] ?? send?.[2];
    if (!ref) throw new Error(snapshot.snapshot);
    const clicking = scout.client.callTool("browser_click", {
      tab: person.id,
      ref,
    });
    await expect
      .poll(async () => (await app.request<unknown[]>("agent-pending")).length)
      .toBe(1);
    const [pending] =
      await app.request<{ actionId: string }[]>("agent-pending");
    await app.request("agent-reject", { actionId: pending.actionId });
    expect(await clicking).toMatchObject({
      ok: false,
      code: "confirmation_denied",
    });
    expect(posts).toEqual([]);
  } finally {
    await run.dispose();
  }
});
