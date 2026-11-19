import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { KIND_PROSPECT_HEAD } from "../../src/features/discovery/businessRecordContract";
import { referenceSalesRecordEvents } from "../../src/testing/e2eReferenceWorkspace";
import { MOCK_TENANT_COMMUNITY_ID } from "../../src/testing/e2eTenant";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { fixture, seedCofounderTheme } from "./cofounder-map-fixtures";

const PROOF_DIR = process.env.ALL_PROSPECTS_PROOF_DIR;
const CAMPAIGN_ID = "1e1a7000-0000-4000-9000-000000009001";
const PERFORMANCE_QUERY = "olive house 1993";

type Scenario = {
  height: number;
  theme: "dark" | "light";
  width: number;
};

const SCREENSHOT_SCENARIOS: Scenario[] = [
  { theme: "light", width: 1440, height: 900 },
  { theme: "dark", width: 1440, height: 900 },
  { theme: "light", width: 1728, height: 1117 },
  { theme: "dark", width: 1728, height: 1117 },
];

function prospectIds(leadCount: number): string[] {
  return referenceSalesRecordEvents("a".repeat(64), MOCK_TENANT_COMMUNITY_ID, {
    leadCount,
  })
    .filter((event) => event.kind === KIND_PROSPECT_HEAD)
    .map((event) => {
      const content = JSON.parse(event.content) as { prospectId: string };
      return content.prospectId;
    });
}

async function installCampaignFixture(
  page: Page,
  {
    height = 900,
    leadCount,
    theme = "light",
    width = 1440,
  }: Scenario & {
    leadCount: number;
  },
) {
  const ids = prospectIds(leadCount);
  await page.addInitScript(
    ({ count, campaignId, campaignProspectIds }) => {
      const campaign = {
        id: campaignId,
        name: "All prospects, South Africa",
        audience: "businesses",
        industryId: "home-living",
        industryName: "Home & Living",
        verticalId: "home-furnishings-retailers",
        verticalName: "Home furnishings retailers",
        location: "South Africa",
        target: count,
        count,
        budgetUsd: 0,
        criteria: "",
        status: "complete",
        prospectIds: campaignProspectIds,
        created: false,
        runBy: { name: "Aya", pubkey: "a".repeat(64) },
        postedInSales: true,
        simulated: true,
      };
      let current = campaign;
      const listeners = new Set<(next: typeof campaign | null) => void>();
      const publish = () => {
        for (const listener of listeners) listener(current);
      };
      const provider = {
        getCurrent: () => current,
        getCampaigns: () => [campaign],
        select: async (nextCampaignId: string) => {
          if (nextCampaignId === campaign.id) current = campaign;
          publish();
        },
        subscribe: (listener: (next: typeof campaign | null) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        start: async () => campaign,
        getContinuation: () => null,
        continueCampaign: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
        retry: async () => undefined,
      };
      (
        window as Window & {
          __BUZZ_E2E_W10_DISCOVERY_PROVIDER__?: typeof provider;
        }
      ).__BUZZ_E2E_W10_DISCOVERY_PROVIDER__ = provider;
    },
    { campaignId: CAMPAIGN_ID, campaignProspectIds: ids, count: leadCount },
  );
  await seedCofounderTheme(page, theme);
  await page.emulateMedia({ colorScheme: theme });
  await installMockBridge(
    page,
    {
      ...fixture(),
      referenceWorkspace: true,
      referenceWorkspaceDiscoveryStandIn: false,
      referenceWorkspaceLeadCount: leadCount,
      referenceWorkspaceOutreachReady: true,
    },
    { previewFeatureOverrides: { map_home: true } },
  );
  await page.setViewportSize({ width, height });
  await page.goto("/#/campaign");
  await expect(page.getByTestId("map-shell-bar")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
  await expect(page.locator(".c3l-match-count")).toHaveText(
    `${leadCount} of ${leadCount} match`,
  );
}

async function selectAllCampaignProspects(page: Page, count: number) {
  await page
    .getByRole("checkbox", { name: "Select all 7 prospects on this page" })
    .check();
  await page
    .getByRole("button", {
      name: `Select all ${count} matching prospects`,
    })
    .click();
  await expect(
    page.getByText(`All ${count} matching prospects are selected.`, {
      exact: true,
    }),
  ).toBeVisible();
}

async function openOverLimitListDialog(page: Page, count: number) {
  await page.getByRole("button", { name: "Add to outreach list" }).click();
  const dialog = page.getByTestId("outreach-list-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText(
    `You selected ${count}. A list holds 500 at most.`,
  );
  await expect(
    dialog.getByRole("button", { name: "Create list" }),
  ).toBeDisabled();
  return dialog;
}

async function capture(page: Page, name: string) {
  if (!PROOF_DIR) return;
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(PROOF_DIR, name),
  });
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("loads all 620 campaign prospects and preserves the list limit before a write", async ({
  page,
}) => {
  await installCampaignFixture(page, { leadCount: 620 });
  await selectAllCampaignProspects(page, 620);
  const dialog = await openOverLimitListDialog(page, 620);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/#/leads");
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  await page
    .getByRole("button", { name: "Remove phone number filter" })
    .click();
  await page.getByRole("button", { name: "Remove WhatsApp filter" }).click();
  await page.getByRole("button", { name: "Remove stage filter: New" }).click();
  await expect(page.locator(".c3l-match-count")).toHaveText("620 of 620 match");
});

test("keeps campaign search and row selection responsive with 2,000 prospects", async ({
  page,
}) => {
  const startedAt = Date.now();
  await installCampaignFixture(page, { leadCount: 2_000 });
  const loadMs = Date.now() - startedAt;

  const searchStartedAt = await page.evaluate(() => performance.now());
  await page.getByLabel("Search prospects").fill(PERFORMANCE_QUERY);
  await expect(page.locator(".c3l-match-count")).toHaveText("1 of 2000 match");
  const searchMs = await page.evaluate(
    (started) => performance.now() - started,
    searchStartedAt,
  );

  await page.getByLabel("Search prospects").fill("");
  await expect(page.locator(".c3l-match-count")).toHaveText(
    "2000 of 2000 match",
  );
  const checkbox = page
    .locator(".c3d-table tbody input[type='checkbox']")
    .first();
  const selectionStartedAt = await page.evaluate(() => performance.now());
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  const selectionMs = await page.evaluate(
    (started) => performance.now() - started,
    selectionStartedAt,
  );

  console.log(
    `all-prospects mock timings: load=${loadMs}ms search=${Math.round(searchMs)}ms select=${Math.round(selectionMs)}ms`,
  );
  expect(searchMs).toBeLessThan(1_500);
  expect(selectionMs).toBeLessThan(1_500);
});

for (const scenario of SCREENSHOT_SCENARIOS) {
  test(`captures 620 prospects and the over-limit selection in ${scenario.theme} at ${scenario.width}x${scenario.height}`, async ({
    page,
  }) => {
    await installCampaignFixture(page, { ...scenario, leadCount: 620 });
    const suffix = `${scenario.theme}-${scenario.width}x${scenario.height}`;
    await capture(page, `campaign-620-${suffix}.png`);
    await selectAllCampaignProspects(page, 620);
    await openOverLimitListDialog(page, 620);
    await capture(page, `selection-over-500-${suffix}.png`);
  });
}
