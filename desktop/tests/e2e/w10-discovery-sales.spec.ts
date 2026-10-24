import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const REFERENCE_WORKSPACE = { referenceWorkspace: true };

async function openHomeDecorCampaignForm(page: Page) {
  await page
    .getByRole("textbox", { name: "Search industries and verticals" })
    .fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const dialog = page.getByRole("dialog");
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
      discovery.getByText("34 industries · 531 verticals"),
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

  test("industry catalogue opens twelve, expands to all, and an industry lists its verticals", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });

    const discovery = page.getByTestId("w10-discovery-page");
    await expect(discovery.locator(".c3d-industry-card")).toHaveCount(12);
    await discovery
      .getByRole("button", { name: "Show all 34 industries" })
      .click();
    await expect(discovery.locator(".c3d-industry-card")).toHaveCount(34);

    await discovery.getByRole("button", { name: /Beauty & Wellness/ }).click();
    await expect(
      discovery.getByRole("heading", { name: "Beauty & Wellness" }),
    ).toBeVisible();
    await expect(discovery.getByText("13 verticals")).toBeVisible();
    await expect(
      page.getByTestId("discovery-category-breadcrumb"),
    ).toContainText("Business/Discovery/Beauty & Wellness");
    await expect(
      discovery.getByRole("button", { name: "Find prospects" }),
    ).toHaveCount(13);

    await discovery.getByRole("button", { name: "All industries" }).click();
    await expect(
      discovery.getByRole("heading", { name: "Browse industries" }),
    ).toBeVisible();
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
    const dialog = page.getByRole("dialog");
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

  test("campaign results filter, export, accept, and open prospect details", async ({
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
    await expect(campaign.locator("tbody tr")).toHaveCount(12);
    await campaign.getByLabel("Filter prospects").selectOption("high-fit");
    await expect(campaign.locator("tbody tr")).toHaveCount(6);
    await campaign.getByLabel("Filter prospects").selectOption("accepted");
    await expect(campaign.locator("tbody tr")).toHaveCount(4);
    await campaign.getByLabel("Filter prospects").selectOption("candidates");
    await expect(campaign.locator("tbody tr")).toHaveCount(8);
    await campaign.getByLabel("Filter prospects").selectOption("all");

    await campaign
      .getByRole("textbox", { name: "Search prospects" })
      .fill("Form & Field");
    await expect(campaign.locator("tbody tr")).toHaveCount(1);
    await campaign
      .getByRole("checkbox", { name: "Select Form & Field" })
      .check();
    await campaign.getByRole("button", { name: "Accept as lead" }).click();
    await expect(
      campaign.locator("tbody tr").getByText("Qualified"),
    ).toBeVisible();

    await campaign.getByRole("textbox", { name: "Search prospects" }).fill("");
    const downloadReady = page.waitForEvent("download");
    await campaign
      .getByRole("button", { name: "Export visible prospects" })
      .click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe("prospects.csv");

    await campaign.getByRole("link", { name: "Open Form & Field" }).click();
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
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("10 prospects found · 10 requested"),
    ).toBeVisible();
  });

  test("lead qualification, duplicate prevention, lost reason, and reopen persist", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/sales/lead/form-field", {
      waitUntil: "domcontentloaded",
    });

    const detail = page.getByTestId("w10-prospect-page");
    await expect(
      detail.getByRole("heading", { name: "Form & Field" }),
    ).toBeVisible();
    await detail.getByRole("button", { name: "Qualify lead" }).click();
    await expect(detail.getByText("Qualified", { exact: true })).toBeVisible();

    await detail.getByRole("button", { name: "Mark as lost" }).click();
    const closeDialog = page.getByTestId("w10-close-opportunity-dialog");
    await expect(
      closeDialog.getByRole("heading", { name: "Close this opportunity" }),
    ).toBeVisible();
    await closeDialog.getByLabel("Reason").selectOption("Budget");
    await closeDialog
      .getByLabel("Notes")
      .fill("The timing does not work for this quarter.");
    await closeDialog.getByRole("button", { name: "Mark as lost" }).click();
    await expect(detail.getByText("Lost", { exact: true })).toBeVisible();
    await expect(
      detail.getByText(
        "Lost: Budget · The timing does not work for this quarter.",
      ),
    ).toBeVisible();
    await detail.getByRole("button", { name: "Reopen opportunity" }).click();
    await expect(detail.getByText("Qualified", { exact: true })).toBeVisible();

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

  test("leads screens offer no proposal, pipeline or services entry points", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    const leads = page.getByTestId("w10-leads-page");
    await expect(leads.getByRole("heading", { name: "Leads" })).toBeVisible();
    await expect(leads.locator("tbody tr")).toHaveCount(12);
    for (const name of ["Pipeline", "Proposals", "Services"]) {
      await expect(leads.getByRole("link", { name })).toHaveCount(0);
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
    await expect(
      detail.getByRole("link", { name: "Discuss in Sales" }),
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
    await expect(page.locator("tbody tr").first()).toContainText(
      "The Olive House",
    );

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
