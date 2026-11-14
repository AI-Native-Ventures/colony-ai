import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import UPNG from "upng-js";

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
import { REFERENCE_PROSPECT_IDS } from "../../src/testing/e2eReferenceWorkspace";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

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
const SALES_OUTREACH = `/channels/${MAP_CHANNEL_ID}?mapJob=sales%3AOutreach&whatsappDeskTab=needs-you`;
const SALES_CLOSING = `/channels/${MAP_CHANNEL_ID}?mapJob=sales%3AClosing&whatsappDeskTab=pipeline`;
const FIX1_OUTREACH_LIST_ID = "3f1a7000-0000-4000-9000-000000000001";
const primedPages = new WeakSet<Page>();
const SURFACE_BOOT_TIMEOUT_MS = 40_000;

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
    referenceMoneyRecords = false,
    referenceOutreachBoard = false,
    seedClient = false,
    whatsappConnected = true,
    whatsappOutreachChannelId = MAP_CHANNEL_ID,
    workspaces,
  }: {
    mapHome?: boolean;
    referenceMoneyRecords?: boolean;
    referenceOutreachBoard?: boolean;
    seedClient?: boolean;
    whatsappConnected?: boolean;
    whatsappOutreachChannelId?: string | null;
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
      ...(referenceMoneyRecords
        ? { referenceWorkspace: true, referenceWorkspaceMoneyRecords: true }
        : {}),
      ...(referenceOutreachBoard
        ? {
            referenceWorkspace: true,
            referenceWorkspaceOutreachBoard: true,
            referenceWorkspaceOutreachReady: true,
            referenceWorkspaceOutreachSidebar: true,
          }
        : {}),
      visualChannels: [{ id: MAP_CHANNEL_ID, name: "Outreach" }],
    },
    {
      previewFeatureOverrides: { map_home: mapHome },
      skipCommunitySeed: Boolean(workspaces),
    },
  );
  await seedCompanyMapBusiness(page);
  await seedCompanyMapMoneyRails(page);
  await seedCompanyMapWhatsApp(
    page,
    whatsappOutreachChannelId,
    true,
    whatsappConnected,
  );
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
      await expect(page.getByTestId(testId)).toBeVisible({
        timeout: SURFACE_BOOT_TIMEOUT_MS,
      });
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
  const invoices = windowContent(page).locator(
    '.b3-kpi[href="#/money/invoices"]',
  );
  if (method === "keyboard") {
    await invoices.focus();
    await page.keyboard.press("Enter");
  } else {
    await invoices.click();
  }
  await expectMapWindow(page, 1);
  await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
}

async function openInvoiceDetail(page: Page) {
  const invoice = windowContent(page).locator(".b3-invoice-link").first();
  await expect(invoice).toBeVisible();
  await invoice.click();
  await expectMapWindow(page, 2);
  await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
}

async function openSalesChat(page: Page) {
  await openRoute(page, SALES_CLOSING);
  await expect(page.getByTestId("outreach-desk-pipeline")).toBeVisible();
  await windowContent(page).getByRole("button", { name: "Open chat" }).click();
  await expectMapWindow(page, 1);
  await expect(page.getByTestId("whatsapp-outreach")).toBeVisible({
    timeout: 15_000,
  });
}

async function captureFix1Screen(
  page: Page,
  screenshotDir: string,
  name: string,
  testId: string,
  depth: number,
) {
  const screen = page.getByTestId(testId);
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expectMapWindow(page, depth);
  if (testId === "w10-discovery-page") {
    await expect(screen).toHaveAttribute("data-vertical-tags-loaded", "true");
  }
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(screenshotDir, `audit-${name}-1728x1117.png`),
  });
}

async function openSalesOutreach(page: Page) {
  await openRoute(page, SALES_OUTREACH);
  await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible({
    timeout: 15_000,
  });
}

async function openSalesView(
  page: Page,
  label: "Leads" | "Lists" | "Pipeline" | "Chats",
  route: string,
) {
  await windowContent(page)
    .getByRole("navigation", { name: "Outreach views" })
    .getByRole("link", { name: label })
    .click();
  await expectRoute(page, route);
  await expectMapWindow(page, 0);
}

async function openClosingDeskView(
  page: Page,
  view: "needs-you" | "pipeline" | "chats" | "discussion",
) {
  await openRoute(page, SALES_CLOSING);
  if (view !== "pipeline") {
    await page.getByTestId(`map-outreach-tab-${view}`).click();
  }
  await expect(page.getByTestId(`map-outreach-tab-${view}`)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectMapWindow(page, 0);
}

async function waitForTheme(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-theme",
    theme === "dark" ? "buzz-dark" : "buzz",
  );
}

type OutreachDeskGeometry = {
  header: { height: number; left: number; top: number; width: number };
  tabs: { height: number; left: number; top: number; width: number };
};

async function outreachDeskGeometry(page: Page): Promise<OutreachDeskGeometry> {
  const window = page.getByTestId("fullmap-window");
  const [header, tabs] = await Promise.all([
    window.getByTestId("map-outreach-desk-header").boundingBox(),
    window.getByTestId("map-outreach-desk-tabs").boundingBox(),
  ]);
  if (!header || !tabs) throw new Error("Expected a measurable Outreach frame");
  return {
    header: {
      height: Math.round(header.height),
      left: Math.round(header.x),
      top: Math.round(header.y),
      width: Math.round(header.width),
    },
    tabs: {
      height: Math.round(tabs.height),
      left: Math.round(tabs.x),
      top: Math.round(tabs.y),
      width: Math.round(tabs.width),
    },
  };
}

async function expectOutreachDeskFrame(
  page: Page,
  active: "needs-you" | "leads" | "lists" | "pipeline" | "chats" | "discussion",
  expectedGeometry?: OutreachDeskGeometry,
) {
  const header = page.getByTestId("map-outreach-desk-header");
  const tabs = page.getByTestId("map-outreach-desk-tabs");
  await expect(header).toBeVisible({ timeout: 15_000 });
  await expect(
    windowContent(page).getByRole("heading", { level: 1, name: "Outreach" }),
  ).toHaveCount(1);
  await expect(tabs).toHaveCount(1);
  await expect(tabs).toBeVisible();
  await expect(tabs.getByTestId("map-outreach-tab-needs-you")).toBeVisible();
  await expect(tabs.getByTestId("map-outreach-tab-leads")).toBeVisible();
  await expect(tabs.getByTestId("map-outreach-tab-lists")).toBeVisible();
  await expect(tabs.getByTestId("map-outreach-tab-pipeline")).toBeVisible();
  await expect(tabs.getByTestId("map-outreach-tab-chats")).toBeVisible();
  await expect(tabs.getByTestId("map-outreach-tab-more")).toBeVisible();
  if (active === "discussion") {
    await expect(tabs.getByTestId("map-outreach-tab-more")).toHaveAttribute(
      "aria-current",
      "page",
    );
  } else {
    await expect(
      tabs.getByTestId(`map-outreach-tab-${active}`),
    ).toHaveAttribute("aria-current", "page");
  }
  await expectMapWindow(page, 0);
  await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
  await waitForAnimations(page);
  const geometry = await outreachDeskGeometry(page);
  if (expectedGeometry) expect(geometry).toEqual(expectedGeometry);
  return geometry;
}

async function selectOutreachMoreView(
  page: Page,
  view: "discussion" | "knowledge" | "canvas" | "files",
) {
  const tabs = windowContent(page).getByTestId("map-outreach-desk-tabs");
  await tabs.getByTestId("map-outreach-tab-more").click();
  await expect(tabs.getByTestId(`map-outreach-tab-${view}`)).toBeVisible();
  await tabs.getByTestId(`map-outreach-tab-${view}`).click();
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
  const peekSnapshot = document.querySelector<HTMLElement>(
    ".map-canvas-route-peek-snapshot",
  );
  if (!peekSnapshot) throw new Error("Expected map trail peek snapshot");
  return {
    connector: box(".map-canvas-route-trail-connector"),
    mapTransform: stage.style.getPropertyValue("--company-map-transform"),
    peek: box('[data-testid="fullmap-window-peek"]'),
    peekSnapshotTransform: peekSnapshot.style.transform,
    stageDuration: stageStyle.transitionDuration,
    stageTiming: stageStyle.transitionTimingFunction,
    window: box(".map-canvas-route-window-content"),
    windowDuration: windowStyle.animationDuration,
    windowTiming: windowStyle.animationTimingFunction,
  };
}

type PeekEvidence = {
  paintColours: number;
  peekBounds: string | null;
  sourceAttached: boolean;
  sourceBounds: string | null;
  sourceIntersectsPeek: boolean;
  snapshotPresent: boolean;
};

function boundsLabel(
  bounds: { height: number; width: number; x: number; y: number } | null,
): string | null {
  return bounds
    ? `${Math.round(bounds.x)},${Math.round(bounds.y)} ${Math.round(bounds.width)}x${Math.round(bounds.height)}`
    : null;
}

function paintedColourCount(png: Buffer): number {
  const pngBuffer = png.buffer.slice(
    png.byteOffset,
    png.byteOffset + png.byteLength,
  );
  const decoded = UPNG.decode(pngBuffer);
  const pixels = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
  const colours = new Set<string>();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    colours.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
  }
  return colours.size;
}

function peekInteriorClip(bounds: {
  height: number;
  width: number;
  x: number;
  y: number;
}) {
  const inset = 4;
  return {
    height: Math.max(1, bounds.height - inset * 2),
    width: Math.max(1, bounds.width - inset * 2),
    x: bounds.x + inset,
    y: bounds.y + inset,
  };
}

async function peekEvidence(
  page: Page,
  sourceTestId: string,
): Promise<PeekEvidence> {
  const peek = page.getByTestId("fullmap-window-peek");
  if ((await peek.count()) === 0) {
    return {
      paintColours: 0,
      peekBounds: null,
      snapshotPresent: false,
      sourceAttached: false,
      sourceBounds: null,
      sourceIntersectsPeek: false,
    };
  }
  const source = peek.getByTestId(sourceTestId);
  const sourceAttached = (await source.count()) > 0;
  const [peekBox, sourceBox, snapshotPresent] = await Promise.all([
    peek.boundingBox(),
    sourceAttached ? source.boundingBox() : null,
    peek.locator(".map-canvas-route-peek-snapshot").count(),
  ]);
  const sourceIntersectsPeek = Boolean(
    peekBox &&
      sourceBox &&
      sourceBox.x + sourceBox.width > peekBox.x &&
      sourceBox.x < peekBox.x + peekBox.width &&
      sourceBox.y + sourceBox.height > peekBox.y &&
      sourceBox.y < peekBox.y + peekBox.height,
  );
  const paintColours = peekBox
    ? paintedColourCount(
        await page.screenshot({
          clip: peekInteriorClip(peekBox),
        }),
      )
    : 0;
  return {
    paintColours,
    peekBounds: boundsLabel(peekBox),
    snapshotPresent: snapshotPresent > 0,
    sourceAttached,
    sourceBounds: boundsLabel(sourceBox),
    sourceIntersectsPeek,
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
        left: 0,
        right: 144,
        top: 124,
        width: 144,
      },
      peekSnapshotTransform: "translateX(-1060px)",
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

  test("runs the predecessor strip to the canvas edge at 2000 by 1228", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 2000, height: 1228 });
    await openMoney(page);
    await openInvoices(page);
    await waitForAnimations(page);

    const geometry = await page.evaluate(deepGeometry);
    expect(geometry.peek).toEqual({
      bottom: 1151,
      height: 1027,
      left: 0,
      right: 144,
      top: 124,
      width: 144,
    });
    expect(geometry.peekSnapshotTransform).toBe("translateX(-1620px)");
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

  for (const theme of ["light", "dark"] as const) {
    test(`uses the ink-2 connector and port in ${theme}`, async ({ page }) => {
      await installFullMap(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openMoney(page);
      await openInvoices(page);
      await waitForAnimations(page);

      const colours = await page.evaluate(() => {
        const connector = document.querySelector<HTMLElement>(
          ".map-canvas-route-trail-connector",
        );
        const port = document.querySelector<HTMLElement>(
          ".map-canvas-route-trail-port",
        );
        if (!connector || !port) {
          throw new Error("Expected the visible trail connector and port");
        }
        const tokenProbe = document.createElement("span");
        tokenProbe.style.backgroundColor = "hsl(var(--colony-fg-secondary))";
        document.body.append(tokenProbe);
        const ink2 = getComputedStyle(tokenProbe).backgroundColor;
        tokenProbe.remove();
        return {
          connector: getComputedStyle(connector).backgroundColor,
          ink2,
          port: getComputedStyle(port).backgroundColor,
        };
      });
      expect(colours.connector).toBe(colours.ink2);
      expect(colours.port).toBe(colours.ink2);
    });
  }

  test("keeps painted predecessor content in Finance and Outreach peeks", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await openMoney(page);
    await openInvoices(page);
    await waitForAnimations(page);
    const finance = await peekEvidence(page, "money-overview");

    await openSalesChat(page);
    await waitForAnimations(page);
    const outreach = await peekEvidence(page, "outreach-desk-pipeline");

    for (const [screen, evidence] of [
      ["Finance", finance],
      ["Outreach", outreach],
    ] as const) {
      expect
        .soft(
          evidence,
          `${screen} peek retains its first-screen element: ${JSON.stringify(evidence)}`,
        )
        .toMatchObject({
          snapshotPresent: true,
          sourceAttached: true,
          sourceIntersectsPeek: true,
        });
      expect
        .soft(
          evidence.paintColours,
          `${screen} peek is not a flat-colour strip`,
        )
        .toBeGreaterThan(6);
    }
    expect
      .soft(currentRoute(page), "Open chat creates the Chats canvas route")
      .toContain("whatsappDeskTab=chats");
  });

  test("opens body routes by keyboard and replaces only the newest same-desk screen", async ({
    page,
  }) => {
    await installFullMap(page, "light", { referenceMoneyRecords: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page, "keyboard");
    await openInvoiceDetail(page);
    await waitForAnimations(page);

    await expect.poll(() => currentRoute(page)).toContain("/money/invoice/");
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

    await windowContent(page)
      .getByRole("navigation", { name: "Money views" })
      .getByRole("link", { name: "Overview" })
      .click();
    await expectMapWindow(page, 2);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(1);
    await expectRoute(page, "/money");
  });

  test("moves one level with close, browser history, peek, Escape, and Zoom out", async ({
    page,
  }) => {
    await installFullMap(page, "light", { referenceMoneyRecords: true });
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
    await expect(
      page.getByTestId("fullmap-window-peek").getByTestId("money-overview"),
    ).toBeVisible();

    await page.getByTestId("fullmap-window-peek").click();
    await expectMapWindow(page, 0);
    await openInvoices(page);
    await page.keyboard.press("Escape");
    await expectMapWindow(page, 0);

    await openInvoices(page);
    await openInvoiceDetail(page);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expectMapWindow(page, 1);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expectMapWindow(page, 0);
  });

  test("sanitizes unsafe peek markup and leaves the remaining markup inert", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await windowContent(page).evaluate((root) => {
      const probe = document.createElement("div");
      probe.dataset.testid = "snapshot-sanitizer-probe";
      probe.style.cssText =
        "position: absolute; right: 0; top: 0; width: 112px; height: 32px";
      probe.innerHTML = [
        '<a data-testid="snapshot-sanitizer-anchor" href="#/clients">Archived link</a>',
        '<form data-testid="snapshot-sanitizer-form"><button type="submit">Archived form</button></form>',
        '<object data-testid="snapshot-sanitizer-object"></object>',
        '<embed data-testid="snapshot-sanitizer-embed">',
        '<link data-testid="snapshot-sanitizer-link" rel="stylesheet">',
        '<meta data-testid="snapshot-sanitizer-meta">',
        '<base data-testid="snapshot-sanitizer-base">',
        '<div data-testid="snapshot-sanitizer-fixed" style="position: fixed; top: 0">Fixed</div>',
      ].join("");
      root.append(probe);
    });
    await openInvoices(page);

    const peek = page.getByTestId("fullmap-window-peek");
    await expect(peek.getByTestId("snapshot-sanitizer-probe")).toHaveCount(1);
    await expect(peek.locator("object, embed, link, meta, base")).toHaveCount(
      0,
    );
    const fixed = peek.getByTestId("snapshot-sanitizer-fixed");
    await expect(fixed).toHaveCount(1);
    expect(await fixed.getAttribute("style")).toBeNull();

    const safety = await page.evaluate(() => {
      const clip = document.querySelector<HTMLElement>(
        ".map-canvas-route-peek-clip",
      );
      const anchor = document.querySelector<HTMLElement>(
        '[data-testid="snapshot-sanitizer-anchor"]',
      );
      if (!clip || !anchor) throw new Error("Expected snapshot safety probes");
      anchor.focus();
      const bounds = anchor.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return {
        focusedAnchor: document.activeElement === anchor,
        inert: clip.hasAttribute("inert"),
        pointerEvents: getComputedStyle(clip).pointerEvents,
        coveredByBackButton: Boolean(
          hit?.closest(".map-canvas-route-peek-back"),
        ),
      };
    });
    expect(safety).toEqual({
      coveredByBackButton: true,
      focusedAnchor: false,
      inert: true,
      pointerEvents: "none",
    });
  });

  test("keeps an oversize live predecessor and restores a labelled window fallback after reload", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await windowContent(page).evaluate((root) => {
      const marker = document.createElement("div");
      marker.dataset.testid = "snapshot-over-cap";
      marker.dataset.payload = "x".repeat(256 * 1024 + 1);
      root.append(marker);
    });
    await openInvoices(page);

    const peek = page.getByTestId("fullmap-window-peek");
    await expect(peek.getByTestId("snapshot-over-cap")).toHaveCount(1);
    const persistedSnapshot = await page.evaluate(() => {
      const state = window.history.state as {
        mapCanvasTrail?: { entries?: Array<{ snapshot?: unknown }> };
      };
      return state.mapCanvasTrail?.entries?.at(-2)?.snapshot;
    });
    expect(persistedSnapshot).toBeNull();

    await page.reload();
    await expectMapWindow(page, 1);
    const fallback = page.locator(".map-canvas-route-peek-fallback");
    await expect(fallback).toHaveText("Chasing payments");
    await expect(peek.locator(".map-canvas-route-peek-snapshot")).toHaveCount(
      0,
    );
    const appearance = await fallback.evaluate((node) => {
      const peekNode = node.closest<HTMLElement>(
        '[data-testid="fullmap-window-peek"]',
      );
      const shell = peekNode?.querySelector<HTMLElement>(
        ".map-canvas-route-peek-shell",
      );
      if (!peekNode || !shell)
        throw new Error("Expected fallback window shell");
      return {
        outerOverflow: getComputedStyle(peekNode).overflow,
        shellBoxShadow: getComputedStyle(shell).boxShadow,
        shellOverflow: getComputedStyle(shell).overflow,
        shellRadius: getComputedStyle(shell).borderRadius,
      };
    });
    expect(appearance.outerOverflow).toBe("visible");
    expect(appearance.shellOverflow).toBe("hidden");
    expect(appearance.shellRadius).toBe("0px 20px 20px 0px");
    expect(appearance.shellBoxShadow).toContain("0px 0px 0px 1px");
    expect(appearance.shellBoxShadow).toContain("0px 30px 60px -34px");
  });

  test("Fit closes the complete trail and returns to the whole map", async ({
    page,
  }) => {
    await installFullMap(page, "light", { referenceMoneyRecords: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page);
    await openInvoiceDetail(page);

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

    await page.getByTestId("map-outreach-tab-chats").click();
    await expect
      .poll(() => currentRoute(page))
      .toContain("whatsappDeskTab=chats");
    await expect.poll(() => currentRoute(page)).not.toContain("mapJob=");
    await expect(page.getByTestId("map-outreach-tab-chats")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.locator(".map-shell-trail-part")).toHaveText("Sales");
    await expect(page.locator(".map-shell-trail-job")).toHaveText("Closing");
  });

  test("swaps Money view tabs in one map window", async ({ page }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);

    const moneyTabs = windowContent(page).getByRole("navigation", {
      name: "Money views",
    });
    await moneyTabs.getByRole("link", { name: "Revenue" }).click();
    await expectRoute(page, FINANCE_REVENUE);
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);

    const revenueTabs = windowContent(page).getByRole("navigation", {
      name: "Money views",
    });
    await revenueTabs.getByRole("link", { name: "Invoices" }).focus();
    await page.keyboard.press("Enter");
    await expectRoute(page, FINANCE_INVOICES);
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);

    await page.goBack();
    await expectRoute(page, FINANCE_REVENUE);
    await expectMapWindow(page, 0);
    await page.goBack();
    await expectRoute(page, FINANCE_MONEY);
    await expectMapWindow(page, 0);
  });

  test("swaps Sales tabs and the Leads Find prospects header action in one map window", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoute(page, SALES_OUTREACH);

    const needsTabs = windowContent(page).getByRole("navigation", {
      name: "Outreach views",
    });
    await needsTabs.getByRole("link", { name: "Lists" }).click();
    await expectRoute(page, "/lists");
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.getByTestId("fullmap-trail-connector")).toHaveCount(0);

    const listsTabs = windowContent(page).getByRole("navigation", {
      name: "Outreach views",
    });
    await listsTabs.getByRole("link", { name: "Pipeline" }).focus();
    await page.keyboard.press("Enter");
    await expectRoute(
      page,
      `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=pipeline`,
    );
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.getByTestId("fullmap-trail-connector")).toHaveCount(0);

    await page.goBack();
    await expectRoute(page, "/lists");
    await expectMapWindow(page, 0);
    await page.goBack();
    await expectRoute(page, SALES_OUTREACH);
    await expectMapWindow(page, 0);

    const returnedNeedsTabs = windowContent(page).getByRole("navigation", {
      name: "Outreach views",
    });
    await returnedNeedsTabs.getByRole("link", { name: "Leads" }).click();
    await expectRoute(page, "/leads");
    await expectMapWindow(page, 0);

    await windowContent(page)
      .getByRole("button", { name: "Find prospects" })
      .click();
    await expectRoute(page, "/discovery");
    await expectMapWindow(page, 0);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.getByTestId("fullmap-trail-connector")).toHaveCount(0);
  });

  test("keeps every Outreach view in one measured desk from the Sales map job", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await installFullMap(page, "light", { referenceOutreachBoard: true });

    for (const { height, width } of [
      { height: 1117, width: 1728 },
      { height: 900, width: 1440 },
    ]) {
      await page.setViewportSize({ height, width });
      await page.goto("/#/");
      await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
      await page.getByTestId("cofounder-map-sales").click();
      await page.getByTestId("cofounder-map-job-sales-outreach").click();

      await expectRoute(page, SALES_OUTREACH);
      await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible();
      const geometry = await expectOutreachDeskFrame(page, "needs-you");

      const tabs = windowContent(page).getByTestId("map-outreach-desk-tabs");
      await tabs.getByTestId("map-outreach-tab-pipeline").click();
      await expectRoute(
        page,
        `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=pipeline`,
      );
      await expect(page.getByTestId("outreach-desk-pipeline")).toBeVisible();
      await expectOutreachDeskFrame(page, "pipeline", geometry);

      await tabs.getByTestId("map-outreach-tab-chats").click();
      await expectRoute(
        page,
        `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=chats`,
      );
      await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
      await expectOutreachDeskFrame(page, "chats", geometry);

      await tabs.getByTestId("map-outreach-tab-leads").click();
      await expectRoute(page, "/leads");
      await expect(page.getByTestId("w10-leads-page")).toBeVisible();
      await expectOutreachDeskFrame(page, "leads", geometry);

      await tabs.getByTestId("map-outreach-tab-lists").click();
      await expectRoute(page, "/lists");
      await expect(page.getByTestId("outreach-lists-page")).toBeVisible();
      await expectOutreachDeskFrame(page, "lists", geometry);

      await windowContent(page)
        .getByRole("link", { name: "Melville guesthouses, Nov" })
        .click();
      await expectRoute(page, `/lists/${FIX1_OUTREACH_LIST_ID}`);
      await expect(page.getByTestId("outreach-list-detail")).toBeVisible();
      await expectOutreachDeskFrame(page, "lists", geometry);

      await selectOutreachMoreView(page, "discussion");
      await expectRoute(
        page,
        `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=discussion`,
      );
      await expect(page.getByTestId("channel-drop-zone")).toBeVisible();
      await expectOutreachDeskFrame(page, "discussion", geometry);

      await selectOutreachMoreView(page, "knowledge");
      await expectRoute(
        page,
        `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=discussion&outreachWorkArea=knowledge`,
      );
      await expect(page.getByTestId("map-outreach-work-area")).toBeVisible();
      await expect(page.getByTestId("work-area-panel")).toHaveCount(0);
      await expect(page.getByTestId("work-area-knowledge")).toBeVisible();
      await expectOutreachDeskFrame(page, "discussion", geometry);

      await selectOutreachMoreView(page, "canvas");
      await expectRoute(
        page,
        `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=discussion&outreachWorkArea=canvas`,
      );
      await expect(page.getByTestId("work-area-canvas")).toBeVisible();
      await expectOutreachDeskFrame(page, "discussion", geometry);

      await selectOutreachMoreView(page, "files");
      await expectRoute(
        page,
        `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=discussion&outreachWorkArea=files`,
      );
      await expect(page.getByTestId("map-outreach-work-area")).toBeVisible();
      await expect(page.getByTestId("work-area-panel")).toHaveCount(0);
      await expect(
        page.locator("[data-testid^='work-area-files']").first(),
      ).toBeVisible();
      await expectOutreachDeskFrame(page, "discussion", geometry);

      await page.goBack();
      await expectRoute(
        page,
        `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=discussion&outreachWorkArea=canvas`,
      );
      await expectOutreachDeskFrame(page, "discussion", geometry);

      await page.getByTestId("fullmap-window-close").click();
      await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
      await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    }
  });

  test("keeps missing WhatsApp setup inside the same Outreach desk", async ({
    page,
  }) => {
    await installFullMap(page, "light", {
      whatsappConnected: false,
      whatsappOutreachChannelId: null,
    });
    await page.setViewportSize({ width: 1728, height: 1117 });
    await page.goto("/#/");
    await page.getByTestId("cofounder-map-sales").click();
    await page.getByTestId("cofounder-map-job-sales-outreach").click();

    await expectRoute(
      page,
      "/leads?mapJob=sales%3AOutreach&outreachDeskTab=needs-you",
    );
    await expect(page.getByTestId("map-outreach-setup")).toBeVisible();
    const geometry = await expectOutreachDeskFrame(page, "needs-you");
    await expect(page.getByTestId("map-outreach-setup")).toContainText(
      "WhatsApp is not connected",
    );

    const tabs = windowContent(page).getByTestId("map-outreach-desk-tabs");
    for (const view of ["pipeline", "chats"] as const) {
      await tabs.getByTestId(`map-outreach-tab-${view}`).click();
      await expectRoute(page, `/leads?outreachDeskTab=${view}`);
      await expect(page.getByTestId("map-outreach-setup")).toBeVisible();
      await expectOutreachDeskFrame(page, view, geometry);
    }

    await tabs.getByTestId("map-outreach-tab-leads").click();
    await expectRoute(page, "/leads");
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    await expectOutreachDeskFrame(page, "leads", geometry);

    await tabs.getByTestId("map-outreach-tab-lists").click();
    await expectRoute(page, "/lists");
    await expect(page.getByTestId("outreach-lists-page")).toBeVisible();
    await expectOutreachDeskFrame(page, "lists", geometry);
  });

  test("routes the retired Pipeline path into the map Outreach desk", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await primeMap(page);
    await page.goto(hashRoute("/pipeline"));

    await expectRoute(
      page,
      `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=pipeline`,
    );
    await expect(page.getByTestId("outreach-desk-pipeline")).toBeVisible();
    await expect(page.getByTestId("w10-pipeline-page")).toHaveCount(0);
    await expectOutreachDeskFrame(page, "pipeline");
  });

  test("keeps body links as a deeper map screen while tab bars contain only live views", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoute(page, SALES_OUTREACH);

    const needsTabs = windowContent(page).getByRole("navigation", {
      name: "Outreach views",
    });
    await expect(
      needsTabs.getByTestId("map-outreach-tab-needs-you"),
    ).toBeVisible();
    await expect(needsTabs.getByTestId("map-outreach-tab-leads")).toBeVisible();
    await expect(needsTabs.getByTestId("map-outreach-tab-lists")).toBeVisible();
    await expect(
      needsTabs.getByTestId("map-outreach-tab-pipeline"),
    ).toBeVisible();
    await expect(needsTabs.getByTestId("map-outreach-tab-chats")).toBeVisible();
    await expect(needsTabs.getByTestId("map-outreach-tab-more")).toBeVisible();
    await expect(needsTabs.locator("a[href='#/pipeline']")).toHaveCount(0);

    await needsTabs.getByRole("link", { name: "Lists" }).click();
    const listsTabs = windowContent(page).getByRole("navigation", {
      name: "Outreach views",
    });
    await expect(
      listsTabs.getByTestId("map-outreach-tab-lists"),
    ).toHaveAttribute("aria-current", "page");

    await openMoney(page);
    const bodyInvoice = windowContent(page).locator(
      '.b3-kpi[href="#/money/invoices"]',
    );
    await expect(bodyInvoice).toBeVisible();
    await bodyInvoice.click();
    await expectMapWindow(page, 1);
    await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
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
        left: 0,
        right: 144,
        top: 124,
        width: 144,
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

  test("does not peek a trail captured in another community after Back", async ({
    page,
  }) => {
    await installFullMap(page, "light", { workspaces: MAP_WORKSPACES });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMoney(page);
    await openInvoices(page);
    await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
    const firstCommunityState = await page.evaluate(() => window.history.state);

    await dispatchPrimaryWorkspaceShortcut(page, "2");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe("fullmap-workspace-two");
    await expectRoute(page, "/");
    const secondCommunityState = await page.evaluate(
      () => window.history.state,
    );

    await page.evaluate(
      ({ firstState, secondState, targetHref }) => {
        window.history.pushState(firstState, "", `#${targetHref}`);
        window.history.pushState(secondState, "", "#/");
      },
      {
        firstState: firstCommunityState,
        secondState: secondCommunityState,
        targetHref: FINANCE_INVOICES,
      },
    );

    await page.goBack();
    await expectRoute(page, FINANCE_INVOICES);
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(
      page.getByTestId("fullmap-window-peek").getByTestId("money-overview"),
    ).toHaveCount(0);
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

  test("captures the FIX1 Sales and Outreach screen audit when requested", async ({
    page,
  }) => {
    test.skip(
      process.env.FIX1_CAPTURE !== "1",
      "capture is requested only for owner-feedback proof",
    );
    test.setTimeout(180_000);
    const screenshotDir =
      process.env.FIX1_SCREENSHOT_DIR ?? "test-results/fix1";
    mkdirSync(screenshotDir, { recursive: true });
    await installFullMap(page, "light", { referenceOutreachBoard: true });
    await installDiscoveryImageMocks(page);
    await page.setViewportSize({ width: 1728, height: 1117 });

    await openSalesOutreach(page);
    await captureFix1Screen(
      page,
      screenshotDir,
      "outreach-needs-you",
      "outreach-desk-needs-you",
      0,
    );

    await openSalesView(page, "Leads", "/leads");
    await captureFix1Screen(
      page,
      screenshotDir,
      "sales-leads",
      "w10-leads-page",
      0,
    );

    await openSalesView(page, "Lists", "/lists");
    await captureFix1Screen(
      page,
      screenshotDir,
      "sales-lists",
      "outreach-lists-page",
      0,
    );

    await windowContent(page)
      .getByRole("link", { name: "Melville guesthouses, Nov" })
      .click();
    await expectRoute(page, `/lists/${FIX1_OUTREACH_LIST_ID}`);
    await captureFix1Screen(
      page,
      screenshotDir,
      "sales-list-melville",
      "outreach-list-detail",
      1,
    );

    await openSalesOutreach(page);
    await openSalesView(
      page,
      "Pipeline",
      `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=pipeline`,
    );
    await captureFix1Screen(
      page,
      screenshotDir,
      "outreach-pipeline",
      "outreach-desk-pipeline",
      0,
    );

    for (const [view, testId] of [
      ["needs-you", "outreach-desk-needs-you"],
      ["pipeline", "outreach-desk-pipeline"],
      ["chats", "whatsapp-outreach"],
      ["discussion", "channel-drop-zone"],
    ] as const) {
      await openClosingDeskView(page, view);
      await captureFix1Screen(
        page,
        screenshotDir,
        `outreach-${view}`,
        testId,
        0,
      );
    }

    await openSalesOutreach(page);
    await windowContent(page)
      .locator("tr")
      .filter({ hasText: "Jacaranda Lane Guesthouse" })
      .getByRole("link", { name: "Review lead" })
      .click();
    await expectRoute(page, `/sales/lead/${REFERENCE_PROSPECT_IDS.stillroom}`);
    await captureFix1Screen(
      page,
      screenshotDir,
      "sales-lead-jacaranda",
      "w10-prospect-page",
      1,
    );

    await openSalesOutreach(page);
    await windowContent(page)
      .getByRole("button", { name: "Find prospects" })
      .click();
    await expectRoute(page, "/discovery");
    await captureFix1Screen(
      page,
      screenshotDir,
      "sales-discovery",
      "w10-discovery-page",
      0,
    );
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

      await installFullMap(page, theme, {
        referenceMoneyRecords: true,
        seedClient: true,
      });
      for (const viewport of [
        { height: 900, label: "1440", width: 1440 },
        { height: 1228, label: "2000", width: 2000 },
      ]) {
        await page.setViewportSize(viewport);
        await openSalesChat(page);
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
        await openInvoiceDetail(page);
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
