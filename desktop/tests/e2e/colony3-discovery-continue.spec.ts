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
    const initialNames = [
      "Aquila Counter",
      "Bracken Foundry",
      "Crown Sable",
      "Dovetail Orange",
      "Everest Cubed",
      "Fable Rocket",
      "Gossamer Onyx",
      "Hearth Quasar",
      "Iris Parchment",
      "Jasper Nebula",
      "Kestrel Marble",
    ];
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
          // The first page saves 11 new businesses. The next four are all
          // existing leads, so five paid pages use the initial approval while
          // leaving the owner below the 100-prospect target.
          places:
            skip === 0
              ? [
                  ...Array.from({ length: 11 }, (_, index) =>
                    place(
                      `initial-${String(index + 1)}`,
                      initialNames[index] ?? `Initial Fixture ${String(index)}`,
                    ),
                  ),
                  ...Array.from({ length: 9 }, (_, index) =>
                    place(
                      `known-${String(index)}`,
                      existingNames[index % existingNames.length],
                    ),
                  ),
                ]
              : Array.from({ length: 20 }, (_, index) =>
                  place(
                    `known-${String(skip)}-${String(index)}`,
                    existingNames[index % existingNames.length],
                  ),
                ),
          estimatedCostUsd: 0.06,
          nextSkip: skip + 20,
        };
      }
      // The provider ends at skip 100. Pages asked ahead past it are empty.
      if (skip > 100) {
        return {
          provider: "outscraper",
          places: [],
          estimatedCostUsd: 0,
          nextSkip: null,
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

async function campaignStorage(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem(
      "colony:discovery-campaigns:v1:e2e-default-community",
    );
    return raw
      ? (JSON.parse(raw) as {
          currentId: string;
          campaigns: Array<{
            id: string;
            budgetUsd: number;
            spentUsd: number;
          }>;
        })
      : null;
  });
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

test("results already in Leads are not charged, and Find more continues the same campaign without a new approval", async ({
  page,
}) => {
  await openDiscovery(page);
  const firstDialog = await openCampaignDialog(page);
  await chooseJohannesburg(firstDialog);
  await expect(firstDialog.getByText("Maximum search budget")).toBeVisible();
  await expect(firstDialog.getByText("US$3.00", { exact: true })).toBeVisible();
  await expect(
    firstDialog.getByText(/US\$0\.03 per new prospect\./),
  ).toBeVisible();
  await expect(
    firstDialog.getByText(/Businesses already in your Leads are not charged\./),
  ).toBeVisible();
  await expect(firstDialog).not.toContainText("per 20 results");
  await expect(firstDialog).not.toContainText("US$0.30");
  await approve(firstDialog);

  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
  await expect(page.getByText("Search complete", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  // 100 results were approved and used. 89 of them were already Leads, so
  // the run stops and asks before it searches further.
  await expect(
    page.getByText(/results you approved were used after 5 pages/i),
  ).toBeVisible();
  await expect(
    page.getByText(/89 were already in your Leads and are not charged/),
  ).toBeVisible();
  await expect(
    page.getByText(/Keep searching for the other 89\?/),
  ).toBeVisible();
  // Only the 11 new prospects are charged.
  await expect(
    page.getByText(/Search cost.*US\$0\.33.*US\$3\.00 approved/),
  ).toBeVisible();
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    path: path.join(PROOF_DIR, "budget-ask-1440.png"),
  });
  const desktopSize = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForAnimations(page);
  await page.screenshot({
    path: path.join(PROOF_DIR, "budget-ask-390.png"),
  });
  if (desktopSize) await page.setViewportSize(desktopSize);
  await expect(
    page.getByText("Search nearby areas", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/11 prospects found · 100 requested/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Woodmead, Johannesburg, Gauteng, South Africa",
    }),
  ).toBeVisible();
  expect((await searchCalls(page)).map((call) => call.skip)).toEqual([
    0, 20, 40, 60, 80,
  ]);
  const beforeFindMore = await campaignStorage(page);
  expect(beforeFindMore?.campaigns).toHaveLength(1);
  expect(beforeFindMore?.currentId).toBe(beforeFindMore?.campaigns[0]?.id);
  expect(beforeFindMore?.campaigns[0]?.budgetUsd).toBe(0.3);
  expect(beforeFindMore?.campaigns[0]?.spentUsd).toBe(0.3);

  // Continuing asks for no money: there is no approval dialog any more.
  await page.getByRole("button", { name: /Find more/ }).click();
  await expect(page.getByTestId("discovery-continuation-dialog")).toHaveCount(
    0,
  );

  await expect(page.getByText("Search complete", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("link", { name: "Prospects 14" })).toBeVisible();
  // The five continued pages are asked for together, not one by one.
  expect((await searchCalls(page)).map((call) => call.skip)).toEqual([
    0, 20, 40, 60, 80, 100, 120, 140, 160, 180,
  ]);
  const afterFindMore = await campaignStorage(page);
  expect(afterFindMore?.campaigns).toHaveLength(1);
  expect(afterFindMore?.currentId).toBe(beforeFindMore?.currentId);
  expect(afterFindMore?.campaigns[0]?.budgetUsd).toBe(0.6);
  expect(afterFindMore?.campaigns[0]?.spentUsd).toBe(0.36);
  await expect(
    page.getByText(/Search cost.*US\$0\.42.*US\$3\.00 approved/),
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
