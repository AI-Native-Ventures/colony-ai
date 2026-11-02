import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

const REFERENCE_WORKSPACE = { referenceWorkspace: true };

async function openHomeDecorCampaignForm(page: Page) {
  await page
    .getByRole("textbox", {
      name: "Search industries and business types",
    })
    .fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const typeDetails = page.getByTestId("discovery-type-details-dialog");
  await expect(typeDetails).toBeVisible();
  await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await expect(
    dialog.getByRole("heading", { name: "Find the right fit." }),
  ).toBeVisible();
  return dialog;
}

async function startCampaign(page: Page, location: string, target = "50") {
  const dialog = await openHomeDecorCampaignForm(page);
  await dialog.getByLabel("Location").fill(location);
  await dialog.getByLabel("Prospect target").fill(target);
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  await dialog.getByRole("button", { name: "Approve & start" }).click();
  await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
}

test.describe("W10 discovery and sales", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await installDiscoveryImageMocks(page);
  });

  test("discovery search setup validates budget and supports pause, resume, cancel, and empty results", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });

    const discovery = page.getByTestId("w10-discovery-page");
    await expect(
      discovery.getByRole("heading", { name: "Find your next customer." }),
    ).toBeVisible();
    await expect(
      discovery.getByText("51 industries · 869 business types"),
    ).toBeVisible();
    await discovery.getByRole("button", { name: "People" }).click();
    await expect(
      discovery.getByRole("heading", { name: "Browse professional fields" }),
    ).toBeVisible();
    await expect(discovery.getByText("fields · 96 roles")).toBeVisible();
    await discovery.getByRole("button", { name: "Businesses" }).click();

    const dialog = await openHomeDecorCampaignForm(page);
    await dialog.getByLabel("Location").fill("");
    await dialog.getByLabel("Prospect target").fill("0");
    await dialog.getByRole("button", { name: "Approve & start" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Add a location, choose 1–500 prospects and approve the maximum budget.",
    );

    await dialog.getByLabel("Location").fill("South Africa");
    await dialog.getByLabel("Prospect target").fill("50");
    await dialog
      .getByRole("checkbox", {
        name: "I approve this campaign’s maximum budget.",
      })
      .check();
    await dialog.getByRole("button", { name: "Approve & start" }).click();
    await expect(
      page.getByText("Finding prospects", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(
      page.getByText("Search paused", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(
      page.getByText("Finding prospects", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel search" }).click();
    await expect(
      page.getByText("Search cancelled", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New search" }).click();
    await page.getByTestId("w10-discovery-page").waitFor();
    await startCampaign(page, "Atlantis", "5");
    await expect(
      page.getByText("No prospects match these filters."),
    ).toBeVisible();
    await expect(
      page.getByText("Try a different name, location or filter."),
    ).toBeVisible();
  });

  test("industry catalogue shows all covers and an industry lists its business types", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });

    const discovery = page.getByTestId("w10-discovery-page");
    await expect(discovery.locator(".d4-industry-card")).toHaveCount(51);
    await expect(
      discovery.locator(".d4-industry-card-image img").first(),
    ).toHaveAttribute("loading", "lazy");

    await discovery.getByRole("button", { name: /Beauty & Wellness/ }).click();
    await expect(
      discovery.getByRole("heading", { name: "Beauty & Wellness" }),
    ).toBeVisible();
    await expect(
      discovery.getByText("21 business types").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("discovery-category-breadcrumb"),
    ).toContainText("Business/Discovery/Beauty & Wellness");
    await expect(
      discovery.getByRole("button", { name: "Find prospects" }),
    ).toHaveCount(21);

    await discovery.getByRole("button", { name: "All industries" }).click();
    await expect(
      discovery.getByRole("heading", { name: "Browse industries" }),
    ).toBeVisible();
  });

  test("typing guest house finds guesthouses, and B&B finds bed and breakfasts", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });

    const discovery = page.getByTestId("w10-discovery-page");
    const search = discovery.getByRole("textbox", {
      name: "Search industries and business types",
    });
    await search.fill("guest house");
    await expect(discovery.getByText("Guesthouses and inns")).toBeVisible();
    await search.fill("B&B");
    await expect(discovery.getByText("Bed and breakfasts")).toBeVisible();
  });

  test("normal runtime shows no simulated results: a search with no server fails in plain words and creates no campaign", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    const discovery = page.getByTestId("w10-discovery-page");
    await discovery
      .getByRole("textbox", { name: /Search industries/ })
      .fill("home decor");
    const find = discovery
      .getByRole("button", { name: "Find prospects" })
      .first();
    await expect(find).toBeEnabled();
    await expect(
      discovery.getByText("Independent brands needing social support"),
    ).toHaveCount(0);

    await find.click();
    const typeDetails = page.getByTestId("discovery-type-details-dialog");
    await expect(typeDetails).toBeVisible();
    await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
    const dialog = page.getByTestId("discovery-campaign-dialog");
    await dialog.getByLabel("Location").fill("South Africa");
    await dialog
      .getByRole("checkbox", {
        name: "I approve this campaign’s maximum budget.",
      })
      .check();
    await dialog.getByRole("button", { name: /Approve & start/ }).click();
    await expect(dialog.getByRole("alert")).not.toBeEmpty();
    await expect(page.getByTestId("w10-campaign-page")).toHaveCount(0);

    await page.goto("/#/campaign", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
    await expect(page).toHaveURL(/#\/discovery$/);
    await expect(page.getByTestId("w10-campaign-page")).toHaveCount(0);
  });

  test("campaign results filter, accept, and open prospect details", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/campaign", { waitUntil: "domcontentloaded" });

    const campaign = page.getByTestId("w10-campaign-page");
    await expect(
      campaign.getByRole("heading", {
        name: "Independent brands needing social support",
      }),
    ).toBeVisible();
    await expect(campaign.locator("tbody tr")).toHaveCount(7);
    const campaignPages = campaign.getByRole("navigation", {
      name: "Campaign prospect pages",
    });
    await expect(campaignPages).toContainText("Page 1 of 2");
    await campaignPages.getByRole("button", { name: "Next" }).click();
    await expect(campaign.locator("tbody tr")).toHaveCount(5);
    await campaignPages.getByRole("button", { name: "Previous" }).click();
    await expect(campaign.locator("tbody tr")).toHaveCount(7);
    const filterMenu = campaign.locator(".c3l-filter-menu");
    await filterMenu.locator(":scope > summary").click();
    await filterMenu
      .getByRole("group", { name: "Stage" })
      .getByRole("checkbox", { name: /^New/ })
      .check();
    await expect(
      campaign.getByText("8 of 12 match", { exact: true }),
    ).toBeVisible();
    await expect(campaign.locator("tbody tr")).toHaveCount(7);
    await filterMenu
      .getByRole("group", { name: "Phone" })
      .getByRole("checkbox", { name: /Has phone number/ })
      .check();
    await expect(
      campaign.getByText("0 of 12 match", { exact: true }),
    ).toBeVisible();
    await campaign
      .getByRole("button", { name: "Remove phone number filter" })
      .click();
    await expect(
      campaign.getByText("8 of 12 match", { exact: true }),
    ).toBeVisible();
    await campaign
      .getByRole("button", { name: "Remove stage filter: New" })
      .click();
    await expect(
      campaign.getByText("12 of 12 match", { exact: true }),
    ).toBeVisible();
    await filterMenu.locator(":scope > summary").click();

    await campaign
      .getByRole("textbox", { name: "Search prospects" })
      .fill("Form & Field");
    await expect(campaign.locator("tbody tr")).toHaveCount(1);
    await campaign
      .getByRole("checkbox", { name: "Select Form & Field" })
      .check();
    await campaign.getByRole("button", { name: "Accept as lead" }).click();
    await expect(
      campaign.getByText("Accepted 1 prospect as a lead.", { exact: true }),
    ).toBeVisible();

    await campaign.getByRole("link", { name: /Form & Field/ }).click();
    await expect(page.getByTestId("w10-prospect-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Form & Field" }),
    ).toBeVisible();
    await expect(page.getByText("Last checked")).toHaveCount(0);

    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "All campaigns" }).click();
    const campaignList = page.getByRole("dialog");
    await expect(
      campaignList.getByRole("heading", { name: "Your discovery campaigns." }),
    ).toBeVisible();
    await campaignList
      .getByRole("button", {
        name: /Independent brands needing social support/,
      })
      .click();
    await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
  });

  test("campaign run details can simulate a source failure and retry without exceeding its target", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await startCampaign(page, "South Africa", "10");

    await expect(
      page.getByText("Finding prospects", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Run details" }).click();
    const details = page.getByRole("dialog");
    await expect(
      details.getByRole("heading", { name: "Search activity." }),
    ).toBeVisible();
    await details
      .getByRole("button", { name: "Preview a source failure" })
      .click();
    await expect(
      page.getByText("Search interrupted", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry search" }).click();
    await expect(
      page
        .getByTestId("w10-campaign-page")
        .getByRole("link", { name: "Prospects 10" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId("w10-campaign-page").locator("tbody tr"),
    ).toHaveCount(7);
    await expect(page.getByRole("button", { name: "Run details" })).toHaveCount(
      0,
    );
  });

  test("lead stage actions, business phone default, and duplicate prevention persist", async ({
    page,
  }) => {
    await installMockBridge(page, {
      ...REFERENCE_WORKSPACE,
      referenceWorkspaceOutreachReady: true,
    });
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

    const leads = page.getByTestId("w10-leads-page");
    const row = () =>
      leads.locator("tbody tr").filter({ hasText: "Form & Field" });
    await expect(row()).toBeVisible();
    await expect(row()).toContainText("New");
    await row().getByRole("checkbox", { name: "Select Form & Field" }).check();
    let toolbar = page.getByRole("toolbar", { name: "Selected leads" });
    await toolbar.locator(".c3l-selection-more > summary").click();
    const stageMenu = toolbar.locator(".c3l-selection-stage-menu");
    await stageMenu.locator(":scope > summary").click();
    await stageMenu.getByRole("button", { name: "Qualified" }).click();
    await expect(toolbar).toHaveCount(0);
    await expect(row()).toHaveCount(0);

    await leads.getByRole("button", { name: "Show all stages" }).click();
    await expect(row()).toContainText("Qualified");
    await row().getByRole("checkbox", { name: "Select Form & Field" }).check();
    toolbar = page.getByRole("toolbar", { name: "Selected leads" });
    await toolbar.locator(".c3l-selection-more > summary").click();
    await toolbar.getByRole("button", { name: "Mark lost" }).click();
    await expect(row()).toContainText("Lost");

    await row().getByRole("checkbox", { name: "Select Form & Field" }).check();
    toolbar = page.getByRole("toolbar", { name: "Selected leads" });
    await toolbar.locator(".c3l-selection-more > summary").click();
    const reopenStageMenu = toolbar.locator(".c3l-selection-stage-menu");
    await reopenStageMenu.locator(":scope > summary").click();
    await reopenStageMenu.getByRole("button", { name: "Qualified" }).click();
    await expect(row()).toContainText("Qualified");

    await row().getByRole("link", { name: "Review lead" }).click();
    const detail = page.getByTestId("w10-prospect-page");
    await expect(
      detail.getByRole("heading", { name: "Form & Field" }),
    ).toBeVisible();
    await expect(detail.getByTestId("whatsapp-lead-detail-card")).toContainText(
      "Uses the business phone.",
    );
    await expect(detail.getByTestId("whatsapp-lead-detail-card")).toContainText(
      "+27 21 555 0142",
    );

    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Add lead" }).click();
    const addLead = page.getByTestId("w10-add-lead-dialog");
    await addLead.getByLabel("Business name").fill("Form & Field");
    await addLead.getByLabel("Contact name").fill("Jules");
    await addLead.getByLabel("Email").fill("jules@example.test");
    await addLead.getByLabel("Industry").fill("Home & Living");
    await addLead.getByLabel("Location").fill("Cape Town");
    await addLead.getByRole("button", { name: "Add lead" }).click();
    await expect(addLead.getByRole("alert")).toHaveText(
      "This business already exists in Leads. Open the existing record.",
    );
  });

  test("leads screen shows approved views and lead outreach actions", async ({
    page,
  }) => {
    await installMockBridge(page, {
      ...REFERENCE_WORKSPACE,
      referenceWorkspaceOutreachReady: true,
    });
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    const leads = page.getByTestId("w10-leads-page");
    await expect(
      leads.getByRole("heading", { name: "Leads", exact: true }),
    ).toBeVisible();
    await expect(leads.locator("tbody tr")).toHaveCount(1);
    const views = leads.getByRole("navigation", { name: "Business views" });
    await expect(views.getByRole("link", { name: "Lists" })).toBeVisible();
    await expect(views.getByRole("link", { name: "Pipeline" })).toBeVisible();
    for (const name of ["Proposals", "Services"]) {
      await expect(views.getByText(name, { exact: true })).toBeVisible();
      await expect(views.getByRole("link", { name })).toHaveCount(0);
    }
    await expect(
      page.getByTestId("top-bar-breadcrumb").getByText("Leads"),
    ).toBeVisible();

    await page.goto("/#/sales/lead/form-field", {
      waitUntil: "domcontentloaded",
    });
    const detail = page.getByTestId("w10-prospect-page");
    await expect(
      detail.getByRole("heading", { name: "Form & Field" }),
    ).toBeVisible();
    for (const name of [
      "Prepare proposal",
      "Prepare outreach",
      /Open proposal/,
    ]) {
      await expect(detail.getByRole("button", { name })).toHaveCount(0);
      await expect(detail.getByRole("link", { name })).toHaveCount(0);
    }
    await expect(page.getByTestId("lead-breadcrumb")).toContainText(
      "Form & Field",
    );
    await expect(detail.getByTestId("whatsapp-lead-detail-card")).toContainText(
      "Uses the business phone.",
    );
    await expect(
      detail.getByRole("button", { name: "Add to outreach list" }),
    ).toBeVisible();
  });

  test("W10 reference routes resolve to their own screen", async ({ page }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    const routes = [
      ["/discovery", "w10-discovery-page"],
      ["/campaign", "w10-campaign-page"],
      ["/leads", "w10-leads-page"],
      ["/pipeline", "w10-pipeline-page"],
      ["/sales/lead/form-field", "w10-prospect-page"],
    ] as const;
    for (const [path, testId] of routes) {
      await page.goto(`/#${path}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId(testId)).toBeVisible();
    }

    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    const leads = page.getByTestId("w10-leads-page");
    await expect(
      leads.getByRole("heading", { name: "Leads", exact: true }),
    ).toBeVisible();

    await page.goto("/#/pipeline", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Qualified" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "In conversation" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Proposal" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Won" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Lost" })).toBeVisible();
  });
});
