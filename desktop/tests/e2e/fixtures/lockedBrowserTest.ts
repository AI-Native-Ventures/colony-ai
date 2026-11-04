import {
  chromium,
  expect,
  test as base,
  type Browser,
  type BrowserContext,
} from "@playwright/test";

const appPort = Number(process.env.COLONY_E2E_PORT ?? 4173);

export { expect };

export const test = base.extend({
  page: async ({ browserName: _browserName }, use) => {
    const profile = process.env.COLONY_E2E_CHROME_PROFILE;
    const baseURL = `http://127.0.0.1:${appPort}`;
    const launchOptions = {
      headless: true,
      args: ["--use-mock-keychain", "--password-store=basic"],
    };
    let browser: Browser | undefined;
    let context: BrowserContext;
    let page: Awaited<ReturnType<BrowserContext["newPage"]>>;
    if (profile) {
      context = await chromium.launchPersistentContext(profile, {
        ...launchOptions,
        channel: "chrome",
        baseURL,
      });
      page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send("Storage.clearDataForOrigin", {
        origin: baseURL,
        storageTypes: "all",
      });
      await session.detach();
    } else {
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext({ baseURL });
      page = await context.newPage();
    }
    try {
      await use(page);
    } finally {
      await context.close();
      await browser?.close();
    }
  },
});
