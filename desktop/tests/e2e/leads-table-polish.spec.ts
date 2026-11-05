import { expect, test, type Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { cedarCafeLeadRecord } from "../../src/testing/cofounderCustomerFixtures";
import {
  REFERENCE_LONG_LEAD_NAME,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const FORM_FIELD_ID = REFERENCE_PROSPECT_IDS["form-field"];
function leadsFixture() {
  const relaySecret = generateSecretKey();
  const input = {
    scoutPubkey: TEST_IDENTITIES.alice.pubkey,
    ayaPubkey: TEST_IDENTITIES.bob.pubkey,
    ownerPubkey: OWNER_PUBKEY,
  };
  const formField = cedarCafeLeadRecord(input);
  formField.partyId = FORM_FIELD_ID;
  formField.leadId = FORM_FIELD_ID;
  formField.displayName = "Form & Field";

  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    referenceWorkspace: true,
    referenceWorkspaceRole: "owner" as const,
    referenceWorkspaceLongLeadNames: true,
    referenceWorkspaceLeadCount: 108,
    referenceWorkspaceMissingLeadFields: true,
    relayRole: "owner" as const,
    relayRequiresMembership: true,
    relayMembers: [{ pubkey: OWNER_PUBKEY, role: "owner" as const }],
    cofounderSettings: {
      enabled: true,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: {
        approveEveryHire: false,
        approvePlaybookChanges: false,
        approveEveryDiscoveryCampaign: false,
      },
    },
    companyCustomerRecords: [formField],
  };
}

async function installLogoMocks(page: Page) {
  await page.route("https://img.logo.dev/**", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    const hue =
      [...hostname].reduce(
        (sum, character) => sum + character.charCodeAt(0),
        0,
      ) % 360;
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="hsl(${hue} 36% 82%)"/><circle cx="32" cy="32" r="15" fill="hsl(${hue} 45% 45%)"/></svg>`;
    await route.fulfill({ body, contentType: "image/svg+xml" });
  });
}

async function openLeads(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-theme", "buzz");
  });
  await installLogoMocks(page);
  await installDiscoveryImageMocks(page);
  await installMockBridge(page, leadsFixture());
  await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
}

test.describe("Leads table polish", () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  test("renders the 108 lead proof fixture in the paginated outreach table", async ({
    page,
  }, testInfo) => {
    await openLeads(page);

    const table = page.getByRole("table", { name: "Leads" });
    await expect(
      page.locator(".c3l-leads-desktop-head .c3l-subtitle"),
    ).toContainText("108 leads");
    await expect(page.locator(".c3l-match-count")).toHaveText("0 of 108 match");

    await page
      .getByRole("button", { name: "Remove phone number filter" })
      .click();
    await page.getByRole("button", { name: "Remove WhatsApp filter" }).click();
    await page
      .getByRole("button", { name: "Remove stage filter: New" })
      .click();

    await expect(page.locator(".c3l-match-count")).toHaveText(
      "108 of 108 match",
    );
    await expect(table.locator("tbody tr")).toHaveCount(8);
    await expect(table.locator("thead th")).toHaveText([
      "",
      "Business",
      "Phone",
      "Stage",
      "WhatsApp",
      "Next step",
    ]);
    await expect(
      table.getByRole("checkbox", {
        name: "Select all 8 leads on this page",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Lead pages" }),
    ).toContainText("Page 1 of 14");

    const lightPath = testInfo.outputPath("1440-light.png");
    await page.screenshot({ path: lightPath });
    await testInfo.attach("leads-1440-light", {
      path: lightPath,
      contentType: "image/png",
    });

    await page.evaluate(() => {
      window.localStorage.setItem("buzz-theme", "buzz-dark");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    await page
      .getByRole("button", { name: "Remove phone number filter" })
      .click();
    await page.getByRole("button", { name: "Remove WhatsApp filter" }).click();
    await page
      .getByRole("button", { name: "Remove stage filter: New" })
      .click();
    const darkPath = testInfo.outputPath("1440-dark.png");
    await page.screenshot({ path: darkPath });
    await testInfo.attach("leads-1440-dark", {
      path: darkPath,
      contentType: "image/png",
    });

    const search = page.getByRole("searchbox", { name: "Search leads" });
    await search.fill(REFERENCE_LONG_LEAD_NAME);
    const longName = table
      .locator("tbody tr")
      .filter({ hasText: REFERENCE_LONG_LEAD_NAME })
      .first()
      .locator(".c3l-business-text strong");
    await expect(longName).toHaveCSS("white-space", "nowrap");
    await expect(longName).toHaveCSS("text-overflow", "ellipsis");

    await search.fill("Gather House");
    const unsetLead = table.locator("tbody tr").filter({
      has: page.getByText("Gather House", { exact: true }),
    });
    await expect(unsetLead.locator(".c3l-cell-phone strong")).toHaveText(
      "Not set",
    );

    await search.fill("Form & Field");
    const formField = table.locator("tbody tr").filter({
      has: page.getByText("Form & Field", { exact: true }),
    });
    await expect(
      formField.locator(".c3l-cell-business").getByText("Customer record"),
    ).toHaveCount(0);
    await expect(
      formField.getByRole("button", { name: "Make client" }),
    ).toHaveCount(0);
    await expect(
      formField.locator(".c3l-cell-next-step").getByRole("link", {
        name: "Review lead",
      }),
    ).toBeVisible();
  });

  test("the Review lead action opens that lead", async ({ page }) => {
    await openLeads(page);
    await page
      .getByRole("button", { name: "Remove phone number filter" })
      .click();
    await page.getByRole("button", { name: "Remove WhatsApp filter" }).click();
    await page
      .getByRole("button", { name: "Remove stage filter: New" })
      .click();
    await page
      .getByRole("searchbox", { name: "Search leads" })
      .fill("Form & Field");

    const row = page
      .getByRole("table", { name: "Leads" })
      .locator("tbody tr")
      .filter({ has: page.getByText("Form & Field", { exact: true }) })
      .first();

    await row.getByRole("link", { name: "Review lead" }).click();

    await expect(page).toHaveURL(new RegExp(`/sales/lead/${FORM_FIELD_ID}$`));
    await expect(
      page.getByRole("heading", { name: "Form & Field", exact: true }),
    ).toBeVisible();
  });

  test("Make client converts the lead from lead detail", async ({ page }) => {
    await openLeads(page);
    await page.goto(`/#/sales/lead/${FORM_FIELD_ID}`, {
      waitUntil: "domcontentloaded",
    });

    const detail = page.getByTestId("w10-prospect-page");
    const convert = detail.getByRole("button", { name: "Make client" });
    await expect(convert).toBeVisible();
    await convert.click();
    await expect(convert).toHaveCount(0);
    await expect(detail.getByRole("alert")).toHaveCount(0);
  });
});
