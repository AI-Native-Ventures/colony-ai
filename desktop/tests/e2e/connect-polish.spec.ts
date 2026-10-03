import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { installMockBridge } from "../helpers/bridge";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";
import { measureSidebarContrast } from "../helpers/sidebarContrast";
import { waitForAnimations } from "../helpers/animations";
import {
  LIGHT_THEMES,
  SYNTAX_THEMES,
} from "../../src/shared/theme/theme-loader";

test.use({ video: "off" });

const shots = "test-results/connect-polish";
async function capture(page: Page, name: string) {
  await mkdir(shots, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: `${shots}/${name}.png` });
}
for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`subscription and first reply polish ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
      mock: {
        discoverAgentModels: {
          supportsSwitching: true,
          models: [{ id: "actual-model", name: "Claude Sonnet" }],
        },
        onboardingConnectionDelayMs: 1500,
        onboardingConnectionResult: {
          reply: "Hello, I’m here.",
          model: "actual-model",
          startupMs: 20,
          totalMs: 50,
        },
      },
    });
    await expect(
      page.getByText(
        "Your AI teammates share these allowances with your other usage.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Skip for now", exact: true }),
    ).toHaveCount(0);
    await capture(page, `subscriptions-${viewport.width}`);
    await page
      .getByRole("button", { name: "Connect Claude Code", exact: true })
      .click();
    await expect(page.locator(".progress-list li").first()).toHaveText(
      "Connection saved",
    );
    await expect(page.locator(".progress-list li").first()).not.toHaveClass(
      /complete/,
    );
    await capture(page, `testing-${viewport.width}`);
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    await expect(page.locator(".connection-meta")).toContainText(
      "Claude Code · Claude Sonnet",
    );
    await expect(
      page
        .getByRole("button", { name: "Change connection", exact: true })
        .locator("svg"),
    ).toHaveCount(0);
    await capture(page, `connected-${viewport.width}`);
  });
  test(`OpenRouter primary action stays visible ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [
        r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
      ],
      mock: {
        globalAgentConfig: {
          provider: "openrouter",
          model: "fixture/free:free",
          env_vars: {
            OPENROUTER_API_KEY: "e2e-placeholder",
            OPENAI_COMPAT_API_KEY: "e2e-placeholder",
          },
        },
      },
    });
    await page.evaluate(() => {
      const ipc = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = ipc.invoke.bind(ipc);
      ipc.invoke = (command, args) =>
        command === "get_openrouter_connection"
          ? Promise.resolve({
              status: "connected",
              balance: 12.5,
              usage: 1.5,
              freeUsed: 12,
              limit: 5,
              limitRemaining: 0,
              freeRemaining: 38,
              freeLimit: 50,
              freeTier: true,
              failedRestarts: 0,
              model: "fixture/free:free",
              models: [
                {
                  id: "fixture/free:free",
                  name: "Fixture free model",
                  free: true,
                  context: 32000,
                },
              ],
            })
          : original(command, args);
    });
    await page.getByRole("radio", { name: "OpenRouter", exact: true }).click();
    const action = page.getByRole("button", {
      name: "Test connection",
      exact: true,
    });
    await expect(action).toBeEnabled();
    await expect(action).toHaveClass(/primary/);
    await expect(page.locator(".form-content .primary")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Refresh connection", exact: true }),
    ).toHaveCount(0);
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height,
    );
    await capture(page, `openrouter-connected-${viewport.width}`);
    await action.click();
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.__BUZZ_E2E_COMMANDS__?.includes("test_onboarding_connection"),
      ),
    ).toBe(true);
  });
}

test.describe("dark sidebar contrast", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const theme of SYNTAX_THEMES.filter((name) => !LIGHT_THEMES.has(name))) {
    test(`all sidebar text: ${theme}`, async ({ page }, testInfo) => {
      const relay = (
        process.env.BUZZ_E2E_RELAY_URL ?? "http://localhost:3000"
      ).replace(/^http/u, "ws");
      const communityKey = `buzz-community-theme.v1:${"deadbeef".repeat(8)}:${encodeURIComponent(relay)}`;
      await page.addInitScript(
        ({ key, theme }) => {
          localStorage.setItem("buzz-theme", theme);
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              theme,
              accent: "#3b82f6",
              followSystem: false,
            }),
          );
        },
        { key: communityKey, theme },
      );
      await installMockBridge(page);
      await page.goto("/#/today");
      await expect(page.getByTestId("sidebar-profile-name")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("buzz-theme-cache") ?? "{}")
                .themeName,
          ),
        )
        .toBe(theme);
      await waitForAnimations(page);
      const app = await measureSidebarContrast(
        page,
        '[data-testid="app-sidebar"]',
      );
      await page
        .getByTestId("app-sidebar")
        .locator('[data-sidebar="content"]')
        .evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
      await waitForAnimations(page);
      const lowerApp = await measureSidebarContrast(
        page,
        '[data-testid="app-sidebar"]',
      );
      app.text.push(...lowerApp.text);
      await page.getByTestId("open-settings").click();
      await page.getByTestId("profile-popover-settings").click();
      await expect(page.getByTestId("settings-sidebar")).toBeVisible();
      await waitForAnimations(page);
      const settings = await measureSidebarContrast(
        page,
        '[data-testid="settings-sidebar"]',
      );
      const artifact = testInfo.outputPath("sidebar-contrast.json");
      await mkdir(testInfo.outputDir, { recursive: true });
      await writeFile(
        artifact,
        JSON.stringify(
          { theme, project: testInfo.project.name, app, settings },
          null,
          2,
        ),
      );
      await testInfo.attach("sidebar contrast", {
        path: artifact,
        contentType: "application/json",
      });
      for (const category of ["business", "user", "section", "nav", "search"]) {
        const samples = [...app.text, ...settings.text].filter(
          (sample) => sample.category === category,
        );
        expect(samples.length, category).toBeGreaterThan(0);
        const worst = samples.reduce((a, b) => (a.ratio < b.ratio ? a : b));
        expect(
          worst.ratio,
          `${category}: ${worst.text}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // Flat theme edges must continue the sidebar paint. The branded dark
      // theme intentionally retains its approved gradient.
      if (theme !== "buzz-dark") {
        expect(app.frame.top).toEqual(app.frame.bottom);
        expect(settings.frame.top).toEqual(settings.frame.bottom);
      }
      if (theme === "github-dark") {
        await capture(page, "github-dark-settings-1440");
        await page.setViewportSize({ width: 1728, height: 1117 });
        await capture(page, "github-dark-settings-1728");
      }
    });
  }
});
