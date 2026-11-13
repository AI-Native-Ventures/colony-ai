import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

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
import {
  companyMapWindowSearch,
  getCompanyMapJobRoute,
} from "../../src/features/cofounder/companyMapJobRoutes";
import { FUNCTION_DETAILS } from "../../src/features/cofounder/functions";

type WindowJob = {
  functionId: "sales" | "finance";
  jobName: string;
};

type WorkspaceSeed = {
  addedAt: string;
  id: string;
  name: string;
  relayUrl: string;
};

const MAP_WORKSPACES: WorkspaceSeed[] = [
  {
    addedAt: "2026-11-13T00:00:00.000Z",
    id: "fullmap-workspace-one",
    name: "Horizon Labs",
    relayUrl: "ws://localhost:3000",
  },
  {
    addedAt: "2026-11-13T00:01:00.000Z",
    id: "fullmap-workspace-two",
    name: "Second workspace",
    relayUrl: "ws://localhost:3001",
  },
];

const WINDOW_JOBS: readonly WindowJob[] = [
  { functionId: "sales", jobName: "Lead finding" },
  { functionId: "sales", jobName: "Outreach" },
  { functionId: "sales", jobName: "Follow-ups" },
  { functionId: "sales", jobName: "Quotes" },
  { functionId: "sales", jobName: "Closing" },
  { functionId: "finance", jobName: "Quotes" },
  { functionId: "finance", jobName: "Invoices" },
  { functionId: "finance", jobName: "Deposits" },
  { functionId: "finance", jobName: "Chasing payments" },
  { functionId: "finance", jobName: "Costs" },
];

function mapTarget({ functionId, jobName }: WindowJob): string {
  const route = getCompanyMapJobRoute(functionId, jobName);
  const mapJob = companyMapWindowSearch(functionId, jobName)?.mapJob;
  if (route.kind === "app") {
    return `${route.to}?${new URLSearchParams({ mapJob }).toString()}`;
  }
  if (route.kind === "whatsapp") {
    return `/channels/${MAP_CHANNEL_ID}?${new URLSearchParams({
      mapJob,
      whatsappDeskTab: route.tab,
    }).toString()}`;
  }
  throw new Error(`${functionId}:${jobName} has no Slice 1 screen route`);
}

function jobTestId({ functionId, jobName }: WindowJob): string {
  return `cofounder-map-job-${functionId}-${jobName
    .toLowerCase()
    .replaceAll(" ", "-")}`;
}

function jobFileName({ functionId, jobName }: WindowJob): string {
  return `${functionId}-${jobName.toLowerCase().replaceAll(" ", "-")}`;
}

async function installFullMap(
  page: Page,
  theme: "light" | "dark" = "light",
  {
    mapHome = true,
    workspaces,
  }: { mapHome?: boolean; workspaces?: WorkspaceSeed[] } = {},
) {
  await seedCofounderTheme(page, theme);
  if (workspaces) {
    await page.addInitScript((seededWorkspaces) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify(seededWorkspaces),
      );
      window.localStorage.setItem(
        "buzz-active-community-id",
        seededWorkspaces[0]?.id ?? "",
      );
    }, workspaces);
  }
  await installMockBridge(
    page,
    {
      ...fixture(),
      visualChannels: [{ id: MAP_CHANNEL_ID, name: "Outreach" }],
    },
    {
      previewFeatureOverrides: { map_home: mapHome },
      skipCommunitySeed: Boolean(workspaces),
    },
  );
  await seedCompanyMapBusiness(page);
  await seedCompanyMapMoneyRails(page);
  await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
  await page.emulateMedia({ colorScheme: theme });
}

async function openMapJob(page: Page, job: WindowJob) {
  await page.getByTestId(`cofounder-map-${job.functionId}`).click();
  await expect(page.getByTestId(jobTestId(job))).toBeVisible();
  await page.getByTestId(jobTestId(job)).click();
  await expect(page.getByTestId("fullmap-window")).toBeVisible();
  await waitForAnimations(page);
}

async function dispatchPrimaryWorkspaceShortcut(page: Page, digit: string) {
  const cancelled = await page.evaluate((key) => {
    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      key,
      metaKey: isMac,
    });
    const wasNotCancelled = window.dispatchEvent(event);
    return !wasNotCancelled && event.defaultPrevented;
  }, digit);
  expect(cancelled).toBe(true);
}

async function waitForTheme(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-theme",
    theme === "dark" ? "buzz-dark" : "buzz",
  );
}

function windowGeometry() {
  const box = (node: Element | null) => {
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) {
      return null;
    }
    const bounds = node.getBoundingClientRect();
    return {
      bottom: Math.round(bounds.bottom),
      height: Math.round(bounds.height),
      left: Math.round(bounds.left),
      right: Math.round(bounds.right),
      top: Math.round(bounds.top),
      width: Math.round(bounds.width),
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
    };
  };
  return {
    connector: box(document.querySelector(".map-canvas-route-connector")),
    jobRing: box(
      document.querySelector('[data-testid="fullmap-window-job-ring"]'),
    ),
    sales: box(
      document.querySelector(
        '[data-testid="cofounder-map-sales"] .company-map-part-disc',
      ),
    ),
    window: box(document.querySelector(".map-canvas-route-window-content")),
  };
}

function openWindowMarkupContract() {
  const box = (node: Element | null) => {
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) {
      return null;
    }
    const bounds = node.getBoundingClientRect();
    return {
      bottom: Math.round(bounds.bottom),
      height: Math.round(bounds.height),
      left: Math.round(bounds.left),
      right: Math.round(bounds.right),
      top: Math.round(bounds.top),
      width: Math.round(bounds.width),
    };
  };
  const color = (value: string) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
  };
  const window = document.querySelector<HTMLElement>(
    ".map-canvas-route-window-content",
  );
  const close = document.querySelector<HTMLElement>(
    '[data-testid="fullmap-window-close"]',
  );
  const zoom = document.querySelector<HTMLElement>(".company-map-zoom");
  const hint = document.querySelector<HTMLElement>(".company-map-note");
  const ring = document.querySelector<HTMLElement>(
    '[data-testid="fullmap-window-job-ring"]',
  );
  if (!window || !close || !zoom || !hint || !ring) {
    throw new Error("Expected full map open-state contract nodes");
  }
  const windowBounds = window.getBoundingClientRect();
  const closeBounds = close.getBoundingClientRect();
  return {
    close: {
      background: getComputedStyle(close).backgroundColor,
      bottom: Math.round(closeBounds.bottom - windowBounds.bottom),
      color: getComputedStyle(close).color,
      height: Math.round(closeBounds.height),
      radius: getComputedStyle(close).borderRadius,
      right: Math.round(closeBounds.right - windowBounds.right),
      shadow: getComputedStyle(close).boxShadow,
      top: Math.round(closeBounds.top - windowBounds.top),
      width: Math.round(closeBounds.width),
    },
    hint: {
      opacity: getComputedStyle(hint).opacity,
      pointerEvents: getComputedStyle(hint).pointerEvents,
      transitionDuration: getComputedStyle(hint).transitionDuration,
    },
    jobLinks: Array.from(
      document.querySelectorAll<HTMLElement>(
        '.company-map-job-link[data-map-group="sales"]',
      ),
    ).map((node) => ({
      opacity: getComputedStyle(node).opacity,
      visibility: getComputedStyle(node).visibility,
    })),
    jobWires: Array.from(
      document.querySelectorAll<SVGPathElement>(".company-map-job-line"),
    ).map((node) => ({
      opacity: getComputedStyle(node).opacity,
      visibility: getComputedStyle(node).visibility,
    })),
    ring: {
      ...box(ring),
      shadow: getComputedStyle(ring).boxShadow,
    },
    tokens: {
      canvas: color("hsl(var(--colony-canvas))"),
      inkButton: color("var(--colony-ink-button)"),
    },
    window: {
      ...box(window),
      radius: getComputedStyle(window).borderRadius,
    },
    zoom: {
      ...box(zoom),
      buttons: Array.from(zoom.querySelectorAll("button")).map((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          height: Math.round(bounds.height),
          width: Math.round(bounds.width),
        };
      }),
      timing: getComputedStyle(zoom).transitionTimingFunction,
      transitionDuration: getComputedStyle(zoom).transitionDuration,
    },
  };
}

test.describe("full map canvas slice 1", () => {
  test("keeps one map alive through open, Escape, Fit, and browser history", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");
    const stage = page.getByTestId("cofounder-map-stage");
    await expect(stage).toBeVisible();
    await stage.evaluate((node) => {
      (window as Window & { fullmapStage?: Element }).fullmapStage = node;
    });
    const resourceCountBefore = await page.evaluate(
      () => performance.getEntriesByType("resource").length,
    );

    await openMapJob(page, WINDOW_JOBS[0]);
    await expect(page.getByTestId("app-sidebar-layer")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-company-map")).toHaveCount(1);
    await expect(stage).toHaveAttribute("data-map-window-open", "true");
    await expect(page.locator(".map-shell-trail-part")).toHaveText("Sales");
    await expect(page.locator(".map-shell-trail-job")).toHaveText(
      "Lead finding",
    );
    await expect
      .poll(() =>
        stage.evaluate(
          (node) =>
            node ===
            (window as Window & { fullmapStage?: Element }).fullmapStage,
        ),
      )
      .toBe(true);
    const geometry = await page.evaluate(windowGeometry);
    expect(geometry).toEqual({
      connector: {
        bottom: 185,
        height: 2,
        left: 148,
        right: 200,
        top: 183,
        width: 52,
        x: 148,
        y: 183,
      },
      jobRing: {
        bottom: 208,
        height: 48,
        left: 166,
        right: 214,
        top: 160,
        width: 48,
        x: 166,
        y: 160,
      },
      sales: {
        bottom: 228,
        height: 88,
        left: 60,
        right: 148,
        top: 140,
        width: 88,
        x: 60,
        y: 140,
      },
      window: {
        bottom: 823,
        height: 699,
        left: 200,
        right: 1404,
        top: 124,
        width: 1204,
        x: 200,
        y: 124,
      },
    });
    const openContract = await page.evaluate(openWindowMarkupContract);
    expect(openContract.window).toMatchObject({
      bottom: 823,
      height: 699,
      left: 200,
      radius: "20px",
      right: 1404,
      top: 124,
      width: 1204,
    });
    expect(openContract.close).toMatchObject({
      background: openContract.tokens.inkButton,
      color: openContract.tokens.canvas,
      height: 44,
      radius: "50%",
      right: 14,
      top: -14,
      width: 44,
    });
    expect(openContract.close.shadow).toContain("4px");
    expect(openContract.zoom).toMatchObject({
      bottom: 866,
      height: 52,
      left: 16,
      right: 156,
      top: 814,
      width: 140,
    });
    expect(openContract.zoom.buttons).toEqual([
      { height: 44, width: 44 },
      { height: 44, width: 44 },
      { height: 44, width: 44 },
    ]);
    expect(openContract.zoom.transitionDuration).toBe("0.5s");
    expect(openContract.zoom.timing).toBe("cubic-bezier(0.3, 0.8, 0.3, 1)");
    expect(openContract.hint).toEqual({
      opacity: "0",
      pointerEvents: "none",
      transitionDuration: "0.2s",
    });
    expect(openContract.ring).toMatchObject({
      bottom: 208,
      height: 48,
      left: 166,
      right: 214,
      top: 160,
      width: 48,
    });
    expect(openContract.ring.shadow).toContain("3px");
    expect(openContract.ring.shadow).toContain("7px");
    expect(openContract.jobLinks).toHaveLength(6);
    for (const jobLink of openContract.jobLinks) {
      expect(jobLink).toEqual({ opacity: "0", visibility: "hidden" });
    }
    expect(openContract.jobWires).not.toHaveLength(0);
    for (const jobWire of openContract.jobWires) {
      expect(jobWire).toEqual({ opacity: "0", visibility: "hidden" });
    }
    const motion = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>(
        '[data-testid="cofounder-map-stage"]',
      );
      const mapWindow = document.querySelector<HTMLElement>(
        '[data-testid="fullmap-window"]',
      );
      if (!stage || !mapWindow) throw new Error("Expected map motion nodes");
      return {
        stageDuration: getComputedStyle(stage).transitionDuration,
        stageTiming: getComputedStyle(stage).transitionTimingFunction,
        windowDuration: getComputedStyle(mapWindow).animationDuration,
        windowTiming: getComputedStyle(mapWindow).animationTimingFunction,
      };
    });
    expect(motion.stageDuration).toContain("0.45s");
    expect(motion.stageTiming).toContain("cubic-bezier(0.3, 0.8, 0.3, 1)");
    expect(motion.windowDuration).toBe("0.45s");
    expect(motion.windowTiming).toBe("cubic-bezier(0.3, 0.8, 0.3, 1)");
    const resourceCountAfter = await page.evaluate(
      () => performance.getEntriesByType("resource").length,
    );
    await testInfo.attach("map-persistence.json", {
      body: JSON.stringify(
        {
          resourceCountAfter,
          resourceCountBefore,
          sameStageNode: true,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-active-part", "none");

    await page.getByTestId("cofounder-map-sales").click();
    const keyboardJob = page.getByTestId(jobTestId(WINDOW_JOBS[0]));
    await keyboardJob.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
    await page.getByTestId("fullmap-window-close").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-active-part", "none");

    await openMapJob(page, WINDOW_JOBS[1]);
    await page.getByTestId("cofounder-map-fit").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-active-part", "none");

    await openMapJob(page, WINDOW_JOBS[0]);
    await page.goBack();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-active-part", "none");
    await page.goForward();
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
    await expect(stage).toHaveAttribute("data-map-window-open", "true");
  });

  test("opens every Sales and Finance screen through its real route", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const job of WINDOW_JOBS) {
      await page.goto(`/#${mapTarget(job)}`);
      await expect(page.getByTestId("fullmap-window")).toBeVisible();
      await expect(page.locator(".map-shell-trail-part")).toHaveText(
        FUNCTION_DETAILS[job.functionId].name,
      );
      await expect(page.locator(".map-shell-trail-job")).toHaveText(
        job.jobName,
      );
      await expect(
        page.locator(".map-canvas-route-window-content > *").first(),
      ).toBeAttached();
    }

    await page.goto(
      "/#/channels/e2e-company-map-whatsapp?mapJob=sales%3AClosing&whatsappDeskTab=pipeline",
    );
    await expect(page.getByTestId("outreach-desk-pipeline")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Queued to contact" }),
    ).toBeVisible();
    await expect(page.getByTestId("channel-view-tab-pipeline")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("keeps a portaled screen dialog above the map window", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#${mapTarget(WINDOW_JOBS[1])}`);
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
    await waitForAnimations(page);

    await page.getByRole("button", { name: "Add lead" }).click();
    const dialog = page.getByTestId("w10-add-lead-dialog");
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate((node) => {
          const mapWindow = document.querySelector(
            '[data-testid="fullmap-window"]',
          );
          return Boolean(mapWindow) && !mapWindow.contains(node);
        }),
      )
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
  });

  test("uses the fixed margins and growing height on a large canvas", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 2000, height: 1228 });
    await page.goto(`/#${mapTarget(WINDOW_JOBS[6])}`);
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
    await waitForAnimations(page);
    const geometry = await page.evaluate(windowGeometry);
    expect(geometry.window).toMatchObject({
      bottom: 1151,
      height: 1027,
      left: 200,
      right: 1964,
      top: 124,
      width: 1764,
    });
    expect(geometry.connector).toMatchObject({ left: 148, right: 200 });
  });

  test("removes map-window motion when reduced motion is requested", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#${mapTarget(WINDOW_JOBS[0])}`);
    const motion = await page.getByTestId("fullmap-window").evaluate((node) => {
      const styles = getComputedStyle(node);
      return {
        animationName: styles.animationName,
        transitionDuration: styles.transitionDuration,
      };
    });
    expect(motion).toEqual({
      animationName: "none",
      transitionDuration: "0s",
    });
  });

  test("keeps left-side jobs and phone jobs on their current full-page routes", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");

    await page.getByTestId("cofounder-map-operations").click();
    const leftSideJob = page.getByTestId(
      "cofounder-map-job-operations-client-intake",
    );
    await expect(leftSideJob).toBeVisible();
    await leftSideJob.click();
    await expect.poll(() => new URL(page.url()).hash).toContain("#/clients");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-company-map")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    await expect(page.getByTestId("cofounder-map-phone")).toBeVisible();
    const phoneGeometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(phoneGeometry.scrollWidth).toBe(phoneGeometry.clientWidth);
    await page.getByTestId("cofounder-map-phone-sales").click();
    const phoneJob = page.getByTestId(
      "cofounder-map-phone-job-sales-lead-finding",
    );
    await expect(phoneJob).toBeVisible();
    expect(
      await phoneJob.evaluate((node) => node.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    await phoneJob.click();
    await expect.poll(() => new URL(page.url()).hash).toContain("#/discovery");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-company-map")).toHaveCount(0);
  });

  test("keeps map-home-off routes on the existing sidebar surface", async ({
    page,
  }) => {
    await installFullMap(page, "light", { mapHome: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/clients?mapJob=sales%3AQuotes");
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("fullmap-canvas-route-surface")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-company-map")).toHaveCount(0);
  });

  test("closes the map window before a keyboard community switch", async ({
    page,
  }) => {
    await installFullMap(page, "light", { workspaces: MAP_WORKSPACES });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");
    await openMapJob(page, WINDOW_JOBS[0]);

    await dispatchPrimaryWorkspaceShortcut(page, "2");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe("fullmap-workspace-two");
    await expect.poll(() => new URL(page.url()).hash).toBe("#/");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
    await expect(page.getByTestId("cofounder-map-stage")).toHaveAttribute(
      "data-active-part",
      "none",
    );
  });

  for (const theme of ["light", "dark"] as const) {
    test(`captures approved ${theme} route states when requested`, async ({
      page,
    }) => {
      test.skip(
        process.env.FULLMAP_S1_CAPTURE !== "1",
        "capture is requested only for Slice 1 visual proof",
      );
      test.setTimeout(180_000);
      const screenshotDir =
        process.env.FULLMAP_S1_SCREENSHOT_DIR ?? "test-results/fullmap-s1";
      mkdirSync(screenshotDir, { recursive: true });

      await installFullMap(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/#/");
      await waitForTheme(page, theme);
      await page.getByTestId("cofounder-map-sales").click();
      const salesJob = page.getByTestId(jobTestId(WINDOW_JOBS[0]));
      await salesJob.focus();
      await waitForAnimations(page);
      await page.screenshot({
        animations: "disabled",
        path: join(screenshotDir, `sales-job-focus-${theme}-1440.png`),
      });
      await page.setViewportSize({ width: 2000, height: 1228 });
      await waitForAnimations(page);
      await page.screenshot({
        animations: "disabled",
        path: join(screenshotDir, `sales-job-focus-${theme}-2000.png`),
      });

      for (const viewport of [
        { height: 900, label: "1440", width: 1440 },
        { height: 1228, label: "2000", width: 2000 },
      ]) {
        await page.setViewportSize(viewport);
        for (const job of WINDOW_JOBS) {
          await page.goto(`/#${mapTarget(job)}`);
          await expect(page.getByTestId("fullmap-window")).toBeVisible();
          await waitForTheme(page, theme);
          await waitForAnimations(page);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDir,
              `${jobFileName(job)}-${theme}-${viewport.label}.png`,
            ),
          });
        }
      }
    });
  }
});
