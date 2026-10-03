import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installMockBridge } from "../helpers/bridge";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";
import { waitForAnimations } from "../helpers/animations";
import {
  LIGHT_THEMES,
  SYNTAX_THEMES,
} from "../../src/shared/theme/theme-loader";

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

for (const theme of SYNTAX_THEMES.filter((name) => !LIGHT_THEMES.has(name))) {
  test(`business and user name contrast: ${theme}`, async ({ page }) => {
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
    // Wait for the asynchronously loaded palette before measuring computed colors.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("buzz-theme-cache") ?? "{}")
              .themeName,
        ),
      )
      .toBe(theme);
    const ratios = [
      ...(await sidebarContrast(page, '[data-testid="sidebar-profile-name"]')),
      ...(await sidebarContrast(
        page,
        '[data-testid="sidebar-business-switcher"]',
      )),
    ];
    expect(ratios.length).toBeGreaterThan(1);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });
}
async function sidebarContrast(page: Page, selector: string) {
  return page.locator(selector).evaluate((sidebar) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Color canvas is unavailable");
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const blend = (fg: number[], bg: number[]) =>
      fg
        .slice(0, 3)
        .map((v, i) => (v * fg[3]) / 255 + bg[i] * (1 - fg[3] / 255));
    const walker = document.createTreeWalker(sidebar, NodeFilter.SHOW_TEXT);
    const ratios: number[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (
        !el ||
        !node.textContent?.trim() ||
        el.closest('svg,.sr-only,[aria-hidden="true"]') ||
        !el.getBoundingClientRect().height
      )
        continue;
      const style = getComputedStyle(el);
      if (style.visibility !== "visible") continue;
      let opacity = 1;
      const layers: number[][] = [];
      for (
        let parent: Element | null = el;
        parent;
        parent = parent.parentElement
      ) {
        const s = getComputedStyle(parent);
        opacity *= Number(s.opacity);
        layers.push(rgba(s.backgroundColor));
      }
      if (!opacity) continue;
      let bg = [25, 23, 29];
      for (const layer of layers.reverse()) bg = blend(layer, bg);
      const fg = rgba(style.color);
      fg[3] *= opacity;
      const ink = blend(fg, bg);
      const a = luminance(ink),
        b = luminance(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5)
        console.warn("Sidebar contrast", node.textContent?.trim(), ratio);
      ratios.push(ratio);
    }
    return ratios;
  });
}
