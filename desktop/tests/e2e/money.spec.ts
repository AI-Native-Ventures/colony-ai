import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const CEDAR_PARTIAL_INVOICE_ID = "3e3a7000-0000-4000-8000-000000000027";

async function openMoney(
  page: import("@playwright/test").Page,
  route: string,
  channelRole: "owner" | "admin" | "member" = "owner",
  relayRole: "owner" | "admin" | "member" = channelRole,
) {
  await page.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceWorkspaceRole: channelRole,
    relayRequiresMembership: true,
    relayRole,
  });
  await page.goto(route);
}

test("money overview and invoice list derive scoped totals from reference records", async ({
  page,
}) => {
  await openMoney(page, "/#/money");

  const overview = page.getByTestId("money-overview");
  await expect(overview).toBeVisible();
  await expect(overview).toContainText("Invoiced revenue");
  await expect(overview).toContainText(/R\s*14\s*200/);
  await expect(overview).toContainText(/R\s*8\s*000/);
  await expect(overview).toContainText(/R\s*6\s*200/);
  await expect(overview).toContainText("Cedar Café");

  await page.goto("/#/money/invoices");
  const rows = page.getByTestId("money-invoice-list").getByRole("row");
  await expect(rows).toHaveCount(5);
  await expect(page.getByRole("table")).toContainText("The Olive House");
  await expect(page.getByRole("table")).toContainText("Cedar Café");
  await page.getByLabel("Money period").selectOption("2026-08");
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("table")).toContainText("August retainer");

  await page.goto("/#/money/revenue");
  await page
    .locator(`a[href="#/money/revenue/${CEDAR_PARTIAL_INVOICE_ID}"]`)
    .click();
  await expect(page.getByTestId("money-invoice-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: "All revenue" })).toBeVisible();
});

test("invoice detail records payment evidence and keeps typed values after a rejected save", async ({
  page,
}) => {
  await openMoney(page, `/#/money/invoice/${CEDAR_PARTIAL_INVOICE_ID}`);

  const detail = page.getByTestId("money-invoice-detail");
  await expect(detail).toContainText(/R\s*3\s*000/);
  await expect(detail).toContainText("Manual payment");
  await page.getByRole("button", { name: "Record payment" }).click();
  const dialog = page.getByRole("dialog", { name: /Record payment/ });
  await dialog.getByLabel("Amount received · ZAR").fill("2000");
  await dialog
    .getByLabel("Payment reference / evidence")
    .fill("receipt:retry-1");
  await page.evaluate(() => {
    (
      window as Window & {
        __BUZZ_E2E_REJECT_BUSINESS_RECORD_EVENTS__?: Array<{
          kind: number;
          reason: string;
        }>;
      }
    ).__BUZZ_E2E_REJECT_BUSINESS_RECORD_EVENTS__ = [
      {
        kind: 47027,
        reason: "invoice changed before payment evidence was recorded",
      },
    ];
  });
  await dialog.getByRole("button", { name: "Record payment" }).click();

  await expect(dialog.getByRole("alert")).toContainText("invoice changed");
  await expect(dialog.getByLabel("Amount received · ZAR")).toHaveValue("2000");
  await expect(dialog.getByLabel("Payment reference / evidence")).toHaveValue(
    "receipt:retry-1",
  );
  await expect(dialog).toContainText("No money moves in Colony.");
});

test("invoice detail opens a credit note scoped to the current invoice", async ({
  page,
}) => {
  await openMoney(page, `/#/money/invoice/${CEDAR_PARTIAL_INVOICE_ID}`);

  await page.getByRole("button", { name: "Create credit note" }).click();
  const dialog = page.getByRole("dialog", { name: "Create credit note" });
  await expect(dialog.getByLabel("Invoice")).toHaveValue(
    CEDAR_PARTIAL_INVOICE_ID,
  );
  await expect(dialog.getByLabel("Credit amount · ZAR")).toBeVisible();
  await expect(dialog.getByLabel("Evidence reference")).toBeVisible();
});

test("client members can read invoice records without payment controls", async ({
  page,
}) => {
  await openMoney(
    page,
    `/#/money/invoice/${CEDAR_PARTIAL_INVOICE_ID}`,
    "member",
  );

  await expect(page.getByTestId("money-invoice-detail")).toContainText(
    "Read only",
  );
  await expect(
    page.getByRole("button", { name: "Record payment" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Prepare reminder" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Money client")).toHaveCount(0);
  await page.goto("/#/money/adjustments");
  await expect(
    page.getByRole("heading", { name: "Credit notes & refunds" }),
  ).toBeVisible();
});

test("client channel ownership does not grant community money write authority", async ({
  page,
}) => {
  await openMoney(
    page,
    `/#/money/invoice/${CEDAR_PARTIAL_INVOICE_ID}`,
    "owner",
    "member",
  );

  await expect(page.getByTestId("money-invoice-detail")).toContainText(
    "Read only",
  );
  await expect(
    page.getByRole("button", { name: "Record payment" }),
  ).toHaveCount(0);
  await page.goto("/#/money/adjustments");
  await expect(
    page.getByRole("button", { name: "Create credit note" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record refund" })).toHaveCount(
    0,
  );
});

test("refund recording requires real client credit evidence", async ({
  page,
}) => {
  await openMoney(page, "/#/money/adjustments");

  await page.getByRole("button", { name: "Record refund" }).click();
  const dialog = page.getByRole("dialog", { name: "No refundable balance" });
  await expect(dialog).toContainText(
    "A refund cannot exceed the client credit balance.",
  );
  await dialog.getByRole("button", { name: "Create credit note" }).click();
  const creditDialog = page.getByRole("dialog", { name: "Create credit note" });
  await expect(creditDialog).toBeVisible();
  await expect(
    creditDialog.getByRole("button", { name: "Create credit note" }),
  ).toBeEnabled();
});
