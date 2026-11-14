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
import {
  PLANE_TREE_CLIENT_ID,
  planeTreeCustomerRecord,
} from "../../src/testing/cofounderCustomerFixtures";
import {
  companyMapWindowSearch,
  getCompanyMapJobRoute,
} from "../../src/features/cofounder/companyMapJobRoutes";

type Theme = "dark" | "light";

type LeftWindowJob = {
  functionId: "operations" | "customer_success";
  jobName: string;
};

type WorkspaceSeed = {
  addedAt: string;
  id: string;
  name: string;
  relayUrl: string;
};

const OPERATIONS_CLIENT_INTAKE: LeftWindowJob = {
  functionId: "operations",
  jobName: "Client intake",
};
const OPERATIONS_REVISIONS: LeftWindowJob = {
  functionId: "operations",
  jobName: "Revisions",
};
const CUSTOMER_SUCCESS_CHATS: LeftWindowJob = {
  functionId: "customer_success",
  jobName: "Client chats",
};
const CUSTOMER_SUCCESS_CHANGE_REQUESTS: LeftWindowJob = {
  functionId: "customer_success",
  jobName: "Change requests",
};
const SALES_CLOSING =
  "/channels/" +
  MAP_CHANNEL_ID +
  "?mapJob=sales%3AClosing&whatsappDeskTab=pipeline";
const MAP_WORKSPACES: WorkspaceSeed[] = [
  {
    addedAt: "2026-11-14T00:00:00.000Z",
    id: "fullmap-s3-workspace-one",
    name: "Horizon Labs",
    relayUrl: "ws://localhost:3000",
  },
  {
    addedAt: "2026-11-14T00:01:00.000Z",
    id: "fullmap-s3-workspace-two",
    name: "Second workspace",
    relayUrl: "ws://localhost:3001",
  },
];

function customerRecord() {
  return planeTreeCustomerRecord({
    ayaPubkey: AYA_PUBKEY,
    ownerPubkey: OWNER_PUBKEY,
    scoutPubkey: SCOUT_PUBKEY,
  });
}

function mapTarget(job: LeftWindowJob): string {
  const route = getCompanyMapJobRoute(job.functionId, job.jobName);
  const mapJob = companyMapWindowSearch(job.functionId, job.jobName)?.mapJob;
  if (!mapJob) throw new Error("Missing map job for " + job.jobName);
  if (route.kind === "app") {
    return route.to + "?" + new URLSearchParams({ mapJob }).toString();
  }
  if (route.kind === "work") {
    return "/work?" + new URLSearchParams({ mapJob }).toString();
  }
  if (route.kind === "whatsapp") {
    return (
      "/channels/" +
      MAP_CHANNEL_ID +
      "?" +
      new URLSearchParams({
        mapJob,
        whatsappDeskTab: route.tab,
      }).toString()
    );
  }
  throw new Error("Expected a screen route for " + job.jobName);
}

function currentRoute(page: Page): string {
  return new URL(page.url()).hash.slice(1);
}

function hashRoute(route: string): string {
  return "/#" + route;
}

function jobTestId(job: LeftWindowJob): string {
  return (
    "cofounder-map-job-" +
    job.functionId +
    "-" +
    job.jobName.toLowerCase().replaceAll(" ", "-")
  );
}

function windowContent(page: Page) {
  return page.locator(".map-canvas-route-window-content");
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

async function expectMapWindow(page: Page, depth: number) {
  const window = page.getByTestId("fullmap-window");
  await expect(window).toBeVisible({ timeout: 15_000 });
  await expect(window).toHaveAttribute("data-side", "left");
  await expect(window).toHaveAttribute("data-trail-depth", String(depth));
}

async function openRoute(page: Page, route: string, depth = 0) {
  await page.goto(hashRoute(route));
  await expectMapWindow(page, depth);
}

async function openMapJob(
  page: Page,
  job: LeftWindowJob,
  method: "keyboard" | "pointer",
) {
  await page.getByTestId("cofounder-map-" + job.functionId).click();
  const link = page.getByTestId(jobTestId(job));
  await expect(link).toBeVisible();
  if (method === "keyboard") {
    await link.focus();
    await page.keyboard.press("Enter");
  } else {
    await link.click();
  }
  await expectMapWindow(page, 0);
}

async function openOperationsClientRecord(page: Page) {
  await windowContent(page)
    .getByRole("link", { name: "Plane Tree Guesthouse" })
    .click();
  await expectMapWindow(page, 1);
  await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
}

async function openCustomerSuccessTrail(page: Page) {
  await page.getByTestId("channel-view-tab-pipeline").click();
  await expect
    .poll(() => currentRoute(page))
    .toContain("whatsappDeskTab=pipeline");
  await expect.poll(() => currentRoute(page)).not.toContain("mapJob=");
  await expectMapWindow(page, 0);
  await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);

  await windowContent(page).getByRole("button", { name: "Open chat" }).click();
  await expectMapWindow(page, 1);
  await expect(page.getByTestId("fullmap-window-peek")).toBeVisible();
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

function leftOpenGeometry() {
  const box = (selector: string) => {
    const node = document.querySelector<HTMLElement | SVGElement>(selector);
    if (!node) throw new Error("Missing " + selector);
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
  const canvas = document.querySelector<HTMLElement>(".company-map-scroll");
  const zoom = document.querySelector<HTMLElement>(".company-map-zoom");
  if (!canvas || !zoom) throw new Error("Expected map canvas controls");
  const canvasBounds = canvas.getBoundingClientRect();
  const zoomBounds = zoom.getBoundingClientRect();
  return {
    close: box('[data-testid="fullmap-window-close"]'),
    connector: box(".map-canvas-route-connector"),
    jobRing: box('[data-testid="fullmap-window-job-ring"]'),
    operations: box(
      '[data-testid="cofounder-map-operations"] .company-map-part-disc',
    ),
    window: box(".map-canvas-route-window-content"),
    zoom: {
      bottomGap: Math.round(canvasBounds.bottom - zoomBounds.bottom),
      height: Math.round(zoomBounds.height),
      rightGap: Math.round(canvasBounds.right - zoomBounds.right),
      width: Math.round(zoomBounds.width),
    },
  };
}

function leftDeepGeometry() {
  const box = (selector: string) => {
    const node = document.querySelector<HTMLElement | SVGElement>(selector);
    if (!node) throw new Error("Missing " + selector);
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
  const snapshot = document.querySelector<HTMLElement>(
    ".map-canvas-route-peek-snapshot",
  );
  const shell = document.querySelector<HTMLElement>(
    ".map-canvas-route-peek-shell",
  );
  const stage = document.querySelector<HTMLElement>(
    '[data-testid="cofounder-map-stage"]',
  );
  if (!snapshot || !shell || !stage) throw new Error("Expected left trail");
  return {
    connector: box(".map-canvas-route-trail-connector"),
    peek: box('[data-testid="fullmap-window-peek"]'),
    peekRadius: getComputedStyle(shell).borderRadius,
    peekSnapshotTransform: snapshot.style.transform,
    port: box(".map-canvas-route-trail-port"),
    stageTransform: stage.style.getPropertyValue("--company-map-transform"),
    window: box(".map-canvas-route-window-content"),
  };
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
    colours.add(
      pixels[index] + "," + pixels[index + 1] + "," + pixels[index + 2],
    );
  }
  return colours.size;
}

async function peekEvidence(page: Page, sourceTestId: string) {
  const peek = page.getByTestId("fullmap-window-peek");
  const source = peek.getByTestId(sourceTestId);
  const [peekBox, sourceAttached, sourceBox, snapshotCount] = await Promise.all(
    [
      peek.boundingBox(),
      source.count().then((count) => count > 0),
      source.boundingBox(),
      peek.locator(".map-canvas-route-peek-snapshot").count(),
    ],
  );
  const sourceIntersectsPeek = Boolean(
    peekBox &&
      sourceBox &&
      sourceBox.x + sourceBox.width > peekBox.x &&
      sourceBox.x < peekBox.x + peekBox.width &&
      sourceBox.y + sourceBox.height > peekBox.y &&
      sourceBox.y < peekBox.y + peekBox.height,
  );
  const clip = peekBox
    ? {
        height: Math.max(1, peekBox.height - 8),
        width: Math.max(1, peekBox.width - 8),
        x: peekBox.x + 4,
        y: peekBox.y + 4,
      }
    : null;
  return {
    paintColours: clip
      ? paintedColourCount(await page.screenshot({ clip }))
      : 0,
    snapshotPresent: snapshotCount > 0,
    sourceAttached,
    sourceIntersectsPeek,
  };
}

test.describe("full map canvas slice 3a", () => {
  test.describe.configure({ timeout: 90_000 });

  test("opens Operations leftward by pointer and keyboard with the shared controls", async ({
    page,
  }) => {
    await installFullMap(page, "light", { seedClient: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");

    await openMapJob(page, OPERATIONS_CLIENT_INTAKE, "pointer");
    await expect(page.locator(".map-shell-trail-part")).toHaveText(
      "Operations",
    );
    await expect(page.locator(".map-shell-trail-job")).toHaveText(
      "Client intake",
    );
    await expect(
      windowContent(page).getByRole("heading", { name: "Clients" }),
    ).toBeVisible();
    await waitForAnimations(page);

    expect(await page.evaluate(leftOpenGeometry)).toEqual({
      close: {
        bottom: 154,
        height: 44,
        left: 22,
        right: 66,
        top: 110,
        width: 44,
      },
      connector: {
        bottom: 185,
        height: 2,
        left: 1240,
        right: 1292,
        top: 183,
        width: 52,
      },
      jobRing: {
        bottom: 208,
        height: 48,
        left: 1226,
        right: 1274,
        top: 160,
        width: 48,
      },
      operations: {
        bottom: 228,
        height: 88,
        left: 1292,
        right: 1380,
        top: 140,
        width: 88,
      },
      window: {
        bottom: 823,
        height: 699,
        left: 36,
        right: 1240,
        top: 124,
        width: 1204,
      },
      zoom: { bottomGap: 34, height: 52, rightGap: 16, width: 140 },
    });

    await page.getByTestId("fullmap-window-close").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);

    await openMapJob(page, OPERATIONS_CLIENT_INTAKE, "keyboard");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);

    await openMapJob(page, OPERATIONS_CLIENT_INTAKE, "pointer");
    await page.getByTestId("cofounder-map-fit").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect.poll(() => currentRoute(page)).toBe("/");

    await openMapJob(page, OPERATIONS_CLIENT_INTAKE, "pointer");
    await page.goBack();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await page.goForward();
    await expectMapWindow(page, 0);
    await page.reload();
    await expectMapWindow(page, 0);
  });

  test("keeps a painted Operations trail on the right and returns to known screens", async ({
    page,
  }) => {
    await installFullMap(page, "light", { seedClient: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoute(page, mapTarget(OPERATIONS_CLIENT_INTAKE));
    await openOperationsClientRecord(page);
    await waitForAnimations(page);

    expect(await page.evaluate(leftDeepGeometry)).toEqual({
      connector: {
        bottom: 185,
        height: 2,
        left: 1240,
        right: 1296,
        top: 183,
        width: 56,
      },
      peek: {
        bottom: 823,
        height: 699,
        left: 1296,
        right: 1440,
        top: 124,
        width: 144,
      },
      peekRadius: "20px 0px 0px 20px",
      peekSnapshotTransform: "translateX(0px)",
      port: {
        bottom: 190,
        height: 14,
        left: 1233,
        right: 1247,
        top: 176,
        width: 14,
      },
      stageTransform: "translate(2156px, -462px) scale(1)",
      window: {
        bottom: 823,
        height: 699,
        left: 36,
        right: 1240,
        top: 124,
        width: 1204,
      },
    });

    const painted = await peekEvidence(
      page,
      "client-row-" + PLANE_TREE_CLIENT_ID,
    );
    expect(painted).toMatchObject({
      snapshotPresent: true,
      sourceAttached: true,
      sourceIntersectsPeek: true,
    });
    expect(painted.paintColours).toBeGreaterThan(6);

    await page.reload();
    await expectMapWindow(page, 1);
    await expect(
      page
        .getByTestId("fullmap-window-peek")
        .getByTestId("client-row-" + PLANE_TREE_CLIENT_ID),
    ).toBeAttached();

    await windowContent(page)
      .getByRole("button", { name: "Back to All clients" })
      .click();
    await expectMapWindow(page, 0);
    await expect.poll(() => currentRoute(page)).toContain("/clients");

    await openOperationsClientRecord(page);
    await windowContent(page)
      .getByRole("button", { name: "Open in Work" })
      .click();
    await expectMapWindow(page, 2);
    await expect.poll(() => currentRoute(page)).toContain("/work");
    await page.getByTestId("fullmap-window-close").click();
    await expectMapWindow(page, 1);
    await page.getByTestId("fullmap-window-peek").click();
    await expectMapWindow(page, 0);
  });

  test("keeps Customer Success on its WhatsApp Chats surface through tabs and a trail", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");

    await openMapJob(page, CUSTOMER_SUCCESS_CHATS, "keyboard");
    await expect(page.locator(".map-shell-trail-part")).toHaveText(
      "Customer Success",
    );
    await expect(page.locator(".map-shell-trail-job")).toHaveText(
      "Client chats",
    );
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();

    await page.getByTestId("fullmap-window-close").click();
    await openMapJob(page, CUSTOMER_SUCCESS_CHATS, "pointer");
    await openCustomerSuccessTrail(page);
    await page.getByTestId("fullmap-window-peek").click();
    await expectMapWindow(page, 0);

    await openCustomerSuccessTrail(page);
    await page.keyboard.press("Escape");
    await expectMapWindow(page, 0);
  });

  test("supports real left deep links and starts a fresh trail for another job", async ({
    page,
  }) => {
    await installFullMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await openRoute(page, mapTarget(OPERATIONS_REVISIONS));
    await expect(
      windowContent(page).getByRole("heading", { name: "Work" }),
    ).toBeVisible();
    await page.reload();
    await expectMapWindow(page, 0);

    await openRoute(page, mapTarget(CUSTOMER_SUCCESS_CHANGE_REQUESTS));
    await expect(page.locator(".map-shell-trail-part")).toHaveText(
      "Customer Success",
    );
    await expect(page.locator(".map-shell-trail-job")).toHaveText(
      "Change requests",
    );

    await page.goto(hashRoute(SALES_CLOSING));
    await expect(page.getByTestId("fullmap-window")).toHaveAttribute(
      "data-side",
      "right",
    );
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);

    await openRoute(page, mapTarget(OPERATIONS_CLIENT_INTAKE));
    await expect(page.getByTestId("fullmap-window-peek")).toHaveCount(0);
    await expect(page.getByTestId("fullmap-window")).toHaveAttribute(
      "data-side",
      "left",
    );
  });

  test("keeps left trails isolated by company", async ({ page }) => {
    await installFullMap(page, "light", {
      seedClient: true,
      workspaces: MAP_WORKSPACES,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoute(page, mapTarget(OPERATIONS_CLIENT_INTAKE));
    await openOperationsClientRecord(page);

    await dispatchPrimaryWorkspaceShortcut(page, "2");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe("fullmap-s3-workspace-two");
    await expect.poll(() => currentRoute(page)).toBe("/");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  test("leaves map-home-off left routes on the existing sidebar surface", async ({
    page,
  }) => {
    await installFullMap(page, "light", { mapHome: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(hashRoute(mapTarget(OPERATIONS_REVISIONS)));
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("fullmap-canvas-route-surface")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  test("leaves phone map jobs on their existing route surface", async ({
    page,
  }) => {
    await installFullMap(page, "light", { seedClient: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    await expect(page.getByTestId("cofounder-map-phone")).toBeVisible();
    await page.getByTestId("cofounder-map-phone-operations").click();
    await page
      .getByTestId("cofounder-map-phone-job-operations-client-intake")
      .click();
    await expect.poll(() => currentRoute(page)).toContain("/clients");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(
      "uses the ink-2 connector and port for left trails in " + theme,
      async ({ page }) => {
        await installFullMap(page, theme, { seedClient: true });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openRoute(page, mapTarget(OPERATIONS_CLIENT_INTAKE));
        await openOperationsClientRecord(page);
        await waitForAnimations(page);

        const colours = await page.evaluate(() => {
          const connector = document.querySelector<HTMLElement>(
            ".map-canvas-route-trail-connector",
          );
          const port = document.querySelector<HTMLElement>(
            ".map-canvas-route-trail-port",
          );
          if (!connector || !port) throw new Error("Expected left trail ink");
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
      },
    );
  }

  test("keeps mirrored geometry on a large canvas", async ({ page }) => {
    await installFullMap(page, "light", { seedClient: true });
    await page.setViewportSize({ width: 2000, height: 1228 });
    await openRoute(page, mapTarget(OPERATIONS_CLIENT_INTAKE));
    await openOperationsClientRecord(page);
    await waitForAnimations(page);

    const geometry = await page.evaluate(leftDeepGeometry);
    expect(geometry).toMatchObject({
      connector: { left: 1800, right: 1856, width: 56 },
      peek: {
        bottom: 1151,
        height: 1027,
        left: 1856,
        right: 2000,
        top: 124,
        width: 144,
      },
      window: {
        bottom: 1151,
        height: 1027,
        left: 36,
        right: 1800,
        top: 124,
        width: 1764,
      },
    });
  });

  for (const theme of ["light", "dark"] as const) {
    test(
      "captures left proposal states in " + theme + " when requested",
      async ({ page }) => {
        test.skip(
          process.env.FULLMAP_S3_CAPTURE !== "1",
          "capture is requested only for Slice 3a visual proof",
        );
        test.setTimeout(180_000);
        const screenshotDir =
          process.env.FULLMAP_S3_SCREENSHOT_DIR ?? "test-results/fullmap-s3";
        mkdirSync(screenshotDir, { recursive: true });

        await installFullMap(page, theme, { seedClient: true });
        for (const viewport of [
          { height: 900, label: "1440", width: 1440 },
          { height: 1228, label: "2000", width: 2000 },
        ]) {
          await page.setViewportSize(viewport);

          await openRoute(page, mapTarget(CUSTOMER_SUCCESS_CHATS));
          await waitForAnimations(page);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDir,
              "customer-success-open-" + theme + "-" + viewport.label + ".png",
            ),
          });

          await openCustomerSuccessTrail(page);
          await waitForAnimations(page);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDir,
              "customer-success-two-" + theme + "-" + viewport.label + ".png",
            ),
          });

          await openRoute(page, mapTarget(OPERATIONS_CLIENT_INTAKE));
          await waitForAnimations(page);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDir,
              "operations-open-" + theme + "-" + viewport.label + ".png",
            ),
          });

          await openOperationsClientRecord(page);
          await waitForAnimations(page);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDir,
              "operations-two-" + theme + "-" + viewport.label + ".png",
            ),
          });
        }
      },
    );
  }
});
