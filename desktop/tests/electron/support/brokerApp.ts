import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, type Page } from "@playwright/test";
import { createBrokerClient } from "../../../electron/browser-broker/broker-client.mjs";
import type { BrowserTabState } from "../../../src/shared/api/browserHost";

/**
 * The real host and broker in a fixture Electron app, driven the way the
 * packaged app is: tabs are made and shown by the app window (`colonyBrowserHost`),
 * an agent connects over the broker socket with a task credential.
 */

export type TaskContext = {
  agentId: string;
  taskId: string;
  communityOrigin: string;
};

export const COMMUNITY = "https://fixture-relay.example";
export const BUSINESS = "fixture-business";

export const taskFor = (
  letter: string,
  channel = "11111111-1111-4111-8111-111111111111",
): TaskContext => ({
  agentId: letter.repeat(64),
  taskId: `conversation:${channel}`,
  communityOrigin: COMMUNITY,
});

export function listen(server: Server) {
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

export const closeServer = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

export const BOUNDS = { x: 0, y: 50, width: 900, height: 620 };

export async function launchBrokerApp(options: {
  origin: string;
  defaultAccess?: boolean;
  extraOrigins?: string[];
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-broker-app-"));
  const application = await electron.launch({
    args: [path.resolve(import.meta.dirname, "../fixtures/browser-broker.mjs")],
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      DISPLAY: process.env.DISPLAY,
      XAUTHORITY: process.env.XAUTHORITY,
      HOME: dir,
      COLONY_NEST_MIGRATION: "0",
      COLONY_BROWSER_AGENT: "1",
      COLONY_BROWSER_FIXTURE_DEFAULT_ACCESS: options.defaultAccess ? "1" : "0",
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
  const clients: ReturnType<typeof createBrokerClient>[] = [];

  const hostCall = <T>(action: string, ...args: unknown[]) =>
    page.evaluate(
      async ({ action, args }) => {
        const host = window.colonyBrowserHost as unknown as Record<
          string,
          (...a: unknown[]) => Promise<unknown>
        >;
        return host[action](...args);
      },
      { action, args },
    ) as Promise<T>;
  const request = <T>(action: string, payload: object = {}) =>
    page.evaluate(
      async ({ action, payload }) =>
        (
          window.colonyBrowserBroker as unknown as {
            request(action: string, payload: object): Promise<unknown>;
          }
        ).request(action, payload),
      { action, payload },
    ) as Promise<T>;

  return {
    application,
    page,
    request,
    /** A tab the app made. Shown (attached and visible) only when asked. */
    async createTab(
      url: string,
      show: "visible" | "hidden" | "never" = "never",
    ) {
      const tab = await hostCall<BrowserTabState>("createTab", {
        businessId: BUSINESS,
        url,
      });
      if (show !== "never")
        await hostCall("attach", tab.id, BOUNDS, show === "visible");
      return tab;
    },
    attach: (id: string, visible: boolean) =>
      hostCall<BrowserTabState>("attach", id, BOUNDS, visible),
    detach: (id: string) => hostCall<BrowserTabState>("detach", id),
    listTabs: () => hostCall<BrowserTabState[]>("listTabs"),
    hostCall,
    /** The person (not an agent) acts in a tab: a real mouse press and a key. */
    async personActs(tabId: string) {
      await application.evaluate(async (_electron, id) => {
        const fixture = (
          globalThis as unknown as {
            colonyBrowserFixture: {
              browser: {
                agentAdapter: {
                  webContents(id: string): {
                    sendInputEvent(event: object): void;
                  };
                };
              };
            };
          }
        ).colonyBrowserFixture;
        const contents = fixture.browser.agentAdapter.webContents(id);
        contents.sendInputEvent({
          type: "mouseDown",
          x: 10,
          y: 10,
          button: "left",
          clickCount: 1,
        });
        contents.sendInputEvent({
          type: "mouseUp",
          x: 10,
          y: 10,
          button: "left",
          clickCount: 1,
        });
      }, tabId);
    },
    /** Hide, minimize or restore the Colony window itself. */
    async windowState(state: "hidden" | "minimized" | "shown") {
      await application.evaluate(({ BrowserWindow }, state) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (state === "hidden") window.hide();
        else if (state === "minimized") window.minimize();
        else {
          if (window.isMinimized()) window.restore();
          window.showInactive();
        }
      }, state);
      await page.waitForTimeout(400);
    },
    /** Grant the task its tab the way the app does, then connect as the agent. */
    async agent(
      context: TaskContext,
      tabId: string | null,
      origins: string[] = [],
      defaultAccess = false,
    ) {
      const grant = tabId
        ? await request<{ id: string }>("agent-grant", {
            ...context,
            businessId: BUSINESS,
            tabId,
            allowedOrigins: origins,
            defaultAccess,
          })
        : null;
      const credential = await application.evaluate(
        (_electron, context) =>
          (
            globalThis as unknown as {
              colonyBrowserFixture: {
                credential(context: TaskContext): {
                  socketPath: string;
                  secret: string;
                };
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
      clients.push(client);
      await expect.poll(() => client.isReady()).toBe(true);
      return { client, grant };
    },
    async dispose() {
      for (const client of clients) client.close();
      await application.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export type BrokerApp = Awaited<ReturnType<typeof launchBrokerApp>>;

/** Width and height of a PNG from its header (base64), or null. */
export function pngSize(base64: string) {
  const bytes = Buffer.from(base64.slice(0, 64), "base64");
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export const visibleTabs = async (app: { listTabs(): Promise<BrowserTabState[]> }) =>
  (await app.listTabs())
    .filter((tab) => tab.attached && tab.visible)
    .map((tab) => tab.id);

export type { Page };
