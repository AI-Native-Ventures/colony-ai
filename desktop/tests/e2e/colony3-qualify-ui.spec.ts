import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  REFERENCE_CHANNEL_IDS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { MOCK_TENANT_COMMUNITY_ID } from "../../src/testing/e2eTenant";
import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import { waitForAnimations } from "../helpers/animations";

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;
const RUN_ID = "d39cf188-319a-4efc-92cc-8c55c5f2d6d2";
const SCREENSHOT_DIR = process.env.QUALIFY_UI_SCREENSHOTS_DIR;

type DiscoveryWindow = Window & {
  __BUZZ_E2E_DISCOVERY_LOCATIONS__?: () => Promise<unknown>;
  __BUZZ_E2E_DISCOVERY_SEARCH__?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
    command: string;
    payload: Record<string, unknown> | null;
  }>;
  __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
    command: string,
    payload: unknown,
  ) => Promise<unknown>;
};

async function captureQualificationBoard(
  page: Page,
  filename: string,
  viewportHeight = 960,
) {
  if (!SCREENSHOT_DIR) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const previousViewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: viewportHeight });
  try {
    await waitForAnimations(page);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, filename) });
  } finally {
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}

async function installSearchFixture(
  page: Page,
  { ownerReplay = false }: { ownerReplay?: boolean } = {},
) {
  await page.addInitScript((replayOwnerFlow) => {
    const testWindow = window as DiscoveryWindow;
    testWindow.__BUZZ_E2E_DISCOVERY_LOCATIONS__ = async () => ({
      locations: [
        {
          label: "Johannesburg, Gauteng, South Africa",
          latitude: -26.2041,
          longitude: 28.0473,
          countryCode: "ZA",
          region: "Gauteng",
          kind: "city",
          boundingBox: [27.85, -26.35, 28.25, -26],
        },
      ],
    });
    testWindow.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
      const skip = Number(request.skip ?? 0);
      const places = (first: number) =>
        Array.from({ length: 11 }, (_, index) => ({
          placeId: `qualify-${String(first + index)}`,
          name: `Website fixture ${String(first + index)}`,
          category: "Home goods store",
          address: `${String(first + index)} Main Road`,
          city: "Johannesburg",
          state: "Gauteng",
          country: "South Africa",
          phone: `+27 11 555 ${String(1000 + first + index)}`,
          website: `https://website-fixture-${String(first + index)}.example`,
          rating: 4.2,
          reviews: 12 + first + index,
        }));
      if (replayOwnerFlow) {
        if (skip === 0) {
          return {
            provider: "fixture",
            places: places(1),
            estimatedCostUsd: 0.06,
            nextSkip: 20,
          };
        }
        if (skip === 20) {
          return {
            provider: "fixture",
            places: places(1),
            estimatedCostUsd: 0.06,
            nextSkip: 40,
          };
        }
        if (skip === 40) {
          return {
            provider: "fixture",
            places: places(12),
            estimatedCostUsd: 0.06,
            nextSkip: null,
          };
        }
      }
      if (skip > 0) {
        return {
          provider: "fixture",
          places: [],
          estimatedCostUsd: 0,
          nextSkip: null,
        };
      }
      return {
        provider: "fixture",
        places: places(1),
        estimatedCostUsd: 0.012,
        nextSkip: null,
      };
    };
  }, ownerReplay);
  await installMockBridge(page, REAL_RUNNER);
}

async function openDiscovery(
  page: Page,
  fixtureOptions?: { ownerReplay?: boolean },
) {
  await installSearchFixture(page, fixtureOptions);
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
}

async function openCampaignForm(page: Page) {
  await page.getByLabel("Search industries").fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const typeDialog = page.getByTestId("discovery-type-details-dialog");
  await expect(typeDialog).toBeVisible();
  await typeDialog.getByRole("button", { name: "Find prospects" }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await expect(dialog).toBeVisible();
  const location = dialog.getByRole("combobox", { name: "Location" });
  await location.fill("Joh");
  await dialog
    .getByRole("option", { name: "Johannesburg, Gauteng, South Africa" })
    .click();
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  return dialog;
}

async function startCampaign(page: Page) {
  await page.getByRole("button", { name: /Approve & start/ }).click();
  const campaign = page.getByTestId("w10-campaign-page");
  await expect(campaign).toBeVisible();
  await expect(
    campaign.getByText("Search complete", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return campaign;
}

async function qualificationCommands(page: Page) {
  return page.evaluate(() => {
    const testWindow = window as DiscoveryWindow;
    return (testWindow.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter((entry) =>
      entry.command.startsWith("qualify_"),
    );
  });
}

async function waitForQualificationSubscription(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (channelName) =>
          (
            window as Window & {
              __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                channelName: string;
                kind?: number;
              }) => boolean;
            }
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName,
            kind: 30681,
          }) ?? false,
        "Sales",
      ),
    )
    .toBe(true);
}

async function seedQualificationHead(page: Page) {
  const leadId = REFERENCE_PROSPECT_IDS["form-field"];
  const result = await page.evaluate(
    async ({ channelId, communityId, lead, runId }) => {
      const testWindow = window as DiscoveryWindow;
      if (!testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__) {
        throw new Error("The qualification fixture relay is unavailable.");
      }
      return testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__(
        "e2e_seed_qualification_head",
        {
          channelId,
          dTag: `business:${communityId}:qualify_observation:${lead}`,
          record: {
            schemaVersion: 1,
            leadId: lead,
            runId,
            checkedSignals: ["NO_WEBSITE", "NO_ONLINE_BOOKING"],
            observations: [
              {
                signal: "NO_WEBSITE",
                state: "observed",
                value: "No website listed",
                confidence: 1,
                evidenceUrls: [],
                observedAt: 1_793_535_600,
                runId,
                notCheckedReason: null,
                personalData: false,
              },
              {
                signal: "NO_ONLINE_BOOKING",
                state: "observed",
                value: "No booking page found",
                confidence: 0.6,
                evidenceUrls: ["https://form-field.example/"],
                observedAt: 1_793_535_600,
                runId,
                notCheckedReason: null,
                personalData: false,
              },
            ],
            checkedAt: 1_793_535_600,
            sourceActionEventId: "a".repeat(64),
          },
        },
      );
    },
    {
      channelId: REFERENCE_CHANNEL_IDS.sales,
      communityId: MOCK_TENANT_COMMUNITY_ID,
      lead: leadId,
      runId: RUN_ID,
    },
  );
  expect(result).toMatchObject({ eventId: expect.any(String) });
}

test.beforeEach(async ({ page }) => {
  await installDiscoveryImageMocks(page);
  await page.setViewportSize({ width: 1440, height: 960 });
});

test.describe("Qualify website checks", () => {
  test("campaign checks stay opt-in, keep only selected signals, and resume after cancel", async ({
    page,
  }) => {
    await openDiscovery(page);
    const dialog = await openCampaignForm(page);
    const enabled = dialog.getByTestId("campaign-qualification-enabled");
    const noWebsite = dialog.getByTestId("campaign-qualification-NO_WEBSITE");

    await expect(enabled).not.toBeChecked();
    await expect(noWebsite).toBeDisabled();
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await captureQualificationBoard(
      page,
      "01-discovery-qualification.png",
      1836,
    );
    await enabled.focus();
    await page.keyboard.press("Space");
    await expect(enabled).toBeChecked();
    await noWebsite.focus();
    await page.keyboard.press("Space");
    await expect(noWebsite).toBeChecked();

    const campaign = await startCampaign(page);
    const runPanel = campaign.getByTestId("campaign-qualification-run");
    await expect(runPanel).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => qualificationCommands(page)).toHaveLength(1);
    const [start] = await qualificationCommands(page);
    expect(start).toMatchObject({
      command: "qualify_start",
      payload: { selectedSignals: ["NO_WEBSITE"] },
    });
    expect((start?.payload?.leads as unknown[]) ?? []).toHaveLength(11);

    await runPanel.getByRole("button", { name: "Cancel checks" }).click();
    await expect(
      runPanel.getByRole("button", { name: "Resume checks" }),
    ).toBeVisible();
    await runPanel.getByRole("button", { name: "Resume checks" }).click();
    await expect(
      runPanel.getByRole("button", { name: "Cancel checks" }),
    ).toBeVisible();
    expect(
      (await qualificationCommands(page)).map((entry) => entry.command),
    ).toEqual(
      expect.arrayContaining([
        "qualify_start",
        "qualify_cancel",
        "qualify_resume",
      ]),
    );
  });

  test("an unchecked campaign sends nothing", async ({ page }) => {
    await openDiscovery(page);
    const dialog = await openCampaignForm(page);
    await expect(
      dialog.getByTestId("campaign-qualification-enabled"),
    ).not.toBeChecked();
    await startCampaign(page);
    expect(await qualificationCommands(page)).toHaveLength(0);
  });

  test("a short owner-shaped search keeps Find more available", async ({
    page,
  }) => {
    await openDiscovery(page, { ownerReplay: true });
    await openCampaignForm(page);
    const campaign = await startCampaign(page);
    const found = campaign.getByLabel("Prospects found");
    await expect(found).toHaveAttribute("aria-valuenow", "11");
    await campaign.getByRole("button", { name: "Find more" }).click();
    await expect(found).toHaveAttribute("aria-valuenow", "22");
    await expect(
      campaign.getByRole("button", { name: "Find more" }),
    ).toHaveCount(0);
  });

  test("leads preserve a filtered static list", async ({ page }) => {
    await installSearchFixture(page);
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await waitForQualificationSubscription(page);
    await seedQualificationHead(page);
    await expect(
      page.getByText("No website", { exact: true }).first(),
    ).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "/sales/lead/form-field";
    });
    await expect(page.getByTestId("w10-prospect-page")).toBeVisible();
    const findings = page.getByTestId("lead-qualification-findings");
    await findings.scrollIntoViewIfNeeded();
    await expect(findings).toContainText("What we found");
    await expect(findings.getByText("Sure", { exact: true })).toBeVisible();
    await expect(findings.getByText("Likely", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Scout's draft evidence" }),
    ).toContainText(
      "I couldn't find an online booking option in the pages checked.",
    );
    await captureQualificationBoard(page, "03-lead-qualification.png", 1060);

    await page.evaluate(() => {
      window.location.hash = "/leads";
    });
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();

    const liveCount = page.getByTestId("qualification-filter-count");
    const unfilteredCount = await liveCount.textContent();
    const notChecked = page
      .locator(".c3q-signal-picker")
      .filter({ hasText: "Not checked" });
    await notChecked.locator("summary").click();
    await notChecked.locator('input[type="checkbox"]').first().check();
    await expect(liveCount).not.toHaveText(unfilteredCount ?? "");
    const filteredCount = Number(
      (await liveCount.textContent())?.match(/\d+/u)?.[0] ?? "0",
    );
    expect(filteredCount).toBeGreaterThan(0);
    await expect(page.getByText("Form & Field", { exact: true })).toHaveCount(
      0,
    );
    await captureQualificationBoard(
      page,
      "02-leads-qualification-filter.png",
      1180,
    );

    await page
      .getByRole("button", {
        name: "Save this exact filter as a static list",
      })
      .click();
    const listDialog = page.getByTestId("outreach-list-dialog");
    await expect(listDialog).toContainText(
      `Add ${String(filteredCount)} ${filteredCount === 1 ? "lead" : "leads"} to an outreach list`,
    );
    await listDialog.getByLabel("New list name").fill("Website check snapshot");
    await listDialog.getByRole("button", { name: "Create list" }).click();
    await expect(listDialog).toBeHidden();

    const selectAll = page.getByLabel(/Select all .* leads on this page/);
    const selectedPageCount = Number(
      (await selectAll.getAttribute("aria-label"))?.match(/\d+/u)?.[0] ?? "0",
    );
    expect(selectedPageCount).toBeGreaterThan(0);
    await selectAll.check();
    await page
      .getByRole("button", { name: "Check their websites (free)" })
      .click();
    const runDialog = page.getByTestId("qualification-run-dialog");
    await expect(runDialog).toBeVisible();
    await runDialog.getByRole("checkbox", { name: /No website/ }).check();
    await runDialog
      .getByLabel("Refresh checks completed in the last 30 days")
      .check();
    await runDialog.getByRole("button", { name: "Start checks" }).click();
    const progress = page.getByTestId("manual-qualification-progress");
    await expect(progress).toBeVisible();
    await expect.poll(() => qualificationCommands(page)).toHaveLength(1);
    const [start] = await qualificationCommands(page);
    expect(start).toMatchObject({
      command: "qualify_start",
      payload: { refresh: true, selectedSignals: ["NO_WEBSITE"] },
    });
    expect((start?.payload?.leads as unknown[]) ?? []).toHaveLength(
      selectedPageCount,
    );

    await progress.getByRole("button", { name: "Cancel checks" }).click();
    await expect(
      progress.getByRole("button", { name: "Resume checks" }),
    ).toBeVisible();
    await progress.getByRole("button", { name: "Resume checks" }).click();
    await expect(
      progress.getByRole("button", { name: "Cancel checks" }),
    ).toBeVisible();
  });
});
