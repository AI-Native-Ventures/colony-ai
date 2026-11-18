import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import { prepareMapShell } from "./mapShellTestSupport";

const PROOF_DIR =
  process.env.MULTI_CITY_DISCOVERY_PROOF_DIR ??
  "test-results/multi-city-discovery-proof";

const LOCATIONS = [
  {
    label: "Johannesburg, Gauteng, South Africa",
    latitude: -26.2041,
    longitude: 28.0473,
    countryCode: "ZA",
    region: "Gauteng",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "Cape Town, Western Cape, South Africa",
    latitude: -33.9249,
    longitude: 18.4241,
    countryCode: "ZA",
    region: "Western Cape",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "Durban, KwaZulu-Natal, South Africa",
    latitude: -29.8587,
    longitude: 31.0218,
    countryCode: "ZA",
    region: "KwaZulu-Natal",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "Pretoria, Gauteng, South Africa",
    latitude: -25.7479,
    longitude: 28.2293,
    countryCode: "ZA",
    region: "Gauteng",
    kind: "city",
    boundingBox: null,
  },
] as const;

type MultiCityWindow = Window & {
  __BUZZ_E2E_DISCOVERY_LOCATIONS__?: (request: {
    query: string;
  }) => Promise<unknown>;
  __BUZZ_E2E_MULTI_CITY_RESULT_LOCATIONS__?: string[];
};

async function installMultiCityFixture(
  page: Page,
  scenario: { dark: boolean; height: number; width: number },
) {
  await page.addInitScript((locations) => {
    const testWindow = window as MultiCityWindow;
    testWindow.__BUZZ_E2E_MULTI_CITY_RESULT_LOCATIONS__ = locations.map(
      (location) => location.label,
    );
    testWindow.__BUZZ_E2E_DISCOVERY_LOCATIONS__ = async ({ query }) => {
      const normalized = query.trim().toLocaleLowerCase();
      const matching = locations.filter((location) =>
        location.label.toLocaleLowerCase().includes(normalized),
      );
      return { locations: matching.length ? matching : locations };
    };
  }, LOCATIONS);
  await installDiscoveryImageMocks(page);
  await prepareMapShell(page, {
    cofounderEnabled: true,
    featureEnabled: true,
    height: scenario.height,
    theme: scenario.dark ? "dark" : "light",
    width: scenario.width,
  });
  await expect(page.getByTestId("map-shell-bar")).toBeVisible();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
}

async function capture(page: Page, name: string) {
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: path.join(PROOF_DIR, name),
  });
}

async function openCampaignDialog(page: Page) {
  await page.getByTestId("cofounder-map-sales").click();
  const leadFinding = page.getByTestId("cofounder-map-job-sales-lead-finding");
  await expect(leadFinding).toBeVisible();
  await leadFinding.click();
  await expect(page.getByTestId("fullmap-window")).toBeVisible();
  const discovery = page.getByTestId("w10-discovery-page");
  await expect(discovery).toBeVisible();
  await discovery
    .getByRole("textbox", { name: /Search industries/ })
    .fill("home decor");
  await discovery
    .getByRole("button", { name: "Find prospects" })
    .first()
    .click();
  const details = page.getByTestId("discovery-type-details-dialog");
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: /Find prospects/ }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function assertCityTabGeometry(page: Page) {
  const tablist = page.getByRole("tablist", { name: "Campaign cities" });
  await expect(tablist).toBeVisible();
  await waitForAnimations(page);
  const geometry = await tablist.evaluate((node) => {
    const tabs = Array.from(node.querySelectorAll<HTMLElement>('[role="tab"]'));
    return {
      gap: Math.round(parseFloat(getComputedStyle(node).gap)),
      heights: tabs.map((tab) => tab.offsetHeight),
    };
  });
  expect(geometry.heights).toEqual([84, 84, 84, 84, 84]);
  expect(geometry.gap).toBe(10);
}

async function chooseByKeyboard(input: Locator, label: string) {
  await input.fill(label.split(",")[0] ?? label);
  await expect(
    input
      .page()
      .getByRole("option", { name: new RegExp(label.split(",")[0] ?? label) }),
  ).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
}

async function chooseByPointer(dialog: Locator, input: Locator, label: string) {
  await input.fill(label.split(",")[0] ?? label);
  await dialog
    .getByRole("option", { name: new RegExp(label.split(",")[0] ?? label) })
    .click();
}

async function createFourCityCampaign(page: Page, screenshotPrefix: string) {
  const dialog = await openCampaignDialog(page);
  const input = dialog.getByRole("combobox", { name: /Cities|Location/ });
  const chips = dialog.getByTestId("multi-city-location-chips");
  await chooseByKeyboard(input, LOCATIONS[0].label);
  await chooseByPointer(dialog, input, LOCATIONS[1].label);
  await chooseByKeyboard(input, LOCATIONS[2].label);
  await expect(chips).toContainText("Durban");
  await chooseByPointer(dialog, input, LOCATIONS[3].label);
  await expect(chips).toContainText("Pretoria");
  await dialog.getByRole("button", { name: "Remove Pretoria" }).click();
  await expect(chips).not.toContainText("Pretoria");
  await input.press("Backspace");
  await expect(chips).not.toContainText("Durban");
  await chooseByKeyboard(input, LOCATIONS[2].label);
  await expect(chips).toContainText("Johannesburg");
  await expect(chips).toContainText("Durban");
  await expect(chips).not.toContainText("Pretoria");
  await chooseByPointer(dialog, input, LOCATIONS[3].label);
  await expect(chips).toContainText("Pretoria");
  await expect(dialog.getByTestId("multi-city-total")).toHaveText(
    "4 campaigns, up to 400 prospects in all.",
  );
  await dialog.getByLabel("Prospects per city").fill("100");
  await dialog
    .getByRole("checkbox", {
      name: "I approve the maximum budget for all 4 campaigns.",
    })
    .check();
  await capture(page, `${screenshotPrefix}-dialog-approval.png`);
  await dialog.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(chips).toBeVisible();
  await capture(page, `${screenshotPrefix}-dialog-cities.png`);
  await dialog.getByRole("button", { name: "Approve & start 4" }).click();
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
}

async function exerciseGroup(page: Page, screenshotPrefix: string) {
  await expect(page.getByTestId("fullmap-window")).toBeVisible();
  await expect(page.getByRole("tab", { name: /All cities/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(5);
  await assertCityTabGeometry(page);
  const capeTown = page.getByRole("tab", { name: /Cape Town/ });
  await capeTown.click();
  await expect(page.getByTestId("multi-city-waiting")).toContainText(
    "Cape Town is waiting",
  );
  await expect(
    page.getByRole("tab", { name: /Johannesburg, Searching/ }),
  ).toBeVisible();
  await capture(page, `${screenshotPrefix}-campaign-city.png`);
  const durban = page.getByRole("tab", { name: /Durban/ });
  await capeTown.press("ArrowRight");
  await expect(durban).toHaveAttribute("aria-selected", "true");
  await durban.press("ArrowLeft");
  await capeTown.press(" ");
  await expect(capeTown).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /All cities/ }).click();
  const summary = page.getByTestId("multi-city-all-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("12 of 400 prospects found in all", {
    timeout: 12_000,
  });
  const prospects = page.getByRole("table", { name: "Prospects" });
  await expect(prospects).toContainText("Parkhurst, Johannesburg");
  await expect(prospects).toContainText("Woodstock, Cape Town");
  await capture(page, `${screenshotPrefix}-campaign-all.png`);

  await page.goBack();
  const discovery = page.getByTestId("w10-discovery-page");
  await expect(discovery).toBeVisible();
  await discovery.getByRole("button", { name: "All campaigns" }).click();
  await expect(page.getByTestId("discovery-campaigns-page")).toBeVisible();
  await expect(page.getByTestId("fullmap-window")).toBeVisible();
  const groupRow = page
    .getByTestId("discovery-campaign-row")
    .filter({ hasText: "Home furnishings retailers prospects" });
  await expect(groupRow).toHaveCount(1);
  await expect(groupRow).toContainText("4 cities");
  await page
    .locator(".c3d-campaigns-desktop-filters")
    .getByLabel("Campaign location")
    .selectOption(LOCATIONS[1].label);
  await expect(groupRow).toHaveCount(1);
  await capture(page, `${screenshotPrefix}-campaigns.png`);
}

for (const scenario of [
  { dark: false, height: 900, name: "1440-light", width: 1440 },
  { dark: true, height: 1117, name: "1728-dark", width: 1728 },
] as const) {
  test(`multi-city Discovery queues cities and keeps campaign grouping at ${scenario.name}`, async ({
    page,
  }) => {
    await installMultiCityFixture(page, scenario);
    await createFourCityCampaign(page, `multi-city-${scenario.name}`);
    await exerciseGroup(page, `multi-city-${scenario.name}`);
  });
}
