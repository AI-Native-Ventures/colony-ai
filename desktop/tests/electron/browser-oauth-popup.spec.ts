import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";

type HostTab = { id: string; controlOwner?: string };
type FixtureContents = {
  executeJavaScript<T = unknown>(
    script: string,
    userGesture?: boolean,
  ): Promise<T>;
  getTitle(): string;
  isDestroyed(): boolean;
};
type PopupSnapshot = {
  closed: boolean;
  nativeDestroyed: boolean;
  webContentsDestroyed: boolean;
  visible: boolean;
  bounds: { width: number; height: number } | null;
  parented: boolean;
};
type BrowserOAuthFixtureState = {
  host: {
    handleRequest(
      owner: unknown,
      sender: unknown,
      action: string,
      payload: Record<string, unknown>,
    ): Promise<HostTab>;
    agentAdapter: {
      getTab(tabId: string): HostTab | undefined;
      webContents(tabId: string): FixtureContents | undefined;
      setControlOwner(tabId: string, owner: "human" | "agent"): void;
      setNavigationGate(
        callback: (
          tabId: string,
          url: string,
        ) => {
          allow: boolean;
          code?: string;
        },
      ): void;
    };
  };
  ownerWindow: { webContents: unknown };
  ready: boolean;
  popupSnapshot(): PopupSnapshot[];
  sendPopupKeyInput(): void;
  closePopups(): void;
  closeWindows(): void;
  quit(): void;
  humanInputTabs(): string[];
  popupPageFlags(): Promise<{
    opener: boolean;
    sharedCookie: boolean;
    uaHasElectron: boolean;
    uaHasColony: boolean;
    chromeVersion: string;
  } | null>;
};

declare global {
  var __c3BrowserOAuth: BrowserOAuthFixtureState | undefined;
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("OAuth fixture server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startFixtureSites() {
  const provider = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><meta charset="utf-8"><title>provider</title>
<script>
  const openerOrigin = new URL(location.href).searchParams.get("opener") || "";
  document.documentElement.dataset.opener = window.opener ? "yes" : "no";
  document.documentElement.dataset.sharedCookie = document.cookie.includes("fixture_oauth_session=present") ? "yes" : "no";
  document.documentElement.dataset.uaHasElectron = /electron/i.test(navigator.userAgent) ? "yes" : "no";
  document.documentElement.dataset.uaHasColony = /colony/i.test(navigator.userAgent) ? "yes" : "no";
  document.documentElement.dataset.chromeVersion = /Chrome\\/([\\d.]+)/.exec(navigator.userAgent)?.[1] || "";
  window.opener?.postMessage({ type: "oauth-fixture", token: "local-fixture-token" }, openerOrigin);
  setTimeout(() => window.close(), 2500);
</script>`);
  });
  const providerOrigin = await listen(provider);
  const providerUrl = `${providerOrigin}/provider`;

  const parent = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": "fixture_oauth_session=present; Path=/; SameSite=Lax",
    });
    response.end(`<!doctype html><meta charset="utf-8"><title>oauth-parent-ready</title>
<button id="continue">Continue with Google</button>
<script>
  const providerUrl = ${JSON.stringify(providerUrl)};
  const expectedProviderOrigin = ${JSON.stringify(providerOrigin)};
  let popup = null;
  window.addEventListener("message", (event) => {
    if (event.origin !== expectedProviderOrigin) return;
    document.documentElement.dataset.oauthResult = event.data?.type === "oauth-fixture" && event.data?.token === "local-fixture-token" ? "received" : "invalid";
    document.title = document.documentElement.dataset.oauthResult === "received" ? "oauth-token-received" : "oauth-token-invalid";
  });
  document.getElementById("continue").addEventListener("click", () => {
    const target = new URL(providerUrl);
    target.searchParams.set("opener", location.origin);
    popup = window.open(target.href, "oauth-provider", "popup,width=420,height=540");
    document.documentElement.dataset.popupReturned = popup ? "yes" : "no";
  });
</script>`);
  });
  const parentOrigin = await listen(parent);

  const userAgent = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><meta charset="utf-8"><title>user-agent</title>
<script>
  const ua = navigator.userAgent;
  document.documentElement.dataset.hasElectron = /electron/i.test(ua) ? "yes" : "no";
  document.documentElement.dataset.hasColony = /colony/i.test(ua) ? "yes" : "no";
  document.documentElement.dataset.chromeVersion = /Chrome\\/([\\d.]+)/.exec(ua)?.[1] || "";
</script>`);
  });
  const userAgentOrigin = await listen(userAgent);

  return {
    parent,
    provider,
    userAgent,
    parentUrl: `${parentOrigin}/oauth`,
    userAgentUrl: `${userAgentOrigin}/user-agent`,
    providerOrigin,
  };
}

function makeThrowawayHome() {
  const rootPath = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
  const root = mkdtempSync(path.join(rootPath, "colony-c3-browser-oauth-"));
  return { root };
}

async function launchFixture(home: string): Promise<ElectronApplication> {
  const desktopRoot = path.resolve(import.meta.dirname, "../..");
  const application = await electron.launch({
    cwd: desktopRoot,
    args: [
      "--use-mock-keychain",
      "--password-store=basic",
      path.join(desktopRoot, "tests/electron/browser-oauth-popup-main.mjs"),
    ],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
    },
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      application.evaluate(() => globalThis.__c3BrowserOAuth?.ready ?? false),
    )
    .toBe(true);
  return application;
}

async function createTab(
  application: ElectronApplication,
  url: string,
  businessId = "oauth-fixture-business",
) {
  return application.evaluate(
    async (_electron, { url, businessId }) => {
      const state = globalThis.__c3BrowserOAuth;
      if (!state) throw new Error("OAuth browser fixture did not initialize");
      const tab = await state.host.handleRequest(
        state.ownerWindow,
        state.ownerWindow.webContents,
        "create",
        { businessId, url },
      );
      await state.host.handleRequest(
        state.ownerWindow,
        state.ownerWindow.webContents,
        "attach",
        {
          tabId: tab.id,
          bounds: { x: 0, y: 0, width: 960, height: 660 },
          visible: true,
        },
      );
      return tab.id;
    },
    { url, businessId },
  );
}

async function evaluateTab<T>(
  application: ElectronApplication,
  tabId: string,
  script: string,
  userGesture = false,
): Promise<T> {
  return application.evaluate(
    (_electron, { tabId, script, userGesture }) => {
      const contents =
        globalThis.__c3BrowserOAuth?.host.agentAdapter.webContents(tabId);
      if (!contents || contents.isDestroyed())
        throw new Error("OAuth fixture tab is unavailable");
      return contents.executeJavaScript(script, userGesture) as Promise<T>;
    },
    { tabId, script, userGesture },
  );
}

async function clickFixtureButton(
  application: ElectronApplication,
  tabId: string,
) {
  // Electron's explicit userGesture flag gives Chromium the same transient
  // activation as a person clicking the Continue button.
  await evaluateTab<void>(
    application,
    tabId,
    'document.getElementById("continue").click()',
    true,
  );
}

async function closeFixtureApplication(
  application: ElectronApplication | undefined,
) {
  if (!application) return;
  const child = application.process();
  await application.evaluate(() => {
    const state = globalThis.__c3BrowserOAuth;
    state?.closeWindows();
    state?.quit();
  });
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  const forceExit = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, 5_000);
  child.kill("SIGTERM");
  await exit;
  clearTimeout(forceExit);
}

test("a human Google-style popup returns its token to the opener and closes", async () => {
  const { root } = makeThrowawayHome();
  const fixture = await startFixtureSites();
  let application: ElectronApplication | undefined;
  try {
    const app = await launchFixture(root);
    application = app;
    const tabId = await createTab(app, fixture.parentUrl);
    await clickFixtureButton(app, tabId);
    await expect
      .poll(() =>
        evaluateTab<string>(
          app,
          tabId,
          'document.documentElement.dataset.popupReturned || ""',
        ),
      )
      .not.toBe("");

    await expect
      .poll(() => evaluateTab<string>(app, tabId, "document.title"))
      .toBe("oauth-token-received");
    await expect
      .poll(() =>
        app.evaluate(() => globalThis.__c3BrowserOAuth?.popupSnapshot() ?? []),
      )
      .toHaveLength(1);

    const popup = (await app.evaluate(
      () => globalThis.__c3BrowserOAuth?.popupSnapshot()[0] ?? null,
    )) as PopupSnapshot | null;
    expect(popup?.visible).toBe(true);
    expect(popup?.parented).toBe(true);
    expect(popup?.bounds?.width).toBeGreaterThanOrEqual(420);
    expect(popup?.bounds?.height).toBeGreaterThanOrEqual(540);

    const providerFlags = (await app.evaluate(
      () => globalThis.__c3BrowserOAuth?.popupPageFlags() ?? null,
    )) as {
      opener: boolean;
      sharedCookie: boolean;
      uaHasElectron: boolean;
      uaHasColony: boolean;
      chromeVersion: string;
    } | null;
    expect(providerFlags).toMatchObject({
      opener: true,
      sharedCookie: true,
      uaHasElectron: false,
      uaHasColony: false,
    });
    expect(providerFlags?.chromeVersion).toBe(
      await app.evaluate(() => process.versions.chrome),
    );

    await expect
      .poll(() =>
        app.evaluate(
          () => globalThis.__c3BrowserOAuth?.popupSnapshot()[0] ?? null,
        ),
      )
      .toMatchObject({ closed: true });
  } finally {
    await closeFixtureApplication(application);
    await Promise.all([
      closeServer(fixture.parent),
      closeServer(fixture.provider),
      closeServer(fixture.userAgent),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a web tab uses Chrome's bundled Chromium UA without changing the app window", async () => {
  const { root } = makeThrowawayHome();
  const fixture = await startFixtureSites();
  let application: ElectronApplication | undefined;
  try {
    const app = await launchFixture(root);
    application = app;
    const appUserAgentBefore = await app.evaluate(async () => {
      const state = globalThis.__c3BrowserOAuth;
      if (!state) throw new Error("OAuth browser fixture did not initialize");
      const webContents = (
        state.ownerWindow as unknown as {
          webContents: {
            getUserAgent(): string;
            executeJavaScript(script: string): Promise<string>;
          };
        }
      ).webContents;
      return {
        main: webContents.getUserAgent(),
        renderer: await webContents.executeJavaScript("navigator.userAgent"),
      };
    });
    const chromiumVersion = await app.evaluate(() => process.versions.chrome);
    const tabId = await createTab(app, fixture.userAgentUrl);
    const pageFlags = await evaluateTab<{
      hasElectron: boolean;
      hasColony: boolean;
      chromeVersion: string;
    }>(
      app,
      tabId,
      `({
        hasElectron: document.documentElement.dataset.hasElectron === "yes",
        hasColony: document.documentElement.dataset.hasColony === "yes",
        chromeVersion: document.documentElement.dataset.chromeVersion
      })`,
    );

    expect(pageFlags.hasElectron).toBe(false);
    expect(pageFlags.hasColony).toBe(false);
    expect(pageFlags.chromeVersion).toBe(chromiumVersion);
    const appUserAgentAfter = await app.evaluate(async () => {
      const state = globalThis.__c3BrowserOAuth;
      if (!state) throw new Error("OAuth browser fixture did not initialize");
      const webContents = (
        state.ownerWindow as unknown as {
          webContents: {
            getUserAgent(): string;
            executeJavaScript(script: string): Promise<string>;
          };
        }
      ).webContents;
      return {
        main: webContents.getUserAgent(),
        renderer: await webContents.executeJavaScript("navigator.userAgent"),
      };
    });
    expect(appUserAgentAfter).toStrictEqual(appUserAgentBefore);
  } finally {
    await closeFixtureApplication(application);
    await Promise.all([
      closeServer(fixture.parent),
      closeServer(fixture.provider),
      closeServer(fixture.userAgent),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent popups require the owner-approved destination", async () => {
  const { root } = makeThrowawayHome();
  const fixture = await startFixtureSites();
  let application: ElectronApplication | undefined;
  try {
    const app = await launchFixture(root);
    application = app;
    const tabId = await createTab(app, fixture.parentUrl);
    await app.evaluate((_electron, tabId) => {
      const state = globalThis.__c3BrowserOAuth;
      if (!state) throw new Error("OAuth browser fixture did not initialize");
      state.host.agentAdapter.setNavigationGate((_tabId, _url) => ({
        allow: false,
        code: "origin_approval_required",
      }));
      state.host.agentAdapter.setControlOwner(tabId, "agent");
    }, tabId);

    await clickFixtureButton(app, tabId);
    await expect
      .poll(() =>
        evaluateTab<string>(
          app,
          tabId,
          'document.documentElement.dataset.popupReturned || ""',
        ),
      )
      .toBe("no");
    await expect
      .poll(() =>
        app.evaluate(
          () => globalThis.__c3BrowserOAuth?.popupSnapshot().length ?? 0,
        ),
      )
      .toBe(0);

    await app.evaluate((_electron, providerOrigin) => {
      globalThis.__c3BrowserOAuth?.host.agentAdapter.setNavigationGate(
        (_tabId, url) => ({
          allow: new URL(url).origin === providerOrigin,
          code: "origin_approval_required",
        }),
      );
    }, fixture.providerOrigin);
    await clickFixtureButton(app, tabId);
    await expect
      .poll(() =>
        evaluateTab<string>(
          app,
          tabId,
          'document.documentElement.dataset.popupReturned || ""',
        ),
      )
      .toBe("yes");
    await expect
      .poll(() =>
        app.evaluate(
          () => globalThis.__c3BrowserOAuth?.popupSnapshot().length ?? 0,
        ),
      )
      .toBe(1);
    await app.evaluate(() => globalThis.__c3BrowserOAuth?.sendPopupKeyInput());
    await expect
      .poll(() =>
        app.evaluate(() => globalThis.__c3BrowserOAuth?.humanInputTabs() ?? []),
      )
      .toContain(tabId);
  } finally {
    await closeFixtureApplication(application);
    await Promise.all([
      closeServer(fixture.parent),
      closeServer(fixture.provider),
      closeServer(fixture.userAgent),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});
