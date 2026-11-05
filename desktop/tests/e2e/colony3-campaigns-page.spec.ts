import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const PROOF_DIR =
  process.env.CAMPAIGNS_PAGE_PROOF_DIR ?? "test-results/campaigns-page-proof";
const PAGE_SIZE = 15;

type FixtureOptions = {
  campaignCount?: number;
  theme?: "dark" | "light";
};

async function installCampaignFixture(
  page: Page,
  { campaignCount = 5_000, theme = "light" }: FixtureOptions = {},
) {
  const relayUrl = "ws://localhost:3000";
  await page.addInitScript(
    ({ activeTheme, activeRelayUrl }) => {
      window.localStorage.setItem(
        "buzz-theme",
        activeTheme === "dark" ? "buzz-dark" : "buzz",
      );
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem("buzz-accent-color", "#5B45BE");
      window.localStorage.setItem(
        `buzz-community-theme.v1:${"deadbeef".repeat(8)}:${encodeURIComponent(activeRelayUrl)}`,
        JSON.stringify({
          version: 1,
          theme: activeTheme === "dark" ? "buzz-dark" : "buzz",
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    { activeTheme: theme, activeRelayUrl: relayUrl },
  );
  await page.addInitScript((count) => {
    const statuses = ["running", "complete", "paused", "cancelled", "failed"];
    const industries = [
      "Home & Living",
      "Beauty & Wellness",
      "Hospitality",
      "Professional services",
    ];
    const types = [
      "Retailers",
      "Independent hotels",
      "Studios",
      "Consultancies",
    ];
    const locations = [
      "Cape Town, South Africa",
      "Johannesburg, South Africa",
      "Durban, South Africa",
      "Pretoria, South Africa",
    ];
    const campaigns = Array.from({ length: count }, (_, index) => {
      const needle = index === 3_123;
      return {
        id: `campaign-${String(index).padStart(4, "0")}`,
        name: needle
          ? "Needle retail campaign"
          : `Campaign ${String(index).padStart(4, "0")}`,
        audience: "businesses",
        industryId: `industry-${index % industries.length}`,
        industryName: industries[index % industries.length],
        verticalId: `type-${index % types.length}`,
        verticalName: types[index % types.length],
        location: locations[index % locations.length],
        target: 100,
        count: index % 101,
        budgetUsd: 12.5,
        spentUsd: (index % 25) / 2,
        criteria: "",
        status: statuses[index % statuses.length],
        prospectIds: [],
        created: true,
        createdAt: 1_730_000_000 - index * 86_400,
        runBy: {
          name: index % 2 === 0 ? "Aya" : "Scout",
          pubkey: index % 2 === 0 ? "a".repeat(64) : "b".repeat(64),
        },
      };
    });
    let current = campaigns[0] ?? null;
    const listeners = new Set<(campaign: unknown) => void>();
    const publish = () => {
      for (const listener of listeners) listener(current);
    };
    const testWindow = window as Window & {
      __BUZZ_E2E_W10_DISCOVERY_PROVIDER__?: unknown;
    };
    testWindow.__BUZZ_E2E_W10_DISCOVERY_PROVIDER__ = {
      getCampaigns: () => campaigns,
      getCurrent: () => current,
      select: async (campaignId: string) => {
        current =
          campaigns.find((campaign) => campaign.id === campaignId) ?? current;
        publish();
      },
      subscribe: (listener: (campaign: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      start: async () => current,
      pause: async () => undefined,
      resume: async () => undefined,
      cancel: async () => undefined,
      retry: async () => undefined,
    };
  }, campaignCount);
  await installMockBridge(page, {
    colony3Sidebar: true,
    referenceWorkspace: true,
    referenceWorkspaceDiscoveryStandIn: false,
    windowFullscreen: true,
  });
}

async function openCampaigns(page: Page) {
  await page.goto("/#/discovery/campaigns");
  await expect(page.getByTestId("discovery-campaigns-page")).toBeVisible();
  await waitForAnimations(page);
}

async function capture(page: Page, name: string) {
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(PROOF_DIR, name),
  });
}

test.describe("All campaigns page", () => {
  test("paginates 5,000 campaigns and filters within the UI budget", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await installCampaignFixture(page);
    await openCampaigns(page);

    const rows = page.getByTestId("discovery-campaign-row");
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(
      page.getByText("5,000 campaigns", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("sidebar-business-leads")).toBeVisible();
    await expect(page.getByTestId("sidebar-business-leads")).toHaveAttribute(
      "href",
      "#/leads",
    );

    const startedAt = await page.evaluate(() => performance.now());
    await page.getByLabel("Search campaigns").fill("needle retail");
    await expect(rows).toHaveCount(1);
    const elapsed = await page.evaluate(
      (start) => performance.now() - start,
      startedAt,
    );
    expect(elapsed).toBeLessThan(3_000);
    await expect(page).toHaveURL(/q=needle(?:%20|\+)retail/u);

    await page
      .locator(".c3c-desktop-filters")
      .getByLabel("Campaign status")
      .selectOption("stopped");
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/status=stopped/u);

    await page.goBack();
    await expect(page).toHaveURL(/q=needle(?:%20|\+)retail/u);
    await expect(
      page.locator(".c3c-desktop-filters").getByLabel("Campaign status"),
    ).toHaveValue("");
    await page.goForward();
    await expect(
      page.locator(".c3c-desktop-filters").getByLabel("Campaign status"),
    ).toHaveValue("stopped");
  });

  test("captures result and applied-filter states at desktop widths", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await installCampaignFixture(page, { campaignCount: 120, theme: "light" });
    await openCampaigns(page);
    await expect(page.getByTestId("discovery-campaign-row")).toHaveCount(
      PAGE_SIZE,
    );
    await capture(page, "1440-light-results-sidebar-leads.png");

    await page
      .locator(".c3c-desktop-filters")
      .getByLabel("Campaign status")
      .selectOption("running");
    await expect(page.getByTestId("discovery-campaign-row")).toHaveCount(
      PAGE_SIZE,
    );
    await capture(page, "1440-light-filters-applied.png");
  });

  test("captures applied filters at desktop width in dark mode", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await installCampaignFixture(page, { campaignCount: 120, theme: "dark" });
    await openCampaigns(page);
    await page
      .locator(".c3c-desktop-filters")
      .getByLabel("Campaign industry")
      .selectOption("Hospitality");
    await expect(page.getByTestId("discovery-campaign-row")).toHaveCount(
      PAGE_SIZE,
    );
    await capture(page, "1440-dark-filters-applied.png");
  });

  test("captures the no-match state at mobile width in dark mode", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installCampaignFixture(page, { campaignCount: 120, theme: "dark" });
    await openCampaigns(page);
    await page.locator(".c3c-mobile-filters > summary").click();
    await page
      .locator(".c3c-mobile-filters")
      .getByLabel("Campaign status")
      .selectOption("failed");
    await page.getByLabel("Search campaigns").fill("not-a-real-campaign");
    const noMatch = page.getByRole("heading", {
      name: "No campaigns match these filters.",
    });
    await expect(noMatch).toBeVisible();
    await page.locator(".c3c-mobile-filters > summary").click();
    await noMatch.scrollIntoViewIfNeeded();
    await capture(page, "390-dark-no-match.png");
  });

  test("captures the empty state at mobile width in light mode", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installCampaignFixture(page, { campaignCount: 0, theme: "light" });
    await openCampaigns(page);
    await expect(
      page.getByRole("heading", { name: "No campaigns yet" }),
    ).toBeVisible();
    await capture(page, "390-light-empty.png");
  });
});
