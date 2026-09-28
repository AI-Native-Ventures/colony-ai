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

  test("normal runtime exposes no successful provider search", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    const discovery = page.getByTestId("w10-discovery-page");
    await discovery
      .getByRole("textbox", { name: "Search industries and verticals" })
      .fill("home decor");
    await expect(
      discovery.getByRole("button", { name: "Find prospects" }).first(),
    ).toBeDisabled();
    await expect(
      discovery.getByText("Independent brands needing social support"),
    ).toHaveCount(0);

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
    await campaign.getByRole("button", { name: "Accept as leads" }).click();
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

  test("proposal version and acceptance retry keep one client, work item, and draft invoice", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as Window & {
          __BUZZ_E2E_W10_FAIL_ACCEPTANCE_ACK_ONCE__?: boolean;
          __BUZZ_E2E_W10_ACCEPTANCE_ACK_LOST__?: boolean;
        }
      ).__BUZZ_E2E_W10_FAIL_ACCEPTANCE_ACK_ONCE__ = true;
      (
        window as Window & {
          __BUZZ_E2E_W10_ACCEPTANCE_ACK_LOST__?: boolean;
        }
      ).__BUZZ_E2E_W10_ACCEPTANCE_ACK_LOST__ = false;
    });
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/sales/proposal/proposal-form", {
      waitUntil: "domcontentloaded",
    });

    const proposal = page.getByTestId("w10-proposal-page");
    await expect(
      proposal.getByRole("heading", { name: "Service proposal" }),
    ).toBeVisible();
    await expect(proposal.getByText("First service proposal.")).toBeVisible();
    await proposal.getByRole("button", { name: "Request a revision" }).click();
    const revisionDialog = page.getByTestId("w10-proposal-revision-dialog");
    await revisionDialog
      .getByLabel("What needs to change?")
      .fill("Clarify the monthly reporting scope.");
    await revisionDialog.getByRole("button", { name: "Save feedback" }).click();
    await expect(
      proposal.getByText("Clarify the monthly reporting scope."),
    ).toBeVisible();
    await expect(proposal.getByText("v1 · changes requested")).toBeVisible();

    await proposal.getByRole("button", { name: "Edit proposal" }).click();
    const editDialog = page.getByTestId("w10-proposal-edit-dialog");
    await editDialog
      .getByLabel("Title")
      .fill("A steady social presence for Form & Field");
    await editDialog.getByRole("button", { name: "Save proposal" }).click();
    await expect(
      page.getByRole("heading", {
        name: "A steady social presence for Form & Field",
      }),
    ).toBeVisible();
    await expect(page.getByText("v2 · draft")).toBeVisible();

    await proposal
      .getByRole("button", { name: "Record client acceptance" })
      .click();
    const acceptanceDialog = page.getByTestId("w10-acceptance-dialog");
    await acceptanceDialog
      .getByLabel("Evidence or reference")
      .fill("Signed approval reference W10-TEST-001");
    await acceptanceDialog
      .getByRole("checkbox", {
        name: "I have verified acceptance of this exact scope, price and version.",
      })
      .check();
    await acceptanceDialog
      .getByRole("button", { name: "Record acceptance" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __BUZZ_E2E_W10_ACCEPTANCE_ACK_LOST__?: boolean;
              }
            ).__BUZZ_E2E_W10_ACCEPTANCE_ACK_LOST__,
        ),
      )
      .toBe(true);
    await expect(acceptanceDialog).toBeVisible();
    await expect(proposal.getByTestId("w10-conversion-receipt")).toHaveText(
      "Client, first work and draft invoice are linked.",
    );
    const committedConversionCounts = await page.evaluate(
      () =>
        (
          window as Window & {
            __BUZZ_E2E_W10_CONVERSION_COUNTS__?: {
              receipts: number;
              clients: number;
              workItems: number;
              draftInvoices: number;
            };
          }
        ).__BUZZ_E2E_W10_CONVERSION_COUNTS__,
    );
    expect(committedConversionCounts).toEqual({
      receipts: 1,
      clients: 1,
      workItems: 1,
      draftInvoices: 1,
    });

    await acceptanceDialog
      .getByRole("button", { name: "Record acceptance" })
      .click();
    await expect(acceptanceDialog).toBeHidden();
    await expect(
      proposal.getByText("Client, first work and draft invoice are linked."),
    ).toBeVisible();
    const conversionCounts = await page.evaluate(
      () =>
        (
          window as Window & {
            __BUZZ_E2E_W10_CONVERSION_COUNTS__?: {
              receipts: number;
              clients: number;
              workItems: number;
              draftInvoices: number;
            };
          }
        ).__BUZZ_E2E_W10_CONVERSION_COUNTS__,
    );
    expect(conversionCounts).toEqual({
      receipts: 1,
      clients: 1,
      workItems: 1,
      draftInvoices: 1,
    });
  });

  test("W10 reference routes resolve to their own screen", async ({ page }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    const routes = [
      ["/discovery", "w10-discovery-page"],
      ["/campaign", "w10-campaign-page"],
      ["/leads", "w10-leads-page"],
      ["/pipeline", "w10-pipeline-page"],
      ["/sales/lead/form-field", "w10-prospect-page"],
      ["/sales/service", "w10-service-page"],
      ["/sales/proposal/proposal-form", "w10-proposal-page"],
      ["/sales/proposals", "w10-proposals-page"],
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

  test("service scope and pricing save through the reference business stream", async ({
    page,
  }) => {
    await installMockBridge(page, REFERENCE_WORKSPACE);
    await page.goto("/#/sales/service", { waitUntil: "domcontentloaded" });
    const service = page.getByTestId("w10-service-page");
    await expect(service.getByLabel("Service name")).toHaveValue(
      "Social media management",
    );
    await service.getByLabel("Monthly fee (ZAR)").fill("5200");
    await service.getByLabel("Posts per month").fill("9");
    await service.getByLabel("Revision rounds").fill("3");
    await service.getByRole("button", { name: "Save service" }).click();
    await expect(service.getByLabel("Monthly fee (ZAR)")).toHaveValue("5200");
    await expect(service.getByLabel("Posts per month")).toHaveValue("9");
    await expect(service.getByLabel("Revision rounds")).toHaveValue("3");
  });
});
