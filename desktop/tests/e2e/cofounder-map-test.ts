import { chromium, test as base } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const profile = process.env.BUZZ_E2E_BROWSER_PROFILE;

export const test = profile
  ? base.extend<{ browser: Browser; page: Page }>({
      browser: [
        async ({ browserName }, use) => {
          if (browserName !== "chromium") {
            throw new Error("The browser-lock profile requires Chromium.");
          }
          const context = await chromium.launchPersistentContext(profile, {
            channel: "chrome",
            headless: true,
            args: ["--use-mock-keychain", "--password-store=basic"],
          });
          const browser = context.browser();
          if (!browser) {
            await context.close();
            throw new Error("The browser-lock profile did not launch Chrome.");
          }
          try {
            await use(browser);
          } finally {
            await context.close();
          }
        },
        { scope: "worker" },
      ],
      page: async ({ browserName }, use) => {
        if (browserName !== "chromium") {
          throw new Error("The browser-lock profile requires Chromium.");
        }
        const context = await chromium.launchPersistentContext(profile, {
          channel: "chrome",
          headless: true,
          args: ["--use-mock-keychain", "--password-store=basic"],
        });
        const page = context.pages()[0] ?? (await context.newPage());
        try {
          await use(page);
        } finally {
          await context.close();
        }
      },
    })
  : base;
