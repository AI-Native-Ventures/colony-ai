import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

// A finished run is titled "Search complete", or "Found N of M" when it
// ended short of the target.
const RUN_FINISHED_TITLE = /^(Search complete|Found \d+ of \d+)$/;

/**
 * Accept as lead from the campaign's selection bar works for any number of
 * selected rows (the owner hit a greyed button at 13), says what it will skip,
 * and updates every status in place. The search is the page's own stub, so no
 * provider is involved.
 */

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;

test.beforeEach(async ({ page }) => {
  await installDiscoveryImageMocks(page);
});

async function installManyPlaces(page: Page, count: number) {
  await page.addInitScript((total) => {
    const w = window as Window & {
      __BUZZ_E2E_DISCOVERY_SEARCH__?: (
        request: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async () => ({
      provider: "outscraper",
      places: Array.from({ length: total }, (_, index) => ({
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
  }, count);
}

async function runSearch(page: Page, count: number) {
  await installManyPlaces(page, count);
  await installMockBridge(page, REAL_RUNNER);
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
  await dialog.getByRole("combobox", { name: "Location" }).fill("South Africa");
  await dialog.getByRole("option").first().click();
  await dialog.getByLabel("Prospect target").fill("100");
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
  const campaign = page.getByTestId("w10-campaign-page");
  await expect(campaign).toBeVisible();
  await expect(page.getByText(RUN_FINISHED_TITLE)).toBeVisible({
    timeout: 20_000,
  });
  await expect(campaign.locator("tbody tr")).toHaveCount(count);
  return campaign;
}

test.describe("Accept many prospects as leads", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const count of [13, 42]) {
    test(`${count} selected rows are accepted in one action`, async ({
      page,
    }) => {
      const campaign = await runSearch(page, count);
      await campaign
        .getByRole("checkbox", {
          name: `Select all ${count} matching prospects`,
        })
        .check();

      const bar = campaign.getByRole("toolbar", { name: "Selected prospects" });
      await expect(bar).toContainText(`${count} selected`);
      const accept = bar.getByRole("button", {
        name: `Accept ${count} as leads`,
      });
      await expect(accept).toBeEnabled();
      await accept.click();

      // Every status updates in place, the selection clears, and the result is
      // said in words.
      await expect(
        campaign.locator("tbody tr").getByText("Qualified", { exact: true }),
      ).toHaveCount(count, { timeout: 30_000 });
      await expect(bar).toHaveCount(0);
      await expect(campaign.getByRole("status")).toContainText(
        `Accepted ${count} prospects as leads.`,
      );
      await expect(campaign.getByRole("alert")).toHaveCount(0);
    });
  }

  test("rows that are already leads are skipped and said so, and nothing is silently grey", async ({
    page,
  }) => {
    const count = 13;
    const campaign = await runSearch(page, count);
    const bar = campaign.getByRole("toolbar", { name: "Selected prospects" });

    // Accept three first.
    for (const n of [1, 2, 3]) {
      await campaign
        .getByRole("checkbox", {
          name: `Select Seaside Guesthouse ${n}`,
          exact: true,
        })
        .check();
    }
    await bar.getByRole("button", { name: "Accept 3 as leads" }).click();
    await expect(
      campaign.locator("tbody tr").getByText("Qualified", { exact: true }),
    ).toHaveCount(3, { timeout: 15_000 });
    await expect(bar).toHaveCount(0);

    // Only already-accepted rows selected: grey, with its reason.
    await campaign
      .getByRole("checkbox", {
        name: "Select Seaside Guesthouse 1",
        exact: true,
      })
      .check();
    await expect(
      bar.getByRole("button", { name: "Accept as lead" }),
    ).toBeDisabled();
    await expect(bar).toContainText("This prospect is already a lead.");

    // A partial selection offers the rest, then all 13 mix new and old rows.
    await bar.getByRole("button", { name: "Select all 13 matching" }).click();
    await expect(bar).toContainText("13 selected");
    await expect(bar).toContainText(
      "3 selected are already leads and will be skipped.",
    );
    await bar.getByRole("button", { name: "Accept 10 as leads" }).click();

    await expect(
      campaign.locator("tbody tr").getByText("Qualified", { exact: true }),
    ).toHaveCount(count, { timeout: 30_000 });
    await expect(campaign.getByRole("status")).toContainText(
      "Accepted 10 prospects as leads. 3 were already leads.",
    );
  });
});
