import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import { waitForAnimations } from "../helpers/animations";

const PROOF_DIR =
  process.env.COLONY3_DISCOVERY_TAGS_PROOF_DIR ??
  "test-results/colony3-discovery-tags-proof";

async function seedTheme(page: Page, dark: boolean) {
  const relayUrl = "ws://localhost:3000";
  const theme = dark ? "buzz-dark" : "buzz";
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.addInitScript(
    ({ themeName, activeRelayUrl }) => {
      window.localStorage.setItem("buzz-theme", themeName);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem("buzz-accent-color", "#5B45BE");
      window.localStorage.setItem(
        "buzz-community-theme.v1:" +
          "deadbeef".repeat(8) +
          ":" +
          encodeURIComponent(activeRelayUrl),
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    { themeName: theme, activeRelayUrl: relayUrl },
  );
}

async function openDiscovery(
  page: Page,
  width: number,
  height: number,
  dark = false,
) {
  await page.setViewportSize({ width, height });
  await seedTheme(page, dark);
  await installDiscoveryImageMocks(page);
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
  });
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expectDiscoveryReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(dark);
  await expectNoHorizontalOverflow(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  const discovery = page.getByTestId("w10-discovery-page");
  await expect
    .poll(() =>
      discovery.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectDiscoveryReady(page: Page) {
  const discovery = page.getByTestId("w10-discovery-page");
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery).toHaveAttribute("data-vertical-tags-loaded", "true", {
    timeout: 15_000,
  });
}

async function capture(page: Page, name: string) {
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(PROOF_DIR, name),
  });
}

async function searchFor(page: Page, query: string) {
  await page
    .getByRole("textbox", { name: /^Search (industries and )?business types/ })
    .fill(query);
}

type DiscoveryE2EWindow = Window & {
  __discoveryCalls?: Array<Record<string, unknown>>;
  __BUZZ_E2E_DISCOVERY_SEARCH__?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
};

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;

async function installSearchStub(page: Page) {
  await page.addInitScript(() => {
    const w = window as DiscoveryE2EWindow;
    w.__discoveryCalls = [];
    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
      w.__discoveryCalls?.push(request);
      return {
        provider: "outscraper",
        places: [
          {
            placeId: "wedding-guest-house",
            name: "Wedding Guest House",
            category: "Guest house",
            subtypes: "Accommodation",
            address: "1 Main Road, Cape Town",
            city: "Cape Town",
            state: "Western Cape",
            country: "South Africa",
            phone: "+27 21 555 0100",
            website: "https://wedding-guest-house.example",
            email: null,
            rating: 4.8,
            reviews: 30,
            latitude: null,
            longitude: null,
            mapsUrl: null,
            description: "Guest accommodation for wedding visitors.",
            businessStatus: "OPERATIONAL",
          },
        ],
        estimatedCostUsd: 0.01,
        nextSkip: null,
      };
    };
  });
}

async function openRealDiscovery(
  page: Page,
  width: number,
  height: number,
  dark: boolean,
) {
  await page.setViewportSize({ width, height });
  await seedTheme(page, dark);
  await installDiscoveryImageMocks(page);
  await installMockBridge(page, REAL_RUNNER);
  await installSearchStub(page);
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expectDiscoveryReady(page);
  await expectNoHorizontalOverflow(page);
}

async function openGuesthouseDetails(page: Page) {
  await searchFor(page, "guest house");
  const card = page.getByTestId("discovery-type-card-guesthouses-and-inns");
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Details for Guesthouses and inns" })
    .click();
  const details = page.getByTestId("discovery-type-details-dialog");
  await expect(details).toBeVisible();
  await expect(details.getByTestId("discovery-tag-picker")).toBeVisible();
  await expect(details.getByText("Also try", { exact: true })).toBeVisible();
  await details
    .getByRole("button", { name: "Details for Bed and breakfasts" })
    .click();
  await expect(
    details.getByRole("heading", { name: "Bed and breakfasts" }),
  ).toBeVisible();
  await details.getByRole("button", { name: "Back to browsing" }).click();
  await expect(details).toHaveCount(0);
  await searchFor(page, "guest house");
  await page
    .getByTestId("discovery-type-card-guesthouses-and-inns")
    .getByRole("button", { name: "Details for Guesthouses and inns" })
    .click();
  await expect(page.getByTestId("discovery-type-details-dialog")).toBeVisible();
  return details;
}

async function captureDialog(details: Locator, name: string) {
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(details.page());
  await details.screenshot({
    animations: "disabled",
    path: path.join(PROOF_DIR, name),
  });
}

for (const [width, height] of [
  [390, 844],
  [900, 900],
  [1440, 900],
] as const) {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    test(`Discovery tag search "sofa" shows the matched tag at ${String(width)} ${mode}`, async ({
      page,
    }) => {
      await openDiscovery(page, width, height, dark);
      await searchFor(page, "sofa");
      const card = page.getByTestId(
        "discovery-type-card-furniture-manufacturers",
      );
      await expect(card).toBeVisible();
      await expect(card).toContainText("Furniture manufacturers");
      const hint = page.getByTestId(
        "discovery-type-match-furniture-manufacturers",
      );
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText(/^Matches: .*sofa/);
      // A name match carries no hint.
      await expect(
        page.getByTestId("discovery-type-match-sofa-couch-retailers"),
      ).toHaveCount(0);
      await expect(
        page.locator(".d4-global-type-grid .d4-type-card").first(),
      ).toHaveAttribute(
        "data-testid",
        "discovery-type-card-sofa-couch-retailers",
      );
      await expectNoHorizontalOverflow(page);
      await hint.scrollIntoViewIfNeeded();
      if (width !== 900) {
        await capture(page, `sofa-${String(width)}-${mode}.png`);
      }
    });
  }
}

test("Discovery tag search finds a South African term and keeps the name match first", async ({
  page,
}) => {
  await openDiscovery(page, 1440, 900);
  await searchFor(page, "spaza");
  await expect(
    page.getByTestId("discovery-type-card-convenience-stores"),
  ).toBeVisible();
  await searchFor(page, "guest house");
  await expect(
    page.locator(".d4-global-type-grid .d4-type-card").first(),
  ).toHaveAttribute("data-testid", "discovery-type-card-guesthouses-and-inns");
});

test("Discovery search inside an industry shows the hint too", async ({
  page,
}) => {
  await openDiscovery(page, 1440, 900);
  await page
    .getByRole("button", { name: /^Manufacturing/ })
    .first()
    .click();
  await searchFor(page, "sofa");
  await expect(
    page.getByTestId("discovery-type-match-furniture-manufacturers"),
  ).toBeVisible();
});

for (const [width, height] of [
  [390, 844],
  [900, 900],
  [1440, 900],
] as const) {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    test(`Guesthouse details show the tag picker and related types at ${String(width)} ${mode}`, async ({
      page,
    }) => {
      await openDiscovery(page, width, height, dark);
      const details = await openGuesthouseDetails(page);
      await expectNoHorizontalOverflow(page);
      await expect(details.getByTestId("discovery-tag-picker")).toBeVisible();
      if (width !== 900) {
        await captureDialog(
          details,
          `guesthouse-details-${String(width)}-${mode}.png`,
        );
      }

      const related = details.getByTestId("discovery-related-types");
      const bedAndBreakfasts = related.getByRole("button", {
        name: "Details for Bed and breakfasts",
      });
      await expect(bedAndBreakfasts).toBeVisible();
      if (width !== 900) {
        await captureDialog(
          related,
          `guesthouse-related-${String(width)}-${mode}.png`,
        );
      }
    });
  }
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    test(`a picked discovery tag narrows the mock run and appears on its lead at ${String(width)} ${mode}`, async ({
      page,
    }) => {
      await openRealDiscovery(page, width, height, dark);
      const details = await openGuesthouseDetails(page);
      await details
        .getByRole("button", { name: /^Show all \d+ tags$/ })
        .click();
      const weddingGuest = details.getByTestId("discovery-tag-wedding guest");
      await expect(weddingGuest).toBeVisible();
      await weddingGuest.focus();
      await page.keyboard.press("Space");
      await expect(weddingGuest).toHaveAttribute("aria-pressed", "true");
      await details.getByRole("button", { name: /Find prospects/ }).click();

      const form = page.getByTestId("discovery-campaign-dialog");
      await expect(form).toBeVisible();
      await form.getByLabel("Location").fill("South Africa");
      await form.getByLabel("Prospect target").fill("5");
      await form
        .getByRole("checkbox", {
          name: "I approve this campaign’s maximum budget.",
        })
        .check();
      await form.getByRole("button", { name: /Approve & start/ }).click();

      const campaign = page.getByTestId("w10-campaign-page");
      await expect(campaign).toBeVisible();
      await expect(
        page.getByText("Search complete", { exact: true }),
      ).toBeVisible({
        timeout: 15_000,
      });
      await expect(campaign.getByLabel("Picked search tags")).toContainText(
        "wedding guest",
      );
      await expect(campaign.getByLabel("Sort prospects")).toHaveValue("fit");
      await expect(campaign.getByLabel("Sort prospects")).toContainText(
        "Best fit",
      );
      const row = campaign.locator("tbody tr");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Wedding Guest House");
      await expect(row).toContainText("wedding guest");
      await expect(row).toContainText("Possible fit");
      await expect
        .poll(() =>
          campaign.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        )
        .toBe(true);
      await capture(page, `picked-tag-campaign-${String(width)}-${mode}.png`);

      await expect(
        campaign.getByRole("heading", { name: "Widen this search" }),
      ).toBeVisible();
      await campaign
        .getByRole("button", { name: "Details for Bed and breakfasts" })
        .click();
      await expect(
        page
          .getByTestId("discovery-type-details-dialog")
          .getByRole("heading", { name: "Bed and breakfasts" }),
      ).toBeVisible();
      await page
        .getByTestId("discovery-type-details-dialog")
        .getByRole("button", { name: "Back to browsing" })
        .click();

      const calls = await page.evaluate(
        () => (window as DiscoveryE2EWindow).__discoveryCalls ?? [],
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        query: "wedding guest Guesthouses and inns",
        limit: 20,
        skip: 0,
        location: "South Africa",
      });

      await row
        .getByRole("link", { name: /matching tags wedding guest/ })
        .click();
      const lead = page.getByTestId("w10-prospect-page");
      await expect(lead).toBeVisible();
      await expect
        .poll(() =>
          lead.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        )
        .toBe(true);
      await expect(
        lead.getByRole("heading", { name: "Matched tags" }),
      ).toBeVisible();
      await expect(lead).toContainText("wedding guest");
    });
  }
}
