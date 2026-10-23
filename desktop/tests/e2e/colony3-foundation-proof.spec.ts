import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  COLONY3_NOW,
  seedColony3Activity,
  seedColony3Communities,
  setColony3RelayState,
} from "../helpers/colony3Fixture";

/**
 * Colony 3.0 foundation proof. Captures the app at each board's size (and each
 * component at its board rectangle) with the Lerato Social fixture, so
 * `scripts/colony3-proof-report.mjs` can lay every capture next to the design
 * reference. Not a regression gate: it writes PNGs and checks that each state
 * can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT = process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-proof";

type Rect = [x: number, y: number, width: number, height: number];
type Capture = {
  name: string;
  /** Reference board the capture is judged against. */
  board: string;
  /** Part of the board the capture covers; the whole board when omitted. */
  refRect?: Rect;
  title: string;
};
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

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
  capture: Capture,
  target?: Locator | { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  const path = `${OUT}/${capture.name}.png`;
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
  captures.push(capture);
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

async function openShowcase(page: Page, showcase: string, height: number) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height });
  await installMockBridge(page, {});
  await page.addInitScript((name) => {
    const config = (window as unknown as { __BUZZ_E2E__?: object })
      .__BUZZ_E2E__;
    (window as unknown as { __BUZZ_E2E__: object }).__BUZZ_E2E__ = {
      ...config,
      showcase: name,
    };
  }, showcase);
  await page.goto("/");
}

test("Foundations board", async ({ page }) => {
  await openShowcase(page, "colony3", 1180);
  await expect(page.getByTestId("colony3-foundations")).toBeVisible();
  await shot(page, {
    name: "Foundations",
    board: "Foundations",
    title: "Foundations: type, colour, states, people and agents, controls",
  });
});

test("Sidebar board", async ({ page }) => {
  await openLerato(page);
  await dumpTexts(page, "Sidebar", '[data-testid="app-sidebar"]');
  await shot(
    page,
    {
      name: "Sidebar",
      board: "Sidebar",
      title: "Sidebar: full workspace, Today open",
    },
    { x: 0, y: 0, width: 280, height: 960 },
  );
});

test("Sidebar collapsed board", async ({ page }) => {
  await openLerato(page, { rail: true });
  await page.getByTestId("channel-The Olive House").click();
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await shot(page, {
    name: "SidebarCollapsed",
    board: "SidebarCollapsed",
    title: "Collapsed sidebar and community rail (whole screen)",
  });
  await shot(
    page,
    {
      name: "SidebarCollapsed-rail",
      board: "SidebarCollapsed",
      refRect: [0, 0, 141, 960],
      title: "Collapsed sidebar and community rail (rail strip only)",
    },
    { x: 0, y: 0, width: 141, height: 960 },
  );
});

test("Relay notice in the collapsed layout", async ({ page }) => {
  await openLerato(page, { rail: true });
  await page.getByTestId("channel-The Olive House").click();
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await setColony3RelayState(page, "disconnected");
  const card = page.getByTestId("sidebar-relay-unreachable");
  await expect(card).toBeVisible({ timeout: 15000 });
  await shot(
    page,
    {
      name: "SidebarCollapsed-notice",
      board: "SidebarCollapsed",
      refRect: [152, 876, 300, 62],
      title: "Floating relay notice while the sidebar is collapsed",
    },
    card,
  );
});

test("Sidebar menus board", async ({ page }) => {
  await openLerato(page);
  await page.getByTestId("channel-The Olive House").click();
  // A channel hands focus to its composer a moment after it opens. Wait for
  // that, then focus the row: focus opens the preview at once (hover waits half
  // a second of dwell), and nothing takes the focus away afterwards.
  await expect(page.getByTestId("message-input")).toBeFocused();
  await page.getByTestId("channel-The Olive House").focus();
  const popover = page.getByTestId("channel-activity-popover-The Olive House");
  await expect(popover).toBeVisible({ timeout: 20000 });
  await shot(
    page,
    {
      name: "SidebarMenus-activity",
      board: "SidebarMenus",
      refRect: [288, 96, 384, 418],
      title: "Channel activity popover",
    },
    popover,
  );
  await page.mouse.move(700, 600);
  await page.getByTestId("channel-Cedar Café").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to section" }).hover();
  await page.waitForTimeout(500);
  const menus = page.getByRole("menu");
  await shot(
    page,
    {
      name: "SidebarMenus-channel-menu",
      board: "SidebarMenus",
      refRect: [288, 522, 262, 414],
      title: "Channel menu",
    },
    menus.first(),
  );
  await shot(
    page,
    {
      name: "SidebarMenus-section-submenu",
      board: "SidebarMenus",
      refRect: [556, 571, 240, 148],
      title: "Move to section submenu",
    },
    menus.last(),
  );
});

test("Sidebar sections board", async ({ page }) => {
  await openLerato(page);
  await page.getByTestId("channel-The Olive House").click();
  const sectionActions = page.getByTestId(
    "section-actions-reference-client-work",
  );
  const openSectionMenu = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.mouse.move(700, 500);
      await page.waitForTimeout(300);
      await sectionActions.click({ force: true });
      if (
        await page
          .getByRole("menu")
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error("The section menu did not open");
  };
  await openSectionMenu();
  await page.getByRole("menuitem", { name: "Sort" }).hover();
  await page.waitForTimeout(500);
  const menus = page.getByRole("menu");
  await shot(
    page,
    {
      name: "SidebarSections-menu",
      board: "SidebarSections",
      refRect: [268, 446, 252, 271],
      title: "Section menu",
    },
    menus.first(),
  );
  await shot(
    page,
    {
      name: "SidebarSections-sort",
      board: "SidebarSections",
      refRect: [526, 610, 190, 97],
      title: "Sort submenu",
    },
    menus.last(),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openSectionMenu();
  await page.getByRole("menuitem", { name: "Rename section" }).click();
  const rename = page.getByRole("dialog");
  await expect(rename).toBeVisible();
  await shot(
    page,
    {
      name: "SidebarSections-rename",
      board: "SidebarSections",
      refRect: [1008, 84, 400, 217],
      title: "Rename section dialog",
    },
    rename,
  );
  await page.keyboard.press("Escape");
  await expect(rename).toBeHidden();
  await openSectionMenu();
  await page.getByRole("menuitem", { name: "Delete section" }).click();
  const remove = page.getByRole("alertdialog");
  await expect(remove).toBeVisible();
  await shot(
    page,
    {
      name: "SidebarSections-delete",
      board: "SidebarSections",
      refRect: [1008, 380, 400, 212],
      title: "Delete section dialog",
    },
    remove,
  );
  await page.keyboard.press("Escape");
  await expect(remove).toBeHidden();
  await page.getByTestId("channel-Cedar Café").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to section" }).hover();
  await page.getByRole("menuitem", { name: /New section/ }).click();
  const create = page.getByRole("dialog");
  await expect(create).toBeVisible();
  await page.getByPlaceholder("Section name").fill("Retainers");
  await shot(
    page,
    {
      name: "SidebarSections-create",
      board: "SidebarSections",
      refRect: [576, 84, 410, 270],
      title: "Create section dialog",
    },
    create,
  );
});

test("Shell notices board", async ({ page }) => {
  await openShowcase(page, "colony3-notices", 960);
  await expect(page.getByTestId("colony3-notices")).toBeVisible();
  const cards: Array<[string, Rect, string]> = [
    ["notice-relay-unreachable", [320, 72, 341, 66], "Can’t reach the relay"],
    ["notice-relay-reconnecting", [320, 150, 341, 50], "Connecting"],
    ["notice-relay-waiting", [320, 212, 341, 89], "Waiting to reconnect"],
    ["notice-relay-connected", [320, 313, 341, 52], "Connected"],
    ["notice-update-ready", [320, 427, 341, 66], "Ready to update"],
    ["notice-update-available", [320, 505, 341, 90], "Update available"],
  ];
  for (const [testId, refRect, title] of cards) {
    await shot(
      page,
      { name: `ShellNotices-${testId}`, board: "ShellNotices", refRect, title },
      page.getByTestId(testId),
    );
  }
});

test("Shell notices in the app", async ({ page }) => {
  await openLerato(page);
  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.getByTestId("profile-popover-send-feedback").click();
  const dialog = page.getByTestId("send-feedback-dialog");
  await expect(dialog).toBeVisible();
  await page.getByRole("radio", { name: "Something is broken" }).check();
  await page
    .getByTestId("feedback-message")
    .fill(
      "Mina’s carousel previews don’t load in the work area after I switch channels.",
    );
  await page.getByTestId("feedback-include-logs").click();
  await shot(
    page,
    {
      name: "ShellNotices-feedback",
      board: "ShellNotices",
      refRect: [1059, 72, 341, 555],
      title: "Send feedback dialog",
    },
    dialog,
  );
});

test("Main board", async ({ page }) => {
  await openLerato(page, { route: "/" });
  await page.getByTestId("channel-Welcome").click();
  await page.waitForTimeout(1500);
  await shot(page, {
    name: "Main",
    board: "Main",
    title:
      "#Welcome channel (shell and chrome; channel content is a later task)",
  });
});
