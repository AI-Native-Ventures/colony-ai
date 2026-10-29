import { expect, test, type Page } from "@playwright/test";

import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

test.beforeEach(async ({ page }) => {
  await installDiscoveryImageMocks(page);
});

/**
 * The real discovery runner (not the simulated stand-in): Find prospects
 * searches through the relay, saves each business as a prospect record and
 * posts the results in Sales. The relay's `/discovery/search` is replaced by
 * the page's own `window.__BUZZ_E2E_DISCOVERY_SEARCH__` stub, so no provider
 * and no key are involved.
 */

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;

type StubMode = "pages" | "not-configured" | "gated";

type DiscoveryWindow = Window & {
  __discoveryCalls?: Array<Record<string, unknown>>;
  __releaseDiscoveryPage?: () => void;
};

/**
 * Two canned pages. Page one: a new business, one that is already in Leads
 * (same name as a reference lead), one without a website, one with an http
 * website, and one without a name. Page two: a repeat of page one's first
 * business and two more new ones.
 */
async function installSearchStub(page: Page, mode: StubMode = "pages") {
  await page.addInitScript((stubMode) => {
    const w = window as DiscoveryWindow & {
      __BUZZ_E2E_DISCOVERY_SEARCH__?: (
        request: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    w.__discoveryCalls = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.__releaseDiscoveryPage = () => release();
    let gated = false;

    const place = (
      id: string | null,
      name: string,
      extra: Record<string, unknown> = {},
    ) => ({
      placeId: id,
      name,
      category: "Home goods store",
      address: `1 Main Road, ${name}`,
      city: "Johannesburg",
      state: "Gauteng",
      phone: "+27 11 555 0100",
      rating: 4.5,
      reviews: 20,
      ...extra,
    });

    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
      w.__discoveryCalls?.push(request);
      if (stubMode === "not-configured") {
        const error = new Error(
          "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.",
        ) as Error & { code?: string };
        error.code = "discovery_not_configured";
        throw error;
      }
      if (request.skip === 0) {
        return {
          provider: "outscraper",
          places: [
            place("pl-branch", "Olive Branch Studio", {
              website: "https://olive-branch.example",
            }),
            place("pl-house", "The Olive House", {
              website: "https://olive-house.example",
            }),
            place("pl-kiln", "Kiln & Co"),
            place("pl-linen", "Linen Lane", {
              website: "http://linen-lane.example",
            }),
            place("pl-nameless", ""),
          ],
          estimatedCostUsd: 0.012,
          nextSkip: 5,
        };
      }
      if (stubMode === "gated" && !gated) {
        gated = true;
        await gate;
      }
      return {
        provider: "outscraper",
        places: [
          place("pl-branch", "Olive Branch Studio"),
          place("pl-fern", "Fern Home", {
            website: "https://fern-home.example",
          }),
          place("pl-terrace", "Terrace Goods"),
        ],
        estimatedCostUsd: 0.009,
        nextSkip: null,
      };
    };
  }, mode);
}

async function openDiscovery(page: Page, mode: StubMode = "pages") {
  await installMockBridge(page, REAL_RUNNER);
  await installSearchStub(page, mode);
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
}

async function openCampaignForm(page: Page) {
  await page
    .getByRole("textbox", { name: /Search industries/ })
    .fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const typeDetails = page.getByTestId("discovery-type-details-dialog");
  await expect(typeDetails).toBeVisible();
  await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await expect(
    dialog.getByRole("heading", { name: "Find the right fit." }),
  ).toBeVisible();
  return dialog;
}

async function approveAndStart(page: Page) {
  const dialog = await openCampaignForm(page);
  await dialog.getByLabel("Location").fill("South Africa");
  await dialog.getByLabel("Prospect target").fill("50");
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
  return dialog;
}

function campaignRows(page: Page) {
  return page.getByTestId("w10-campaign-page").locator("tbody tr");
}

async function searchCalls(page: Page) {
  return page.evaluate(
    () => (window as DiscoveryWindow).__discoveryCalls ?? [],
  );
}

/** In-app navigation: a full page load would reset the mock relay's memory. */
async function goTo(page: Page, hash: string) {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
}

test.describe("Real discovery run", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a search saves new businesses, skips ones already in Leads and posts the results in Sales", async ({
    page,
  }) => {
    await openDiscovery(page);
    await approveAndStart(page);

    const campaign = page.getByTestId("w10-campaign-page");
    await expect(campaign).toBeVisible();
    await expect(
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Five new businesses: the repeat, the nameless place and the business
    // that is already in Leads are not added.
    await expect(campaignRows(page)).toHaveCount(5);
    const body = campaign.locator("tbody");
    for (const name of [
      "Olive Branch Studio",
      "Kiln & Co",
      "Linen Lane",
      "Fern Home",
      "Terrace Goods",
    ]) {
      await expect(body).toContainText(name);
    }
    await expect(body).not.toContainText("The Olive House");

    // The search went out as the design's flow asks: vertical, location,
    // pages of 20, the second page from the first page's cursor.
    const calls = await searchCalls(page);
    expect(calls.map((call) => call.skip)).toEqual([0, 5]);
    expect(calls[0]).toMatchObject({
      location: "South Africa",
      country: "South Africa",
      limit: 20,
    });
    expect(String(calls[0]?.query)).toMatch(/home furnishings/i);

    // Pick up where you left off: the run is on the Discovery page.
    await goTo(page, "/discovery");
    await expect(
      page.getByRole("heading", { name: "Pick up where you left off" }),
    ).toBeVisible();

    // The results were posted in Sales as a message the team can read.
    await goTo(page, `/channels/${REFERENCE_CHANNEL_IDS.sales}`);
    const timeline = page.getByTestId("message-timeline");
    await expect(timeline).toContainText("Found 5 prospects for");
    await expect(timeline).toContainText("Best fits:");
  });

  test("a second search for the same businesses adds nothing", async ({
    page,
  }) => {
    await openDiscovery(page);
    await approveAndStart(page);
    await expect(
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(campaignRows(page)).toHaveCount(5);

    await goTo(page, "/discovery");
    await page.getByTestId("w10-discovery-page").waitFor();
    await approveAndStart(page);
    await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
    await expect(
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(campaignRows(page)).toHaveCount(0);

    // Both searches are in the campaigns list.
    await goTo(page, "/discovery");
    await page.getByRole("button", { name: /All campaigns/ }).click();
    const list = page.getByRole("dialog");
    await expect(
      list.getByRole("heading", { name: "Your discovery campaigns." }),
    ).toBeVisible();
    await expect(list.getByRole("button", { name: /prospects/ })).toHaveCount(
      2,
    );
  });

  test("a server that is not set up says so in the dialog and creates no campaign", async ({
    page,
  }) => {
    await openDiscovery(page, "not-configured");
    const dialog = await approveAndStart(page);
    await expect(dialog.getByRole("alert")).toContainText(
      "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.",
    );
    await expect(page.getByTestId("w10-campaign-page")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: "Pick up where you left off" }),
    ).toHaveCount(0);
    expect(await searchCalls(page)).toHaveLength(1);
  });

  test("pause stops at the saved results and resume carries on from the same place", async ({
    page,
  }) => {
    await openDiscovery(page, "gated");
    await approveAndStart(page);
    await expect(page.getByTestId("w10-campaign-page")).toBeVisible();

    // Page one is saved (three new businesses); page two is still in flight.
    await expect(campaignRows(page)).toHaveCount(3, { timeout: 15_000 });
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(
      page.getByText("Search paused", { exact: true }),
    ).toBeVisible();

    // The page that was in flight arrives after the pause: nothing is saved.
    await page.evaluate(() =>
      (window as DiscoveryWindow).__releaseDiscoveryPage?.(),
    );
    await page.waitForTimeout(400);
    await expect(campaignRows(page)).toHaveCount(3);
    await expect(
      page.getByText("Search paused", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Resume" }).click();
    await expect(
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(campaignRows(page)).toHaveCount(5);
    // The page that arrived after the pause was already paid for, so Resume
    // saves it instead of asking for it again.
    const calls = await searchCalls(page);
    expect(calls.map((call) => call.skip)).toEqual([0, 5]);
  });
});
