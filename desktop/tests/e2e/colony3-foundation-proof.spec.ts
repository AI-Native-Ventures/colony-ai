import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  COLONY3_NOW,
  seedColony3Activity,
  seedColony3Communities,
  setColony3RelayState,
} from "../helpers/colony3Fixture";

/**
 * Colony 3.0 foundation proof. Captures the app at each board's size with the
 * Lerato Social fixture, so `scripts/colony3-compare.mjs` can lay each capture
 * next to the design reference. Not a regression gate: it only writes PNGs
 * (and checks that each state can be reached).
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT = process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-proof";
const captures: Array<{ board: string; file: string; note?: string }> = [];

test.describe.configure({ mode: "serial" });

async function openLerato(
  page: Page,
  options: { rail?: boolean; route?: string } = {},
) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
  });
  if (options.rail) await seedColony3Communities(page);
  await page.goto(options.route ?? "/#/today");
  await seedColony3Activity(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.waitForTimeout(1200);
  await waitForAnimations(page);
}

async function shot(
  page: Page,
  board: string,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  const file = `${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, clip });
  captures.push({ board, file });
}

/** Writes the text geometry of one region, to line up with the design's DOM. */
async function dumpTexts(page: Page, name: string, rootSelector: string) {
  const rects = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out: Array<Record<string, unknown>> = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent?.trim() ?? "";
      const parent = node.parentElement;
      if (text && parent) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        const style = getComputedStyle(parent);
        out.push({
          t: text.slice(0, 40),
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          w: Math.round(box.width * 10) / 10,
          h: Math.round(box.height * 10) / 10,
          fs: style.fontSize,
          fw: style.fontWeight,
          c: style.color,
          lh: style.lineHeight,
          ls: style.letterSpacing,
        });
      }
      node = walker.nextNode();
    }
    return out;
  }, rootSelector);
  writeFileSync(`${OUT}/${name}.rects.json`, JSON.stringify(rects, null, 1));
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

test("Sidebar board", async ({ page }) => {
  await openLerato(page);
  await dumpTexts(page, "Sidebar", '[data-testid="app-sidebar"]');
  await shot(page, "Sidebar", "Sidebar", {
    x: 0,
    y: 0,
    width: 280,
    height: 960,
  });
});

test("Sidebar collapsed board", async ({ page }) => {
  await openLerato(page, { rail: true });
  await page.getByTestId("channel-The Olive House").click();
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await setColony3RelayState(page, "reconnecting");
  await page.waitForTimeout(800);
  await shot(page, "SidebarCollapsed", "SidebarCollapsed");
});

test("Foundations board", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1180 });
  await installMockBridge(page, {});
  await page.addInitScript(() => {
    const config = (window as unknown as { __BUZZ_E2E__?: object })
      .__BUZZ_E2E__;
    (window as unknown as { __BUZZ_E2E__: object }).__BUZZ_E2E__ = {
      ...config,
      showcase: "colony3",
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("colony3-foundations")).toBeVisible();
  await shot(page, "Foundations", "Foundations");
});

test("Shell notices board", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await installMockBridge(page, {});
  await page.addInitScript(() => {
    const config = (window as unknown as { __BUZZ_E2E__?: object })
      .__BUZZ_E2E__;
    (window as unknown as { __BUZZ_E2E__: object }).__BUZZ_E2E__ = {
      ...config,
      showcase: "colony3-notices",
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("colony3-notices")).toBeVisible();
  await shot(page, "ShellNotices", "ShellNotices-components");
});

test("Sidebar menus board", async ({ page }) => {
  await openLerato(page);
  await page.getByTestId("channel-The Olive House").click();
  await page.getByTestId("channel-working-The Olive House").hover();
  const popover = page.getByTestId("channel-activity-popover-The Olive House");
  await expect(popover).toBeVisible({ timeout: 8000 });
  await shot(page, "SidebarMenus", "SidebarMenus-activity");
  await page.mouse.move(700, 600);
  await page.getByTestId("channel-Cedar Café").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to section" }).hover();
  await page.waitForTimeout(400);
  await shot(page, "SidebarMenus", "SidebarMenus-context");
});

test("Sidebar sections board", async ({ page }) => {
  await openLerato(page);
  await page.getByTestId("channel-The Olive House").click();
  // Section menu
  await page
    .getByRole("button", { name: "More actions for Client work" })
    .click({ force: true });
  await page.getByRole("menuitem", { name: "Sort" }).hover();
  await page.waitForTimeout(400);
  await shot(page, "SidebarSections", "SidebarSections-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // Rename dialog
  await page
    .getByRole("button", { name: "More actions for Client work" })
    .click({ force: true });
  await page.getByRole("menuitem", { name: "Rename section" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "SidebarSections", "SidebarSections-rename");
  await page.keyboard.press("Escape");
  // Delete dialog
  await page
    .getByRole("button", { name: "More actions for Client work" })
    .click({ force: true });
  await page.getByRole("menuitem", { name: "Delete section" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await shot(page, "SidebarSections", "SidebarSections-delete");
  await page.keyboard.press("Escape");
  // Create dialog from the channel menu
  await page.getByTestId("channel-Cedar Café").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to section" }).hover();
  await page.getByRole("menuitem", { name: /New section/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByPlaceholder("Section name").fill("Retainers");
  await shot(page, "SidebarSections", "SidebarSections-create");
});

test("Shell notices in the app", async ({ page }) => {
  await openLerato(page);
  await shot(page, "ShellNotices", "ShellNotices-sidebar", {
    x: 0,
    y: 0,
    width: 280,
    height: 960,
  });
  // Feedback dialog
  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.getByTestId("profile-popover-send-feedback").click();
  await expect(page.getByTestId("send-feedback-dialog")).toBeVisible();
  await page.getByRole("radio", { name: "Something is broken" }).check();
  await page
    .getByTestId("feedback-message")
    .fill(
      "Mina’s carousel previews don’t load in the work area after I switch channels.",
    );
  await page.getByTestId("feedback-include-logs").click();
  await waitForAnimations(page);
  await page
    .getByTestId("send-feedback-dialog")
    .screenshot({ path: `${OUT}/ShellNotices-feedback.png` });
  captures.push({ board: "ShellNotices", file: "ShellNotices-feedback.png" });
});
