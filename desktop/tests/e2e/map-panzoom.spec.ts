import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  MAP_CHANNEL_ID,
  fixture,
  seedCofounderTheme,
  seedCompanyMapBusiness,
  seedCompanyMapMoneyRails,
  seedCompanyMapWhatsApp,
} from "./cofounder-map-fixtures";

const CAPTURE_DIR = process.env.MAP_PANZOOM_CAPTURE_DIR;
const LARGE_VIEWPORT = { height: 1117, width: 1728 };
const SLICE_ONE_VIEWPORT = { height: 900, width: 1440 };

type Camera = {
  scale: number;
  x: number;
  y: number;
};

type Box = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type WheelSample = {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  isTrusted: boolean;
  metaKey: boolean;
};

async function installMap(
  page: Page,
  { mapHome = true }: { mapHome?: boolean } = {},
) {
  await seedCofounderTheme(page, "light");
  await installMockBridge(
    page,
    {
      ...fixture(),
      visualChannels: [{ id: MAP_CHANNEL_ID, name: "Outreach" }],
    },
    { previewFeatureOverrides: { map_home: mapHome } },
  );
  await seedCompanyMapBusiness(page);
  await seedCompanyMapMoneyRails(page);
  await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
  await page.emulateMedia({ colorScheme: "light" });
}

async function openMap(page: Page, viewport = LARGE_VIEWPORT) {
  await installMap(page);
  await page.setViewportSize(viewport);
  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible({
    timeout: 15_000,
  });
}

async function openSalesJobs(page: Page) {
  await page.getByTestId("cofounder-map-sales").click();
  await expect(
    page.getByTestId("cofounder-map-job-sales-lead-finding"),
  ).toBeVisible();
}

async function openSalesLeadFinding(page: Page) {
  await openSalesJobs(page);
  await page.getByTestId("cofounder-map-job-sales-lead-finding").click();
  await expect(page.getByTestId("fullmap-window")).toBeVisible();
}

async function pointAt(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected an on-screen map target");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function readCamera(page: Page): Promise<Camera> {
  return page.getByTestId("cofounder-map-stage").evaluate((node) => {
    const value = getComputedStyle(node)
      .getPropertyValue("--company-map-transform")
      .trim();
    const match = value.match(
      /^translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)$/,
    );
    if (!match) throw new Error(`Unexpected map transform: ${value}`);
    return {
      scale: Number(match[3]),
      x: Number(match[1]),
      y: Number(match[2]),
    };
  });
}

async function readBox(locator: Locator): Promise<Box> {
  return locator.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { height: box.height, width: box.width, x: box.x, y: box.y };
  });
}

async function waitForPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function findBlankCanvasPoint(page: Page) {
  return page.getByTestId("cofounder-map-viewport").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const candidates = [
      { x: bounds.left + bounds.width * 0.84, y: bounds.top + 120 },
      { x: bounds.left + bounds.width * 0.13, y: bounds.top + 180 },
      { x: bounds.left + bounds.width * 0.86, y: bounds.bottom - 150 },
    ];
    for (const point of candidates) {
      const target = document.elementFromPoint(point.x, point.y);
      if (
        !(target instanceof Element) ||
        !target.closest("button, a, [data-map-control], .company-map-card")
      ) {
        return point;
      }
    }
    throw new Error("Expected a blank point on the map canvas");
  });
}

async function dispatchWheel(
  page: Page,
  point: { x: number; y: number },
  {
    deltaX = 0,
    deltaY,
    modifiers = 0,
  }: { deltaX?: number; deltaY: number; modifiers?: number },
) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchMouseEvent", {
      deltaX,
      deltaY,
      modifiers,
      type: "mouseWheel",
      x: point.x,
      y: point.y,
    });
  } finally {
    await session.detach();
  }
}

async function recordNextWheel(page: Page) {
  await page.evaluate(() => {
    type SampleWindow = Window & { __MAP_PANZOOM_WHEEL_SAMPLE__?: WheelSample };
    const testWindow = window as SampleWindow;
    testWindow.__MAP_PANZOOM_WHEEL_SAMPLE__ = undefined;
    document.addEventListener(
      "wheel",
      (event) => {
        testWindow.__MAP_PANZOOM_WHEEL_SAMPLE__ = {
          ctrlKey: event.ctrlKey,
          deltaMode: event.deltaMode,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          isTrusted: event.isTrusted,
          metaKey: event.metaKey,
        };
      },
      { capture: true, once: true },
    );
  });
}

async function readWheelSample(page: Page): Promise<WheelSample> {
  return page.evaluate(() => {
    const sample = (
      window as Window & { __MAP_PANZOOM_WHEEL_SAMPLE__?: WheelSample }
    ).__MAP_PANZOOM_WHEEL_SAMPLE__;
    if (!sample) throw new Error("Expected a recorded wheel event");
    return sample;
  });
}

async function dragMouse(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  button: "left" | "middle" | "right" = "left",
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up({ button });
  await waitForPaint(page);
}

async function dispatchTouch(
  page: Page,
  steps: Array<{
    points: Array<{ id: number; x: number; y: number }>;
    type: "touchEnd" | "touchMove" | "touchStart";
  }>,
) {
  const session = await page.context().newCDPSession(page);
  try {
    for (const step of steps) {
      await session.send("Input.dispatchTouchEvent", {
        touchPoints: step.points.map((point) => ({
          force: 1,
          id: point.id,
          radiusX: 1,
          radiusY: 1,
          x: point.x,
          y: point.y,
        })),
        type: step.type,
      });
    }
  } finally {
    await session.detach();
  }
  await waitForPaint(page);
}

async function installContextMenuProbe(page: Page) {
  await page.evaluate(() => {
    type ProbeWindow = Window & {
      __MAP_PANZOOM_CONTEXT_MENU__?: { count: number; prevented: boolean };
    };
    const testWindow = window as ProbeWindow;
    testWindow.__MAP_PANZOOM_CONTEXT_MENU__ = { count: 0, prevented: false };
    window.addEventListener(
      "contextmenu",
      (event) => {
        const probe = testWindow.__MAP_PANZOOM_CONTEXT_MENU__;
        if (!probe) return;
        probe.count += 1;
        probe.prevented = event.defaultPrevented;
      },
      { once: true },
    );
  });
}

async function installDragFrameProbe(page: Page) {
  await page.evaluate(() => {
    type ProbeWindow = Window & {
      __MAP_PANZOOM_DRAG_FRAME__?: { maxMoveToFrameMs: number | null };
    };
    const testWindow = window as ProbeWindow;
    const probe = { maxMoveToFrameMs: null as number | null };
    let latestMoveAt: number | null = null;
    let frameQueued = false;
    document.addEventListener(
      "pointermove",
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest("[data-testid='cofounder-map-viewport']")) {
          return;
        }
        latestMoveAt = performance.now();
        if (frameQueued) return;
        frameQueued = true;
        requestAnimationFrame(() => {
          frameQueued = false;
          if (latestMoveAt === null) return;
          const elapsed = performance.now() - latestMoveAt;
          probe.maxMoveToFrameMs = Math.max(
            probe.maxMoveToFrameMs ?? 0,
            elapsed,
          );
        });
      },
      true,
    );
    testWindow.__MAP_PANZOOM_DRAG_FRAME__ = probe;
  });
}

async function readDragFrameProbe(page: Page) {
  await waitForPaint(page);
  return page.evaluate(
    () =>
      (
        window as Window & {
          __MAP_PANZOOM_DRAG_FRAME__?: { maxMoveToFrameMs: number | null };
        }
      ).__MAP_PANZOOM_DRAG_FRAME__,
  );
}

async function readContextMenuProbe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __MAP_PANZOOM_CONTEXT_MENU__?: { count: number; prevented: boolean };
        }
      ).__MAP_PANZOOM_CONTEXT_MENU__,
  );
}

async function capture(page: Page, name: string) {
  if (!CAPTURE_DIR) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    fullPage: false,
    path: join(CAPTURE_DIR, `${name}.png`),
  });
}

function expectNear(actual: number, expected: number, tolerance = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test.describe("company map pan and zoom", () => {
  test("zooms toward a Chromium pinch wheel pointer and records its event sample", async ({
    page,
  }, testInfo) => {
    await openMap(page);
    const hub = page.getByTestId("cofounder-map-company-hub");
    const pointer = await pointAt(hub);
    const before = await pointAt(hub);

    await recordNextWheel(page);
    await dispatchWheel(page, pointer, { deltaY: -120, modifiers: 2 });
    await waitForPaint(page);

    const after = await pointAt(hub);
    const camera = await readCamera(page);
    const sample = await readWheelSample(page);
    expect(camera.scale).toBeGreaterThan(1);
    expectNear(after.x, before.x, 2);
    expectNear(after.y, before.y, 2);
    expect(sample).toMatchObject({
      ctrlKey: true,
      deltaMode: 0,
      deltaX: 0,
      deltaY: -120,
      isTrusted: true,
      metaKey: false,
    });
    await testInfo.attach("chromium-pinch-wheel-sample.json", {
      body: JSON.stringify(sample, null, 2),
      contentType: "application/json",
    });
  });

  test("zooms for Ctrl and Cmd wheel input", async ({ page }, testInfo) => {
    await openMap(page);
    const pointer = await pointAt(
      page.getByTestId("cofounder-map-company-hub"),
    );

    await recordNextWheel(page);
    await dispatchWheel(page, pointer, { deltaY: -90, modifiers: 2 });
    const afterControl = await readCamera(page);
    const controlSample = await readWheelSample(page);
    await recordNextWheel(page);
    await dispatchWheel(page, pointer, { deltaY: -90, modifiers: 4 });
    const afterCommand = await readCamera(page);
    const commandSample = await readWheelSample(page);

    expect(afterControl.scale).toBeGreaterThan(1);
    expect(afterCommand.scale).toBeGreaterThan(afterControl.scale);
    expect(controlSample).toMatchObject({ ctrlKey: true, metaKey: false });
    expect(commandSample).toMatchObject({ ctrlKey: false, metaKey: true });
    await testInfo.attach("modifier-wheel-samples.json", {
      body: JSON.stringify({ commandSample, controlSample }, null, 2),
      contentType: "application/json",
    });
  });

  test("pans for plain two-axis wheel scroll without guessing the device", async ({
    page,
  }, testInfo) => {
    await openMap(page);
    const pointer = await findBlankCanvasPoint(page);
    const before = await readCamera(page);

    await recordNextWheel(page);
    await dispatchWheel(page, pointer, { deltaX: 40, deltaY: 120 });
    await waitForPaint(page);

    const after = await readCamera(page);
    const sample = await readWheelSample(page);
    expect(after.scale).toBe(before.scale);
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    expect(sample).toMatchObject({
      ctrlKey: false,
      deltaMode: 0,
      isTrusted: true,
      metaKey: false,
    });
    await testInfo.attach("plain-wheel-sample.json", {
      body: JSON.stringify(sample, null, 2),
      contentType: "application/json",
    });
  });

  test("pans with right, middle, Space plus left, and empty left drags", async ({
    page,
  }) => {
    await openMap(page);
    const start = await findBlankCanvasPoint(page);
    const rightEnd = { x: start.x - 180, y: start.y + 120 };

    await installContextMenuProbe(page);
    await dragMouse(page, start, rightEnd, "right");
    const afterRight = await readCamera(page);
    const contextMenu = await readContextMenuProbe(page);
    expect(afterRight.x).toBeLessThan(0);
    expect(afterRight.y).toBeGreaterThan(0);
    expect(contextMenu).toEqual({ count: 1, prevented: true });

    await dragMouse(
      page,
      start,
      { x: start.x + 150, y: start.y - 80 },
      "middle",
    );
    const afterMiddle = await readCamera(page);
    expect(afterMiddle.x).toBeGreaterThan(afterRight.x);
    expect(afterMiddle.y).toBeLessThan(afterRight.y);

    await page.keyboard.down("Space");
    await dragMouse(page, start, { x: start.x - 120, y: start.y - 90 });
    await page.keyboard.up("Space");
    const afterSpace = await readCamera(page);
    expect(afterSpace.x).toBeLessThan(afterMiddle.x);
    expect(afterSpace.y).toBeLessThan(afterMiddle.y);

    const emptyStart = await findBlankCanvasPoint(page);
    await dragMouse(page, emptyStart, {
      x: emptyStart.x + 80,
      y: emptyStart.y + 70,
    });
    const afterEmpty = await readCamera(page);
    expect(afterEmpty.x).toBeGreaterThan(afterSpace.x);
    expect(afterEmpty.y).toBeGreaterThan(afterSpace.y);
  });

  test("ends a map drag on pointer cancellation and window blur", async ({
    page,
  }) => {
    await openMap(page);
    const viewport = page.getByTestId("cofounder-map-viewport");
    const start = await findBlankCanvasPoint(page);
    const end = { x: start.x - 90, y: start.y + 70 };

    await page.evaluate(() => {
      type ProbeWindow = Window & { __MAP_PANZOOM_POINTER_ID__?: number };
      const testWindow = window as ProbeWindow;
      testWindow.__MAP_PANZOOM_POINTER_ID__ = undefined;
      document.addEventListener(
        "pointerdown",
        (event) => {
          testWindow.__MAP_PANZOOM_POINTER_ID__ = event.pointerId;
        },
        { capture: true, once: true },
      );
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const pointerId = await page.evaluate(() => {
      const value = (window as Window & { __MAP_PANZOOM_POINTER_ID__?: number })
        .__MAP_PANZOOM_POINTER_ID__;
      if (typeof value !== "number") throw new Error("Expected a pointer ID");
      return value;
    });
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await expect(viewport).toHaveAttribute("data-camera-interacting", "true");
    await viewport.evaluate((node, cancelledPointerId) => {
      node.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: cancelledPointerId,
          pointerType: "mouse",
        }),
      );
    }, pointerId);
    await expect(viewport).not.toHaveAttribute(
      "data-camera-interacting",
      "true",
    );
    await page.mouse.up();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await expect(viewport).toHaveAttribute("data-camera-interacting", "true");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(viewport).not.toHaveAttribute(
      "data-camera-interacting",
      "true",
    );
    await page.mouse.up();
  });

  test("keeps a three-pixel job-circle press as a click", async ({ page }) => {
    await openMap(page);
    await openSalesJobs(page);
    const job = page.getByTestId("cofounder-map-job-disc-sales-lead-finding");
    const point = await pointAt(job);

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 3, point.y);
    await page.mouse.up();

    await expect(page.getByTestId("fullmap-window")).toBeVisible();
  });

  test("pans and pinches with touch input", async ({ page }) => {
    await openMap(page);
    const start = await findBlankCanvasPoint(page);

    await dispatchTouch(page, [
      { points: [{ id: 1, x: start.x, y: start.y }], type: "touchStart" },
      {
        points: [{ id: 1, x: start.x + 130, y: start.y - 80 }],
        type: "touchMove",
      },
      { points: [], type: "touchEnd" },
    ]);
    const afterTouchPan = await readCamera(page);
    expect(afterTouchPan.x).toBeGreaterThan(0);
    expect(afterTouchPan.y).toBeLessThan(0);

    const hub = await pointAt(page.getByTestId("cofounder-map-company-hub"));
    await dispatchTouch(page, [
      {
        points: [
          { id: 1, x: hub.x - 50, y: hub.y },
          { id: 2, x: hub.x + 50, y: hub.y },
        ],
        type: "touchStart",
      },
      {
        points: [
          { id: 1, x: hub.x - 110, y: hub.y + 25 },
          { id: 2, x: hub.x + 110, y: hub.y + 25 },
        ],
        type: "touchMove",
      },
      { points: [], type: "touchEnd" },
    ]);
    const afterPinch = await readCamera(page);
    expect(afterPinch.scale).toBeGreaterThan(afterTouchPan.scale);
    expect(afterPinch.y).toBeGreaterThan(afterTouchPan.y);
  });

  test("pans and zooms from a visibly focused keyboard canvas", async ({
    page,
  }) => {
    await openMap(page);
    const viewport = page.getByTestId("cofounder-map-viewport");
    await viewport.focus();
    await expect(viewport).toBeFocused();
    const before = await readCamera(page);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+Equal");
    const afterKeys = await readCamera(page);
    expect(afterKeys.x).toBeLessThan(before.x);
    expect(afterKeys.scale).toBeGreaterThan(before.scale);

    await page.keyboard.press("Digit0");
    expect(await readCamera(page)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  test("fits the measured start box and clamps a panned company into view", async ({
    page,
  }) => {
    await openMap(page);
    const stage = page.getByTestId("cofounder-map-stage");
    const viewport = page.getByTestId("cofounder-map-viewport");
    const initialBox = await readBox(stage);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const start = await findBlankCanvasPoint(page);
      const end = await viewport.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return { x: bounds.left + 12, y: bounds.bottom - 12 };
      });
      await dragMouse(page, start, end, "right");
    }
    const clamped = await stage.evaluate((node) => {
      const stageBox = node.getBoundingClientRect();
      const viewport = node.closest(".company-map-viewport");
      if (!viewport) throw new Error("Expected map viewport");
      const viewportBox = viewport.getBoundingClientRect();
      return {
        bottomVisible: stageBox.bottom - viewportBox.top,
        leftVisible: stageBox.right - viewportBox.left,
        rightVisible: viewportBox.right - stageBox.left,
        topVisible: viewportBox.bottom - stageBox.top,
      };
    });
    expect(
      Math.max(clamped.leftVisible, clamped.rightVisible),
    ).toBeGreaterThanOrEqual(72);
    expect(
      Math.max(clamped.topVisible, clamped.bottomVisible),
    ).toBeGreaterThanOrEqual(72);

    await page.getByTestId("cofounder-map-fit").click();
    await waitForAnimations(page);
    expect(await readCamera(page)).toEqual({ scale: 1, x: 0, y: 0 });
    const fittedBox = await readBox(stage);
    expectNear(fittedBox.x, initialBox.x);
    expectNear(fittedBox.y, initialBox.y);
    expectNear(fittedBox.width, initialBox.width);
    expectNear(fittedBox.height, initialBox.height);
  });

  test("keeps a 300px map drag direct with all map parts rendered", async ({
    page,
  }, testInfo) => {
    await openMap(page);
    await openSalesJobs(page);
    await installDragFrameProbe(page);
    const start = await findBlankCanvasPoint(page);

    await dragMouse(page, start, { x: start.x - 300, y: start.y + 120 });
    const frame = await readDragFrameProbe(page);
    expect(frame?.maxMoveToFrameMs).not.toBeNull();
    expect(frame?.maxMoveToFrameMs).toBeLessThan(100);
    await testInfo.attach("300px-drag-frame-cost.json", {
      body: JSON.stringify(frame, null, 2),
      contentType: "application/json",
    });
  });

  test("keeps a screen's wheel scrolling and Slice 1 box independent from the camera", async ({
    page,
  }) => {
    await openMap(page, SLICE_ONE_VIEWPORT);
    const hub = page.getByTestId("cofounder-map-company-hub");
    await dispatchWheel(page, await pointAt(hub), {
      deltaY: -120,
      modifiers: 2,
    });
    const cameraBeforeOpening = await readCamera(page);
    await openSalesLeadFinding(page);
    const window = page.getByTestId("fullmap-window");
    await waitForAnimations(page);
    const windowBox = await readBox(window);
    expect(windowBox).toEqual({ height: 699, width: 1204, x: 200, y: 124 });

    const scrollTarget = await window.evaluate((node) => {
      const candidate = [node, ...node.querySelectorAll<HTMLElement>("*")].find(
        (element): element is HTMLElement => {
          const style = getComputedStyle(element);
          return (
            /(auto|scroll)/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 8
          );
        },
      );
      if (!candidate) throw new Error("Expected a scrollable screen region");
      const box = candidate.getBoundingClientRect();
      return {
        scrollTop: candidate.scrollTop,
        x: box.x + box.width / 2,
        y: box.y + Math.min(80, box.height / 2),
      };
    });
    await page.mouse.move(scrollTarget.x, scrollTarget.y);
    await page.mouse.wheel(0, 240);
    await waitForPaint(page);
    const scrollTop = await window.evaluate(() => {
      const candidate = [
        document.querySelector("[data-testid='fullmap-window']"),
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid='fullmap-window'] *",
        ),
      ].find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
          element.scrollHeight > element.clientHeight + 8,
      );
      return candidate?.scrollTop ?? null;
    });
    expect(scrollTop).not.toBeNull();
    expect(scrollTop).toBeGreaterThan(scrollTarget.scrollTop);

    await page.getByTestId("fullmap-window-close").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await waitForAnimations(page);
    expect(await readCamera(page)).toEqual(cameraBeforeOpening);
  });

  test("leaves map-home-off on the existing shell", async ({ page }) => {
    await installMap(page, { mapHome: false });
    await page.setViewportSize(SLICE_ONE_VIEWPORT);
    await page.goto("/#/");
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("cofounder-company-map")).toHaveCount(0);
  });

  test("captures zoomed, zoomed-out, panned, and fitted map states", async ({
    page,
  }) => {
    await openMap(page);
    await openSalesJobs(page);
    const sales = page.getByTestId("cofounder-map-sales");
    await dispatchWheel(page, await pointAt(sales), {
      deltaY: -120,
      modifiers: 2,
    });
    await capture(page, "01-zoomed-sales");

    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await capture(page, "02-zoomed-out");

    const blank = await findBlankCanvasPoint(page);
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.wheel(180, -140);
    await capture(page, "03-panned");

    await page.getByTestId("cofounder-map-fit").click();
    await capture(page, "04-after-fit");
  });
});
