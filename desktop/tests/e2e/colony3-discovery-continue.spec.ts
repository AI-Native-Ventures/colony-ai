import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import { waitForAnimations } from "../helpers/animations";

const PROOF_DIR =
  process.env.COLONY3_DISCOVERY_CONTINUE_PROOF_DIR ??
  "test-results/colony3-discovery-continue";

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;

const EXISTING_LEAD_NAMES = [
  "The Olive House",
  "Form & Field",
  "The Sunday Edit",
  "Stillroom",
  "Gather House",
  "Common Ground Store",
];

type DiscoveryWindow = Window & {
  __discoveryCalls?: Array<Record<string, unknown>>;
  __locationCalls?: string[];
  __BUZZ_E2E_DISCOVERY_SEARCH__?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  __BUZZ_E2E_DISCOVERY_LOCATIONS__?: (request: {
    query: string;
  }) => Promise<unknown>;
};

async function installDiscoveryFixture(page: Page) {
  await page.addInitScript((existingNames) => {
    const w = window as DiscoveryWindow;
    const place = (id: string, name: string) => ({
      placeId: id,
      name,
      category: "Home goods store",
      address: `1 Main Road, ${name}`,
      city: "Johannesburg",
      state: "Gauteng",
      country: "South Africa",
      phone: "+27 11 555 0100",
      website: `https://${id}.example`,
      rating: 4.5,
      reviews: 20,
    });
    w.__discoveryCalls = [];
    w.__locationCalls = [];
    w.__BUZZ_E2E_DISCOVERY_LOCATIONS__ = async ({ query }) => {
      w.__locationCalls?.push(query);
      return {
        locations: [
          {
            label: "Johannesburg, Gauteng, South Africa",
            latitude: -26.2041,
            longitude: 28.0473,
            countryCode: "ZA",
            region: "Gauteng",
            kind: "city",
            boundingBox: [27.85, -26.35, 28.25, -26.0],
          },
          {
            label: "Woodmead, Johannesburg, Gauteng, South Africa",
            latitude: -26.055,
            longitude: 28.081,
            countryCode: "ZA",
            region: "Gauteng",
            kind: "suburb",
            boundingBox: [28.07, -26.06, 28.09, -26.04],
          },
          {
            label: "Sandton, Johannesburg, Gauteng, South Africa",
            latitude: -26.1076,
            longitude: 28.0567,
            countryCode: "ZA",
            region: "Gauteng",
            kind: "suburb",
            boundingBox: [28.03, -26.13, 28.08, -26.08],
          },
        ],
      };
    };
    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
      w.__discoveryCalls?.push(request);
      const skip = Number(request.skip ?? 0);
      if (skip < 100) {
        return {
          provider: "outscraper",
          // The reference workspace already has each of these businesses.
          // Five full pages must still advance to the approved budget cursor.
          places: Array.from({ length: 20 }, (_, index) =>
            place(
              `known-${String(skip)}-${String(index)}`,
              existingNames[index % existingNames.length],
            ),
          ),
          estimatedCostUsd: 0.06,
          nextSkip: skip + 20,
        };
      }
      return {
        provider: "outscraper",
        places: [
          place("continued-1", "Continuation Store One"),
          place("continued-2", "Continuation Store Two"),
          place("continued-3", "Continuation Store Three"),
        ],
        estimatedCostUsd: 0.06,
        nextSkip: null,
      };
    };
  }, EXISTING_LEAD_NAMES);
}

async function openDiscovery(page: Page) {
  await installDiscoveryFixture(page);
  await installMockBridge(page, REAL_RUNNER);
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
}

async function openCampaignDialog(page: Page) {
  await page
    .getByRole("textbox", { name: /Search industries/ })
    .fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const typeDetails = page.getByTestId("discovery-type-details-dialog");
  await expect(typeDetails).toBeVisible();
  await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseJohannesburg(dialog: Locator) {
  const input = dialog.getByRole("combobox", { name: "Location" });
  await input.fill("Joh");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(
    dialog.getByText(/Selected Johannesburg, Gauteng, South Africa/),
  ).toBeVisible();
}

async function approve(dialog: Locator) {
  await dialog.getByLabel("Prospect target").fill("100");
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
}

async function searchCalls(page: Page) {
  return page.evaluate(
    () => (window as DiscoveryWindow).__discoveryCalls ?? [],
  );
}

async function seedTheme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.addInitScript(
    (theme) => {
      window.localStorage.setItem("buzz-theme", theme);
      window.localStorage.setItem("buzz-follow-system", "false");
    },
    dark ? "buzz-dark" : "buzz",
  );
}

test.beforeEach(async ({ page }) => {
  await installDiscoveryImageMocks(page);
});

test("same industry and city continue past existing leads, then Find more resumes the stopped cursor", async ({
  page,
}) => {
  await openDiscovery(page);
  const firstDialog = await openCampaignDialog(page);
  await chooseJohannesburg(firstDialog);
  await approve(firstDialog);

  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
  await expect(page.getByText("Search complete", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText(/approved search budget was used after 5 pages/i),
  ).toBeVisible();
  await expect(
    page.getByText("Search nearby areas", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Woodmead, Johannesburg, Gauteng, South Africa",
    }),
  ).toBeVisible();
  expect((await searchCalls(page)).map((call) => call.skip)).toEqual([
    0, 20, 40, 60, 80,
  ]);

  await page.getByRole("button", { name: /Find more/ }).click();
  const moreDialog = page.getByTestId("discovery-campaign-dialog");
  await expect(moreDialog).toBeVisible();
  await expect(
    moreDialog.getByText(/Selected Johannesburg, Gauteng, South Africa/),
  ).toBeVisible();
  await approve(moreDialog);

  await expect(page.getByText("Search complete", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByTestId("w10-campaign-page").locator("tbody tr"),
  ).toHaveCount(3);
  expect((await searchCalls(page)).map((call) => call.skip)).toEqual([
    0, 20, 40, 60, 80, 100,
  ]);
  await expect(
    page.getByText(/Search cost.*\$0\.06.*\$0\.30 approved/),
  ).toBeVisible();
});

test("location autocomplete refuses free text, then supports keyboard selection", async ({
  page,
}) => {
  await openDiscovery(page);
  const dialog = await openCampaignDialog(page);
  const input = dialog.getByRole("combobox", { name: "Location" });
  await input.fill("Johannesburg");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Pick a place from the list before starting this search.",
  );
  expect(await searchCalls(page)).toHaveLength(0);

  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(
    dialog.getByText(/Selected Johannesburg, Gauteng, South Africa/),
  ).toBeVisible();
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    test(`location picker fits its card at ${String(width)} ${mode}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await seedTheme(page, dark);
      await openDiscovery(page);
      const dialog = await openCampaignDialog(page);
      const input = dialog.getByRole("combobox", { name: "Location" });
      await input.fill("Joh");
      await expect(dialog.getByRole("option").first()).toBeVisible();
      await expect
        .poll(() =>
          dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        )
        .toBe(true);
      mkdirSync(PROOF_DIR, { recursive: true });
      await waitForAnimations(page);
      await dialog.screenshot({
        path: path.join(
          PROOF_DIR,
          `location-picker-${String(width)}-${mode}.png`,
        ),
      });
    });
  }
}
