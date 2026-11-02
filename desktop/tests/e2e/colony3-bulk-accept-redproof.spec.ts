import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

/**
 * Red proof: with 13 prospects selected, Accept as lead must be usable. On
 * main it is greyed for any selection other than exactly one row.
 */

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;

test.beforeEach(async ({ page }) => {
  await installDiscoveryImageMocks(page);
});

async function installThirteenPlaces(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & {
      __BUZZ_E2E_DISCOVERY_SEARCH__?: (
        request: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async () => ({
      provider: "outscraper",
      places: Array.from({ length: 13 }, (_, index) => ({
        placeId: `bulk-${index + 1}`,
        name: `Seaside Guesthouse ${index + 1}`,
        category: "Guest house",
        address: `${index + 1} Beach Road`,
        city: "Cape Town",
        state: "Western Cape",
        phone: "+27 21 555 0100",
        website: `https://seaside-${index + 1}.example`,
        rating: 4.5,
        reviews: 20,
      })),
      estimatedCostUsd: 0.01,
      nextSkip: null,
    });
  });
}

test.describe("Accept many prospects as leads", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Accept as lead is enabled with 13 rows selected and accepts them all", async ({
    page,
  }) => {
    await installMockBridge(page, REAL_RUNNER);
    await installThirteenPlaces(page);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
    await page
      .getByRole("textbox", { name: /Search industries/ })
      .fill("home decor");
    await page.getByRole("button", { name: "Find prospects" }).first().click();
    const typeDetails = page.getByTestId("discovery-type-details-dialog");
    await expect(typeDetails).toBeVisible();
    await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
    const dialog = page.getByTestId("discovery-campaign-dialog");
    await dialog.getByLabel("Location").fill("South Africa");
    await dialog.getByLabel("Prospect target").fill("50");
    await dialog
      .getByRole("checkbox", {
        name: "I approve this campaign’s maximum budget.",
      })
      .check();
    await dialog.getByRole("button", { name: /Approve & start/ }).click();
    const campaign = page.getByTestId("w10-campaign-page");
    await expect(
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(campaign.locator("tbody tr")).toHaveCount(13);

    // Select all 13 rows with the header checkbox.
    await campaign.locator("thead input[type='checkbox']").check();
    const bar = campaign.getByRole("toolbar", { name: "Selected prospects" });
    await expect(bar).toContainText("13 selected");

    const accept = bar.getByRole("button", { name: /^Accept/ });
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(
      campaign.locator("tbody tr").getByText("Qualified", { exact: true }),
    ).toHaveCount(13, { timeout: 30_000 });
  });
});
