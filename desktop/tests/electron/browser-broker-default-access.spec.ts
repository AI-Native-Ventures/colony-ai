import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type Page,
} from "@playwright/test";
import { createBrokerClient } from "../../electron/browser-broker/broker-client.mjs";

type Shown = {
  key: string;
  hostId: string | null;
  url: string;
  error: string | null;
  notices: string[];
  /** The Allow cards the person would see for this page. */
  requestedSites: string[];
  grantedSites: string[];
};

declare global {
  interface Window {
    colonyDefaultAccessFixture: {
      events(): { source: string; type: string; detail: string }[];
      pages(): Shown[];
      controlOwners(): Promise<Record<string, string>>;
    };
  }
}

const channelId = "11111111-1111-4111-8111-111111111111";
const context = {
  agentId: "a".repeat(64),
  taskId: `conversation:${channelId}`,
  communityOrigin: "https://fixture-relay.example",
};

function listen(server: Server) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        reject(new Error("Fixture server failed"));
      else resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

/**
 * Default access in real Electron: the real host, the real broker and the real
 * renderer store, access module and control store. Nothing is open and nothing
 * is granted when the agent makes its first call. The app opens the page and
 * grants it, and the person is only watching: no approval card, no blocked
 * notice and no error page for what the agent itself asked for.
 */
async function launch(options: { origin: string; extraOrigins?: string[] }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-default-access-"));
  const application = await electron.launch({
    args: [path.resolve(import.meta.dirname, "fixtures/browser-broker.mjs")],
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      DISPLAY: process.env.DISPLAY,
      XAUTHORITY: process.env.XAUTHORITY,
      HOME: dir,
      COLONY_NEST_MIGRATION: "0",
      COLONY_BROWSER_AGENT: "1",
      COLONY_BROWSER_FIXTURE_DEFAULT_ACCESS: "1",
      COLONY_BROWSER_FIXTURE_URL: options.origin,
      COLONY_BROWSER_FIXTURE_EXTRA_ORIGINS: (options.extraOrigins ?? []).join(
        ",",
      ),
      COLONY_ELECTRON_USER_DATA: dir,
    },
    timeout: 30_000,
  });
  const page = await application.firstWindow();
  await page.waitForLoadState();
  const renderer = await build({
    stdin: {
      contents: `
        import * as React from "react";
        import { createRoot } from "react-dom/client";
        import { BrowserViewport } from "./src/features/workarea/browser/BrowserViewport";
        import { startAgentBrowserAccess } from "./src/features/workarea/browser/agentBrowserAccess";
        import { browserPageKeyOf } from "./src/features/workarea/browser/browserTabId";
        import { createBrowserControlStore } from "./src/features/workarea/browser/browserControlStore";
        import { getBrowserNotices, getBrowserPage, initBrowserTabsStore,
          setBrowserHostForTests, subscribeBrowserTabs } from "./src/features/workarea/browser/browserTabsStore";
        import { getWorkAreaState, initWorkAreaStore, subscribeWorkArea } from "./src/features/workarea/dock/workAreaStore";
        const host = { ...window.colonyBrowserHost };
        setBrowserHostForTests(host);
        initWorkAreaStore("fixture-business");
        initBrowserTabsStore("fixture-business");
        const events = [];
        const note = (source, event) => events.push({ source, type: event.type, detail: JSON.stringify(event) });
        window.colonyBrowserBroker.onEvent((event) => note("broker", event));
        host.onEvent((event) => note("host", event));
        startAgentBrowserAccess({
          businessId: "fixture-business",
          communityOrigin: ${JSON.stringify(context.communityOrigin)},
        });
        // Show every browser page the dock holds, with the same person
        // controls the work area gives it.
        const mounted = new Map();
        const controls = new Map();
        function sync() {
          const state = getWorkAreaState(${JSON.stringify(channelId)});
          for (const tab of state.tabs) {
            if (tab.kind !== "browser" || mounted.has(tab.id)) continue;
            const key = browserPageKeyOf(tab.id);
            const root = document.createElement("div");
            root.style.cssText = "position:absolute;left:0;top:50px;width:900px;height:620px;display:flex;flex-direction:column";
            document.body.append(root);
            function View() {
              const page = React.useSyncExternalStore(subscribeBrowserTabs, () => getBrowserPage(key));
              return page ? React.createElement(BrowserViewport, { page, active: state.activeTabId === tab.id }) : null;
            }
            createRoot(root).render(React.createElement(View));
            mounted.set(tab.id, key);
          }
        }
        subscribeWorkArea(sync);
        sync();
        function controlsFor(hostId) {
          let store = controls.get(hostId);
          if (!store) {
            store = createBrowserControlStore({
              businessId: "fixture-business",
              tabId: hostId,
              taskId: ${JSON.stringify(context.taskId)},
              communityOrigin: ${JSON.stringify(context.communityOrigin)},
            });
            controls.set(hostId, store);
            void store.start();
          }
          return store.getSnapshot();
        }
        // The work area's controls exist from the moment its page does.
        subscribeBrowserTabs(() => {
          for (const key of mounted.values()) {
            const hostId = getBrowserPage(key)?.hostId;
            if (hostId) controlsFor(hostId);
          }
        });
        window.colonyDefaultAccessFixture = {
          events: () => events,
          pages: () => [...mounted.values()].map((key) => {
            const page = getBrowserPage(key);
            const snapshot = page?.hostId ? controlsFor(page.hostId) : null;
            return {
              key,
              hostId: page?.hostId ?? null,
              url: page?.url ?? "",
              error: page?.error ?? null,
              notices: getBrowserNotices(key).map((notice) => notice.message),
              requestedSites: [...(snapshot?.requestedSites ?? [])],
              grantedSites: [...(snapshot?.grant?.allowedOrigins ?? [])],
            };
          }),
          controlOwners: async () =>
            Object.fromEntries((await host.listTabs()).map((tab) => [tab.id, tab.controlOwner])),
        };
      `,
      resolveDir: path.resolve(import.meta.dirname, "../.."),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    alias: { "@": path.resolve(import.meta.dirname, "../../src") },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.addStyleTag({
    path: path.resolve(
      import.meta.dirname,
      "../../src/shared/styles/globals/colony-work-area-browser.css",
    ),
  });
  await page.addScriptTag({ content: renderer.outputFiles[0].text });
  const credential = await application.evaluate(
    (_electron, context) =>
      (
        globalThis as typeof globalThis & {
          colonyBrowserFixture: {
            credential(context: {
              agentId: string;
              taskId: string;
              communityOrigin: string;
            }): { socketPath: string; secret: string };
          };
        }
      ).colonyBrowserFixture.credential(context),
    context,
  );
  const client = createBrokerClient({
    ...credential,
    agent: context.agentId,
    taskId: context.taskId,
    communityOrigin: context.communityOrigin,
  });
  client.start();
  await expect.poll(() => client.isReady()).toBe(true);
  return {
    page,
    client,
    async dispose() {
      client.close();
      await application.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const shownPages = (page: Page) =>
  page.evaluate(() => window.colonyDefaultAccessFixture.pages());
const personSaw = (page: Page) =>
  page.evaluate(() =>
    window.colonyDefaultAccessFixture
      .events()
      .filter((event) =>
        [
          "origin-approval-requested",
          "navigation-blocked",
          "confirmation-requested",
        ].includes(event.type),
      )
      .map((event) => event.type),
  );

test("real Electron default access: an agent's own site opens with no approval card and no error", async () => {
  test.setTimeout(120_000);
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/next") {
      response.end("<!doctype html><title>Next page</title><p>Next</p>");
      return;
    }
    response.end(`<!doctype html><title>Colony fixture home</title><body>
      <h1>Home</h1><a href="/next">Next page</a>
      <iframe src="/next" title="Frame"></iframe>
    </body>`);
  });
  const origin = await listen(server);
  const run = await launch({ origin });
  try {
    // Nothing is open and nothing is granted: this is the first call.
    expect(await shownPages(run.page)).toEqual([]);

    const opened = await run.client.callTool("browser_open", { url: origin });
    expect(opened.ok).toBe(true);
    expect(opened.tab.url).toBe(`${origin}/`);

    // The panel is the one the app opened, on the page the agent works in.
    await expect.poll(async () => (await shownPages(run.page)).length).toBe(1);
    const [shown] = await shownPages(run.page);
    expect(shown.hostId).toBe(opened.tab.id);
    await expect
      .poll(() =>
        run.page.evaluate(
          async (id) =>
            (await window.colonyDefaultAccessFixture.controlOwners())[id],
          opened.tab.id,
        ),
      )
      .toBe("agent");

    // The agent reads what it opened, then follows a link on the same site.
    const snapshot = await run.client.callTool("browser_snapshot", {
      tab: opened.tab.id,
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.snapshot).toContain("Home");
    const next = await run.client.callTool("browser_navigate", {
      tab: opened.tab.id,
      url: `${origin}/next`,
    });
    expect(next.ok).toBe(true);

    // The person sees no card, no blocked notice and no error.
    await run.page.waitForTimeout(500);
    expect(await personSaw(run.page)).toEqual([]);
    expect(await shownPages(run.page)).toEqual([
      expect.objectContaining({
        hostId: opened.tab.id,
        url: `${origin}/next`,
        error: null,
        notices: [],
        requestedSites: [],
      }),
    ]);
  } finally {
    await run.dispose();
    await close(server);
  }
});

test("real Electron default access: a site the agent opened that sends the browser to another origin shows no error page, and the card goes once the agent follows", async () => {
  test.setTimeout(120_000);
  const target = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>Moved here</title><p>Moved</p>");
  });
  const targetOrigin = await listen(target);
  const server = createServer((request, response) => {
    if (request.url === "/old") {
      response.writeHead(302, { location: `${targetOrigin}/` });
      response.end();
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>Start</title><p>Start</p>");
  });
  const origin = await listen(server);
  const run = await launch({ origin, extraOrigins: [targetOrigin] });
  try {
    // The site sends the browser to an origin the agent did not ask for.
    const first = await run.client.callTool("browser_open", {
      url: `${origin}/old`,
    });
    expect(first.ok).toBe(false);
    expect(first.code).toBe("origin_approval_required");
    await expect.poll(async () => (await shownPages(run.page)).length).toBe(1);
    await expect
      .poll(async () => (await shownPages(run.page))[0].requestedSites)
      .toEqual([targetOrigin]);

    // The page is still the page it was: a notice, never an error page.
    const [held] = await shownPages(run.page);
    expect(held.error).toBeNull();
    expect(held.notices).toEqual(["This task has no approval for that site."]);

    // The agent asks for that origin itself. The broker approves it, and the
    // card for it has nothing left to ask.
    const followed = await run.client.callTool("browser_navigate", {
      tab: held.hostId,
      url: targetOrigin,
    });
    expect(followed.ok).toBe(true);
    await expect
      .poll(async () => (await shownPages(run.page))[0].grantedSites)
      .toContain(targetOrigin);
    await expect
      .poll(async () => (await shownPages(run.page))[0].requestedSites)
      .toEqual([]);
    const [after] = await shownPages(run.page);
    expect(after.error).toBeNull();
    expect(after.url).toBe(`${targetOrigin}/`);
  } finally {
    await run.dispose();
    await close(server);
    await close(target);
  }
});
