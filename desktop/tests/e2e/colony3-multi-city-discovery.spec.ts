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
  {
    label: "Bloemfontein, Free State, South Africa",
    latitude: -29.0852,
    longitude: 26.1596,
    countryCode: "ZA",
    region: "Free State",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "Gqeberha, Eastern Cape, South Africa",
    latitude: -33.9608,
    longitude: 25.6022,
    countryCode: "ZA",
    region: "Eastern Cape",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "KuGompo City, Eastern Cape, South Africa",
    latitude: -23.9045,
    longitude: 29.4689,
    countryCode: "ZA",
    region: "Eastern Cape",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "Pietermaritzburg, KwaZulu-Natal, South Africa",
    latitude: -25.4658,
    longitude: 30.9853,
    countryCode: "ZA",
    region: "KwaZulu-Natal",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "Nelson Mandela Bay, Eastern Cape, South Africa",
    latitude: -25.8652,
    longitude: 25.6442,
    countryCode: "ZA",
    region: "Eastern Cape",
    kind: "city",
    boundingBox: null,
  },
  {
    label: "Kimberley, Northern Cape, South Africa",
    latitude: -28.7282,
    longitude: 24.7499,
    countryCode: "ZA",
    region: "Northern Cape",
    kind: "city",
    boundingBox: null,
  },
] as const;

type MultiCityWindow = Window & {
  __BUZZ_E2E_DISCOVERY_LOCATIONS__?: (request: {
    query: string;
  }) => Promise<unknown>;
  __BUZZ_E2E_MULTI_CITY_RESULT_LOCATIONS__?: string[];
  __BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__?: boolean;
  __BUZZ_E2E_REFERENCE_DISCOVERY_RESUME__?: () => void;
  __BUZZ_E2E_W10_FAIL_NEXT_RUN__?: boolean;
  __BUZZ_E2E_W10_FAIL_NEXT_START__?: boolean;
};

async function installMultiCityFixture(
  page: Page,
  scenario: { dark: boolean; height: number; width: number },
) {
  await page.addInitScript((locations) => {
    const testWindow = window as MultiCityWindow;
    testWindow.__BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__ = true;
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
  const discovery = page.getByTestId("w10-discovery-page");
  if (!(await discovery.isVisible())) {
    await page.getByTestId("cofounder-map-sales").click();
    const leadFinding = page.getByTestId("cofounder-map-job-sales-lead-finding");
    await expect(leadFinding).toBeVisible();
    await leadFinding.click();
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
  }
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

async function assertCityTabGeometry(page: Page, expectedTabs: number, oneRow = false) {
  const tablist = page.getByRole("tablist", { name: "Campaign cities" });
  await expect(tablist).toBeVisible();
  await waitForAnimations(page);
  const geometry = await tablist.evaluate((node) => {
    const tabs = Array.from(node.querySelectorAll<HTMLElement>('[role="tab"]'));
    return {
      gap: Math.round(parseFloat(getComputedStyle(node).gap)),
      heights: tabs.map((tab) => tab.offsetHeight),
      tops: tabs.map((tab) => Math.round(tab.getBoundingClientRect().top)),
      overflows: [
        {
          clientWidth: node.clientWidth,
          name: "tab row",
          scrollWidth: node.scrollWidth,
        },
        ...tabs.flatMap((tab) =>
          [
            {
              element: tab.querySelector<HTMLElement>(
                ".c3mc-city-tab-top > strong",
              ),
              name: "name",
            },
            {
              element: tab.querySelector<HTMLElement>(
                ".c3mc-city-tab-status",
              ),
              name: "status",
            },
            {
              element: tab.querySelector<HTMLElement>(
                ".c3mc-city-tab-count",
              ),
              name: "count",
            },
          ].flatMap(({ name, element }) =>
            element && element.scrollWidth > element.clientWidth
              ? [
                  {
                    clientWidth: element.clientWidth,
                    name,
                    scrollWidth: element.scrollWidth,
                  },
                ]
              : [],
          ),
        ),
      ],
    };
  });
  expect(geometry.heights).toEqual(Array(expectedTabs).fill(84));
  expect(geometry.gap).toBe(10);
  expect(geometry.overflows).toEqual([]);
  if (oneRow) expect(new Set(geometry.tops).size).toBe(1);
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
  const queueHint = dialog.locator(".c3mc-campaign-queue-hint");
  await chooseByKeyboard(input, LOCATIONS[0].label);
  await chooseByPointer(dialog, input, LOCATIONS[1].label);
  await expect(queueHint).toHaveText(
    "One campaign per city. Colony searches them at the same time, so you can close this and come back.",
  );
  await chooseByKeyboard(input, LOCATIONS[2].label);
  await expect(queueHint).toHaveText(
    "One campaign per city. Colony searches them at the same time, so you can close this and come back.",
  );
  await expect(chips).toContainText("Durban");
  await chooseByPointer(dialog, input, LOCATIONS[3].label);
  await expect(chips).toContainText("Pretoria");
  await expect(queueHint).toHaveText(
    "One campaign per city. Colony searches 3 at a time, so you can close this and come back.",
  );
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

async function exerciseFourCityGroup(page: Page, screenshotPrefix: string) {
  await expect(page.getByTestId("fullmap-window")).toBeVisible();
  await expect(page.getByRole("tab", { name: /All cities/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(5);
  await assertCityTabGeometry(page, 5, true);
  await expect(
    page.getByRole("tab", { name: /Johannesburg.*Searching/ }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Cape Town.*Searching/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Durban.*Searching/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Pretoria.*Waiting/ })).toBeVisible();
  await capture(page, `${screenshotPrefix}-four-one-row.png`);
  const capeTown = page.getByRole("tab", { name: /Cape Town/ });
  await capeTown.click();
  await expect(capeTown).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Finding prospects" }),
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
  await capture(page, `${screenshotPrefix}-campaign-all.png`);
}

async function createTenCityCampaign(page: Page) {
  const dialog = await openCampaignDialog(page);
  const input = dialog.getByRole("combobox", { name: /Cities|Location/ });
  for (const [index, location] of LOCATIONS.entries()) {
    if (index % 2 === 0) await chooseByKeyboard(input, location.label);
    else await chooseByPointer(dialog, input, location.label);
  }
  await expect(dialog.getByTestId("multi-city-total")).toHaveText(
    "10 campaigns, up to 1000 prospects in all.",
  );
  await dialog.getByRole("checkbox", {
    name: "I approve the maximum budget for all 10 campaigns.",
  }).check();
  await dialog.getByRole("button", { name: "Approve & start 10" }).click();
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
}

async function createFiveCityCampaign(page: Page) {
  const dialog = await openCampaignDialog(page);
  const input = dialog.getByRole("combobox", { name: /Cities|Location/ });
  for (const [index, location] of LOCATIONS.slice(0, 5).entries()) {
    if (index % 2 === 0) await chooseByKeyboard(input, location.label);
    else await chooseByPointer(dialog, input, location.label);
  }
  await dialog.getByRole("checkbox", {
    name: "I approve the maximum budget for all 5 campaigns.",
  }).check();
  await dialog.getByRole("button", { name: "Approve & start 5" }).click();
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
}

async function createThreeCityCampaign(page: Page) {
  const dialog = await openCampaignDialog(page);
  const input = dialog.getByRole("combobox", { name: /Cities|Location/ });
  for (const [index, location] of LOCATIONS.slice(0, 3).entries()) {
    if (index % 2 === 0) await chooseByKeyboard(input, location.label);
    else await chooseByPointer(dialog, input, location.label);
  }
  await dialog.getByRole("checkbox", {
    name: "I approve the maximum budget for all 3 campaigns.",
  }).check();
  await dialog.getByRole("button", { name: "Approve & start 3" }).click();
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
}

async function exerciseTenCityGroup(page: Page, screenshotPrefix: string) {
  await expect(page.getByRole("tab")).toHaveCount(11);
  await assertCityTabGeometry(page, 11);
  await expect(page.getByRole("tab", { name: /All cities/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const location of LOCATIONS.slice(0, 3)) {
    await expect(
      page.getByRole("tab", {
        name: new RegExp(`${location.label.split(",")[0]}.*Searching`),
      }),
    ).toBeVisible();
  }
  await capture(page, `${screenshotPrefix}-ten-cities-all.png`);
  const city = page.getByRole("tab", { name: /Cape Town/ });
  await city.click();
  await expect(city).toHaveAttribute("aria-selected", "true");
  await capture(page, `${screenshotPrefix}-ten-cities-cape-town.png`);

  const tabs = page.getByRole("tab");
  await page.getByRole("tab", { name: /All cities/ }).focus();
  for (let index = 1; index < 11; index += 1) {
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(index)).toBeFocused();
  }
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
}

async function returnToDiscovery(page: Page) {
  await page.goBack();
  const discovery = page.getByTestId("w10-discovery-page");
  await expect(discovery).toBeVisible();
}

async function exerciseFailedCityRecovery(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as MultiCityWindow;
    testWindow.__BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__ = false;
    testWindow.__BUZZ_E2E_W10_FAIL_NEXT_RUN__ = true;
    testWindow.__BUZZ_E2E_REFERENCE_DISCOVERY_RESUME__?.();
  });
  const failed = page.getByRole("tab", { name: /Failed/ });
  await expect(failed).toBeVisible({ timeout: 5_000 });
  const failedCity = (await failed.getAttribute("aria-label"))?.split(",")[0];
  if (!failedCity) throw new Error("The failed city tab needs an accessible name.");
  await failed.click();
  const panel = page.getByTestId("multi-city-failed-city");
  await expect(panel).toContainText(new RegExp(`${failedCity} stopped`));
  const retry = panel.getByRole("button", { name: /Try again/ });
  await expect(retry).toBeVisible();
  await retry.press("Enter");
  await expect(
    page.getByRole("tab", {
      name: new RegExp(`${failedCity}.*Searching`),
    }),
  ).toBeVisible();
  await expect(failed).toBeFocused();
}

test("five cities retain a paused slot and replace only completed or cancelled slots", async ({
  page,
}) => {
  await installMultiCityFixture(page, {
    dark: false,
    height: 900,
    width: 1440,
  });
  await createFiveCityCampaign(page);
  await expect(page.getByRole("tab", { name: /Johannesburg.*Searching/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Cape Town.*Searching/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Durban.*Searching/ })).toBeVisible();
  const pretoria = page.getByRole("tab", { name: /Pretoria.*Waiting/ });
  const bloemfontein = page.getByRole("tab", { name: /Bloemfontein.*Waiting/ });
  const johannesburg = page.getByRole("tab", { name: /Johannesburg/ });
  await johannesburg.click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(johannesburg).toHaveAttribute("aria-label", /Paused/);
  await expect(pretoria).toHaveAttribute("aria-label", /Waiting/);
  await expect(bloemfontein).toHaveAttribute("aria-label", /Waiting/);

  await page.evaluate(() => {
    const testWindow = window as MultiCityWindow;
    testWindow.__BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__ = false;
    testWindow.__BUZZ_E2E_REFERENCE_DISCOVERY_RESUME__?.();
  });
  await expect(pretoria).toHaveAttribute("aria-label", /Searching/, {
    timeout: 5_000,
  });
  await expect(bloemfontein).toHaveAttribute("aria-label", /Waiting/);

  await johannesburg.click();
  await page.getByRole("button", { name: "Cancel search" }).click();
  await expect(bloemfontein).toHaveAttribute("aria-label", /Searching/, {
    timeout: 5_000,
  });
});

test("a city that never started explains the reason and retries as a fresh campaign", async ({
  page,
}) => {
  await installMultiCityFixture(page, {
    dark: false,
    height: 900,
    width: 1440,
  });
  await page.evaluate(() => {
    (window as MultiCityWindow).__BUZZ_E2E_W10_FAIL_NEXT_START__ = true;
  });
  await createThreeCityCampaign(page);
  const failed = page.getByRole("tab", { name: /Johannesburg.*Failed/ });
  await expect(failed).toBeVisible();
  await failed.click();
  const panel = page.getByTestId("multi-city-failed-city");
  await expect(panel).toContainText("Johannesburg could not start");
  await expect(panel).toContainText("No matching businesses in this area.");
  await panel.getByRole("button", { name: "Try again Johannesburg" }).click();
  await expect(
    page.getByRole("tab", { name: /Johannesburg.*Searching/ }),
  ).toBeVisible();
});

for (const scenario of [
  { dark: false, height: 900, name: "1440-light", width: 1440 },
  { dark: true, height: 900, name: "1440-dark", width: 1440 },
  { dark: false, height: 1117, name: "1728-light", width: 1728 },
  { dark: true, height: 1117, name: "1728-dark", width: 1728 },
] as const) {
  test(`multi-city Discovery searches three cities at once at ${scenario.name}`, async ({
    page,
  }) => {
    await installMultiCityFixture(page, scenario);
    await createFourCityCampaign(page, `multi-city-${scenario.name}`);
    await exerciseFourCityGroup(page, `multi-city-${scenario.name}`);
    if (scenario.name === "1440-light") await exerciseFailedCityRecovery(page);
    await returnToDiscovery(page);
    await page.evaluate(() => {
      (window as MultiCityWindow).__BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__ =
        true;
    });
    await createTenCityCampaign(page);
    await exerciseTenCityGroup(page, `multi-city-${scenario.name}`);
  });
}
