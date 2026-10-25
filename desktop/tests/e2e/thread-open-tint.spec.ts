import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { openChannelWithThreads, summaryOf } from "../helpers/threadRoots";

// The message whose thread is open in the side panel carries a soft wash of
// the person's accent (the old app did this) so that, with several threads in
// view, they can see which one is open.

const ACTIVE = '.c3c-row[data-active-thread-root="true"]';

/** The row's own surface layer (the one hover and the open-thread wash paint). */
function surface(row: Locator) {
  return row.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    const text = getComputedStyle(element).color;
    return { background: style.backgroundColor, text };
  });
}

/** Read the surface once its 120 ms fade has finished. */
async function settled(row: Locator) {
  let previous = await surface(row);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await row.page().waitForTimeout(80);
    const next = await surface(row);
    if (next.background === previous.background) return next;
    previous = next;
  }
  return previous;
}

type Rgba = { r: number; g: number; b: number; a: number };

function parse(color: string): Rgba {
  const match =
    color.match(/rgba?\(([^)]+)\)/) ?? color.match(/color\(srgb ([^)]+)\)/);
  if (!match) throw new Error(`Cannot read colour ${color}`);
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  const scale = color.startsWith("color(") ? 255 : 1;
  return {
    r: parts[0] * scale,
    g: parts[1] * scale,
    b: parts[2] * scale,
    a: parts[3] ?? 1,
  };
}

function luminance({ r, g, b }: Rgba) {
  const channel = (value: number) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function rowOf(page: Page, text: string) {
  return page.locator(".c3c-row", { hasText: text }).first();
}

test.describe("open thread tint", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
  });

  test("the open thread's root has the accent wash, the others do not", async ({
    page,
  }) => {
    const roots = await openChannelWithThreads(page);
    await page.mouse.move(1435, 4);
    await expect(page.locator(ACTIVE)).toHaveCount(0);
    for (const root of roots) {
      expect((await settled(rowOf(page, root.text))).background).toBe(
        "rgba(0, 0, 0, 0)",
      );
    }

    await summaryOf(page, roots[2].id).click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await waitForAnimations(page);
    await page.mouse.move(1435, 4);

    const active = page.locator(ACTIVE);
    await expect(active).toHaveCount(1);
    await expect(active).toContainText(roots[2].text);
    const open = await settled(active);
    const wash = parse(open.background);
    expect(wash.a).toBeGreaterThan(0.9);
    for (const [index, root] of roots.entries()) {
      if (index === 2) continue;
      expect((await settled(rowOf(page, root.text))).background).toBe(
        "rgba(0, 0, 0, 0)",
      );
    }

    // Light enough to read the message on: the text keeps AA contrast.
    expect(luminance(wash)).toBeGreaterThan(0.6);
    expect(contrast(parse(open.text), wash)).toBeGreaterThanOrEqual(4.5);
  });

  test("it is clearly not the hover state", async ({ page }) => {
    const roots = await openChannelWithThreads(page);
    await summaryOf(page, roots[1].id).click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await waitForAnimations(page);

    // Hover another row to read the hover surface.
    await rowOf(page, roots[4].text).hover();
    const hover = await settled(rowOf(page, roots[4].text));
    const hoverWash = parse(hover.background);
    expect(hoverWash.a).toBeGreaterThan(0.9);

    const active = page.locator(ACTIVE);
    const openWash = parse((await settled(active)).background);
    // Visibly stronger than hover: much further from the page surface.
    expect(luminance(hoverWash) - luminance(openWash)).toBeGreaterThan(0.03);

    // Hovering the open row does not change it.
    await active.hover();
    const hoveredOpen = parse((await settled(active)).background);
    expect(hoveredOpen).toEqual(openWash);
  });

  test("it moves to the next thread opened and goes when the panel closes", async ({
    page,
  }) => {
    const roots = await openChannelWithThreads(page);
    await summaryOf(page, roots[0].id).click();
    await expect(page.locator(ACTIVE)).toContainText(roots[0].text);

    await summaryOf(page, roots[4].id).click();
    const active = page.locator(ACTIVE);
    await expect(active).toHaveCount(1);
    await expect(active).toContainText(roots[4].text);
    await page.mouse.move(1435, 4);
    expect((await settled(rowOf(page, roots[0].text))).background).toBe(
      "rgba(0, 0, 0, 0)",
    );

    await page.getByTestId("auxiliary-panel-close").click();
    await expect(page.getByTestId("message-thread-panel")).toHaveCount(0);
    await expect(page.locator(ACTIVE)).toHaveCount(0);
    await page.mouse.move(1435, 4);
    expect((await settled(rowOf(page, roots[4].text))).background).toBe(
      "rgba(0, 0, 0, 0)",
    );
  });

  test("it also marks the root at the narrower side-panel width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const roots = await openChannelWithThreads(page);
    await summaryOf(page, roots[3].id).click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await expect(page.locator(ACTIVE)).toContainText(roots[3].text);
  });
});

test.describe("open thread tint follows the accent", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a chosen accent tints the open thread in its own colour", async ({
    page,
  }) => {
    // Teal: green leads, where the default violet leans blue and red.
    await page.addInitScript(() => {
      window.localStorage.setItem("buzz-accent-color", "#1F7A70");
    });
    await installMockBridge(page);
    const roots = await openChannelWithThreads(page);
    await summaryOf(page, roots[2].id).click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await waitForAnimations(page);
    await page.mouse.move(1435, 4);
    const wash = parse((await settled(page.locator(ACTIVE))).background);
    expect(wash.g).toBeGreaterThan(wash.r + 4);
    expect(wash.g).toBeGreaterThanOrEqual(wash.b);
    expect(luminance(wash)).toBeGreaterThan(0.6);
  });
});
