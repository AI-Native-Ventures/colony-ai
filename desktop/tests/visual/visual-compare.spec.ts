import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import UPNG from "upng-js";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

type StorageSeed = {
  localStorage?: Record<string, unknown>;
  sessionStorage?: Record<string, unknown>;
  cookies?: Record<string, string>;
};

type VisualAction = {
  type: "click" | "hover";
  target?: "reference" | "app" | "both";
  selector: string;
  timeoutMs?: number;
  options?: Record<string, unknown>;
};

type VisualCase = {
  id: string;
  referenceUrl: string;
  referencePrefs: StorageSeed;
  referenceInventoryRoute?: string;
  appRoute: string;
  appPrefs: StorageSeed;
  appMockData?: Record<string, unknown>;
  viewport: "1728x1117" | "1440x900";
  theme: "light" | "dark";
  actions: VisualAction[];
  clip?:
    | string
    | { x: number; y: number; width: number; height: number }
    | { selector: string }
    | { referenceSelector: string; appSelector?: string };
  referenceReadySelector?: string;
  appReadySelector?: string;
};

type VisualManifest = {
  defaults?: Partial<VisualCase>;
  cases?: Array<
    Partial<VisualCase> &
      Pick<
        VisualCase,
        "id" | "referenceUrl" | "appRoute" | "viewport" | "theme"
      >
  >;
  entries?: Array<
    Partial<VisualCase> &
      Pick<
        VisualCase,
        "id" | "referenceUrl" | "appRoute" | "viewport" | "theme"
      >
  >;
};

const manifestPath = process.env.VISUAL_COMPARE_MANIFEST;
const outputRoot = process.env.VISUAL_COMPARE_OUTPUT_DIR;
const appBaseUrl = process.env.VISUAL_COMPARE_APP_BASE_URL;
const referenceBaseUrl = process.env.VISUAL_COMPARE_REFERENCE_BASE_URL;

if (!manifestPath || !outputRoot || !appBaseUrl || !referenceBaseUrl) {
  throw new Error("Run this spec through pnpm visual:compare.");
}

const manifest = JSON.parse(
  await readFile(manifestPath, "utf8"),
) as VisualManifest;
const defaults = manifest.defaults ?? {};
const cases = (manifest.cases ?? manifest.entries ?? []).map((entry) => ({
  ...defaults,
  ...entry,
  referencePrefs: entry.referencePrefs ?? defaults.referencePrefs ?? {},
  appPrefs: entry.appPrefs ?? defaults.appPrefs ?? {},
  actions: entry.actions ?? defaults.actions ?? [],
})) as VisualCase[];

test.describe("visual comparison captures", () => {
  test.describe.configure({ mode: "serial" });

  for (const entry of cases) {
    test(`${entry.id} ${entry.viewport}`, async ({ browser }) => {
      const { width, height } = parseViewport(entry.viewport);
      const contextOptions = {
        viewport: { width, height },
        deviceScaleFactor: 1,
        colorScheme: entry.theme,
        timezoneId: "Africa/Johannesburg",
      } as const;
      const referenceContext = await browser.newContext(contextOptions);
      const appContext = await browser.newContext(contextOptions);

      try {
        const referencePage = await referenceContext.newPage();
        // Owner decision 2026-09-24: compare the app and frozen reference in
        // Manrope while keeping the reference package read-only.
        await referencePage.route("**/*.css*", async (route) => {
          const response = await route.fetch();
          const css = (await response.text()).replaceAll(
            "Satoshi",
            "Manrope Variable",
          );
          await route.fulfill({ response, body: css });
        });
        // Serve the local reference Manrope face for the frozen font request.
        await referencePage.route("**/*.woff2", async (route) => {
          const manrope = new URL(
            "manrope-latin.woff2",
            new URL(route.request().url()),
          ).toString();
          const response = await route.fetch({ url: manrope });
          await route.fulfill({ response });
        });
        await seedStorage(
          referencePage,
          entry.referencePrefs,
          new URL(entry.referenceUrl).origin,
        );
        await referencePage.goto(entry.referenceUrl, {
          waitUntil: "domcontentloaded",
        });
        await referencePage.waitForLoadState("load");

        const appPage = await appContext.newPage();
        const appUrl = new URL(entry.appRoute, appBaseUrl).toString();
        await seedStorage(appPage, entry.appPrefs, new URL(appUrl).origin);
        await installMockBridge(appPage, entry.appMockData);
        await appPage.goto(appUrl, {
          waitUntil: "domcontentloaded",
        });
        await appPage.waitForLoadState("load");

        await waitForCaptureReady(
          referencePage,
          "Manrope Variable",
          entry.referenceReadySelector,
        );
        await waitForCaptureReady(
          appPage,
          "Manrope Variable",
          entry.appReadySelector,
        );
        await performActions(entry.actions, referencePage, appPage);
        await waitForCaptureReady(
          referencePage,
          "Manrope Variable",
          entry.referenceReadySelector,
        );
        await waitForCaptureReady(
          appPage,
          "Manrope Variable",
          entry.appReadySelector,
        );
        const referenceGeometry = await inspectPageGeometry(
          referencePage,
          width,
          height,
        );
        const appGeometry = await inspectPageGeometry(appPage, width, height);

        const clip = await resolveClip(entry.clip, referencePage, appPage);
        const caseDir = path.join(outputRoot, entry.id);
        await mkdir(caseDir, { recursive: true });
        const referenceBuffer = await referencePage.screenshot({
          path: path.join(caseDir, "reference.png"),
          ...(clip ? { clip: clip.reference } : {}),
        });
        const appBuffer = await appPage.screenshot({
          path: path.join(caseDir, "app.png"),
          ...(clip ? { clip: clip.app } : {}),
        });

        const reference = decodePng(referenceBuffer);
        const app = decodePng(appBuffer);
        if (reference.width !== app.width || reference.height !== app.height) {
          throw new Error(
            `${entry.id} dimension mismatch: reference ${reference.width}x${reference.height}, app ${app.width}x${app.height}.`,
          );
        }
        const comparison = compareImages(reference, app);
        await writePng(
          path.join(caseDir, "side-by-side.png"),
          comparison.sideBySide,
        );
        await writePng(path.join(caseDir, "overlay.png"), comparison.overlay);
        await writePng(
          path.join(caseDir, "diff-heatmap.png"),
          comparison.heatmap,
        );
        await writeFile(
          path.join(caseDir, "metrics.json"),
          `${JSON.stringify(
            {
              id: entry.id,
              referenceInventoryRoute: entry.referenceInventoryRoute ?? null,
              referenceUrl: entry.referenceUrl,
              appRoute: entry.appRoute,
              viewport: entry.viewport,
              theme: entry.theme,
              deviceScaleFactor: 1,
              referenceGeometry,
              appGeometry,
              comparison: "exact-rgb-no-mask-no-threshold",
              width: reference.width,
              height: reference.height,
              changedPixels: comparison.changedPixels,
              totalPixels: comparison.totalPixels,
              changedPixelRatio: comparison.changedPixelRatio,
              meanAbsoluteChannelDelta: comparison.meanAbsoluteChannelDelta,
              diffComponentCount: comparison.diffComponentCount,
              largestDiffRegions: comparison.largestDiffRegions,
            },
            null,
            2,
          )}\n`,
        );
      } finally {
        await Promise.all([referenceContext.close(), appContext.close()]);
      }
    });
  }
});

async function seedStorage(
  page: import("@playwright/test").Page,
  seed: StorageSeed,
  origin: string,
) {
  const cookies = Object.entries(seed.cookies ?? {});
  if (cookies.length > 0) {
    await page
      .context()
      .addCookies(
        cookies.map(([name, value]) => ({ name, value, url: origin })),
      );
  }
  await page.addInitScript((storage) => {
    const setValues = (
      target: Storage,
      values: Record<string, unknown> | undefined,
    ) => {
      target.clear();
      for (const [key, value] of Object.entries(values ?? {})) {
        target.setItem(
          key,
          typeof value === "string" ? value : JSON.stringify(value),
        );
      }
    };
    setValues(window.localStorage, storage.localStorage);
    setValues(window.sessionStorage, storage.sessionStorage);
  }, seed);
}

async function waitForCaptureReady(
  page: import("@playwright/test").Page,
  expectedFont: string,
  readySelector?: string,
) {
  if (readySelector) {
    await page.locator(readySelector).first().waitFor({ state: "visible" });
  }
  await page.evaluate(async (family) => {
    // Faces load lazily on first use; request the expected face explicitly.
    await document.fonts.load(`400 14px "${family}"`);
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, expectedFont);
  await waitForAnimations(page);
  const fontState = await page.evaluate(
    ({ family, selector }) => {
      const fontTarget =
        document.querySelector(selector ?? "") ?? document.body;
      const computed = getComputedStyle(fontTarget).fontFamily;
      const available = Array.from(document.fonts).some((face) => {
        const name = face.family.replaceAll('"', "").replaceAll("'", "").trim();
        const weight = face.weight.trim();
        const supports400 =
          weight === "normal" ||
          weight === "400" ||
          (/^\d+\s+\d+$/.test(weight) &&
            Number(weight.split(/\s+/)[0]) <= 400 &&
            Number(weight.split(/\s+/)[1]) >= 400);
        return name === family && face.status === "loaded" && supports400;
      });
      return {
        computed,
        available,
        check: document.fonts.check(`400 14px "${family}"`),
      };
    },
    { family: expectedFont, selector: readySelector },
  );
  if (
    !fontState.computed.includes(expectedFont) ||
    !fontState.available ||
    !fontState.check
  ) {
    throw new Error(
      `Expected ${expectedFont} 400 to be loaded; computed=${fontState.computed}, faceLoaded=${fontState.available}, check=${fontState.check}.`,
    );
  }
}

async function inspectPageGeometry(
  page: import("@playwright/test").Page,
  expectedWidth: number,
  expectedHeight: number,
) {
  const geometry = await page.evaluate(() => {
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      document: {
        bounds: bounds(document.documentElement),
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      body: {
        bounds: bounds(document.body),
        scrollWidth: document.body.scrollWidth,
        scrollHeight: document.body.scrollHeight,
      },
    };
  });
  if (
    geometry.viewport.width !== expectedWidth ||
    geometry.viewport.height !== expectedHeight ||
    geometry.devicePixelRatio !== 1
  ) {
    throw new Error(
      `Unexpected viewport geometry: ${JSON.stringify(geometry.viewport)}, DPR ${geometry.devicePixelRatio}.`,
    );
  }
  return geometry;
}

async function performActions(
  actions: VisualAction[],
  referencePage: import("@playwright/test").Page,
  appPage: import("@playwright/test").Page,
) {
  for (const action of actions) {
    if (!action.selector)
      throw new Error("Every visual action needs a selector.");
    const target = action.target ?? "both";
    const runOnPage = async (page: import("@playwright/test").Page) => {
      const locator = page.locator(action.selector).first();
      const options = {
        timeout: action.timeoutMs ?? 10_000,
        ...(action.options ?? {}),
      };
      if (action.type === "click") {
        await locator.click(options);
      } else if (action.type === "hover") {
        await locator.hover(options);
      } else {
        throw new Error(`Unsupported action type: ${String(action.type)}`);
      }
    };
    if (target === "reference" || target === "both")
      await runOnPage(referencePage);
    if (target === "app" || target === "both") await runOnPage(appPage);
  }
}

async function resolveClip(
  clip: VisualCase["clip"],
  referencePage: import("@playwright/test").Page,
  appPage: import("@playwright/test").Page,
) {
  if (!clip) return null;
  if (typeof clip === "object" && "x" in clip) {
    const box = {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
    };
    assertClipBox(box);
    return { reference: box, app: box };
  }
  if (typeof clip === "object" && "referenceSelector" in clip) {
    const reference = await locatorBox(referencePage, clip.referenceSelector);
    const app = clip.appSelector
      ? await locatorBox(appPage, clip.appSelector)
      : reference;
    return { reference, app };
  }
  const selector = typeof clip === "string" ? clip : clip.selector;
  return {
    reference: await locatorBox(referencePage, selector),
    app: await locatorBox(appPage, selector),
  };
}

async function locatorBox(
  page: import("@playwright/test").Page,
  selector: string,
) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Clip selector was not visible: ${selector}`);
  const rounded = {
    x: Math.floor(box.x),
    y: Math.floor(box.y),
    width: Math.ceil(box.width),
    height: Math.ceil(box.height),
  };
  assertClipBox(rounded);
  return rounded;
}

function assertClipBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  if (
    !Object.values(box).every(Number.isFinite) ||
    box.x < 0 ||
    box.y < 0 ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    throw new Error(`Invalid screenshot clip: ${JSON.stringify(box)}`);
  }
}

function parseViewport(value: VisualCase["viewport"]) {
  const [width, height] = value.split("x").map(Number);
  return { width, height };
}

function decodePng(buffer: Buffer) {
  const pngBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  const decoded = UPNG.decode(pngBuffer);
  const frame = UPNG.toRGBA8(decoded)[0];
  return {
    width: decoded.width,
    height: decoded.height,
    pixels: new Uint8Array(frame),
  };
}

function compareImages(
  reference: { width: number; height: number; pixels: Uint8Array },
  app: { width: number; height: number; pixels: Uint8Array },
) {
  const { width, height } = reference;
  const totalPixels = width * height;
  const rgbaLength = totalPixels * 4;
  const heatmap = new Uint8Array(rgbaLength);
  const overlay = new Uint8Array(rgbaLength);
  const sideBySide = new Uint8Array(rgbaLength * 2);
  const changedMask = new Uint8Array(totalPixels);
  let changedPixels = 0;
  let absoluteDelta = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4;
    let maxDelta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const referenceValue = reference.pixels[offset + channel];
      const appValue = app.pixels[offset + channel];
      const delta = Math.abs(referenceValue - appValue);
      absoluteDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
      overlay[offset + channel] = Math.round((referenceValue + appValue) / 2);
      heatmap[offset + channel] = Math.min(255, delta * 5);
    }
    overlay[offset + 3] = 255;
    heatmap[offset + 3] = 255;
    if (maxDelta > 0) {
      changedMask[pixel] = 1;
      changedPixels += 1;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    sideBySide.set(
      reference.pixels.subarray(rowOffset, rowOffset + width * 4),
      y * width * 8,
    );
    sideBySide.set(
      app.pixels.subarray(rowOffset, rowOffset + width * 4),
      y * width * 8 + width * 4,
    );
  }
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = rowOffset + x * 4;
      const rightOffset = rowOffset + (width + x) * 4;
      sideBySide.set(
        app.pixels.subarray(sourceOffset, sourceOffset + 4),
        rightOffset,
      );
    }
  }

  const largestDiffRegions = findDiffRegions(changedMask, width, height);
  return {
    changedPixels,
    totalPixels,
    changedPixelRatio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
    meanAbsoluteChannelDelta: absoluteDelta / (totalPixels * 3),
    diffComponentCount: largestDiffRegions.count,
    largestDiffRegions: largestDiffRegions.top,
    sideBySide: { width: width * 2, height, pixels: sideBySide },
    overlay: { width, height, pixels: overlay },
    heatmap: { width, height, pixels: heatmap },
  };
}

function findDiffRegions(mask: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const top = [];
  let count = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] !== 0) continue;
    count += 1;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (mask[next] === 1 && visited[next] === 0) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    top.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels: tail,
    });
  }
  top.sort(
    (a, b) => b.pixels - a.pixels || b.width * b.height - a.width * a.height,
  );
  return { count, top: top.slice(0, 10) };
}

async function writePng(
  filePath: string,
  image: { width: number; height: number; pixels: Uint8Array },
) {
  const encoded = UPNG.encode(
    [image.pixels.buffer],
    image.width,
    image.height,
    0,
  );
  await writeFile(filePath, Buffer.from(encoded));
}
