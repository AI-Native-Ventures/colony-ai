import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "./animations";

const SHOT_DIR = "/Users/mac/worktrees/.lanes/reskin/shots";

const screenshotTheme =
  process.env.COLONY_RESKIN_SCREENSHOT_THEME === "dark" ? "dark" : "light";

export async function seedReskinTheme(page: Page) {
  await page.addInitScript((theme) => {
    const isDark = theme === "dark";
    window.localStorage.setItem("buzz-theme", isDark ? "buzz-dark" : "buzz");
    window.localStorage.setItem(
      "buzz-theme-cache",
      JSON.stringify({
        themeName: isDark ? "buzz-dark" : "buzz",
        vars: {
          "--background": isDark ? "260 11.54% 10.2%" : "270 16.67% 95.29%",
        },
        isDark,
      }),
    );
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
  }, screenshotTheme);
  await page.emulateMedia({ colorScheme: screenshotTheme });
}

export async function captureReskinState(page: Page, name: string) {
  const originalViewport = page.viewportSize();
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const width of [1440, 900]) {
    await captureReskinAtWidth(page, name, width);
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}

export async function captureReskinAtWidth(
  page: Page,
  name: string,
  width: number,
) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width, height: 900 });
  await waitForAnimations(page);
  const themeSuffix = screenshotTheme === "dark" ? "-dark" : "";
  await page.screenshot({
    path: `${SHOT_DIR}/${name}${themeSuffix}-${width}.png`,
  });
}
