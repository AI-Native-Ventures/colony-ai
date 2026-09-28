import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { REFERENCE_MONEY_INVOICE_IDS } from "../../src/testing/e2eReferenceWorkspace";

const DRAFT_INVOICE_ID = REFERENCE_MONEY_INVOICE_IDS.northlineDraft;
const KIND_INVOICE_VERSION = 47026;

async function openTaxSettings(
  page: import("@playwright/test").Page,
  options: {
    role?: "owner" | "admin" | "member";
    moneyRecords?: boolean;
    rejectInvoiceVersion?: boolean;
  } = {},
) {
  await page.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
  const role = options.role ?? "owner";
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceWorkspaceRole: role,
    relayRequiresMembership: true,
    relayRole: role,
    ...(options.moneyRecords === undefined
      ? {}
      : { referenceWorkspaceMoneyRecords: options.moneyRecords }),
    ...(options.rejectInvoiceVersion
      ? {
          referenceWorkspaceRejectBusinessRecordEvents: [
            {
              kind: KIND_INVOICE_VERSION,
              reason: "temporary relay failure",
            },
          ],
        }
      : {}),
  });
  await page.goto(
    `/#/money/tax/settings?invoiceId=${encodeURIComponent(DRAFT_INVOICE_ID)}`,
  );
}

test("invoice tax stays optional until configured and saved tax appears in preview", async ({
  page,
}) => {
  await openTaxSettings(page);

  await expect(page.getByTestId("money-tax-settings-page")).toBeVisible();
  await expect(page.getByLabel("Tax rate, percent")).toHaveValue("0");
  await expect(page.getByText("No tax by default")).toBeVisible();
  await expect(page.getByText("Not applied until configured")).toBeVisible();
  await page.getByRole("button", { name: "Preview invoice" }).click();
  await expect(page.getByTestId("money-tax-preview-page")).toContainText(
    "Tax · Not configured",
  );

  await page.goto(
    `/#/money/tax/settings?invoiceId=${encodeURIComponent(DRAFT_INVOICE_ID)}`,
  );
  await page.getByLabel("Seller tax number, optional").fill("ZA-SELLER-01");
  await page.getByLabel("Customer tax number, optional").fill("ZA-CUSTOMER-02");
  await page.getByLabel("Tax label, optional").fill("VAT");
  await page.getByLabel("Tax rate, percent").fill("15");
  await page.getByRole("button", { name: "Preview invoice" }).click();

  const preview = page.getByTestId("money-tax-preview-page");
  await expect(preview).toContainText("VAT · 15%");
  await expect(preview).toContainText("ZA-SELLER-01");
  await expect(preview).toContainText("ZA-CUSTOMER-02");
  await expect(preview).toContainText(/9\s?775/);
  await expect(preview).toContainText("Draft · Not sent");
  await page.getByRole("button", { name: "Edit invoice" }).click();
  await expect(page.getByTestId("money-tax-saved-page")).toContainText(
    "Draft saved",
  );
  await expect(page.getByLabel("Tax rate, percent")).toHaveValue("15");
});

test("rejected tax save keeps the entered tax fields on the failed route", async ({
  page,
}) => {
  await openTaxSettings(page, { rejectInvoiceVersion: true });
  await page.getByLabel("Seller tax number, optional").fill("ZA-RETRY-11");
  await page.getByLabel("Tax label, optional").fill("VAT");
  await page.getByLabel("Tax rate, percent").fill("15");
  await page.getByRole("button", { name: "Preview invoice" }).click();

  const failed = page.getByTestId("money-tax-failed-page");
  await expect(failed.getByRole("alert")).toContainText(
    "Invoice was not saved",
  );
  await expect(page.getByLabel("Seller tax number, optional")).toHaveValue(
    "ZA-RETRY-11",
  );
  await expect(page.getByLabel("Tax label, optional")).toHaveValue("VAT");
  await expect(page.getByLabel("Tax rate, percent")).toHaveValue("15");
});

test("members can read the invoice but cannot open tax settings", async ({
  page,
}) => {
  await openTaxSettings(page, { role: "member" });
  await expect(page.getByTestId("money-tax-denied-page")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview invoice" }),
  ).toHaveCount(0);
});

test("cost and profitability figures reflect only available invoice sources", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
  await installMockBridge(page, { referenceWorkspace: true });
  await page.goto("/#/money/costs/partial");
  const costs = page.getByTestId("money-costs-page");
  await expect(costs).toContainText("Unavailable");
  await expect(costs).toContainText("No cost records are available.");
  await expect(costs.locator(".money-source-metric").nth(1)).not.toContainText(
    /R\s*\d/,
  );
  await expect(costs.locator(".money-source-metric").nth(2)).not.toContainText(
    /R\s*\d/,
  );

  await page.goto("/#/money/profitability/recovered");
  const profitability = page.getByTestId("money-profitability-page");
  await expect(profitability).toContainText("Partial data");
  await expect(profitability).toContainText(/R\s*14\s?200/);
  await expect(profitability).toContainText("Known costs");
  await expect(profitability).toContainText("Profit");
  await expect(profitability).toContainText("Unavailable");
});

test("missing invoice records leave profitability unavailable without a zero claim", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceWorkspaceMoneyRecords: false,
  });
  await page.goto("/#/money/profitability/unavailable");
  const unavailable = page.getByTestId("money-profitability-page");
  await expect(unavailable).toContainText("Revenue");
  await expect(unavailable).toContainText(
    "No issued invoice records are available",
  );
  await expect(unavailable).toContainText("Profitability unavailable");
  await expect(unavailable).not.toContainText(/R\s*\d/);
});
