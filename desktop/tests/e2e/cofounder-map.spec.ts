import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  AYA_PUBKEY,
  MAP_CHANNEL_ID,
  PROPOSED_COFOUNDER_GOAL_ID,
  SCOUT_PUBKEY,
  WORKER_ID,
  fixture,
  functionHead,
  numbersFixture,
  openMapPart,
  seedCofounderTheme,
  seedCompanyMapBusiness,
  seedCompanyMapMoneyRails,
  seedCompanyMapWhatsApp,
  selectMapPart,
  workerRun,
} from "./cofounder-map-fixtures";
import {
  FUNCTION_DETAILS,
  FUNCTION_ORDER,
} from "../../src/features/cofounder/functions";
import {
  companyMapWindowSearch,
  getCompanyMapJobRoute,
} from "../../src/features/cofounder/companyMapJobRoutes";

type ConnectorState = "live" | "on" | "off";

async function measuredConnector(page: Page, target: string) {
  const connector = page.locator(`[data-map-target="${target}"]`);
  await expect(connector).toHaveCount(1);
  await expect
    .poll(() => connector.evaluate((node) => getComputedStyle(node).stroke))
    .not.toBe("none");
  return connector.evaluate((node) => {
    const style = getComputedStyle(node);
    const tokenColor = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      animationName: style.animationName,
      dashArray: style.strokeDasharray.replaceAll("px", "").replaceAll(" ", ""),
      state: node.getAttribute("data-state"),
      stroke: style.stroke,
      strokeWidth: Number.parseFloat(style.strokeWidth),
      tokens: {
        accent: tokenColor("hsl(var(--colony-accent))"),
        need: tokenColor("hsl(var(--colony-need))"),
        off: tokenColor("hsl(var(--colony-border-strong))"),
        on: tokenColor("hsl(var(--colony-fg-secondary))"),
      },
    };
  });
}

function expectConnectorKind(
  measured: Awaited<ReturnType<typeof measuredConnector>>,
  state: ConnectorState,
) {
  const stroke =
    state === "on"
      ? measured.tokens.on
      : state === "off"
        ? measured.tokens.off
        : measured.tokens.accent;
  expect(measured).toMatchObject({
    dashArray: state === "live" ? "6,7" : state === "on" ? "none" : "2,6",
    state,
    stroke,
    strokeWidth: state === "live" ? 2.5 : 2,
  });
  expect(measured.animationName).toBe(
    state === "live" ? "company-map-dash" : "none",
  );
}

test.describe("co-founder mode desktop", () => {
  test("owner sees the company-only switch and turns it on", async ({
    page,
  }) => {
    await installMockBridge(page, fixture({ enabled: false }));
    await page.goto("/#/settings?section=experimental");

    const toggle = page.getByRole("switch", { name: "Co-founder mode" });
    await expect(toggle).toBeVisible();
    await expect(
      page.getByText(/ only · Owner and admins can switch it/),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("settings-back-to-app").click();
    await page.getByTestId("sidebar-nav-company-toggle").click();
    await expect(page.getByTestId("sidebar-company-map")).toBeVisible();
  });

  test("a member sees the co-founder switch read-only", async ({ page }) => {
    await installMockBridge(page, fixture({ role: "member", enabled: false }));
    await page.goto("/#/settings?section=experimental");

    const toggle = page.getByRole("switch", { name: "Co-founder mode" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("the company map shows five ordered parts around the company hub", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await seedCompanyMapBusiness(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/company/map");

    const map = page.getByTestId("cofounder-map-stage");
    await expect(
      page.getByRole("heading", { name: "Company map" }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: /company map$/i }),
    ).toBeVisible();
    await expect(page.getByTestId("cofounder-map-company-hub")).toHaveAttribute(
      "aria-label",
      "Horizon Labs. Lerato Molefe, founder, and Scout, chief of staff. Show the whole company.",
    );
    await expect(map).toHaveAttribute("data-active-part", "none");
    await expect(page.getByTestId("cofounder-map-company-hub")).toBeVisible();
    await expect(page.getByTestId("cofounder-map-desktop")).toBeVisible();
    await expect(page.getByTestId("cofounder-map-phone")).toBeHidden();
    const functions = map.locator("[data-function]");
    await expect(functions).toHaveCount(5);
    await expect
      .poll(() =>
        functions.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-function")),
        ),
      )
      .toEqual(["sales", "operations", "customer_success", "finance", "brand"]);
    await expect(map.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "aria-label",
      "Sales, led by Aya",
    );
    await expect(map.getByTestId("cofounder-map-operations")).toHaveAttribute(
      "aria-label",
      "Operations, covered by Scout",
    );
    await expect(map.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "data-state",
      "filled",
    );
    await expect(map.getByTestId("cofounder-map-operations")).toHaveAttribute(
      "data-state",
      "covered_by_scout",
    );
    for (const functionId of ["customer_success", "finance", "brand"]) {
      await expect(
        map.getByTestId(`cofounder-map-${functionId}`),
      ).toHaveAttribute("data-state", "empty");
    }
    const geometry = await map.evaluate((stage) => {
      const stageBounds = stage.getBoundingClientRect();
      const viewport = stage.parentElement as HTMLElement;
      // The canvas fills the window. The board's own controls are still
      // measured against the board, which is what the design numbers are for.
      const viewportBounds = stageBounds;
      const point = (selector: string) => {
        const node = stage.querySelector<HTMLElement>(selector);
        const bounds = node?.getBoundingClientRect();
        return bounds
          ? {
              x: Math.round(bounds.left - stageBounds.left + bounds.width / 2),
              y: Math.round(bounds.top - stageBounds.top + bounds.height / 2),
              width: Math.round(bounds.width),
              height: Math.round(bounds.height),
            }
          : null;
      };
      const viewportMetrics = (selector: string) => {
        const node = viewport.querySelector<HTMLElement>(selector);
        if (!node) return null;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          x: Math.round(bounds.left - viewportBounds.left),
          y: Math.round(bounds.top - viewportBounds.top),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          padding: style.padding,
          radius: style.borderRadius,
          right: Math.round(viewportBounds.right - bounds.right),
          bottom: Math.round(viewportBounds.bottom - bounds.bottom),
        };
      };
      const zoomButtons = Array.from(
        viewport.querySelectorAll<HTMLElement>(".company-map-zoom button"),
      ).map((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      });
      const homeCard = stage.querySelector<HTMLElement>(
        '[data-testid="cofounder-map-home-card"]',
      );
      const homeCardBounds = homeCard?.getBoundingClientRect();
      const homeCardStyle = homeCard ? getComputedStyle(homeCard) : null;
      const note = viewport.querySelector<HTMLElement>(".company-map-note");
      const noteBounds = note?.getBoundingClientRect();
      const noteStyle = note ? getComputedStyle(note) : null;
      return {
        size: { width: stageBounds.width, height: stageBounds.height },
        hub: point(
          '[data-testid="cofounder-map-company-hub"] .company-map-hub-disc',
        ),
        parts: Object.fromEntries(
          ["sales", "operations", "customer_success", "finance", "brand"].map(
            (functionId) => [
              functionId,
              point(
                `[data-testid="cofounder-map-${functionId}"] .company-map-part-disc`,
              ),
            ],
          ),
        ),
        zoom: viewportMetrics(".company-map-zoom"),
        zoomButtons,
        homeCard:
          homeCard && homeCardBounds && homeCardStyle
            ? {
                x: Math.round(homeCardBounds.left - stageBounds.left),
                width: Math.round(homeCardBounds.width),
                padding: homeCardStyle.padding,
                radius: homeCardStyle.borderRadius,
                right: Math.round(stageBounds.right - homeCardBounds.right),
                bottom: Math.round(stageBounds.bottom - homeCardBounds.bottom),
              }
            : null,
        note:
          note && noteBounds && noteStyle
            ? {
                text: note.textContent?.trim(),
                fontSize: noteStyle.fontSize,
                right: Math.round(viewportBounds.right - noteBounds.right),
                bottom: Math.round(viewportBounds.bottom - noteBounds.bottom),
              }
            : null,
      };
    });
    expect(geometry).toEqual({
      size: { width: 1400, height: 790 },
      hub: { x: 700, y: 395, width: 120, height: 120 },
      parts: {
        sales: { x: 980, y: 212, width: 88, height: 88 },
        operations: { x: 420, y: 127, width: 88, height: 88 },
        customer_success: { x: 420, y: 387, width: 88, height: 88 },
        finance: { x: 980, y: 562, width: 88, height: 88 },
        brand: { x: 420, y: 647, width: 88, height: 88 },
      },
      zoom: {
        x: 628,
        y: 8,
        width: 140,
        height: 52,
        padding: "4px",
        radius: "14px",
        right: 632,
        bottom: 730,
      },
      zoomButtons: [
        { width: 44, height: 44 },
        { width: 44, height: 44 },
        { width: 44, height: 44 },
      ],
      homeCard: {
        x: 484,
        width: 440,
        padding: "16px",
        radius: "20px",
        right: 476,
        bottom: 6,
      },
      note: {
        text: "Point at a part to open it. Tap a job to go in.",
        fontSize: "13px",
        right: 12,
        bottom: 8,
      },
    });
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fit the whole company" }),
    ).toHaveText("Fit");
    await expect(page.getByRole("button", { name: "Zoom in" })).toHaveText("+");
  });

  test("shared Needs you summary drives map part and job badges", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await seedCompanyMapMoneyRails(page);
    await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/company/map");

    await expect(page.getByTestId("cofounder-map-home-card")).toContainText(
      "2 things need your yes.",
    );
    await expect(page.getByTestId("cofounder-map-part-needs-sales")).toHaveText(
      "1",
    );
    await expect(
      page.getByTestId("cofounder-map-part-needs-customer_success"),
    ).toHaveText("1");
    await expect(
      page.getByTestId("cofounder-map-job-needs-sales-calls"),
    ).toHaveText("1");
  });

  test("current connectors follow the board runner states, not needs badges", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await seedCompanyMapMoneyRails(page);
    await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/company/map");

    await expect(
      page.getByTestId("cofounder-map-part-needs-customer_success"),
    ).toHaveText("1");
    expectConnectorKind(await measuredConnector(page, "sales"), "on");
    const waitingCustomerSuccess = await measuredConnector(
      page,
      "customer_success",
    );
    expectConnectorKind(waitingCustomerSuccess, "off");
    expect(waitingCustomerSuccess.stroke).not.toBe(
      waitingCustomerSuccess.tokens.need,
    );

    await selectMapPart(page, "sales", "Sales");
    const calls = await measuredConnector(page, "sales:Calls");
    expectConnectorKind(calls, "on");
    expect(calls.stroke).not.toBe(calls.tokens.need);

    await selectMapPart(page, "finance", "Finance");
    expectConnectorKind(
      await measuredConnector(page, "finance:Invoices"),
      "off",
    );
    expectConnectorKind(
      await measuredConnector(page, "finance:Recurring plans"),
      "on",
    );

    await selectMapPart(page, "customer_success", "Customer Success");
    for (const job of ["Renewals", "Upsell", "Reviews"]) {
      expectConnectorKind(
        await measuredConnector(page, `customer_success:${job}`),
        "on",
      );
    }

    await selectMapPart(page, "brand", "Brand");
    for (const job of ["Website", "Portfolio", "Marketing"]) {
      expectConnectorKind(await measuredConnector(page, `brand:${job}`), "on");
    }
    await expect(
      page.locator('[data-map-connector][data-state="seat"]'),
    ).toHaveCount(0);
  });

  test("a running part uses live wires for its waiting jobs", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installMockBridge(
      page,
      fixture({ workerRuns: [workerRun({ status: "running" })] }),
    );
    await seedCompanyMapMoneyRails(page);
    await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/company/map");

    await page.waitForTimeout(250);
    expect(pageErrors).toEqual([]);
    await expect(page.getByTestId("cofounder-map-stage")).toBeVisible();
    await expect(page.locator('[data-map-target="sales"]')).toHaveAttribute(
      "data-state",
      "live",
    );
    expectConnectorKind(await measuredConnector(page, "sales"), "live");

    await selectMapPart(page, "sales", "Sales");
    expectConnectorKind(await measuredConnector(page, "sales:Calls"), "live");
  });

  test("map-home bar follows the open part and closes its arm", async ({
    page,
  }) => {
    await installMockBridge(page, fixture(), {
      previewFeatureOverrides: { map_home: true },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");

    const stage = page.getByTestId("cofounder-map-stage");
    await expect(page.getByTestId("map-shell-company")).toBeVisible();
    await page.getByTestId("cofounder-map-sales").click();
    await expect(stage).toHaveAttribute("data-active-part", "sales");
    await expect(page.getByTestId("map-shell-map-button")).toBeVisible();
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Sales/All of Sales",
    );
    await expect(page.getByTestId("map-shell-company")).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#/");

    await page.getByTestId("map-shell-map-button").click();
    await expect(stage).toHaveAttribute("data-active-part", "none");
    await expect(page.getByTestId("map-shell-company")).toBeVisible();
    await expect(page.getByTestId("map-shell-map-button")).toHaveCount(0);
    await expect(page.getByTestId("map-shell-trail")).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#/");
  });

  test("the canvas fills the window under the bar and the board sits in its middle", async ({
    page,
  }) => {
    // Owner report, 13 Nov: on a tall window the dotted canvas stopped at the
    // board's 790px and a blank band showed below it.
    await installMockBridge(page, fixture(), {
      previewFeatureOverrides: { map_home: true },
    });
    const measure = () =>
      page.evaluate(() => {
        const box = (selector: string) => {
          const bounds = document
            .querySelector(selector)
            ?.getBoundingClientRect();
          return bounds
            ? {
                left: Math.round(bounds.left),
                top: Math.round(bounds.top),
                right: Math.round(bounds.right),
                bottom: Math.round(bounds.bottom),
              }
            : null;
        };
        const scroll = document.querySelector(".company-map-scroll");
        return {
          window: { width: window.innerWidth, height: window.innerHeight },
          bar: box('[data-testid="map-shell-bar"]'),
          canvas: box(".company-map-scroll"),
          dotted: scroll
            ? getComputedStyle(scroll).backgroundImage.includes("gradient")
            : false,
          board: box(".company-map-stage"),
          zoom: box(".company-map-zoom"),
          note: box(".company-map-note"),
          scrollWidth: scroll?.scrollWidth ?? 0,
        };
      });

    await page.setViewportSize({ width: 2000, height: 1228 });
    await page.goto("/#/");
    await expect(page.getByTestId("cofounder-map-stage")).toBeVisible();
    const tall = await measure();
    expect(tall.dotted).toBe(true);
    // The canvas runs from the bar to the bottom and across the full width.
    expect(tall.canvas).toEqual({
      left: 0,
      top: tall.bar?.bottom,
      right: 2000,
      bottom: 1228,
    });
    // The 1400 by 790 board is centred in it.
    expect(tall.board).toMatchObject({ left: 300, right: 1700 });
    const above = (tall.board?.top ?? 0) - (tall.canvas?.top ?? 0);
    const below = (tall.canvas?.bottom ?? 0) - (tall.board?.bottom ?? 0);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(8);
    // Zoom stays at the top middle of the canvas, the hint in its corner.
    expect((tall.zoom?.top ?? 0) - (tall.canvas?.top ?? 0)).toBe(28);
    expect(((tall.zoom?.left ?? 0) + (tall.zoom?.right ?? 0)) / 2).toBeCloseTo(
      998,
      0,
    );
    expect(2000 - (tall.note?.right ?? 0)).toBe(32);
    expect(1228 - (tall.note?.bottom ?? 0)).toBe(34);

    // At the design's own window size nothing moved: the board starts 20px
    // under the bar and 20px from the left.
    await page.setViewportSize({ width: 1440, height: 900 });
    const design = await measure();
    expect(design.canvas?.bottom).toBe(900);
    expect(design.board).toMatchObject({
      left: 20,
      top: (design.bar?.bottom ?? 0) + 20,
    });

    // A window narrower than the board scrolls sideways instead of cutting it.
    await page.setViewportSize({ width: 1100, height: 700 });
    const narrow = await measure();
    expect(narrow.scrollWidth).toBe(1400);
  });

  test("each part reveals its current app jobs and closes with Escape", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/company/map");

    const cases = [
      ["sales", "Sales", 6],
      ["operations", "Operations", 5],
      ["customer_success", "Customer Success", 5],
      ["finance", "Finance", 6],
      ["brand", "Brand", 5],
    ] as const;
    for (const [functionId, name, jobCount] of cases) {
      await selectMapPart(page, functionId, name);
      await expect(page.getByTestId("cofounder-map-stage")).toHaveAttribute(
        "data-active-part",
        functionId,
      );
      await expect(
        page.locator(`[data-map-group="${functionId}"][data-job]`),
      ).toHaveCount(jobCount);
      await expect(
        page.getByTestId(`cofounder-map-${functionId}`),
      ).toHaveAttribute("aria-expanded", "true");
      if (functionId === "operations") {
        await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
          "Scout runs Operations until you hire someone.",
        );
        await expect(
          page.getByTestId("cofounder-map-part-card"),
        ).not.toContainText("Each circle is one workflow.");
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("cofounder-map-stage")).toHaveAttribute(
        "data-active-part",
        "none",
      );
    }
  });

  test("the open Sales arm and card match the measured board", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/company/map");
    await selectMapPart(page, "sales", "Sales");

    const stage = page.getByTestId("cofounder-map-stage");
    await expect(stage).toHaveAttribute("data-active-part", "sales");
    await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
      "Find small businesses that need a better website, start the conversation and close.",
    );
    await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
      "Aya runs Sales.",
    );
    await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
      "Part of your company",
    );
    await expect(
      page.getByRole("link", { name: "Open Sales", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("cofounder-map-part-card").getByRole("button", {
        name: "Close",
      }),
    ).toBeVisible();

    const measured = await stage.evaluate((node) => {
      const stageBounds = node.getBoundingClientRect();
      const bounds = (selector: string) => {
        const element = node.querySelector<HTMLElement>(selector);
        const rect = element?.getBoundingClientRect();
        if (!rect) return null;
        const style = getComputedStyle(element);
        return {
          x: Math.round(rect.left - stageBounds.left),
          y: Math.round(rect.top - stageBounds.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          padding: style.padding,
          radius: style.borderRadius,
          background: style.backgroundColor,
          right: Math.round(stageBounds.right - rect.right),
          bottom: Math.round(stageBounds.bottom - rect.bottom),
        };
      };
      return {
        card: bounds('[data-testid="cofounder-map-part-card"]'),
        salesCircle: bounds(
          '[data-testid="cofounder-map-sales"] .company-map-part-disc',
        ),
        firstJob: bounds(
          '[data-testid="cofounder-map-job-sales-lead-finding"]',
        ),
        firstJobCircle: bounds(
          '[data-testid="cofounder-map-job-sales-lead-finding"] .company-map-job-disc',
        ),
        highlight: bounds(".company-map-highlight"),
        openAction: bounds('[data-testid="cofounder-map-open-sales"]'),
        closeAction: bounds('[data-testid="cofounder-map-part-card"] button'),
      };
    });
    expect(measured.card).toMatchObject({
      x: 484,
      width: 440,
      padding: "16px",
      radius: "20px",
      right: 476,
      bottom: 6,
    });
    expect(measured.salesCircle).toMatchObject({
      x: 936,
      y: 168,
      width: 88,
      height: 88,
    });
    expect(measured.firstJob).toMatchObject({
      x: 1156,
      y: 53,
      width: 232,
      height: 48,
    });
    expect(measured.firstJobCircle).toMatchObject({ width: 48, height: 48 });
    expect(measured.highlight).toMatchObject({
      x: 930,
      y: 162,
      width: 100,
      height: 100,
    });
    expect(measured.openAction).toMatchObject({
      width: 327,
      height: 44,
      padding: "0px 16px",
    });
    expect(measured.closeAction).toMatchObject({
      height: 44,
      background: "rgb(243, 239, 244)",
    });
  });

  test("an empty part keeps its dashed circle and plus", async ({ page }) => {
    await installMockBridge(page, fixture());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/company/map");

    const finance = page.getByTestId("cofounder-map-finance");
    await expect(finance).toHaveAttribute("data-state", "empty");
    const circle = finance.locator(".company-map-part-disc");
    const measured = await circle.evaluate((node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      const plus = node.querySelector("svg")?.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        borderStyle: style.borderTopStyle,
        plusWidth: plus?.width,
        plusHeight: plus?.height,
      };
    });
    expect(measured).toEqual({
      width: 88,
      height: 88,
      borderStyle: "dashed",
      plusWidth: 24,
      plusHeight: 24,
    });
  });

  test("hover, focus, Close, and the blank board control the active part", async ({
    page,
  }) => {
    await installMockBridge(page, fixture(), {
      previewFeatureOverrides: { map_home: true },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");

    const stage = page.getByTestId("cofounder-map-stage");
    const sales = page.getByTestId("cofounder-map-sales");
    await sales.hover();
    await expect(stage).toHaveAttribute("data-active-part", "sales");
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Sales/All of Sales",
    );
    await expect(page.getByTestId("cofounder-map-operations")).toHaveAttribute(
      "data-faded",
      "true",
    );

    const brand = page.getByTestId("cofounder-map-brand");
    await brand.focus();
    await expect(stage).toHaveAttribute("data-active-part", "brand");
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Brand/All of Brand",
    );
    await page.keyboard.press("Escape");
    await expect(stage).toHaveAttribute("data-active-part", "none");
    await expect(page.getByTestId("map-shell-company")).toBeVisible();

    await selectMapPart(page, "finance", "Finance");
    await page
      .getByTestId("cofounder-map-part-card")
      .getByRole("button", { name: "Close" })
      .click();
    await expect(stage).toHaveAttribute("data-active-part", "none");

    await selectMapPart(page, "sales", "Sales");
    await stage.click({ position: { x: 30, y: 30 } });
    await expect(stage).toHaveAttribute("data-active-part", "none");

    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByTestId("cofounder-map-zoom-level")).toHaveText(
      "130 percent",
    );
    const viewport = page.locator(".company-map-viewport");
    const bounds = await viewport.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move((bounds?.x ?? 0) + 100, (bounds?.y ?? 0) + 100);
    await page.mouse.down();
    await page.mouse.move((bounds?.x ?? 0) + 140, (bounds?.y ?? 0) + 130);
    await page.mouse.up();
    await expect(stage).toHaveCSS(
      "transform",
      "matrix(1.3, 0, 0, 1.3, 40, 30)",
    );
    await page.getByTestId("cofounder-map-fit").click();
    await expect(page.getByTestId("cofounder-map-zoom-level")).toHaveText(
      "100 percent",
    );
  });

  test("every map-home job link follows its route table entry", async ({
    page,
  }) => {
    await installMockBridge(page, fixture(), {
      previewFeatureOverrides: { map_home: true },
    });
    await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");
    await expect(page.getByTestId("map-shell-bar")).toBeVisible();
    for (const functionId of FUNCTION_ORDER) {
      await selectMapPart(page, functionId, FUNCTION_DETAILS[functionId].name);
      for (const jobName of FUNCTION_DETAILS[functionId].subFunctions) {
        const route = getCompanyMapJobRoute(functionId, jobName);
        const path =
          route.kind === "app"
            ? route.to
            : route.kind === "work"
              ? "/work"
              : route.kind === "whatsapp"
                ? `/channels/${MAP_CHANNEL_ID}?whatsappDeskTab=${route.tab}`
                : `/company/function/${route.functionId}`;
        const jobId = jobName.toLowerCase().replaceAll(" ", "-");
        const href = await page
          .getByTestId(`cofounder-map-job-${functionId}-${jobId}`)
          .getAttribute("href");
        const target = href?.split("#")[1] ?? "";
        const [targetPath, targetSearch] = target.split("?", 2);
        expect(targetPath).toBe(path.split("?", 1)[0]);
        const params = new URLSearchParams(
          targetSearch ?? path.split("?", 2)[1],
        );
        expect(params.get("whatsappDeskTab")).toBe(
          route.kind === "whatsapp" ? route.tab : null,
        );
        expect(params.get("mapJob")).toBe(
          companyMapWindowSearch(functionId, jobName)?.mapJob ?? null,
        );
      }
      await page.keyboard.press("Escape");
    }
  });

  test("the Sales page shows Aya and her worker output", async ({ page }) => {
    await installMockBridge(page, fixture({ workerRuns: [workerRun()] }));
    await page.goto("/#/company/map");

    await openMapPart(page, "sales", "Sales");
    await expect(page.getByRole("heading", { name: "Sales" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Aya", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("cofounder-worker-list")).toContainText(
      "Workers under Aya",
    );
    await expect(page.getByTestId("cofounder-worker-runs")).toContainText(
      "Research: Linden guesthouses",
    );
    await page.getByRole("button", { name: "Open output" }).click();
    await expect(
      page.getByTestId(`cofounder-worker-output-${WORKER_ID}`),
    ).toContainText("Three guesthouses match the brief.");
  });

  test("an empty Sales slot shows Scout's worker run with output and Free cost", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      fixture({
        includeAya: false,
        includeScout: true,
        functionHeads: [],
        workerRuns: [
          workerRun({
            parentPubkey: SCOUT_PUBKEY,
            label: "Research: 3 guesthouse marketing ideas",
            model: "nvidia/nemotron-3-ultra-550b-a55b:free",
            costUsd: undefined,
            outputText: "Idea 1. Idea 2. Idea 3.",
          }),
        ],
      }),
    );
    await page.goto("/#/company/map");

    await openMapPart(page, "sales", "Sales");
    await expect(page.getByTestId("cofounder-worker-list")).toContainText(
      "Workers under Scout",
    );
    const runs = page.getByTestId("cofounder-worker-runs");
    await expect(runs).toContainText("Research: 3 guesthouse marketing ideas");
    await expect(
      page.getByTestId(`cofounder-worker-status-${WORKER_ID}`),
    ).toHaveText("Done");
    await expect(runs).toContainText("Free");
    await expect(runs).not.toContainText("Cost unavailable");
    await page.getByRole("button", { name: "Open output" }).click();
    await expect(
      page.getByTestId(`cofounder-worker-output-${WORKER_ID}`),
    ).toContainText("Idea 1. Idea 2. Idea 3.");
  });

  test("Company Work lists worker runs with status, output and cost", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      fixture({
        includeAya: false,
        includeScout: true,
        functionHeads: [],
        workerRuns: [
          workerRun({
            parentPubkey: SCOUT_PUBKEY,
            label: "Research: 3 guesthouse marketing ideas",
            model: "nvidia/nemotron-3-ultra-550b-a55b:free",
            costUsd: 0,
            outputText: "Idea 1. Idea 2. Idea 3.",
          }),
        ],
      }),
    );
    await page.goto("/#/work");

    const list = page.getByTestId("cofounder-worker-list");
    await expect(list).toContainText("Worker runs");
    await expect(page.getByTestId("cofounder-worker-runs")).toContainText(
      "Research: 3 guesthouse marketing ideas",
    );
    await expect(
      page.getByTestId(`cofounder-worker-status-${WORKER_ID}`),
    ).toHaveText("Done");
    await expect(list).toContainText("Free");
    await page.getByRole("button", { name: "Open output" }).click();
    await expect(
      page.getByTestId(`cofounder-worker-output-${WORKER_ID}`),
    ).toContainText("Idea 1. Idea 2. Idea 3.");
  });

  test("all five function pages show scorecards and goals when enabled", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    for (const functionId of [
      "sales",
      "operations",
      "customer_success",
      "finance",
      "brand",
    ]) {
      await page.goto(`/#/company/function/${functionId}`);
      await expect(page.getByTestId("cofounder-function-screen")).toBeVisible();
      await expect(page.getByTestId("cofounder-scorecard")).toBeVisible();
      await expect(page.getByTestId("cofounder-goals")).toBeVisible();
      if (functionId === "operations") {
        await expect(
          page.getByTestId("cofounder-playbook-screen"),
        ).toBeVisible();
      }
    }
  });

  test("the owner can edit, approve, and reject a proposed goal", async ({
    page,
  }) => {
    await installMockBridge(page, fixture({ numbers: numbersFixture(true) }));
    await page.goto("/#/company/function/sales");

    const goals = page.getByTestId("cofounder-goals");
    const proposal = goals.getByTestId(
      `cofounder-goal-proposal-${PROPOSED_COFOUNDER_GOAL_ID}`,
    );
    await expect(proposal).toBeVisible();
    await proposal.getByRole("button", { name: "Edit goal" }).click();
    await page.getByLabel("Goal title").fill("Follow up with 8 new leads");
    await page.getByLabel("Target (whole number)").fill("8");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(goals.getByRole("status")).toHaveText("Goal updated.");
    await expect(proposal).toContainText("Follow up with 8 new leads");
    await proposal.getByRole("button", { name: "Approve goal" }).focus();
    await page.keyboard.press("Enter");
    await expect(goals.getByRole("status")).toHaveText("Goal approved.");
    await expect(goals).toContainText("Follow up with 8 new leads");

    const propose = goals.getByTestId("cofounder-propose-goal");
    await propose.focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Goal title").fill("Close one more client");
    await page.getByLabel("Target (whole number)").fill("1");
    await page.getByRole("button", { name: "Create proposal" }).click();
    const rejectedProposal = goals.getByText("Close one more client", {
      exact: true,
    });
    await expect(rejectedProposal).toBeVisible();
    await rejectedProposal
      .locator("xpath=ancestor::article")
      .getByRole("button", { name: "Reject goal" })
      .click();
    await expect(goals.getByRole("status")).toHaveText(
      "Goal proposal rejected.",
    );
    await expect(rejectedProposal).toHaveCount(0);
  });

  test("non-owners can review a proposed goal but cannot decide it", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      fixture({ role: "member", numbers: numbersFixture(true) }),
    );
    await page.goto("/#/company/function/sales");

    const goals = page.getByTestId("cofounder-goals");
    const proposal = goals.getByTestId(
      `cofounder-goal-proposal-${PROPOSED_COFOUNDER_GOAL_ID}`,
    );
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText("Waiting for the owner to review");
    await expect(
      proposal.getByRole("button", { name: "Approve goal" }),
    ).toHaveCount(0);
    await expect(
      proposal.getByRole("button", { name: "Edit goal" }),
    ).toHaveCount(0);
    await expect(
      proposal.getByRole("button", { name: "Reject goal" }),
    ).toHaveCount(0);
    await expect(goals.getByTestId("cofounder-propose-goal")).toHaveCount(0);
  });

  test("weekly review presents each function and routes decisions through Needs you", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/company/weekly-review");

    const review = page.getByTestId("cofounder-weekly-review-card");
    await expect(review).toBeVisible();
    await expect(page.getByText("Friday 30 October")).toBeVisible();
    for (const functionName of [
      "Sales",
      "Operations",
      "Customer Success",
      "Finance",
      "Brand",
    ]) {
      await expect(review).toContainText(functionName);
    }
    await expect(review).toContainText("Leads found: 3");
    await expect(review).toContainText("What worked");
    await expect(review).toContainText("What missed");
    await expect(
      review.getByRole("heading", { name: "Needs you · 1" }),
    ).toBeVisible();
    await expect(review.getByTestId("weekly-review-needs-you")).toContainText(
      "Hire a Customer Success lead?",
    );

    const hire = review.getByTestId("weekly-review-decision-hire-cs");
    await hire.getByRole("button", { name: "Yes" }).click();
    await expect(hire).toContainText("Approved");
    await expect(
      review.getByRole("heading", { name: "Needs you · 0" }),
    ).toBeVisible();
  });

  test("weekly review and function data remain hidden when co-founder mode is off", async ({
    page,
  }) => {
    await installMockBridge(page, fixture({ enabled: false }));
    await page.goto("/#/company/weekly-review");
    await expect(page.getByTestId("cofounder-weekly-review")).toContainText(
      "Co-founder mode is off",
    );
    await expect(page.getByTestId("cofounder-weekly-review-card")).toHaveCount(
      0,
    );

    await page.goto("/#/company/function/sales");
    await expect(page.getByTestId("cofounder-scorecard")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-goals")).toHaveCount(0);
  });

  test("Finance shows the Bookkeeper suggestion and hire route", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/company/map");

    await selectMapPart(page, "finance", "Finance");
    await expect(
      page.getByRole("link", { name: "Hire a Bookkeeper" }),
    ).toHaveAttribute("href", /hire\/roles/);
    await page.getByRole("link", { name: "Hire a Bookkeeper" }).click();
    await expect(page).toHaveURL(/#\/hire\/roles$/);
  });

  test("a slot whose lead left the team is displayed as empty", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      fixture({
        includeAya: false,
        functionHeads: [functionHead("sales", "filled", AYA_PUBKEY)],
      }),
    );
    await page.goto("/#/company/map");

    await expect(page.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "data-state",
      "empty",
    );
    await expect(page.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "aria-label",
      "Sales, empty slot",
    );
  });

  test("a running worker past its deadline shows Failed", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    await installMockBridge(
      page,
      fixture({
        workerRuns: [
          workerRun({
            status: "running",
            startedAt: now - 600,
            deadlineAt: now - 1,
          }),
        ],
      }),
    );
    await page.goto("/#/company/map");

    await openMapPart(page, "sales", "Sales");
    await expect(
      page.getByTestId(`cofounder-worker-status-${WORKER_ID}`),
    ).toHaveText("Failed");
  });

  test("the phone stack fits 390px and keeps every control reachable", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/company/map");
    const phone = page.getByTestId("cofounder-map-phone");
    await expect(phone).toBeVisible();
    await expect(page.getByTestId("cofounder-map-desktop")).toBeHidden();
    for (const functionId of FUNCTION_ORDER) {
      await phone.getByTestId(`cofounder-map-phone-${functionId}`).click();
      const controls = phone.locator("button:visible, a:visible");
      for (let index = 0; index < (await controls.count()); index += 1) {
        const control = controls.nth(index);
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBe(0);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`captures every company map state at 1440 and 390 in ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const screenshotDir = "test-results/cofounder-map-board";
      mkdirSync(screenshotDir, { recursive: true });
      const desktopStates = [
        { name: "no-part-open" },
        { name: "sales-open", functionId: "sales", label: "Sales" },
        {
          name: "operations-open",
          functionId: "operations",
          label: "Operations",
        },
        {
          name: "customer-success-open",
          functionId: "customer_success",
          label: "Customer Success",
        },
        { name: "finance-open", functionId: "finance", label: "Finance" },
        { name: "brand-open", functionId: "brand", label: "Brand" },
        { name: "zoomed", zoom: true },
      ] as const;

      const capturePage = page;
      await seedCofounderTheme(capturePage, theme);
      await installMockBridge(capturePage, fixture({ includeScout: true }), {
        previewFeatureOverrides: { map_home: true },
      });
      await seedCompanyMapBusiness(capturePage);
      await seedCompanyMapMoneyRails(capturePage);
      await seedCompanyMapWhatsApp(capturePage, MAP_CHANNEL_ID);
      await capturePage.emulateMedia({ colorScheme: theme });
      await capturePage.setViewportSize({ width: 1440, height: 900 });
      await capturePage.goto("/#/");
      await expect(capturePage.getByTestId("map-shell-bar")).toBeVisible();
      await expect(
        capturePage.getByTestId("cofounder-map-stage"),
      ).toBeVisible();
      await expect(
        capturePage.getByTestId("cofounder-map-company-logo"),
      ).toHaveAttribute("data-source", "profile");
      await expect(
        capturePage.getByRole("heading", { name: "Company map" }),
      ).toBeVisible();
      await expect(
        capturePage.getByTestId("cofounder-map-home-card"),
      ).toContainText("2 things need your yes.");
      await expect
        .poll(() =>
          capturePage.evaluate(() =>
            document.documentElement.classList.contains("dark"),
          ),
        )
        .toBe(theme === "dark");

      for (const state of desktopStates) {
        await capturePage.getByTestId("cofounder-map-fit").click();
        if ("functionId" in state) {
          await selectMapPart(capturePage, state.functionId, state.label);
        }
        if ("zoom" in state && state.zoom) {
          await capturePage.getByRole("button", { name: "Zoom in" }).click();
          await capturePage.getByRole("button", { name: "Zoom in" }).click();
        }
        await waitForAnimations(capturePage);
        await capturePage.screenshot({
          animations: "disabled",
          fullPage: false,
          path: join(screenshotDir, `${state.name}-${theme}-1440.png`),
        });
        if ("functionId" in state) {
          await capturePage.keyboard.press("Escape");
          await expect(
            capturePage.getByTestId("cofounder-map-stage"),
          ).toHaveAttribute("data-active-part", "none");
        }
      }

      await capturePage.setViewportSize({ width: 390, height: 844 });
      await expect(
        capturePage.getByTestId("cofounder-map-desktop"),
      ).toBeHidden();
      await expect(
        capturePage.getByTestId("cofounder-map-phone"),
      ).toBeVisible();
      await waitForAnimations(capturePage);
      await capturePage.screenshot({
        animations: "disabled",
        fullPage: false,
        path: join(screenshotDir, `phone-no-part-open-${theme}-390.png`),
      });
      await capturePage.getByTestId("cofounder-map-phone-sales").click();
      await expect(
        capturePage.getByTestId("cofounder-map-phone-sales"),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(
        capturePage.getByTestId("cofounder-map-phone-job-sales-lead-finding"),
      ).toBeVisible();
      await waitForAnimations(capturePage);
      await capturePage.screenshot({
        animations: "disabled",
        fullPage: false,
        path: join(screenshotDir, `phone-sales-open-${theme}-390.png`),
      });
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`captures weekly review and function pages at 1440 and 390 in ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const screenshotDir = "test-results/cofounder-phase5";
      mkdirSync(screenshotDir, { recursive: true });

      const capturePage = page;
      await seedCofounderTheme(capturePage, theme);
      await installMockBridge(capturePage, fixture());
      await capturePage.emulateMedia({ colorScheme: theme });

      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        await capturePage.setViewportSize(viewport);
        for (const screen of [
          {
            name: "weekly-review",
            path: "/#/company/weekly-review",
            testId: "cofounder-weekly-review-card",
          },
          {
            name: "function-sales",
            path: "/#/company/function/sales",
            testId: "cofounder-scorecard",
          },
          {
            name: "function-operations",
            path: "/#/company/function/operations",
            testId: "cofounder-scorecard",
          },
        ]) {
          await capturePage.goto(screen.path);
          await expect(capturePage.getByTestId(screen.testId)).toBeVisible();
          await expect
            .poll(() =>
              capturePage.evaluate(() =>
                document.documentElement.classList.contains("dark"),
              ),
            )
            .toBe(theme === "dark");
          await waitForAnimations(capturePage);
          await capturePage.screenshot({
            animations: "disabled",
            fullPage: true,
            path: join(
              screenshotDir,
              `${screen.name}-${theme}-${viewport.width}.png`,
            ),
          });
          if (screen.name === "weekly-review") {
            const reviewCard = capturePage.getByTestId(
              "cofounder-weekly-review-card",
            );
            const cardBounds = await reviewCard.boundingBox();
            if (cardBounds && viewport.width < 600) {
              await capturePage.setViewportSize({
                width: viewport.width,
                height: Math.ceil(cardBounds.height + 100),
              });
            }
            await reviewCard.screenshot({
              animations: "disabled",
              path: join(
                screenshotDir,
                `${screen.name}-card-${theme}-${viewport.width}.png`,
              ),
            });
            if (viewport.width < 600) {
              await capturePage.setViewportSize({
                width: viewport.width,
                height: viewport.height,
              });
            }
          } else if (screen.name === "function-sales") {
            await capturePage.getByTestId("cofounder-goals").screenshot({
              animations: "disabled",
              path: join(
                screenshotDir,
                `${screen.name}-goals-${theme}-${viewport.width}.png`,
              ),
            });
          }
        }
      }
    });
  }
});
