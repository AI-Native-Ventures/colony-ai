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

type Theme = "dark" | "light";

const OUTREACH_LIST_ID = "3f1a7000-0000-4000-9000-000000000001";
const OWNER_VIEWPORT = { height: 1117, width: 1728 };

async function installOutreachMap(
  page: Page,
  theme: Theme,
  {
    connected = true,
    outreachChannelId = MAP_CHANNEL_ID,
  }: {
    connected?: boolean;
    outreachChannelId?: string | null;
  } = {},
) {
  await seedCofounderTheme(page, theme);
  await installMockBridge(
    page,
    {
      ...fixture(),
      referenceWorkspace: true,
      referenceWorkspaceOutreachBoard: true,
      referenceWorkspaceOutreachReady: true,
      referenceWorkspaceOutreachSidebar: true,
      visualChannels: [{ id: MAP_CHANNEL_ID, name: "Outreach" }],
    },
    { previewFeatureOverrides: { map_home: true } },
  );
  await seedCompanyMapBusiness(page);
  await seedCompanyMapMoneyRails(page);
  await seedCompanyMapWhatsApp(page, outreachChannelId, true, connected);
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize(OWNER_VIEWPORT);
}

function deskTabs(page: Page) {
  return page
    .locator(".map-canvas-route-window-content")
    .getByTestId("map-outreach-desk-tabs");
}

async function openOutreachFromMap(page: Page) {
  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await page.getByTestId("cofounder-map-sales").click();
  await page.getByTestId("cofounder-map-job-sales-outreach").click();
  await expect(page.getByTestId("map-outreach-desk-header")).toBeVisible();
}

async function capture(page: Page, directory: string, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(directory, `${name}.png`),
  });
}

async function selectMoreView(
  page: Page,
  view: "canvas" | "discussion" | "files" | "knowledge",
) {
  const tabs = deskTabs(page);
  await tabs.getByTestId("map-outreach-tab-more").click();
  await expect(tabs.getByTestId(`map-outreach-tab-${view}`)).toBeVisible();
  await tabs.getByTestId(`map-outreach-tab-${view}`).click();
}

async function captureConnectedDesk(
  page: Page,
  directory: string,
  theme: Theme,
) {
  const prefix = `${theme}-1728x1117`;
  await openOutreachFromMap(page);
  await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible();
  await capture(page, directory, `needs-you-${prefix}`);

  const tabs = deskTabs(page);
  await tabs.getByTestId("map-outreach-tab-pipeline").click();
  await expect(page.getByTestId("outreach-desk-pipeline")).toBeVisible();
  await capture(page, directory, `pipeline-${prefix}`);

  await tabs.getByTestId("map-outreach-tab-chats").click();
  await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
  await capture(page, directory, `chats-${prefix}`);

  await tabs.getByTestId("map-outreach-tab-leads").click();
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  await capture(page, directory, `leads-${prefix}`);

  await tabs.getByTestId("map-outreach-tab-lists").click();
  await expect(page.getByTestId("outreach-lists-page")).toBeVisible();
  await capture(page, directory, `lists-${prefix}`);

  await page
    .getByTestId("outreach-lists-page")
    .getByRole("link", { name: "Melville guesthouses, Nov" })
    .click();
  await expect(page.getByTestId("outreach-list-detail")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toContain(`/lists/${OUTREACH_LIST_ID}`);
  await capture(page, directory, `list-detail-${prefix}`);

  await deskTabs(page).getByTestId("map-outreach-tab-needs-you").click();
  await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible();

  await deskTabs(page).getByTestId("map-outreach-tab-more").click();
  await expect(
    deskTabs(page).getByTestId("map-outreach-tab-discussion"),
  ).toBeVisible();
  await capture(page, directory, `more-open-${prefix}`);
  await deskTabs(page).getByTestId("map-outreach-tab-discussion").click();
  await expect(page.getByTestId("channel-drop-zone")).toBeVisible();
  await capture(page, directory, `discussion-${prefix}`);

  await selectMoreView(page, "knowledge");
  await expect(page.getByTestId("work-area-knowledge")).toBeVisible();
  await capture(page, directory, `knowledge-${prefix}`);

  await selectMoreView(page, "canvas");
  await expect(page.getByTestId("work-area-canvas")).toBeVisible();
  await capture(page, directory, `canvas-${prefix}`);

  await selectMoreView(page, "files");
  await expect(
    page.locator("[data-testid^='work-area-files']").first(),
  ).toBeVisible();
  await capture(page, directory, `files-${prefix}`);
}

test("captures every map Outreach desk state when requested", async ({
  browser,
}) => {
  test.skip(
    process.env.OUTREACH_DESK_CAPTURE !== "1",
    "capture is requested only for Outreach desk proof",
  );
  test.setTimeout(240_000);
  const directory =
    process.env.OUTREACH_DESK_SCREENSHOT_DIR ??
    "test-results/outreach-desk-map";
  mkdirSync(directory, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: OWNER_VIEWPORT });
    try {
      const page = await context.newPage();
      await installOutreachMap(page, theme);
      await captureConnectedDesk(page, directory, theme);
    } finally {
      await context.close();
    }

    const disconnectedContext = await browser.newContext({
      viewport: OWNER_VIEWPORT,
    });
    try {
      const page = await disconnectedContext.newPage();
      await installOutreachMap(page, theme, {
        connected: false,
        outreachChannelId: null,
      });
      await openOutreachFromMap(page);
      await expect(page.getByTestId("map-outreach-setup")).toBeVisible();
      await capture(page, directory, `no-whatsapp-${theme}-1728x1117`);
    } finally {
      await disconnectedContext.close();
    }
  }
});
