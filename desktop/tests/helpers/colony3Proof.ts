import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";

import { waitForAnimations } from "./animations";
import { installMockBridge } from "./bridge";
import {
  COLONY3_NOW,
  seedColony3Activity,
  seedColony3Communities,
} from "./colony3Fixture";

/**
 * Shared plumbing for the Colony 3.0 area proof specs. Each spec opens the
 * Lerato Social fixture, captures the app at a board's size, and records the
 * capture so `scripts/colony3-proof-report.mjs` can lay it next to the design
 * reference. COLONY3_PROOF_DIR chooses where the captures land.
 */
export const PROOF_OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-proof";

type MockBridgeOptions = Parameters<typeof installMockBridge>[1];

export type Rect = [x: number, y: number, width: number, height: number];

export type Capture = {
  name: string;
  /** Reference board the capture is judged against. */
  board: string;
  /** Part of the board the capture covers; the whole board when omitted. */
  refRect?: Rect;
  title: string;
};

export const captures: Capture[] = [];

export type OpenLeratoOptions = {
  rail?: boolean;
  route?: string;
  /** Extra mock-bridge options on top of the Lerato Social fixture. */
  mock?: MockBridgeOptions;
  height?: number;
  seedActivity?: boolean;
};

export async function openLerato(page: Page, options: OpenLeratoOptions = {}) {
  mkdirSync(PROOF_OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: options.height ?? 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    accountEmail: "lerato@example.com",
    relayRequiresMembership: true,
    relayRole: "owner",
    ...options.mock,
  });
  if (options.rail) await seedColony3Communities(page);
  await page.goto(options.route ?? "/#/today");
  if (options.seedActivity !== false) await seedColony3Activity(page);
  await page.waitForTimeout(1200);
  await waitForAnimations(page);
}

export async function waitForShell(page: Page) {
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

export async function shot(
  page: Page,
  capture: Capture,
  target?: Locator | { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  const path = `${PROOF_OUT}/${capture.name}.png`;
  if (target && "screenshot" in target) {
    // A clip of the element's box, not an element screenshot: those wait for
    // the element to hold still, which a live popover never quite does.
    const box = await target.boundingBox();
    if (!box) throw new Error(`No box to capture for ${capture.name}`);
    await page.screenshot({
      animations: "disabled",
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      path,
    });
  } else {
    await page.screenshot({ animations: "disabled", clip: target, path });
  }
  const existing = captures.findIndex((entry) => entry.name === capture.name);
  if (existing >= 0) captures.splice(existing, 1);
  captures.push(capture);
}

/** Writes the text geometry of one region, to line up with the design's DOM. */
export async function dumpTexts(
  page: Page,
  name: string,
  rootSelector: string,
) {
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
  mkdirSync(PROOF_OUT, { recursive: true });
  writeFileSync(
    `${PROOF_OUT}/${name}.rects.json`,
    JSON.stringify(rects, null, 1),
  );
}

/** Writes captures.json; call from a test.afterAll. */
export function writeCaptures() {
  mkdirSync(PROOF_OUT, { recursive: true });
  writeFileSync(
    `${PROOF_OUT}/captures.json`,
    JSON.stringify(captures, null, 2),
  );
}
