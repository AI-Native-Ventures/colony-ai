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

  test("renders the 108 lead proof fixture in the approved five-column rhythm", async ({
    page,
  }, testInfo) => {
    await openLeads(page);

    const table = page.getByRole("table", { name: "Leads" });
    await expect(table.locator("tbody tr")).toHaveCount(108);
    await expect(table.locator("thead th")).toHaveText([
      "Business",
      "Contact",
      "Stage",
      "Service / month",
      "Next step",
    ]);
    await expect(page.getByLabel("WhatsApp status")).toBeVisible();

    const longName = table
      .locator("tbody tr")
      .filter({ hasText: REFERENCE_LONG_LEAD_NAME })
      .first()
      .locator(".c3l-business-text strong");
    await expect(longName).toHaveCSS("white-space", "nowrap");
    await expect(longName).toHaveCSS("text-overflow", "ellipsis");

    const unsetLead = table
      .locator("tbody tr")
      .filter({ hasText: "Gather House" })
      .first();
    await expect(unsetLead.locator(".c3l-cell-contact")).toHaveText("Not set");
    await expect(unsetLead.locator(".c3l-cell-amount")).toHaveText("Not set");
    await expect(
      unsetLead.locator(".c3l-cell-contact .c3l-empty-value"),
    ).toHaveCSS("font-weight", "500");

    const formField = table
      .locator("tbody tr")
      .filter({ hasText: "Form & Field" })
      .first();
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
    const darkPath = testInfo.outputPath("1440-dark.png");
    await page.screenshot({ path: darkPath });
    await testInfo.attach("leads-1440-dark", {
      path: darkPath,
      contentType: "image/png",
    });
  });

  test("clicking an empty part of a lead row opens that lead", async ({
    page,
  }) => {
    await openLeads(page);
    const row = page
      .getByRole("table", { name: "Leads" })
      .locator("tbody tr")
      .filter({ hasText: "Form & Field" })
      .first();

    const emptyCell = await row.locator("td").nth(3).boundingBox();
    if (!emptyCell) throw new Error("The lead row amount cell is unavailable.");
    await page.mouse.click(
      emptyCell.x + emptyCell.width / 2,
      emptyCell.y + emptyCell.height / 2,
    );

    await expect(page).toHaveURL(new RegExp(`/sales/lead/${FORM_FIELD_ID}$`));
    await expect(
      page.getByRole("heading", { name: "Form & Field", exact: true }),
    ).toBeVisible();
  });

  test("customer record and Make client actions live on lead detail", async ({
    page,
  }) => {
    await openLeads(page);
    await page.goto(`/#/sales/lead/${FORM_FIELD_ID}`, {
      waitUntil: "domcontentloaded",
    });

    const detail = page.getByTestId("w10-prospect-page");
    const convert = detail.getByRole("button", { name: "Make client" });
    await expect(convert).toBeVisible();
    await expect(
      detail.getByRole("link", { name: "Customer record" }),
    ).toBeVisible();
    await convert.click();
    await expect(convert).toHaveCount(0);
    await detail.getByRole("link", { name: "Customer record" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/record/${FORM_FIELD_ID}$`),
    );
  });
});
