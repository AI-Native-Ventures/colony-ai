import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import { waitForAnimations } from "../helpers/animations";
import { answerFirstSearchWordOnly } from "./helpers/discoveryFirstWord";

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
      city: "Kempton Park",
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
        // A town with no suburb list, offered with two nearby places. A big
        // city searched suburb by suburb has its own test below.
        locations: [
          {
            label: "Kempton Park, Gauteng, South Africa",
            latitude: -26.0964,
            longitude: 28.2336,
            countryCode: "ZA",
            region: "Gauteng",
            kind: "city",
            boundingBox: [28.17, -26.15, 28.3, -26.03],
          },
          {
            label: "Benoni, Gauteng, South Africa",
            latitude: -26.1885,
            longitude: 28.3208,
            countryCode: "ZA",
            region: "Gauteng",
            kind: "suburb",
            boundingBox: [28.28, -26.23, 28.36, -26.15],
          },
          {
            label: "Edenvale, Gauteng, South Africa",
            latitude: -26.1406,
            longitude: 28.152,
            countryCode: "ZA",
            region: "Gauteng",
            kind: "suburb",
            boundingBox: [28.13, -26.16, 28.17, -26.12],
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
  await answerFirstSearchWordOnly(page);
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

async function chooseKemptonPark(dialog: Locator) {
  const input = dialog.getByRole("combobox", { name: "Location" });
  await input.fill("Kem");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(
    dialog.getByText(/Selected Kempton Park, Gauteng, South Africa/),
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
  await chooseKemptonPark(firstDialog);
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
  // 100 results were approved and used. 89 of them were already Leads, so
  // the run stops and asks before it searches further. A card that asks to
  // keep searching does not call the search complete.
  await expect(page.getByText("Found 11 of 100", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Search complete", { exact: true })).toHaveCount(
    0,
  );
  // One short question, not a paragraph.
  await expect(
    page.getByText(
      "89 were already in your Leads and are free. Find the other 89?",
      { exact: true },
    ),
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
  // No row of nearby-area links: nearby areas are one question, asked only
  // once this area has run out.
  await expect(
    page.getByText("Search nearby areas", { exact: true }),
  ).toHaveCount(0);
  // The title holds both numbers, so the line under it is only the question.
  await expect(
    page.getByText(/11 prospects found · 100 requested/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Benoni, Gauteng, South Africa",
    }),
  ).toHaveCount(0);
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

  // Kempton Park ran out at 14. The search stops and asks before it goes
  // anywhere else: nothing was asked of Edenvale or Benoni.
  await expect(page.getByText("Found 14 of 100", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText(
      "Kempton Park has no more. Find more in Edenvale and Benoni?",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    new Set((await searchCalls(page)).map((call) => call.location)),
  ).toEqual(new Set(["Kempton Park, Gauteng, South Africa"]));
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

test("the chosen place runs out: one clean question, and one yes continues through the nearby areas", async ({
  page,
}) => {
  await installDiscoveryFixture(page);
  // Maps lists 27 here, 25 in Edenvale and 10 in Benoni: 62 of the 100 asked.
  await page.addInitScript(() => {
    const w = window as DiscoveryWindow;
    const listed: Record<string, number> = {
      "Kempton Park, Gauteng, South Africa": 27,
      "Edenvale, Gauteng, South Africa": 25,
      "Benoni, Gauteng, South Africa": 10,
    };
    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
      w.__discoveryCalls?.push(request);
      const area = String(request.location ?? "");
      const short = area.split(",")[0] ?? area;
      const total = listed[area] ?? 0;
      const skip = Number(request.skip ?? 0);
      const count = Math.max(0, Math.min(20, total - skip));
      return {
        provider: "outscraper",
        places: Array.from({ length: count }, (_, index) => {
          const n = skip + index + 1;
          return {
            placeId: `${short}-${String(n)}`,
            name: `${short} Interiors ${String(n)}`,
            category: "Home goods store",
            address: `${String(n)} Main Road, ${short}`,
            city: short,
            state: "Gauteng",
            country: "South Africa",
            phone: "+27 11 555 0100",
            website: `https://${short.toLowerCase()}-${String(n)}.example`,
            rating: 4.5,
            reviews: 20,
          };
        }),
        estimatedCostUsd: count > 0 ? 0.06 : 0,
        nextSkip: skip + 20 < total ? skip + 20 : null,
      };
    };
  });
  await answerFirstSearchWordOnly(page);
  await installMockBridge(page, REAL_RUNNER);
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
  const dialog = await openCampaignDialog(page);
  await chooseKemptonPark(dialog);
  await approve(dialog);

  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
  await expect(page.getByText("Found 27 of 100", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const question = page.getByText(
    "Kempton Park has no more. Find more in Edenvale and Benoni?",
    { exact: true },
  );
  await expect(question).toBeVisible();
  // It asked. It did not go there by itself.
  expect(
    new Set((await searchCalls(page)).map((call) => call.location)),
  ).toEqual(new Set(["Kempton Park, Gauteng, South Africa"]));
  await expect(
    page.getByText("Search nearby areas", { exact: true }),
  ).toHaveCount(0);
  const before = await campaignStorage(page);
  expect(before?.campaigns).toHaveLength(1);

  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: path.join(PROOF_DIR, "nearby-ask-1440.png") });
  const desktopSize = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForAnimations(page);
  await page.screenshot({ path: path.join(PROOF_DIR, "nearby-ask-390.png") });
  if (desktopSize) await page.setViewportSize(desktopSize);

  // One yes: Edenvale first (nearer), then Benoni, in the same campaign.
  await page.getByRole("button", { name: /Find more/ }).click();
  await expect(page.getByText("Found 62 of 100", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText(
      "Kempton Park and its nearby areas have no more. Try another business type.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Find more/ })).toHaveCount(0);
  await expect(page.getByText("Kempton Park + 2 nearby areas")).toBeVisible();
  const areas: string[] = [];
  for (const call of await searchCalls(page)) {
    const area = String(call.location).split(",")[0] ?? "";
    if (areas.at(-1) !== area) areas.push(area);
  }
  expect(areas).toEqual(["Kempton Park", "Edenvale", "Benoni"]);
  const after = await campaignStorage(page);
  expect(after?.campaigns).toHaveLength(1);
  expect(after?.currentId).toBe(before?.currentId);
  await expect(page.getByRole("link", { name: "Prospects 62" })).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: path.join(PROOF_DIR, "nearby-done-1440.png") });
});

test("a whole city runs out: the search goes on suburb by suburb inside it, and asks only to go further", async ({
  page,
}) => {
  await installDiscoveryFixture(page);
  // Owner, 18 Nov 2026: whole-city searches stopped under 200. Maps ends one
  // search at about 100 to 150 places; suburbs list businesses it missed.
  await page.addInitScript(() => {
    const w = window as DiscoveryWindow;
    w.__BUZZ_E2E_DISCOVERY_LOCATIONS__ = async () => ({
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
      ],
    });
    const listed: Record<string, number> = {
      "Johannesburg, Gauteng, South Africa": 27,
      "Sandton, Johannesburg, Gauteng, South Africa": 25,
      "Randburg, Johannesburg, Gauteng, South Africa": 30,
      "Soweto, Johannesburg, Gauteng, South Africa": 20,
    };
    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
      w.__discoveryCalls?.push(request);
      const area = String(request.location ?? "");
      const short = area.split(",")[0] ?? area;
      const total = listed[area] ?? 0;
      const skip = Number(request.skip ?? 0);
      const count = Math.max(0, Math.min(20, total - skip));
      return {
        provider: "outscraper",
        places: Array.from({ length: count }, (_, index) => {
          const n = skip + index + 1;
          return {
            placeId: `${short}-${String(n)}`,
            name: `${short} Interiors ${String(n)}`,
            category: "Home goods store",
            address: `${String(n)} Main Road, ${short}`,
            city: short,
            state: "Gauteng",
            country: "South Africa",
            phone: "+27 11 555 0100",
            website: `https://${short.toLowerCase()}-${String(n)}.example`,
            rating: 4.5,
            reviews: 20,
          };
        }),
        estimatedCostUsd: count > 0 ? 0.06 : 0,
        nextSkip: skip + 20 < total ? skip + 20 : null,
      };
    };
  });
  await answerFirstSearchWordOnly(page);
  await installMockBridge(page, REAL_RUNNER);
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
  const dialog = await openCampaignDialog(page);
  const input = dialog.getByRole("combobox", { name: "Location" });
  await input.fill("Joh");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(
    dialog.getByText(/Selected Johannesburg, Gauteng, South Africa/),
  ).toBeVisible();
  await approve(dialog);

  // Johannesburg as a whole lists 27. The run went on to Sandton and
  // Randburg by itself, until the 100 approved results were used.
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
  await expect(page.getByText("Found 72 of 100", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Johannesburg + 2 suburbs")).toBeVisible();
  await expect(
    page.getByText("Find the other 28?", { exact: true }),
  ).toBeVisible();
  const firstAreas = new Set(
    (await searchCalls(page)).map((call) => String(call.location)),
  );
  expect(firstAreas).toEqual(
    new Set([
      "Johannesburg, Gauteng, South Africa",
      "Sandton, Johannesburg, Gauteng, South Africa",
      "Randburg, Johannesburg, Gauteng, South Africa",
    ]),
  );
  for (const call of await searchCalls(page)) {
    expect(call.coordinates, "searched by name, not from one point").toBe(
      undefined,
    );
  }
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: path.join(PROOF_DIR, "suburbs-ask-1440.png") });
  const desktopSize = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForAnimations(page);
  await page.screenshot({ path: path.join(PROOF_DIR, "suburbs-ask-390.png") });
  if (desktopSize) await page.setViewportSize(desktopSize);

  // One yes: the rest of Randburg, then on through the suburbs to Soweto,
  // where the 100th prospect is found.
  await page.getByRole("button", { name: /Find more/ }).click();
  await expect(page.getByRole("link", { name: "Prospects 100" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Johannesburg + 7 suburbs")).toBeVisible();
  await expect(page.getByRole("button", { name: /Find more/ })).toHaveCount(0);
  const stored = await campaignStorage(page);
  expect(stored?.campaigns).toHaveLength(1);
  const outside = (await searchCalls(page)).filter(
    (call) => !String(call.location).includes("Johannesburg"),
  );
  expect(outside, "nothing outside the city was searched").toEqual([]);
  await waitForAnimations(page);
  await page.screenshot({
    path: path.join(PROOF_DIR, "suburbs-done-1440.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForAnimations(page);
  await page.screenshot({ path: path.join(PROOF_DIR, "suburbs-done-390.png") });
});

test("location autocomplete refuses free text, then supports keyboard selection", async ({
  page,
}) => {
  await openDiscovery(page);
  const dialog = await openCampaignDialog(page);
  const input = dialog.getByRole("combobox", { name: "Location" });
  await input.fill("Kempton Park");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Pick a place from the list before starting this search.",
  );
  expect(await searchCalls(page)).toHaveLength(0);

  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(
    dialog.getByText(/Selected Kempton Park, Gauteng, South Africa/),
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
