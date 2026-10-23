import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";
import {
  colony3WorkAreaBridgeOptions,
  createColony3WorkAreaWorkspace,
} from "../helpers/colony3WorkAreaFixture";
import { installWorkspaceFileHost } from "./helpers/workspaceFileHost";

/**
 * Colony 3.0 work area proof (ChannelWorkArea board). Captures the app at the
 * board's size with the Lerato Social fixture and the work area open on
 * Mina's October file, so `scripts/colony3-compare.mjs` can lay it next to the
 * design reference. Not a regression gate: it writes PNGs and checks that the
 * state can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-workarea-proof";

test.use({ timezoneId: "Africa/Johannesburg" });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const OPEN_TAB = "colony:open-work-area-tab";

async function requestTab(page: Page, kind: string) {
  await page.evaluate(
    ([name, detail]) => window.dispatchEvent(new CustomEvent(name, { detail })),
    [OPEN_TAB, kind],
  );
}

test("ChannelWorkArea board", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const root = await createColony3WorkAreaWorkspace();
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.clock.setFixedTime(new Date(COLONY3_NOW));
    await installWorkspaceFileHost(page, root);
    await installMockBridge(page, colony3WorkAreaBridgeOptions());
    await page.goto("/#/today");
    await seedColony3Activity(page);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await page.getByTestId("channel-The Olive House").click();
    await expect(page.getByTestId("message-input")).toBeVisible();
    // The board has no bar above the channel header; the header restyle
    // (C3-CONV timeline) removes it. Until that is merged, hide it here so the
    // dock lines up with the board and this proof judges the dock alone.
    await page.addStyleTag({
      content: ".colony-channel-topbar{display:none !important}",
    });

    // Canvas, Work, the file, then Terminal: the board's tab order.
    await requestTab(page, "canvas");
    await requestTab(page, "work");
    // The file opens from the card in Mina's message, as it does for people.
    await page
      .getByTestId("message-row")
      .filter({ hasText: "next post is ready" })
      .getByRole("link", { name: /october-carousel-concepts\.md/ })
      .click();
    await requestTab(page, "terminal");
    await page.waitForTimeout(1500);
    await page
      .getByTestId("work-area-panel")
      .getByRole("tab", { name: "october-carousel-concepts.md" })
      .click();
    await expect(
      page.getByTestId("work-area-panel").getByRole("heading", {
        name: "October carousel concepts",
      }),
    ).toBeVisible();
    await page.waitForTimeout(800);
    await waitForAnimations(page);
    await page.screenshot({
      animations: "disabled",
      clip: { x: 0, y: 0, width: 1440, height: 960 },
      path: `${OUT}/ChannelWorkArea.png`,
    });
    // Text geometry of the dock, to line up with the design's own DOM.
    const rects = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="work-area-panel"]');
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
            t: text.slice(0, 50),
            x: Math.round(box.x * 10) / 10,
            y: Math.round(box.y * 10) / 10,
            w: Math.round(box.width * 10) / 10,
            h: Math.round(box.height * 10) / 10,
            fs: style.fontSize,
            fw: style.fontWeight,
            c: style.color,
            lh: style.lineHeight,
          });
        }
        node = walker.nextNode();
      }
      return out;
    });
    writeFileSync(`${OUT}/dock.rects.json`, JSON.stringify(rects, null, 1));
    // Box geometry of the document's blocks and the reader header.
    const boxes = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".colony-doc-head, .colony-doc-head > *, .colony-doc, .colony-doc > *, .colony-doc li, .colony-work-area-head, .colony-work-area-tab, .colony-work-area-add, .colony-work-area-close",
        ),
      ].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          cls: String(element.className).slice(0, 40),
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          w: Math.round(box.width * 10) / 10,
          h: Math.round(box.height * 10) / 10,
        };
      }),
    );
    writeFileSync(`${OUT}/dock.boxes.json`, JSON.stringify(boxes, null, 1));
    writeFileSync(
      `${OUT}/captures.json`,
      JSON.stringify(
        [
          {
            name: "ChannelWorkArea",
            board: "ChannelWorkArea",
            title: "Channel with the work area open on Mina's file",
          },
        ],
        null,
        2,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
