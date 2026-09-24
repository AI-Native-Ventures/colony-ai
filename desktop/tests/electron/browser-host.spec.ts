import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import type {
  BrowserHostApi,
  BrowserTabBounds,
} from "../../src/shared/api/browserHost";
import {
  finishElectronTest,
  createUserDataDir,
  launchElectron,
  type RunningElectron,
} from "./helpers";

async function startProbeServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const cookieValue = requestUrl.searchParams.get("cookie");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<meta charset="utf-8">
<title>pending</title>
<script>
  if (${JSON.stringify(cookieValue)}) {
    document.cookie = "scope_cookie=" + ${JSON.stringify(cookieValue)} + "; Path=/; SameSite=Lax";
  }
  document.title = JSON.stringify({
    cookie: document.cookie,
    tauri: typeof window.__TAURI_INTERNALS__,
    desktopBridge: typeof window.colonyDesktop,
    browserBridge: typeof window.colonyBrowserHost
  });
</script>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Probe server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}/probe` };
}

async function waitForTitle(
  running: RunningElectron,
  tabId: string,
): Promise<{
  cookie: string;
  tauri: string;
  desktopBridge: string;
  browserBridge: string;
}> {
  await expect
    .poll(async () => {
      const tab = await running.page.evaluate(async (id) => {
        const host = (window as Window & { colonyBrowserHost?: BrowserHostApi })
          .colonyBrowserHost;
        return (
          (await host?.listTabs())?.find((entry) => entry.id === id) ?? null
        );
      }, tabId);
      if (!tab || tab.title === "pending" || !tab.title) return null;
      try {
        return JSON.parse(tab.title) as {
          cookie: string;
          tauri: string;
          desktopBridge: string;
          browserBridge: string;
        };
      } catch {
        return null;
      }
    })
    .not.toBeNull();
  const value = await running.page.evaluate(async (id) => {
    const host = (window as Window & { colonyBrowserHost?: BrowserHostApi })
      .colonyBrowserHost;
    const tab = (await host?.listTabs())?.find((entry) => entry.id === id);
    return tab?.title ?? "";
  }, tabId);
  return JSON.parse(value) as {
    cookie: string;
    tauri: string;
    desktopBridge: string;
    browserBridge: string;
  };
}

async function createProbeTabAndWait(
  running: RunningElectron,
  probeUrl: string,
  bounds: BrowserTabBounds,
  options: { businessId: string; clientId?: string; cookie?: string },
) {
  const url = new URL(probeUrl);
  if (options.cookie) url.searchParams.set("cookie", options.cookie);
  const tabId = await running.page.evaluate(
    async ({ businessId, clientId, url: pageUrl, viewBounds }) => {
      const host = (window as Window & { colonyBrowserHost?: BrowserHostApi })
        .colonyBrowserHost;
      if (!host) throw new Error("Browser host preload is missing");
      const tab = await host.createTab({
        businessId,
        clientId,
        url: pageUrl,
      });
      await host.attach(tab.id, viewBounds, true);
      return tab.id;
    },
    {
      businessId: options.businessId,
      clientId: options.clientId,
      url: url.href,
      viewBounds: bounds,
    },
  );
  return waitForTitle(running, tabId);
}

test("embedded browser isolates business and client profiles without exposing the desktop bridge", async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "Electron uses the Chromium engine");
  const userDataDir = createUserDataDir(testInfo);
  const applications: RunningElectron[] = [];
  let probe: Awaited<ReturnType<typeof startProbeServer>> | undefined;
  try {
    probe = await startProbeServer();
    const running = await launchElectron(userDataDir, "ws://127.0.0.1:1");
    applications.push(running);
    const bounds: BrowserTabBounds = { x: 0, y: 0, width: 960, height: 620 };
    const businessA = await createProbeTabAndWait(running, probe.url, bounds, {
      businessId: "business-a",
      cookie: "business-a",
    });
    const businessB = await createProbeTabAndWait(running, probe.url, bounds, {
      businessId: "business-b",
    });
    const clientA = await createProbeTabAndWait(running, probe.url, bounds, {
      businessId: "business-a",
      clientId: "client-a",
      cookie: "client-a",
    });
    const clientB = await createProbeTabAndWait(running, probe.url, bounds, {
      businessId: "business-a",
      clientId: "client-b",
    });
    const reopenedClientA = await createProbeTabAndWait(
      running,
      probe.url,
      bounds,
      { businessId: "business-a", clientId: "client-a" },
    );

    expect(businessA.cookie).toContain("scope_cookie=business-a");
    expect(businessB.cookie).not.toContain("scope_cookie=business-a");
    expect(clientA.cookie).toContain("scope_cookie=client-a");
    expect(clientA.cookie).not.toContain("scope_cookie=business-a");
    expect(clientB.cookie).not.toContain("scope_cookie=client-a");
    expect(clientB.cookie).not.toContain("scope_cookie=business-a");
    expect(reopenedClientA.cookie).toContain("scope_cookie=client-a");
    expect(reopenedClientA.cookie).not.toContain("scope_cookie=business-a");
    for (const result of [
      businessA,
      businessB,
      clientA,
      clientB,
      reopenedClientA,
    ]) {
      expect(result.tauri).toBe("undefined");
      expect(result.desktopBridge).toBe("undefined");
      expect(result.browserBridge).toBe("undefined");
    }
  } finally {
    await finishElectronTest(testInfo, userDataDir, applications);
    if (probe)
      await new Promise<void>((resolve) =>
        probe?.server.close(() => resolve()),
      );
  }
});
