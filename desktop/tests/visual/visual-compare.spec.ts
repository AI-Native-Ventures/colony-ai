import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import UPNG from "upng-js";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { compareImages } from "../../scripts/visualComparison.mjs";
import type { VisualFixtureSeed } from "../../src/testing/e2eBridge";

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
  fixtureVariant?: "reviews-empty";
  viewport: "1728x1117" | "1440x900";
  theme: "light" | "dark";
  actions: VisualAction[];
  clip?:
    | string
    | { x: number; y: number; width: number; height: number }
    | { selector: string }
    | { referenceSelector: string; appSelector?: string };
  referenceReadySelector?: string;
  referenceCanvas?: boolean;
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
const r17Fixture = JSON.parse(
  await readFile(new URL("./fixtures/g1-r17.json", import.meta.url), "utf8"),
) as VisualFixtureSeed;
const r17VoiceNoteWav = await readFile(
  new URL("./fixtures/sample-note.wav", import.meta.url),
);
const manropeFont = await readFile(
  new URL(
    "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
    import.meta.url,
  ),
);
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
        await referencePage.clock.install({
          time: new Date("2026-09-23T12:00:00+02:00"),
        });
        // Keep the frozen reference files untouched while applying the owner
        // typeface decision in memory. The reference font request is served
        // with its Manrope file and its family alias is normalized here.
        await referencePage.route(/\.css(?:\?.*)?$/, async (route) => {
          const response = await route.fetch();
          const stylesheet = await response.text();
          await route.fulfill({
            response,
            body: stylesheet.replace(/\bSatoshi\b/g, "Manrope"),
          });
        });
        await referencePage.route(
          /satoshi-variable\.woff2(?:\?.*)?$/,
          async (route) => {
            await route.fulfill({
              status: 200,
              contentType: "font/woff2",
              body: manropeFont,
            });
          },
        );
        await seedStorage(
          referencePage,
          entry.referencePrefs,
          new URL(entry.referenceUrl).origin,
        );
        if (entry.referenceInventoryRoute === "onboarding/testing") {
          await referencePage.addInitScript(() => {
            const nativeSetTimeout = window.setTimeout.bind(window);
            window.setTimeout = ((handler, timeout, ...args) => {
              if (
                window.location.hash === "#testing" &&
                (timeout === 1050 || timeout === 2550)
              ) {
                return 0;
              }
              return nativeSetTimeout(handler, timeout, ...args);
            }) as typeof window.setTimeout;
          });
        }
        await referencePage.goto(entry.referenceUrl, {
          waitUntil: "domcontentloaded",
        });
        await referencePage.waitForLoadState("load");
        if (entry.referenceCanvas) {
          await fitReferenceCanvas(referencePage, width, height);
        }

        const appPage = await appContext.newPage();
        await appPage.route(
          "https://example.invalid/voice-note-r17.wav",
          (route) =>
            route.fulfill({
              status: 200,
              contentType: "audio/x-wav",
              body: r17VoiceNoteWav,
            }),
        );
        await appPage.clock.install({
          time: new Date("2026-09-23T12:00:00+02:00"),
        });
        const appUrl = new URL(entry.appRoute, appBaseUrl).toString();
        await seedStorage(appPage, entry.appPrefs, new URL(appUrl).origin);
        await appPage.addInitScript(
          ({ pubkey }) => {
            localStorage.setItem(
              `buzz-channel-sort.v1:${pubkey}:ws%3A%2F%2Flocalhost%3A3000`,
              JSON.stringify({
                version: 1,
                groups: {
                  starred: "recent",
                  "section:client-work": "recent",
                },
              }),
            );
          },
          { pubkey: r17Fixture.identity.pubkey },
        );
        const visualFixture = {
          ...r17Fixture,
          today: {
            ...r17Fixture.today,
            ...(entry.fixtureVariant === "reviews-empty"
              ? { businessReviews: [], reviewsEmpty: true }
              : {}),
          },
        };
        await installMockBridge(appPage, {
          ...(entry.appMockData ?? {}),
          visualFixture,
        });
        if (entry.referenceInventoryRoute === "navigation/history") {
          const channelUrl = new URL(
            "/#/channels/c6f3a9b2-4d55-5a23-bf78-5b9e2a3c5d6f",
            appBaseUrl,
          ).toString();
          await appPage.goto(channelUrl, { waitUntil: "domcontentloaded" });
          await appPage.goto(
            new URL("/#/navigation/history", appBaseUrl).toString(),
            { waitUntil: "domcontentloaded" },
          );
          await appPage.goto(new URL("/#/workflows", appBaseUrl).toString(), {
            waitUntil: "domcontentloaded",
          });
          await appPage.goBack({ waitUntil: "domcontentloaded" });
        } else {
          await appPage.goto(appUrl, {
            waitUntil: "domcontentloaded",
          });
        }
        await appPage.waitForLoadState("load");

        await waitForCaptureReady(
          referencePage,
          "Manrope",
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
          "Manrope",
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
        (selector ? document.querySelector(selector) : null) ?? document.body;
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

async function fitReferenceCanvas(
  page: import("@playwright/test").Page,
  width: number,
  height: number,
) {
  await page.evaluate(
    ({ width, height }) => {
      const setStyle = (selector: string, values: Record<string, string>) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return;
        for (const [property, value] of Object.entries(values)) {
          element.style.setProperty(property, value, "important");
        }
      };

      setStyle(".reviewbar", { display: "none" });
      setStyle(".reviewfoot", { display: "none" });
      setStyle("body", { height: `${height}px` });
      setStyle("#review-canvas", {
        width: `${width}px`,
        height: `${height}px`,
        padding: "0",
        overflow: "hidden",
      });
      setStyle("#scale-space", {
        width: `${width}px`,
        height: `${height}px`,
        margin: "0",
      });
      setStyle("#canvas", {
        width: `${width}px`,
        height: `${height}px`,
        transform: "none",
        borderRadius: "0",
        boxShadow: "none",
      });
    },
    { width, height },
  );
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
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      bodyFontSize: getComputedStyle(document.body).fontSize,
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
      visualElements: [
        "#topbar",
        "#sidebar",
        "#surface",
        ".studio-page",
        ".studio-heading",
        ".today-studio-grid",
        ".cx-agent-attention",
        ".cx-agent-attention .cx-row",
        ".agency-attention-row",
        ".attention-art",
        ".studio-section",
        ".studio-section-heading",
        ".waiting-record",
        ".coverage-entry",
        ".r17-today-page",
        ".r17-today-heading",
        ".r17-today-grid",
        ".r17-today-left",
        ".r17-today-attention-row",
        ".r17-today-business-heading",
        ".r17-today-review-row",
        ".r17-today-art",
        ".r17-today-art-frame",
        ".r17-today-right",
        ".r17-today-section",
        ".r17-today-waiting-record",
        ".r17-today-money-record",
        ".colony-workspace-topbar",
        ".colony-channel-route-content",
        ".channel-pane",
        ".thread-pane",
        ".channel-header",
        ".tabs",
        ".message-list",
        ".day-divider",
        ".day-divider p",
        ".voice-player",
        ".channel-composer",
        ".channel-composer .composer",
        ".channel-composer .composer textarea",
        ".channel-composer .composer-footer",
        "[data-testid=app-sidebar]",
        "[data-testid=sidebar-team-section]",
        "[data-testid=app-top-chrome]",
        "[data-buzz-content-surface]",
        "[data-testid=chat-header]",
        "[data-testid=chat-title]",
        "[data-testid=channel-drop-zone]",
        "[data-testid=channel-composer-overlay]",
        "[data-testid=message-composer]",
        "[data-testid=message-input-scroll]",
        "[data-testid=message-composer-toolbar]",
        "[data-testid=channel-view-tabs]",
        "[data-testid=channel-view-tabs] > span:nth-child(1)",
        "[data-testid=channel-view-tabs] > span:nth-child(2)",
        "[data-testid=channel-view-tabs] > span:nth-child(3)",
        "[data-testid=channel-view-tabs] > span:nth-child(4)",
        "[data-testid=channel-view-tabs] > span:nth-child(5)",
        "[data-testid=open-search] > span:first-of-type",
        "[data-testid=sidebar-profile-name]",
        "[data-testid=sidebar-profile-user-status]",
        ".colony-composer-submit-hint",
        "[data-testid=message-timeline]",
        "[data-testid=message-timeline-day-group]",
        "[data-testid=message-timeline-day-divider]",
        "[data-testid=message-timeline-day-divider] p",
        "[data-testid=message-timeline-sticky-day-divider]",
        "[data-testid=message-timeline-sticky-day-divider-content]",
        "[data-testid=message-timeline-sticky-day-divider-content] p",
        "[data-testid=audio-message-attachment]",
        ".colony-voice-note-card",
        "[data-testid=message-thread-panel]",
        ".colony-channel-topbar",
        ".colony-channel-header",
        ".colony-thread-panel-title",
        ".colony-composer-submit-hint",
      ].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, count: 0 };
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          selector,
          count: document.querySelectorAll(selector).length,
          bounds: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          display: style.display,
          text: element.textContent?.trim() ?? "",
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          width: style.width,
          height: style.height,
          padding: style.padding,
          boxSizing: style.boxSizing,
          transform: style.transform,
          zoom: style.zoom,
          opacity: style.opacity,
          visibility: style.visibility,
          webkitTextFillColor: style.getPropertyValue(
            "-webkit-text-fill-color",
          ),
          zIndex: style.zIndex,
          position: style.position,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
        };
      }),
      timelineRows: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="message-row"], article.message',
        ),
      ).map((element) => {
        const rect = bounds(element);
        const body = element.querySelector<HTMLElement>(
          '[data-testid="message-body"], .message-body',
        );
        const meta = element.querySelector<HTMLElement>(
          '[data-testid="message-meta"], .message-meta',
        );
        return {
          bounds: rect,
          text:
            element.textContent?.trim().replace(/\s+/g, " ").slice(0, 140) ??
            "",
          bodyBounds: body ? bounds(body) : null,
          metaBounds: meta ? bounds(meta) : null,
          children: Array.from(element.querySelectorAll<HTMLElement>("*"))
            .filter(
              (child) =>
                child.parentElement === element ||
                child.matches(
                  "[data-testid], [class*='preview'], [class*='thread']",
                ),
            )
            .slice(0, 16)
            .map((child) => ({
              tag: child.tagName,
              className: child.className?.toString() ?? "",
              testId: child.dataset.testid ?? null,
              text:
                child.textContent?.trim().replace(/\s+/g, " ").slice(0, 90) ??
                "",
              bounds: bounds(child),
            })),
          bodyChildren: body
            ? Array.from(body.querySelectorAll<HTMLElement>("*"))
                .filter(
                  (child) =>
                    child.children.length === 0 || child.dataset.testid,
                )
                .slice(0, 20)
                .map((child) => ({
                  tag: child.tagName,
                  className: child.className?.toString() ?? "",
                  testId: child.dataset.testid ?? null,
                  text:
                    child.textContent
                      ?.trim()
                      .replace(/\s+/g, " ")
                      .slice(0, 90) ?? "",
                  bounds: bounds(child),
                }))
            : [],
        };
      }),
      sidebarChildren: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="sidebar-scroll-content"] > *',
        ),
      ).map((element) => ({
        testId: element.dataset.testid ?? null,
        text:
          element.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) ?? "",
        order: getComputedStyle(element).order,
      })),
      channelTabPaint: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="channel-view-tabs"] > span',
        ),
      ).map((element) => {
        const style = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(element);
        const textRect = range.getBoundingClientRect();
        const ancestors: Array<Record<string, string>> = [];
        let ancestor: HTMLElement | null = element;
        while (ancestor && ancestors.length < 5) {
          const ancestorStyle = getComputedStyle(ancestor);
          ancestors.push({
            tag: ancestor.tagName,
            className: ancestor.className.toString(),
            color: ancestorStyle.color,
            opacity: ancestorStyle.opacity,
            visibility: ancestorStyle.visibility,
            display: ancestorStyle.display,
            textIndent: ancestorStyle.textIndent,
            overflow: ancestorStyle.overflow,
            clipPath: ancestorStyle.clipPath,
            filter: ancestorStyle.filter,
            mixBlendMode: ancestorStyle.mixBlendMode,
            textShadow: ancestorStyle.textShadow,
            webkitTextFillColor: ancestorStyle.getPropertyValue(
              "-webkit-text-fill-color",
            ),
          });
          ancestor = ancestor.parentElement;
        }
        const hitStack = document
          .elementsFromPoint(
            textRect.x + textRect.width / 2,
            textRect.y + textRect.height / 2,
          )
          .map((hit) => `${hit.tagName}.${(hit as HTMLElement).className}`);
        return {
          text: element.textContent?.trim() ?? "",
          textRect: {
            x: textRect.x,
            y: textRect.y,
            width: textRect.width,
            height: textRect.height,
          },
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          color: style.color,
          webkitTextFillColor: style.getPropertyValue(
            "-webkit-text-fill-color",
          ),
          textStroke: style.getPropertyValue("-webkit-text-stroke-color"),
          textShadow: style.textShadow,
          textIndent: style.textIndent,
          clipPath: style.clipPath,
          filter: style.filter,
          mixBlendMode: style.mixBlendMode,
          animations: element
            .getAnimations()
            .map((animation) => animation.playState),
          ancestors,
          hitStack,
        };
      }),
      messageTimelineRows: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="message-timeline"] [data-testid="message-row"]',
        ),
      ).map((element) => ({
        id: element.dataset.messageId ?? null,
        text:
          element.textContent?.trim().replace(/\s+/g, " ").slice(0, 180) ?? "",
      })),
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
