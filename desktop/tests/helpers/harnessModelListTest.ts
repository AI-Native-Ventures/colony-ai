import { chromium, expect, test as base } from "@playwright/test";

export { expect };

export const test = base.extend({
  context: async ({ contextOptions, launchOptions }, use) => {
    const profile = process.env.BUZZ_E2E_BROWSER_PROFILE;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const context = profile
      ? await chromium.launchPersistentContext(profile, {
          ...contextOptions,
          ...launchOptions,
          channel: "chrome",
          headless: true,
        })
      : await (async () => {
          browser = await chromium.launch({
            ...launchOptions,
            channel: "chrome",
            headless: true,
          });
          return browser.newContext(contextOptions);
        })();

    try {
      await use(context);
    } finally {
      await context.close();
      await browser?.close();
    }
  },
});
