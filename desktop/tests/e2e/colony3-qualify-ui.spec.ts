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

// A finished run is titled "Search complete", or "Found N of M" when it
// ended short of the target.
const RUN_FINISHED_TITLE = /^(Search complete|Found \d+ of \d+)$/;

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;
const FIT_SCORE_RUNNER = {
  ...REAL_RUNNER,
  referenceWorkspaceLeadCount: 108,
  referenceWorkspaceOutreachBoard: true,
  referenceWorkspaceOutreachReady: true,
} as const;
const RUN_ID = "d39cf188-319a-4efc-92cc-8c55c5f2d6d2";
const SCREENSHOT_DIR = process.env.QUALIFY_UI_SCREENSHOTS_DIR;
const FIT_SCORE_NO_PHONE_LEAD = "1e1a7000-0000-4000-9000-000000900106";

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

async function installFitScoreFixture(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_WHATSAPP__?: (request: {
        action: "post" | "command";
        path?: string;
        body?: Record<string, unknown>;
        kind?: number;
      }) => Promise<unknown>;
    };
    const template = {
      title: "Fit score outreach",
      name: "fit_score_outreach",
      proposedTitle: null,
      titleCustom: true,
      language: "en",
      category: "MARKETING",
      status: "APPROVED",
      body: "A carefully reviewed website idea.",
      slots: 0,
      buttons: [],
    };
    testWindow.__BUZZ_E2E_WHATSAPP__ = async (request) => {
      if (request.action !== "post" || request.path !== "/api/whatsapp/query") {
        return {};
      }
      switch (request.body?.what) {
        case "status":
          return {
            connected: true,
            connectionId: "e2e-fit-score",
            displayPhoneNumber: "+27 61 534 0627",
            verifiedName: "Horizon Labs",
            quality: "GREEN",
            phoneStatus: "CONNECTED",
            dailyNewChatCap: 30,
            newChatsSentToday: 0,
            sendingPaused: false,
            pauseReason: null,
            issues: [],
            outreachChannelId: null,
            templatesSyncedAt: null,
            templates: [template],
            webhookUrl: null,
          };
        case "templates":
          return { templates: [template] };
        case "contacts":
          return { contacts: [] };
        case "batches":
          return { batches: [] };
        default:
          return {};
      }
    };
  });
  await installMockBridge(page, FIT_SCORE_RUNNER);
}

async function openDiscovery(
  page: Page,
  fixtureOptions?: { ownerReplay?: boolean },
) {
  await installSearchFixture(page, fixtureOptions);
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
}

async function openFitScoreLeads(page: Page) {
  await installFitScoreFixture(page);
  await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  await waitForQualificationSubscription(page);
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
  await expect(campaign.getByText(RUN_FINISHED_TITLE)).toBeVisible({
    timeout: 15_000,
  });
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

async function seedQualificationHeadForLead(
  page: Page,
  leadId: string,
  observations: Array<{
    signal: string;
    confidence: number;
    value: string;
    evidenceUrls?: string[];
  }>,
) {
  const result = await page.evaluate(
    async ({ channelId, communityId, lead, observations: seeded, runId }) => {
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
            checkedSignals: seeded.map((item) => item.signal),
            observations: seeded.map((item) => ({
              ...item,
              state: "observed",
              evidenceUrls: item.evidenceUrls ?? [],
              observedAt: 1_793_535_600,
              runId,
              notCheckedReason: null,
              personalData: false,
            })),
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
      observations,
      runId: RUN_ID,
    },
  );
  expect(result).toMatchObject({ eventId: expect.any(String) });
}

async function seedQualificationHead(page: Page) {
  await seedQualificationHeadForLead(
    page,
    REFERENCE_PROSPECT_IDS["form-field"],
    [
      {
        signal: "NO_WEBSITE",
        confidence: 1,
        value: "No website listed",
      },
      {
        signal: "NO_ONLINE_BOOKING",
        confidence: 0.6,
        value: "No booking page found",
        evidenceUrls: ["https://form-field.example/"],
      },
    ],
  );
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

  test("fit score keeps the batch, not-contacted reasons, and why card in sync", async ({
    page,
  }) => {
    const highFitLead = REFERENCE_PROSPECT_IDS.stillroom;
    const lowFitLead = REFERENCE_PROSPECT_IDS["north-note"];
    const uncheckedLead = REFERENCE_PROSPECT_IDS["woven-living"];
    await openFitScoreLeads(page);
    await page
      .getByRole("button", { name: "Remove phone number filter" })
      .click();
    await page.getByRole("button", { name: "Remove WhatsApp filter" }).click();
    await page
      .getByRole("button", { name: "Remove stage filter: New" })
      .click();
    await expect(page.getByTestId("qualification-filter-count")).toHaveText(
      "108 leads",
    );
    await seedQualificationHeadForLead(page, highFitLead, [
      {
        signal: "NO_WEBSITE",
        confidence: 1,
        value: "No public website",
      },
      {
        signal: "SITE_DOWN",
        confidence: 1,
        value: "Website did not respond",
        evidenceUrls: ["https://jacaranda.example/"],
      },
      {
        signal: "NOT_MOBILE_FRIENDLY",
        confidence: 1,
        value: "Desktop-only layout",
        evidenceUrls: ["https://jacaranda.example/"],
      },
    ]);
    await seedQualificationHeadForLead(page, lowFitLead, [
      {
        signal: "NO_WEBSITE",
        confidence: 1,
        value: "No public website",
      },
    ]);

    const dashboard = page.getByTestId("fit-score-dashboard");
    const minimumEnabled = page.getByRole("checkbox", {
      name: "Only message the best matches",
    });
    const minimumFit = page.getByRole("slider", {
      name: "Minimum fit score",
    });
    await expect(dashboard).toContainText("Jacaranda Lane Guesthouse");
    await expect(minimumEnabled).not.toBeChecked();
    await expect(minimumFit).toBeDisabled();
    await expect(
      page.getByTestId(`fit-not-contacted-${lowFitLead}`),
    ).toHaveCount(0);

    await minimumEnabled.focus();
    await page.keyboard.press("Space");
    await expect(minimumEnabled).toBeChecked();
    await expect(minimumFit).toBeEnabled();
    await expect(minimumFit).toHaveValue("60");
    await expect(
      page.getByRole("tab", { name: /Will message 1/ }),
    ).toBeVisible();

    const notContactedTab = page.getByRole("tab", {
      name: /Not contacted/,
    });
    await page.getByRole("tab", { name: /^All / }).focus();
    await page.keyboard.press("End");
    await expect(notContactedTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByTestId(`fit-not-contacted-${lowFitLead}`),
    ).toContainText("Below your minimum of 60");
    await expect(
      page.getByTestId(`fit-not-contacted-${uncheckedLead}`),
    ).toContainText("Not checked yet");
    await expect(
      page.getByTestId(`fit-not-contacted-${FIT_SCORE_NO_PHONE_LEAD}`),
    ).toContainText("No WhatsApp number");
    await captureQualificationBoard(
      page,
      "04-fit-score-not-contacted.png",
      1180,
    );

    await page
      .getByRole("checkbox", { name: "Select Jacaranda Lane Guesthouse" })
      .check();
    await page
      .getByRole("checkbox", { name: "Select Koppie View Lodge" })
      .check();
    await page
      .getByRole("checkbox", { name: "Select Bramble & Brick Guesthouse" })
      .check();
    const selection = page.getByRole("toolbar", { name: "Selected leads" });
    await expect(selection).toContainText("3 selected");
    await selection.getByRole("button", { name: "WhatsApp batch" }).click();
    const batch = page.getByTestId("outreach-batch-dialog");
    await expect(batch).toBeVisible();
    const template = batch.getByRole("button", { name: /fit_score_outreach/ });
    await template.click();
    const batchMinimumFit = batch.getByRole("slider", {
      name: "Minimum fit score",
    });
    await batchMinimumFit.focus();
    await page.keyboard.press("ArrowRight");
    await expect(template).toHaveAttribute("aria-pressed", "true");
    await expect(batch.getByTestId("batch-skip-summary")).toContainText(
      "1 ready for review",
    );
    const notContacted = batch.getByLabel("Not contacted");
    await expect(notContacted).toContainText("Koppie View Lodge");
    await expect(notContacted).toContainText("Below your minimum of 61");
    await expect(notContacted).toContainText("Bramble & Brick Guesthouse");
    await expect(notContacted).toContainText("Not checked yet");
    await page.keyboard.press("Escape");

    await page.evaluate((leadId) => {
      window.location.hash = `/sales/lead/${leadId}`;
    }, highFitLead);
    await expect(page.getByTestId("w10-prospect-page")).toBeVisible();
    const breakdown = page.getByTestId("outreach-fit-breakdown");
    await breakdown.scrollIntoViewIfNeeded();
    await expect(breakdown).toContainText(
      "Why Jacaranda Lane Guesthouse scores 80",
    );
    await expect(breakdown).toContainText("No website");
    await expect(breakdown).toContainText("Website not loading");
    await expect(breakdown).toContainText("Hard to use on a phone");
    await expect(breakdown).toContainText("+25");
    await captureQualificationBoard(page, "05-fit-score-why.png", 1180);
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
