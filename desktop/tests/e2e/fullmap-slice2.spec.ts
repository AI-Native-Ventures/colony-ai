import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  AYA_PUBKEY,
  MAP_CHANNEL_ID,
  OWNER_PUBKEY,
  SCOUT_PUBKEY,
  fixture,
  seedCofounderTheme,
  seedCompanyMapBusiness,
  seedCompanyMapMoneyRails,
  seedCompanyMapWhatsApp,
} from "./cofounder-map-fixtures";
import { planeTreeCustomerRecord } from "../../src/testing/cofounderCustomerFixtures";

type Theme = "dark" | "light";

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

const FINANCE_MONEY = "/money?mapJob=finance%3AChasing+payments";
const FINANCE_INVOICES = "/money/invoices";
const FINANCE_REVENUE = "/money/revenue";
const SALES_CLIENTS = "/clients?mapJob=sales%3AQuotes";
const SALES_CLOSING = `/channels/${MAP_CHANNEL_ID}?mapJob=sales%3AClosing&whatsappDeskTab=pipeline`;
const primedPages = new WeakSet<Page>();

function customerRecord() {
  return planeTreeCustomerRecord({
    ayaPubkey: AYA_PUBKEY,
    ownerPubkey: OWNER_PUBKEY,
    scoutPubkey: SCOUT_PUBKEY,
  });
}

async function installFullMap(
  page: Page,
  theme: Theme = "light",
  {
    mapHome = true,
    seedClient = false,
    workspaces,
  }: {
    mapHome?: boolean;
    seedClient?: boolean;
    workspaces?: WorkspaceSeed[];
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
      ...fixture(),
      ...(seedClient ? { companyCustomerRecords: [customerRecord()] } : {}),
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

function currentRoute(page: Page): string {
  return new URL(page.url()).hash.slice(1);
}

function hashRoute(route: string): string {
  return `/#${route}`;
}

function windowContent(page: Page) {
  return page.locator(".map-canvas-route-window-content");
}

async function expectMapWindow(page: Page, depth: number) {
  const window = page.getByTestId("fullmap-window");
  await expect(window).toBeVisible({ timeout: 15_000 });
  await expect(window).toHaveAttribute("data-trail-depth", String(depth));
}

async function expectRoute(page: Page, route: string) {
  await expect.poll(() => currentRoute(page), { timeout: 15_000 }).toBe(route);
}

async function visitUntilSurfaceIsReady(page: Page, testId: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/#/");
    try {
      await expect(page.getByTestId(testId)).toBeVisible({ timeout: 15_000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function primeMap(page: Page) {
  if (primedPages.has(page)) return;
  await visitUntilSurfaceIsReady(page, "cofounder-company-map");
  primedPages.add(page);
}

async function openRoute(page: Page, route: string, depth = 0) {
  await primeMap(page);
  await page.goto(hashRoute(route));
  await expectMapWindow(page, depth);
}

async function openMoney(page: Page) {
  await openRoute(page, FINANCE_MONEY);
}

async function openInvoices(
  page: Page,
  method: "keyboard" | "pointer" = "pointer",
) {
  const invoices = windowContent(page)
    .locator('a[href="#/money/invoices"]')
    .first();
  if (method === "keyboard") {
    await invoices.focus();
    await page.keyboard.press("Enter");
  } else {
    await invoices.click();
  }
  await expectMapWindow(page, 1);
  await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
}

async function openRevenue(page: Page) {
  await windowContent(page)
    .locator('a[href="#/money/revenue"]')
    .first()
    .click();
  await expectMapWindow(page, 2);
  await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
}

async function openSalesClientRecord(page: Page) {
  await openRoute(page, SALES_CLIENTS);
  await windowContent(page)
    .getByRole("link", { exact: true, name: "Plane Tree Guesthouse" })
    .click();
  await expectMapWindow(page, 1);
  await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
}

async function waitForTheme(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-theme",
    theme === "dark" ? "buzz-dark" : "buzz",
  );
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

function deepGeometry() {
  const box = (selector: string) => {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
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
  const stage = document.querySelector<HTMLElement>(
    '[data-testid="cofounder-map-stage"]',
  );
  const window = document.querySelector<HTMLElement>(
    '[data-testid="fullmap-window"]',
  );
  if (!stage || !window) throw new Error("Expected map trail nodes");
  const windowStyle = getComputedStyle(window);
  const stageStyle = getComputedStyle(stage);
  return {
    connector: box(".map-canvas-route-trail-connector"),
    mapTransform: stage.style.getPropertyValue("--company-map-transform"),
    peek: box('[data-testid="fullmap-window-peek"]'),
    stageDuration: stageStyle.transitionDuration,
    stageTiming: stageStyle.transitionTimingFunction,
    window: box(".map-canvas-route-window-content"),
    windowDuration: windowStyle.animationDuration,
    windowTiming: windowStyle.animationTimingFunction,
  };
}

test.describe("full map canvas slice 2", () => {
  test.describe.configure({ timeout: 90_000 });

  test("opens a Finance screen beside the first window by pointer", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page);
    await waitForAnimations(page);

    await expectRoute(page, FINANCE_INVOICES);
    await expect(page.locator(".map-shell-trail-part")).toHaveText("Finance");
    await expect(page.locator(".map-shell-trail-job")).toHaveText(
      "Chasing payments",
    );
    await expect(page.getByTestId("fullmap-window")).toHaveCount(1);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(1);
    const geometry = await page.evaluate(deepGeometry);
    expect(geometry).toEqual({
      connector: {
        bottom: 185,
        height: 2,
        left: 144,
        right: 200,
        top: 183,
        width: 56,
      },
      mapTransform: "translate(-2156px, -462px) scale(1)",
      peek: {
        bottom: 823,
        height: 699,
        left: 20,
        right: 144,
        top: 124,
        width: 124,
      },
      stageDuration: "0.45s, 0.45s, 0.45s",
      stageTiming:
        "cubic-bezier(0.3, 0.8, 0.3, 1), cubic-bezier(0.3, 0.8, 0.3, 1), cubic-bezier(0.3, 0.8, 0.3, 1)",
      window: {
        bottom: 823,
        height: 699,
        left: 200,
        right: 1404,
        top: 124,
        width: 1204,
      },
      windowDuration: "0.45s",
      windowTiming: "cubic-bezier(0.3, 0.8, 0.3, 1)",
    });
  });

  test("opens a direct Finance deep link as one window", async ({ page }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoute(page, FINANCE_INVOICES);

    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.locator(".map-shell-trail-part")).toHaveText("Finance");
    await expect(page.locator(".map-shell-trail-job")).toHaveText("Invoices");
  });

  test("opens by keyboard, supports a three-screen trail, and returns to a known screen", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page, "keyboard");
    await openRevenue(page);
    await waitForAnimations(page);

    await expectRoute(page, FINANCE_REVENUE);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(1);
    await expect(page.locator(".map-shell-trail-part")).toHaveText("Finance");
    await expect(page.locator(".map-shell-trail-job")).toHaveText(
      "Chasing payments",
    );
    await expect
      .poll(() =>
        page
          .getByTestId("cofounder-map-stage")
          .evaluate((node) =>
            node.style.getPropertyValue("--company-map-transform"),
          ),
      )
      .toBe("translate(-3416px, -462px) scale(1)");

    await windowContent(page).locator('a[href="#/money"]').first().click();
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expectRoute(page, FINANCE_MONEY);
  });

  test("moves one level with close, browser history, peek, Escape, and Zoom out", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await openMoney(page);
    await openInvoices(page);
    await page.getByTestId("fullmap-window-close").click();
    await expectMapWindow(page, 0);
    await expectRoute(page, FINANCE_MONEY);

    await openInvoices(page);
    await page.goBack();
    await expectMapWindow(page, 0);
    await expectRoute(page, FINANCE_MONEY);
    await page.goForward();
    await expectMapWindow(page, 1);
    await expectRoute(page, FINANCE_INVOICES);
    await page.reload();
    await expectMapWindow(page, 1);
    await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();

    await page.getByTestId("fullmap-window-peek").click();
    await expectMapWindow(page, 0);
    await openInvoices(page);
    await page.keyboard.press("Escape");
    await expectMapWindow(page, 0);

    await openInvoices(page);
    await openRevenue(page);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expectMapWindow(page, 1);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expectMapWindow(page, 0);
  });

  test("Fit closes the complete trail and returns to the whole map", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page);
    await openRevenue(page);

    await page.getByTestId("cofounder-map-fit").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expectRoute(page, "/");
    await expect(page.getByTestId("cofounder-map-stage")).toHaveAttribute(
      "data-active-part",
      "none",
    );
  });

  test("swaps a same-desk tab in place while retaining the starting Sales job", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoute(page, SALES_CLOSING);
    await expect(page.getByTestId("outreach-desk-pipeline")).toBeVisible();

    await page.getByTestId("channel-view-tab-chats").click();
    await expect
      .poll(() => currentRoute(page))
      .toContain("whatsappDeskTab=chats");
    await expect(page.getByTestId("channel-view-tab-chats")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.locator(".map-shell-trail-part")).toHaveText("Sales");
    await expect(page.locator(".map-shell-trail-job")).toHaveText("Closing");
  });

  test("keeps one trail when another map job opens", async ({ page }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page);

    await openRoute(page, SALES_CLOSING);
    await expect(page.getByTestId("outreach-desk-pipeline")).toBeVisible();
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.locator(".map-shell-trail-part")).toHaveText("Sales");
    await expect(page.locator(".map-shell-trail-job")).toHaveText("Closing");
  });

  test("keeps the deep geometry and bottom-left zoom control on a large canvas", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 2000, height: 1228 });
    await openMoney(page);
    await openInvoices(page);
    await waitForAnimations(page);

    const geometry = await page.evaluate(deepGeometry);
    expect(geometry).toMatchObject({
      connector: {
        height: 2,
        left: 144,
        right: 200,
        top: 183,
        width: 56,
      },
      mapTransform: "translate(-2156px, -462px) scale(1)",
      peek: {
        bottom: 1151,
        height: 1027,
        left: 20,
        right: 144,
        top: 124,
        width: 124,
      },
      window: {
        bottom: 1151,
        height: 1027,
        left: 200,
        right: 1964,
        top: 124,
        width: 1764,
      },
    });
    const zoom = await page
      .getByTestId("cofounder-map-zoom")
      .evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const canvas = document.querySelector<HTMLElement>(
          ".company-map-scroll",
        );
        if (!canvas) throw new Error("Expected map canvas");
        const canvasBounds = canvas.getBoundingClientRect();
        return {
          bottomGap: Math.round(canvasBounds.bottom - bounds.bottom),
          leftGap: Math.round(bounds.left - canvasBounds.left),
        };
      });
    expect(zoom).toEqual({ bottomGap: 34, leftGap: 16 });
  });

  test("clears the trail before a keyboard community switch", async ({
    page,
  }) => {
    await installFullMap(page, "light", { workspaces: MAP_WORKSPACES });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page);

    await dispatchPrimaryWorkspaceShortcut(page, "2");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe("fullmap-workspace-two");
    await expectRoute(page, "/");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  });

  test("leaves map-home-off routes on their existing sidebar surface", async ({
    page,
  }) => {
    await installFullMap(page, "light", { mapHome: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await visitUntilSurfaceIsReady(page, "app-sidebar");
    await page.goto(hashRoute(FINANCE_MONEY));
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("fullmap-canvas-route-surface")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`captures approved ${theme} trails when requested`, async ({
      page,
    }) => {
      test.skip(
        process.env.FULLMAP_S2_CAPTURE !== "1",
        "capture is requested only for Slice 2 visual proof",
      );
      test.setTimeout(180_000);
      const screenshotDir =
        process.env.FULLMAP_S2_SCREENSHOT_DIR ?? "test-results/fullmap-s2";
      mkdirSync(screenshotDir, { recursive: true });

      await installFullMap(page, theme, { seedClient: true });
      for (const viewport of [
        { height: 900, label: "1440", width: 1440 },
        { height: 1228, label: "2000", width: 2000 },
      ]) {
        await page.setViewportSize(viewport);
        await openSalesClientRecord(page);
        await waitForTheme(page, theme);
        await waitForAnimations(page);
        await page.screenshot({
          animations: "disabled",
          path: join(
            screenshotDir,
            `trail-sales-two-${theme}-${viewport.label}.png`,
          ),
        });

        await openMoney(page);
        await openInvoices(page);
        await openRevenue(page);
        await waitForTheme(page, theme);
        await waitForAnimations(page);
        await page.screenshot({
          animations: "disabled",
          path: join(
            screenshotDir,
            `trail-three-${theme}-${viewport.label}.png`,
          ),
        });

        await openMoney(page);
        await openInvoices(page);
        await waitForTheme(page, theme);
        await waitForAnimations(page);
        await page.screenshot({
          animations: "disabled",
          path: join(
            screenshotDir,
            `trail-finance-two-${theme}-${viewport.label}.png`,
          ),
        });
      }
    });
  }
});
