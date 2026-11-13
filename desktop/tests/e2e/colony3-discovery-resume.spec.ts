import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

const PROOF_DIR =
  process.env.COLONY3_DISCOVERY_RESUME_PROOF_DIR ??
  "test-results/colony3-discovery-resume";
const DISCOVERY_STORAGE_KEY =
  "colony:discovery-campaigns:v1:e2e-default-community";
const OWNER = "deadbeef".repeat(8);
const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;
const JOHANNESBURG = {
  label: "Johannesburg, Gauteng, South Africa",
  latitude: -26.2041,
  longitude: 28.0473,
  countryCode: "ZA",
  region: "Gauteng",
  kind: "city",
  boundingBox: [27.85, -26.35, 28.25, -26.0],
};
const EXISTING_LEAD_NAMES = [
  "The Olive House",
  "Form & Field",
  "The Sunday Edit",
  "Stillroom",
  "Gather House",
  "Common Ground Store",
];

type Scenario = "partial-overlap" | "legacy-repeat";
type DiscoveryWindow = Window & {
  __discoveryCalls?: Array<Record<string, unknown>>;
  __releaseDiscoveryPage?: () => void;
  __BUZZ_E2E_DISCOVERY_LOCATIONS__?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  __BUZZ_E2E_DISCOVERY_SEARCH__?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
};

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

async function installDiscoveryFixture(page: Page, scenario: Scenario) {
  await page.addInitScript(
    ({ existingLeadNames, location, owner, scenarioName, storageKey }) => {
      const w = window as DiscoveryWindow;
      const place = (id: string, name: string) => ({
        placeId: id,
        name,
        category: "Real estate agency",
        address: `1 Main Road, ${name}`,
        city: "Johannesburg",
        state: "Gauteng",
        country: "South Africa",
        phone: "+27 11 555 0100",
        website: `https://${id}.example`,
        rating: 4.5,
        reviews: 20,
      });
      const response = (
        places: Array<Record<string, unknown>>,
        nextSkip: number | null,
      ) => ({
        provider: "outscraper",
        places,
        estimatedCostUsd: 0.06,
        nextSkip,
      });

      w.__discoveryCalls = [];
      w.__BUZZ_E2E_DISCOVERY_LOCATIONS__ = async () => ({
        locations: [location],
      });
      let releasePage: () => void = () => {};
      const gatedPage = new Promise<void>((resolve) => {
        releasePage = resolve;
      });
      w.__releaseDiscoveryPage = () => releasePage();

      if (scenarioName === "legacy-repeat") {
        // This is the exact persisted shape produced by the buggy 3.0.35
        // path: two paid pages, 11 new prospects, a consumed cursor, and a
        // false provider_repeat terminal with no per-page log yet.
        w.localStorage.setItem(
          storageKey,
          JSON.stringify({
            version: 2,
            ownerPubkey: owner,
            currentId: "real-estate-stuck",
            campaigns: [
              {
                id: "real-estate-stuck",
                name: "Real Estate Agents and Brokers prospects",
                audience: "businesses",
                industryId: "real-estate",
                industryName: "Real Estate",
                verticalId: "real-estate-agents-and-brokers",
                verticalName: "Real Estate Agents and Brokers",
                pickedTags: [],
                location: location.label,
                locationSelection: location,
                target: 100,
                count: 11,
                budgetUsd: 0.3,
                criteria: "",
                status: "complete",
                prospectIds: Array.from(
                  { length: 11 },
                  (_, index) => `legacy-prospect-${String(index + 1)}`,
                ),
                created: true,
                runBy: { name: "Lerato", pubkey: owner },
                failureReason: null,
                endNote:
                  "The search provider repeated places already returned in this campaign.",
                postedInSales: false,
                createdAt: 1_730_000_000,
                skippedDuplicates: 29,
                seenProviderPlaceIds: Array.from(
                  { length: 40 },
                  (_, index) => `p${String(index + 1)}`,
                ),
                spentUsd: 0.12,
                endReason: "provider_repeat",
                coverage: [
                  {
                    queryKey:
                      "real-estate-agents-and-brokers::tag:::legacy:johannesburg",
                    nextSkip: 40,
                    terminalReason: "provider_repeat",
                  },
                ],
                skip: 40,
                tagCursors: [],
                pendingTagCursors: null,
                pagesFetched: 2,
                exhausted: true,
                pendingPost: false,
                postState: "none",
                stopNotePosted: false,
                topFits: [],
                pendingPage: null,
              },
            ],
          }),
        );
      }

      w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
        w.__discoveryCalls?.push(request);
        const skip = Number(request.skip ?? 0);
        if (scenarioName === "legacy-repeat") {
          if (skip !== 40) {
            throw new Error(
              `Expected legacy continuation at skip 40, got ${String(skip)}.`,
            );
          }
          await gatedPage;
          return response(
            Array.from({ length: 20 }, (_, index) =>
              place(`p${String(index + 41)}`, `Broker ${String(index + 41)}`),
            ),
            null,
          );
        }

        if (skip === 0) {
          return response(
            [
              ...Array.from({ length: 9 }, (_, index) =>
                place(
                  `p${String(index + 1)}`,
                  existingLeadNames[index % existingLeadNames.length] ??
                    "Known lead",
                ),
              ),
              ...Array.from({ length: 11 }, (_, index) =>
                place(`p${String(index + 10)}`, `Broker ${String(index + 10)}`),
              ),
            ],
            20,
          );
        }
        if (skip === 20) {
          return response(
            [
              place("p19", "Broker 19"),
              place("p20", "Broker 20"),
              ...Array.from({ length: 8 }, (_, index) =>
                place(`p${String(index + 21)}`, `Broker ${String(index + 21)}`),
              ),
              ...Array.from({ length: 10 }, (_, index) =>
                place(
                  `p${String(index + 29)}`,
                  existingLeadNames[index % existingLeadNames.length] ??
                    "Known lead",
                ),
              ),
            ],
            40,
          );
        }
        if (skip === 40) {
          await gatedPage;
          return response(
            Array.from({ length: 20 }, (_, index) =>
              place(`p${String(index + 39)}`, `Broker ${String(index + 39)}`),
            ),
            null,
          );
        }
        // Once page two shows the provider moving forward, the remaining
        // approved pages are asked for together. Past the provider's end they
        // come back empty, as the real provider does.
        if (skip === 60 || skip === 80) return response([], null);
        throw new Error(`Unexpected discovery skip ${String(skip)}.`);
      };
    },
    {
      existingLeadNames: EXISTING_LEAD_NAMES,
      location: JOHANNESBURG,
      owner: OWNER,
      scenarioName: scenario,
      storageKey: DISCOVERY_STORAGE_KEY,
    },
  );
  await installMockBridge(page, REAL_RUNNER);
}

async function searchSkips(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      (window as DiscoveryWindow).__discoveryCalls?.map((call) =>
        Number(call.skip ?? 0),
      ) ?? [],
  );
}

async function campaignState(page: Page) {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw
      ? (JSON.parse(raw) as {
          currentId: string | null;
          campaigns: Array<{
            id: string;
            status: string;
            endReason: string | null;
            pagesFetched: number;
          }>;
        })
      : null;
  }, DISCOVERY_STORAGE_KEY);
}

async function releaseProviderPage(page: Page) {
  await page.evaluate(() =>
    (window as DiscoveryWindow).__releaseDiscoveryPage?.(),
  );
}

async function capture(page: Page, subject: Locator, filename: string) {
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await subject.screenshot({ path: path.join(PROOF_DIR, filename) });
}

async function startPartialOverlapCampaign(page: Page) {
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  const discovery = page.getByTestId("w10-discovery-page");
  await expect(discovery).toBeVisible();
  await discovery
    .getByRole("textbox", { name: /Search industries/ })
    .fill("home decor");
  await discovery
    .getByRole("button", { name: "Find prospects" })
    .first()
    .click();
  const typeDetails = page.getByTestId("discovery-type-details-dialog");
  await expect(typeDetails).toBeVisible();
  await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await expect(dialog).toBeVisible();
  const location = dialog.getByRole("combobox", { name: "Location" });
  await location.fill("Joh");
  await dialog.getByRole("option", { name: JOHANNESBURG.label }).click();
  await dialog.getByLabel("Prospect target").fill("100");
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installDiscoveryImageMocks(page);
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    const suffix = `${String(width)}-${mode}`;

    test(`real-shaped overlap keeps paging and records evidence at ${suffix}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await seedTheme(page, dark);
      await installDiscoveryFixture(page, "partial-overlap");
      await startPartialOverlapCampaign(page);

      await expect.poll(() => searchSkips(page)).toEqual([0, 20, 40, 60, 80]);
      const campaign = page.getByTestId("w10-campaign-page");
      await expect(
        campaign.getByText("Finding prospects", { exact: true }),
      ).toBeVisible();
      await capture(
        page,
        campaign.locator(".c3d-run"),
        `running-past-page-2-${suffix}.png`,
      );

      await releaseProviderPage(page);
      // The area ran out short of the target: the card says what was found
      // and, in one short line, that there is no more here.
      await expect(campaign.getByText(/^Found \d+ of \d+$/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(campaign.getByText(/ has no more\. /)).toBeVisible();
      await capture(
        page,
        campaign.locator(".c3d-run"),
        `honest-provider-end-${suffix}.png`,
      );

      await campaign.getByRole("button", { name: "Run details" }).click();
      const details = page.getByTestId("campaign-activity-dialog");
      await expect(details.getByText("Provider page log")).toBeVisible();
      await expect(details.getByText("Page 2")).toBeVisible();
      await expect(
        details.getByText("Repeated in campaign").first(),
      ).toBeVisible();
      await expect(
        details.getByText("Stopped here: Maps returned no more results."),
      ).toBeVisible();
      await capture(page, details, `run-details-${suffix}.png`);
    });

    test(`Find more rescues a legacy stuck campaign in place at ${suffix}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await seedTheme(page, dark);
      await installDiscoveryFixture(page, "legacy-repeat");
      await page.goto("/#/campaign", { waitUntil: "domcontentloaded" });

      const campaign = page.getByTestId("w10-campaign-page");
      await expect(campaign).toBeVisible();
      await expect(
        campaign.getByRole("heading", {
          name: "Real Estate Agents and Brokers prospects",
        }),
      ).toBeVisible();
      const before = await campaignState(page);
      expect(before?.campaigns).toHaveLength(1);
      expect(before?.currentId).toBe("real-estate-stuck");

      await campaign.getByRole("button", { name: "Find more" }).click();
      await expect.poll(() => searchSkips(page)).toEqual([40]);
      await expect(
        campaign.getByText("Finding prospects", { exact: true }),
      ).toBeVisible();
      const whileRunning = await campaignState(page);
      expect(whileRunning?.campaigns).toHaveLength(1);
      expect(whileRunning?.currentId).toBe("real-estate-stuck");
      expect(whileRunning?.campaigns[0]).toMatchObject({
        id: "real-estate-stuck",
        status: "running",
      });
      await capture(
        page,
        campaign.locator(".c3d-run"),
        `stuck-find-more-in-place-${suffix}.png`,
      );

      await releaseProviderPage(page);
      await expect(campaign.getByText(/^Found \d+ of \d+$/)).toBeVisible({
        timeout: 15_000,
      });
      const after = await campaignState(page);
      expect(after?.campaigns).toHaveLength(1);
      expect(after?.currentId).toBe("real-estate-stuck");
      expect(after?.campaigns[0]).toMatchObject({
        id: "real-estate-stuck",
        endReason: "provider_end",
        pagesFetched: 3,
      });
    });
  }
}
