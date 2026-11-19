import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  fixture,
  seedCofounderTheme,
  seedCompanyMapBusiness,
  seedCompanyMapMoneyRails,
} from "./cofounder-map-fixtures";
import {
  companyMapJobKey,
  companyMapWindowSearch,
} from "../../src/features/cofounder/companyMapJobRoutes";
import { FUNCTION_DETAILS } from "../../src/features/cofounder/functions";

type Theme = "dark" | "light";

type NoScreenJob = {
  functionId: "brand" | "customer_success" | "finance" | "sales";
  jobName: string;
  side: "left" | "right";
};

type WorkspaceSeed = {
  addedAt: string;
  id: string;
  name: string;
  relayUrl: string;
};

type CardClickCostMetrics = {
  historyReplaces: number;
  snapshotCaptures: number;
};

const SCOUT_CHANNEL_ID = "fullmap-s4-scout";
const NO_SCREEN_JOBS: readonly NoScreenJob[] = [
  { functionId: "sales", jobName: "Calls", side: "right" },
  { functionId: "finance", jobName: "Recurring plans", side: "right" },
  { functionId: "customer_success", jobName: "Upsell", side: "left" },
  { functionId: "customer_success", jobName: "Reviews", side: "left" },
  { functionId: "brand", jobName: "Website", side: "left" },
  { functionId: "brand", jobName: "Portfolio", side: "left" },
  { functionId: "brand", jobName: "Marketing", side: "left" },
  { functionId: "brand", jobName: "Offer and prices", side: "left" },
  { functionId: "brand", jobName: "Voice", side: "left" },
];
const SALES_CALLS = NO_SCREEN_JOBS[0];
const CUSTOMER_SUCCESS_UPSELL = NO_SCREEN_JOBS[2];
const BRAND_WEBSITE = NO_SCREEN_JOBS[4];
const MAP_WORKSPACES: readonly WorkspaceSeed[] = [
  {
    addedAt: "2026-11-15T00:00:00.000Z",
    id: "fullmap-s4-workspace-one",
    name: "Horizon Labs",
    relayUrl: "ws://localhost:3000",
  },
  {
    addedAt: "2026-11-15T00:01:00.000Z",
    id: "fullmap-s4-workspace-two",
    name: "Second workspace",
    relayUrl: "ws://localhost:3001",
  },
];

function jobTestId({ functionId, jobName }: NoScreenJob): string {
  return `cofounder-map-job-${functionId}-${jobName
    .toLowerCase()
    .replaceAll(" ", "-")}`;
}

function routeFor(job: NoScreenJob): string {
  const mapJob = companyMapWindowSearch(job.functionId, job.jobName)?.mapJob;
  if (!mapJob) throw new Error(`Missing map job for ${job.jobName}`);
  return `/company/function/${job.functionId}?${new URLSearchParams({ mapJob }).toString()}`;
}

function hashRoute(route: string): string {
  return `/#${route}`;
}

function currentRoute(page: Page): string {
  return new URL(page.url()).hash.slice(1);
}

function noScreenCard(page: Page) {
  return page.getByTestId("fullmap-no-screen-card");
}

async function installNoScreenMap(
  page: Page,
  {
    includeScout = true,
    mapHome = true,
    theme = "light",
    workspaces,
  }: {
    includeScout?: boolean;
    mapHome?: boolean;
    theme?: Theme;
    workspaces?: readonly WorkspaceSeed[];
  } = {},
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
      ...fixture({ includeScout }),
      visualChannels: includeScout
        ? [{ id: SCOUT_CHANNEL_ID, name: "general" }]
        : [],
    },
    {
      previewFeatureOverrides: { map_home: mapHome },
      skipCommunitySeed: Boolean(workspaces),
    },
  );
  await seedCompanyMapBusiness(page);
  await seedCompanyMapMoneyRails(page);
  await page.emulateMedia({ colorScheme: theme });
}

async function expectMapWindow(page: Page, job: NoScreenJob, depth = 0) {
  const mapWindow = page.getByTestId("fullmap-window");
  await expect(mapWindow).toBeVisible({ timeout: 15_000 });
  await expect(mapWindow).toHaveAttribute("data-side", job.side);
  await expect(mapWindow).toHaveAttribute("data-trail-depth", String(depth));
}

async function expectNoScreenCard(
  page: Page,
  job: NoScreenJob,
  { scout = true }: { scout?: boolean } = {},
) {
  const card = noScreenCard(page);
  const partName = FUNCTION_DETAILS[job.functionId].name;
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute(
    "data-job",
    companyMapJobKey(job.functionId, job.jobName),
  );
  await expect(card).toHaveAccessibleName(
    `${partName}, ${job.jobName} No screen yet`,
  );
  await expect(card.getByTestId("fullmap-no-screen-cap")).toHaveText(
    `${partName}, ${job.jobName}`,
  );
  await expect(
    card.getByRole("heading", { name: "No screen yet", exact: true }),
  ).toHaveCount(1);
  await expect(card.getByRole("heading")).toHaveCount(1);
  await expect(card).toContainText(
    `${job.jobName} has no screen in the app yet.`,
  );
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "Ask Scout", exact: true }),
  ).toHaveCount(scout ? 1 : 0);
}

async function openNoScreenJob(
  page: Page,
  job: NoScreenJob,
  method: "keyboard" | "pointer",
) {
  const part = page.getByTestId(`cofounder-map-${job.functionId}`);
  if ((await part.getAttribute("aria-expanded")) !== "true") {
    await part.click();
  }
  const link = page.getByTestId(jobTestId(job));
  await expect(link).toBeVisible();
  if (method === "keyboard") {
    await link.focus();
    await page.keyboard.press("Enter");
  } else {
    await link.click();
  }
  await expectMapWindow(page, job);
  await expectNoScreenCard(page, job);
}

async function installCardClickCostProbe(page: Page) {
  await page.addInitScript(() => {
    type Probe = CardClickCostMetrics & { armed: boolean };
    type ProbeWindow = Window & {
      __FULLMAP_S4_CARD_CLICK__?: {
        read: () => CardClickCostMetrics;
        reset: () => void;
      };
    };
    const probe: Probe = {
      armed: false,
      historyReplaces: 0,
      snapshotCaptures: 0,
    };
    const cloneNode = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function (deep?: boolean) {
      if (
        probe.armed &&
        this instanceof HTMLElement &&
        this.classList.contains("map-canvas-route-window-content")
      ) {
        probe.snapshotCaptures += 1;
      }
      return cloneNode.call(this, deep);
    };
    const replaceState = History.prototype.replaceState;
    History.prototype.replaceState = function (...args) {
      if (probe.armed) probe.historyReplaces += 1;
      return replaceState.apply(this, args);
    };
    (window as ProbeWindow).__FULLMAP_S4_CARD_CLICK__ = {
      read: () => ({
        historyReplaces: probe.historyReplaces,
        snapshotCaptures: probe.snapshotCaptures,
      }),
      reset: () => {
        probe.armed = true;
        probe.historyReplaces = 0;
        probe.snapshotCaptures = 0;
      },
    };
  });
}

async function resetCardClickCostProbe(page: Page) {
  await page.evaluate(() => {
    const probe = (
      window as Window & {
        __FULLMAP_S4_CARD_CLICK__?: { reset: () => void };
      }
    ).__FULLMAP_S4_CARD_CLICK__;
    if (!probe) throw new Error("Expected the Slice 4 card click probe");
    probe.reset();
  });
}

async function readCardClickCostProbe(
  page: Page,
): Promise<CardClickCostMetrics> {
  return page.evaluate(() => {
    const probe = (
      window as Window & {
        __FULLMAP_S4_CARD_CLICK__?: { read: () => CardClickCostMetrics };
      }
    ).__FULLMAP_S4_CARD_CLICK__;
    if (!probe) throw new Error("Expected the Slice 4 card click probe");
    return probe.read();
  });
}

async function readMapCamera(page: Page) {
  return page.getByTestId("cofounder-map-stage").evaluate((node) => {
    const transform = getComputedStyle(node)
      .getPropertyValue("--company-map-transform")
      .trim();
    const match = transform.match(
      /^translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)$/,
    );
    if (!match) throw new Error(`Unexpected map transform: ${transform}`);
    return {
      scale: Number(match[3]),
      x: Number(match[1]),
      y: Number(match[2]),
    };
  });
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

function cardGeometry() {
  const card = document.querySelector<HTMLElement>(
    '[data-testid="fullmap-no-screen-card"]',
  );
  if (!card) throw new Error("Expected no-screen card");
  const bounds = card.getBoundingClientRect();
  const style = getComputedStyle(card);
  return {
    borderRadius: style.borderRadius,
    borderStyle: style.borderTopStyle,
    borderWidth: style.borderTopWidth,
    bottom: Math.round(bounds.bottom),
    height: Math.round(bounds.height),
    left: Math.round(bounds.left),
    paddingLeft: Math.round(Number.parseFloat(style.paddingLeft)),
    paddingTop: Math.round(Number.parseFloat(style.paddingTop)),
    right: Math.round(bounds.right),
    top: Math.round(bounds.top),
    width: Math.round(bounds.width),
  };
}

async function captureCard(
  page: Page,
  screenshotDir: string,
  job: NoScreenJob,
  name: string,
  { scout = true }: { scout?: boolean } = {},
) {
  await page.goto(hashRoute(routeFor(job)));
  await expectNoScreenCard(page, job, { scout });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(screenshotDir, name),
  });
}

test.describe("full map canvas slice 4", () => {
  test.describe.configure({ timeout: 120_000 });

  test("opens every no-screen job as an accessible card by pointer and keyboard", async ({
    page,
  }) => {
    await installNoScreenMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const method of ["pointer", "keyboard"] as const) {
      for (const job of NO_SCREEN_JOBS) {
        await page.goto("/#/");
        await openNoScreenJob(page, job, method);
        await expect(page.locator(".map-shell-trail-part")).toHaveText(
          FUNCTION_DETAILS[job.functionId].name,
        );
        await expect(page.locator(".map-shell-trail-job")).toHaveText(
          job.jobName,
        );
        await page.getByTestId("fullmap-window-close").click();
        await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
      }
    }
  });

  test("keeps card geometry, controls, focus, history, reload, and deep links on the map", async ({
    page,
  }) => {
    await installNoScreenMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");
    await openNoScreenJob(page, SALES_CALLS, "pointer");
    await expect(noScreenCard(page)).toBeFocused();
    await waitForAnimations(page);
    expect(await page.evaluate(cardGeometry)).toEqual({
      borderRadius: "20px",
      borderStyle: "dashed",
      borderWidth: "2px",
      bottom: 823,
      height: 699,
      left: 200,
      paddingLeft: 64,
      paddingTop: 56,
      right: 1404,
      top: 124,
      width: 1204,
    });

    await page.getByTestId("fullmap-window-close").click();
    await expect(page.getByTestId(jobTestId(SALES_CALLS))).toBeFocused();

    await openNoScreenJob(page, CUSTOMER_SUCCESS_UPSELL, "keyboard");
    await expect(noScreenCard(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId(jobTestId(CUSTOMER_SUCCESS_UPSELL)),
    ).toBeFocused();

    await openNoScreenJob(page, SALES_CALLS, "pointer");
    await page.getByTestId("cofounder-map-fit").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect.poll(() => currentRoute(page)).toBe("/");

    await page.goto("/#/");
    await openNoScreenJob(page, SALES_CALLS, "pointer");
    await page.goBack();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await page.goForward();
    await expectNoScreenCard(page, SALES_CALLS);
    await page.reload();
    await expectNoScreenCard(page, SALES_CALLS);

    await page.goto(hashRoute(routeFor(CUSTOMER_SUCCESS_UPSELL)));
    await expectNoScreenCard(page, CUSTOMER_SUCCESS_UPSELL);
    await page.goto(hashRoute(routeFor(BRAND_WEBSITE)));
    await expectNoScreenCard(page, BRAND_WEBSITE);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);

    await page.setViewportSize({ width: 2000, height: 1228 });
    await page.goto(hashRoute(routeFor(SALES_CALLS)));
    await waitForAnimations(page);
    expect(await page.evaluate(cardGeometry)).toMatchObject({
      bottom: 1151,
      height: 1027,
      left: 200,
      right: 1964,
      top: 124,
      width: 1764,
    });
    await page.goto(hashRoute(routeFor(CUSTOMER_SUCCESS_UPSELL)));
    await waitForAnimations(page);
    expect(await page.evaluate(cardGeometry)).toMatchObject({
      bottom: 1151,
      height: 1027,
      left: 36,
      right: 1800,
      top: 124,
      width: 1764,
    });
  });

  test("opens Scout chat beside the card and keeps a card click free", async ({
    page,
  }) => {
    await installCardClickCostProbe(page);
    await installNoScreenMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(hashRoute(routeFor(SALES_CALLS)));
    await expectNoScreenCard(page, SALES_CALLS, { scout: true });

    await resetCardClickCostProbe(page);
    await noScreenCard(page)
      .getByRole("heading", { name: "No screen yet", exact: true })
      .click();
    expect(await readCardClickCostProbe(page)).toEqual({
      historyReplaces: 0,
      snapshotCaptures: 0,
    });

    const scoutLink = noScreenCard(page).getByRole("link", {
      name: "Ask Scout",
      exact: true,
    });
    const scoutHref = await scoutLink.getAttribute("href");
    if (!scoutHref) throw new Error("Ask Scout needs a chat destination");
    const scoutRoute = new URL(scoutHref, page.url()).hash.slice(1);
    expect(scoutRoute).toMatch(/^\/channels\/[^/?#]+$/u);
    await scoutLink.click();
    await expectMapWindow(page, SALES_CALLS, 1);
    await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
    await expect.poll(() => currentRoute(page)).toBe(scoutRoute);
    await page.goBack();
    await expectMapWindow(page, SALES_CALLS, 0);
    await expectNoScreenCard(page, SALES_CALLS, { scout: true });
  });

  test("omits Ask Scout when the company has no Scout conversation", async ({
    page,
  }) => {
    await installNoScreenMap(page, { includeScout: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(hashRoute(routeFor(BRAND_WEBSITE)));
    await expectNoScreenCard(page, BRAND_WEBSITE, { scout: false });
  });

  test("keeps pan and zoom with a part open and clears the card on company switch", async ({
    page,
  }) => {
    await installNoScreenMap(page, { workspaces: MAP_WORKSPACES });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");
    await page.getByTestId("cofounder-map-sales").click();
    const viewport = page.getByTestId("cofounder-map-viewport");
    await viewport.focus();
    await page.keyboard.press("Shift+Equal");
    await page.keyboard.press("ArrowRight");
    const camera = await readMapCamera(page);
    expect(camera.scale).toBeGreaterThan(1);
    expect(camera.x).toBeLessThan(0);

    await page.getByTestId(jobTestId(SALES_CALLS)).focus();
    await page.keyboard.press("Enter");
    await expectNoScreenCard(page, SALES_CALLS);
    await dispatchPrimaryWorkspaceShortcut(page, "2");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe("fullmap-s4-workspace-two");
    await expect.poll(() => currentRoute(page)).toBe("/");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  test("keeps no-screen routes on the existing sidebar surface when map home is off", async ({
    page,
  }) => {
    await installNoScreenMap(page, { mapHome: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(hashRoute(routeFor(SALES_CALLS)));
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("fullmap-canvas-route-surface")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  test("keeps no-screen phone jobs on their existing part page", async ({
    page,
  }) => {
    await installNoScreenMap(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    await expect(page.getByTestId("cofounder-map-phone")).toBeVisible();
    await page.getByTestId("cofounder-map-phone-sales").click();
    await page.getByTestId("cofounder-map-phone-job-sales-calls").click();
    await expect
      .poll(() => currentRoute(page))
      .toContain("/company/function/sales");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    expect(
      await page
        .locator("body")
        .evaluate((body) => body.scrollWidth === body.clientWidth),
    ).toBe(true);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`captures card and Scout states in ${theme} when requested`, async ({
      page,
    }) => {
      test.skip(
        process.env.FULLMAP_S4_CAPTURE !== "1",
        "capture is requested only for Slice 4 visual proof",
      );
      test.setTimeout(180_000);
      const screenshotDir =
        process.env.FULLMAP_S4_SCREENSHOT_DIR ?? "test-results/fullmap-s4";
      mkdirSync(screenshotDir, { recursive: true });
      await installNoScreenMap(page, { theme });

      for (const viewport of [
        { height: 900, label: "1440x900", width: 1440 },
        { height: 1228, label: "2000x1228", width: 2000 },
        { height: 1117, label: "1728x1117", width: 1728 },
      ]) {
        await page.setViewportSize(viewport);
        await captureCard(
          page,
          screenshotDir,
          SALES_CALLS,
          `no-screen-right-${theme}-${viewport.label}.png`,
        );
        await captureCard(
          page,
          screenshotDir,
          CUSTOMER_SUCCESS_UPSELL,
          `no-screen-left-${theme}-${viewport.label}.png`,
        );
        await page.goto(hashRoute(routeFor(SALES_CALLS)));
        await expectNoScreenCard(page, SALES_CALLS, { scout: true });
        await noScreenCard(page)
          .getByRole("link", { name: "Ask Scout", exact: true })
          .click();
        await expectMapWindow(page, SALES_CALLS, 1);
        await waitForAnimations(page);
        await page.screenshot({
          animations: "disabled",
          path: join(
            screenshotDir,
            `no-screen-scout-${theme}-${viewport.label}.png`,
          ),
        });

        if (theme === "light" && viewport.label === "1440x900") {
          await captureCard(
            page,
            screenshotDir,
            SALES_CALLS,
            "comparison-WalkCalls-app-1440x900.png",
          );
          await captureCard(
            page,
            screenshotDir,
            NO_SCREEN_JOBS[1],
            "comparison-WalkFinPlans-app-1440x900.png",
          );
          await captureCard(
            page,
            screenshotDir,
            CUSTOMER_SUCCESS_UPSELL,
            "comparison-WalkCsRenew-app-1440x900.png",
          );
          await captureCard(
            page,
            screenshotDir,
            BRAND_WEBSITE,
            "comparison-WalkBrandSite-app-1440x900.png",
          );
        }
      }
    });

    test(`captures the no-Scout card in ${theme} when requested`, async ({
      page,
    }) => {
      test.skip(
        process.env.FULLMAP_S4_CAPTURE !== "1",
        "capture is requested only for Slice 4 visual proof",
      );
      test.setTimeout(180_000);
      const screenshotDir =
        process.env.FULLMAP_S4_SCREENSHOT_DIR ?? "test-results/fullmap-s4";
      mkdirSync(screenshotDir, { recursive: true });
      await installNoScreenMap(page, { includeScout: false, theme });
      for (const viewport of [
        { height: 900, label: "1440x900", width: 1440 },
        { height: 1228, label: "2000x1228", width: 2000 },
        { height: 1117, label: "1728x1117", width: 1728 },
      ]) {
        await page.setViewportSize(viewport);
        await captureCard(
          page,
          screenshotDir,
          BRAND_WEBSITE,
          `no-screen-no-scout-${theme}-${viewport.label}.png`,
          { scout: false },
        );
      }
    });
  }
});
