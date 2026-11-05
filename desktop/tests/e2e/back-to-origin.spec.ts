import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import {
  gotoWhatsAppScreen,
  installWhatsAppMockBridge,
  PLANE_TREE_WA_ID,
} from "../helpers/whatsappOutreach";

async function installDiscovery(page: Parameters<typeof installMockBridge>[0]) {
  await installDiscoveryImageMocks(page);
  await installMockBridge(page, { referenceWorkspace: true });
}

test.describe("Back to origin", () => {
  test("campaign lead returns to the campaign with its filters, selection, and scroll", async ({
    page,
  }) => {
    await installDiscovery(page);
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto("/#/campaign", { waitUntil: "domcontentloaded" });

    const campaign = page.getByTestId("w10-campaign-page");
    await expect(campaign).toBeVisible();
    const campaignName = await campaign
      .getByRole("heading", { level: 1 })
      .innerText();
    await campaign.getByText("Add filter", { exact: true }).click();
    const stageFilters = campaign.getByRole("group", { name: "Stage" });
    await stageFilters.getByRole("checkbox").first().check();
    await campaign
      .getByRole("textbox", { name: "Search prospects" })
      .fill("Form & Field");
    await campaign
      .getByRole("checkbox", { name: "Select Form & Field" })
      .check();
    await campaign.evaluate((element) => element.scrollTo({ top: 260 }));
    await expect
      .poll(() => campaign.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const openLead = campaign.getByRole("link", { name: /Form & Field/ });
    await openLead.scrollIntoViewIfNeeded();
    const sourceScrollTop = await campaign.evaluate(
      (element) => element.scrollTop,
    );
    await openLead.click();

    const lead = page.getByTestId("w10-prospect-page");
    await expect(lead).toBeVisible();
    const breadcrumb = page.getByTestId("lead-breadcrumb");
    const returnButton = breadcrumb.getByRole("button", {
      name: `Back to ${campaignName}`,
    });
    await expect(returnButton).toBeVisible();
    await expect(returnButton).toHaveAttribute("title", campaignName);
    await expect(page.getByTestId("lead-breadcrumb")).toContainText(
      `Business/Discovery/${campaignName}/Form & Field`,
    );

    await returnButton.click();
    await expect(campaign).toBeVisible();
    await expect(
      campaign.getByRole("button", { name: "Remove stage filter: New" }),
    ).toBeVisible();
    await expect(
      campaign.getByRole("textbox", { name: "Search prospects" }),
    ).toHaveValue("Form & Field");
    await expect(
      campaign.getByRole("checkbox", { name: "Select Form & Field" }),
    ).toBeChecked();
    const maxScrollTop = await campaign.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    );
    await expect
      .poll(() => campaign.evaluate((element) => element.scrollTop))
      .toBe(Math.min(sourceScrollTop, maxScrollTop));

    await campaign.getByRole("link", { name: /Form & Field/ }).click();
    await expect(page.getByTestId("w10-prospect-page")).toBeVisible();
    await page.getByTestId("global-back").click();
    await expect(campaign).toBeVisible();
    await expect(
      campaign.getByRole("button", { name: "Remove stage filter: New" }),
    ).toBeVisible();
  });

  test("a long campaign return label truncates without horizontal overflow", async ({
    page,
  }) => {
    await installDiscovery(page);
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto("/#/campaign", { waitUntil: "domcontentloaded" });

    const campaign = page.getByTestId("w10-campaign-page");
    await expect(campaign).toBeVisible();
    const campaignName = await campaign
      .getByRole("heading", { level: 1 })
      .innerText();
    await campaign
      .getByRole("textbox", { name: "Search prospects" })
      .fill("Form & Field");
    await campaign.getByRole("link", { name: /Form & Field/ }).click();

    const lead = page.getByTestId("w10-prospect-page");
    await expect(lead).toBeVisible();
    const returnButton = page
      .getByTestId("lead-breadcrumb")
      .getByRole("button", {
        name: `Back to ${campaignName}`,
      });
    await expect(returnButton).toHaveAttribute("title", campaignName);
    const label = returnButton;
    await expect(label).toHaveCSS("text-overflow", "ellipsis");
    expect(
      await label.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const widths = await page.evaluate(() => {
      const pageRoot = document.querySelector<HTMLElement>(".c3l-page");
      return {
        document: document.documentElement.scrollWidth,
        page: pageRoot?.scrollWidth ?? 0,
        pageClient: pageRoot?.clientWidth ?? 0,
      };
    });
    expect(widths.document).toBeLessThanOrEqual(390);
    expect(widths.page).toBeLessThanOrEqual(widths.pageClient);
  });

  test("a lead opened from Leads returns to its searched source", async ({
    page,
  }) => {
    await installDiscovery(page);
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

    const leads = page.getByTestId("w10-leads-page");
    await expect(leads).toBeVisible();
    await leads
      .getByRole("button", { name: "Remove phone number filter" })
      .click();
    await leads.getByRole("button", { name: "Remove WhatsApp filter" }).click();
    await leads
      .getByRole("button", { name: "Remove stage filter: New" })
      .click();
    await leads
      .getByRole("searchbox", { name: "Search leads" })
      .fill("Form & Field");
    await leads.getByRole("link", { name: "Review lead" }).click();

    const lead = page.getByTestId("w10-prospect-page");
    await expect(lead).toBeVisible();
    const breadcrumb = page.getByTestId("lead-breadcrumb");
    await expect(
      breadcrumb.getByRole("button", { name: "Back to All leads" }),
    ).toBeVisible();
    await expect(page.getByTestId("lead-breadcrumb")).toContainText(
      "Business/Sales/Leads/Form & Field",
    );
    await breadcrumb.getByRole("button", { name: "Back to All leads" }).click();

    await expect(leads).toBeVisible();
    await expect(
      leads.getByRole("searchbox", { name: "Search leads" }),
    ).toHaveValue("Form & Field");
    await expect(
      leads.getByRole("link", { name: "Review lead" }),
    ).toBeVisible();
  });

  test("an invoice opened from Revenue returns with its period filter", async ({
    page,
  }) => {
    await page.clock.install({
      time: new Date("2026-09-23T12:00:00+02:00"),
    });
    await installMockBridge(page, {
      referenceWorkspace: true,
      referenceWorkspaceMoneyRecords: true,
    });
    await page.goto("/#/money/revenue", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("money-invoice-list")).toBeVisible();
    await page.getByLabel("Money period").selectOption("2026-09");
    const invoice = page.locator(
      'a[href="#/money/revenue/3e3a7000-0000-4000-8000-000000000027"]',
    );
    await expect(invoice).toBeVisible();
    await invoice.click();

    await expect(page.getByTestId("money-invoice-detail")).toBeVisible();
    const back = page.getByRole("button", { name: "Back to All revenue" });
    await expect(back).toBeVisible();
    await back.click();

    await expect(page.getByTestId("money-invoice-list")).toBeVisible();
    await expect(page).toHaveURL(/#\/money\/revenue$/);
    await expect(page.getByLabel("Money period")).toHaveValue("2026-09");
  });

  test("a lead opened from Outreach chats returns to the channel and contact", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(page, "/channels/e2e-whatsapp-outreach-channel");
    await page.getByTestId("channel-whatsapp-chats-trigger").click();

    const outreach = page.getByTestId("whatsapp-outreach");
    await expect(outreach).toBeVisible();
    await outreach.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`).click();
    await outreach.getByRole("button", { name: "Open lead" }).first().click();

    const lead = page.getByTestId("w10-prospect-page");
    await expect(lead).toBeVisible();
    const breadcrumb = page.getByTestId("lead-breadcrumb");
    await expect(
      breadcrumb.getByRole("button", { name: "Back to Outreach" }),
    ).toBeVisible();
    await expect(page.getByTestId("lead-breadcrumb")).toContainText(
      "Business/Outreach/Plane Tree Guesthouse",
    );
    await breadcrumb.getByRole("button", { name: "Back to Outreach" }).click();

    await expect(outreach).toBeVisible();
    await expect(
      outreach.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".c3wa-thread-head-copy")).toContainText(
      "Plane Tree Guesthouse",
    );
  });

  test("a deep linked lead falls back to All leads", async ({ page }) => {
    await installDiscovery(page);
    await page.goto("/#/sales/lead/form-field", {
      waitUntil: "domcontentloaded",
    });

    const lead = page.getByTestId("w10-prospect-page");
    await expect(lead).toBeVisible();
    const breadcrumb = page.getByTestId("lead-breadcrumb");
    await expect(
      breadcrumb.getByRole("button", { name: "Back to All leads" }),
    ).toBeVisible();
    await breadcrumb.getByRole("button", { name: "Back to All leads" }).click();
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  });

  test("audited detail pages return to their natural parent on deep links", async ({
    page,
  }) => {
    await installMockBridge(page, { referenceWorkspace: true });

    const checks = [
      {
        route: "/#/clients/1e1a7000-0000-4000-8000-000000000011",
        back: () => page.getByRole("button", { name: "Back to All clients" }),
        target: /#\/clients$/,
      },
      {
        route: "/#/money/invoice/3e3a7000-0000-4000-8000-000000000027",
        back: () => page.getByRole("button", { name: "Back to All invoices" }),
        target: /#\/money\/invoices$/,
      },
      {
        route: "/#/money/revenue/3e3a7000-0000-4000-8000-000000000027",
        back: () => page.getByRole("button", { name: "Back to All revenue" }),
        target: /#\/money\/revenue$/,
      },
      {
        route: "/#/company/function/operations",
        back: () => page.getByTestId("global-back"),
        target: /#\/company\/map$/,
      },
      {
        route: `/#/agents?agent=${"deadbeef".repeat(8)}`,
        back: () => page.getByRole("button", { name: "Back to Agents" }),
        target: /#\/agents$/,
      },
      {
        route: "/#/settings?section=business-profile",
        back: () => page.getByTestId("settings-history-back"),
        target: /#\/today$/,
      },
      {
        route: "/#/campaign",
        back: () => page.getByTestId("global-back"),
        target: /#\/discovery$/,
      },
    ];

    for (const check of checks) {
      await page.goto(check.route, { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      const back = check.back();
      await expect(back).toBeVisible();
      await back.click();
      await expect(page).toHaveURL(check.target);
    }
  });

  test("a settings subpage returns to the route that opened settings", async ({
    page,
  }) => {
    await installDiscovery(page);
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();

    await page.getByTestId("sidebar-settings").click();
    await expect(page.getByTestId("settings-view")).toBeVisible();
    const backToSource = page.getByTestId("settings-history-back");
    await expect(backToSource).toHaveAccessibleName("Back to All leads");
    await backToSource.click();

    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  });
});
