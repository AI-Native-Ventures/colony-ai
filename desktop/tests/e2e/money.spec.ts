import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const CEDAR_PARTIAL_INVOICE_ID = "3e3a7000-0000-4000-8000-000000000027";
const NORTHLINE_DRAFT_INVOICE_ID = "3e3a7000-0000-4000-8000-000000000029";

async function openMoney(
  page: import("@playwright/test").Page,
  route: string,
  channelRole: "owner" | "admin" | "member" = "owner",
  relayRole: "owner" | "admin" | "member" = channelRole,
  moneyRecords = true,
) {
  await page.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceWorkspaceRole: channelRole,
    relayRequiresMembership: true,
    relayRole,
    referenceWorkspaceMoneyRecords: moneyRecords,
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
  // Opens on every month with records: the header, two month headings, and
  // the six invoices.
  await expect(rows).toHaveCount(9);
  await page.getByLabel("Money period").selectOption("2026-09");
  await expect(rows).toHaveCount(6);
  await expect(page.getByRole("table")).toContainText("The Olive House");
  await expect(page.getByRole("table")).toContainText("Cedar Café");
  await page.getByLabel("Money period").selectOption("2026-08");
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole("table")).toContainText("August retainer");

  await page.goto("/#/money/revenue");
  await page
    .locator(`a[href="#/money/revenue/${CEDAR_PARTIAL_INVOICE_ID}"]`)
    .click();
  await expect(page.getByTestId("money-invoice-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: "All revenue" })).toBeVisible();
});

test("empty invoice list offers only the available filters and recovery path", async ({
  page,
}) => {
  await openMoney(page, "/#/money/invoices", "owner", "owner", false);

  const invoices = page.getByTestId("money-invoice-list");
  await expect(invoices).toContainText("No invoices for this selection");
  await expect(invoices).toContainText(
    "Change the period or client to find other invoices.",
  );
  await expect(
    invoices.getByRole("button", { name: /New invoice/i }),
  ).toHaveCount(0);
});

test("incomplete draft identifies missing details and cannot be issued", async ({
  page,
}) => {
  await openMoney(page, `/#/money/invoice/${NORTHLINE_DRAFT_INVOICE_ID}`);

  await page.getByRole("button", { name: "Review & issue" }).click();
  const dialog = page.getByRole("dialog", { name: /Issue/ });
  await expect(dialog.getByRole("alert")).toHaveText(
    "Details missing before issue: Due date.",
  );
  await expect(
    dialog.getByRole("button", { name: "Issue invoice" }),
  ).toBeDisabled();
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
  await expect(page.getByLabel("Money client")).toHaveCount(0);
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
});

const NORTHLINE_CLIENT_ID = "1e1a7000-0000-4000-8000-000000000013";

test("an owner creates a draft invoice from the invoices page", async ({
  page,
}) => {
  await openMoney(page, "/#/money/invoices");

  await page.getByRole("button", { name: "New invoice" }).click();
  const dialog = page.getByRole("dialog", { name: "New invoice" });
  await expect(dialog).toContainText(
    "New invoices start as drafts. Review and issue separately.",
  );
  const create = dialog.getByRole("button", { name: "Create invoice" });
  await dialog.getByLabel("Client").selectOption(NORTHLINE_CLIENT_ID);
  await dialog.getByLabel("Service / description").fill("Website refresh");
  await dialog.getByLabel("Quantity").fill("2");
  await dialog.getByLabel("Unit amount · ZAR").fill("1250");
  await dialog.getByLabel("Due date").fill("2026-10-15");
  await expect(dialog).toContainText(/R\s*2\s*500/);
  await create.click();

  await expect(page).toHaveURL(/#\/money\/invoice\/[0-9a-f-]{36}$/);
  const detail = page.getByTestId("money-invoice-detail");
  await expect(detail).toContainText("Website refresh");
  await expect(detail).toContainText("Northline Interiors");
  await expect(detail).toContainText(/R\s*2\s*500/);
  await expect(detail).toContainText("Draft");
  await expect(
    page.getByRole("button", { name: "Review & issue" }),
  ).toBeVisible();
});

test("a draft invoice is created from the client page for that client", async ({
  page,
}) => {
  await openMoney(page, `/#/clients/${NORTHLINE_CLIENT_ID}`);

  await page.getByRole("button", { name: "New invoice" }).click();
  const dialog = page.getByRole("dialog", { name: "New invoice" });
  await expect(dialog.getByLabel("Client")).toHaveCount(0);
  await expect(dialog).toContainText("Northline Interiors");
  await dialog.getByLabel("Service / description").fill("Onboarding workshop");
  await dialog.getByLabel("Unit amount · ZAR").fill("4000");
  await dialog.getByRole("button", { name: "Create invoice" }).click();

  await expect(page).toHaveURL(/#\/money\/invoice\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("money-invoice-detail")).toContainText(
    "Onboarding workshop",
  );
  await page.goto("/#/money/invoices");
  await expect(page.getByTestId("money-invoice-list")).toContainText(
    "Onboarding workshop",
  );
});

test("a refused new invoice keeps what was typed and says why", async ({
  page,
}) => {
  await openMoney(page, "/#/money/invoices");
  await page.getByRole("button", { name: "New invoice" }).click();
  const dialog = page.getByRole("dialog", { name: "New invoice" });
  await dialog.getByLabel("Client").selectOption(NORTHLINE_CLIENT_ID);
  await dialog.getByLabel("Service / description").fill("Retry me");
  await dialog.getByLabel("Unit amount · ZAR").fill("900");
  await page.evaluate(() => {
    (
      window as Window & {
        __BUZZ_E2E_REJECT_BUSINESS_RECORD_EVENTS__?: Array<{
          kind: number;
          reason: string;
        }>;
      }
    ).__BUZZ_E2E_REJECT_BUSINESS_RECORD_EVENTS__ = [
      { kind: 47026, reason: "client channel is not available" },
    ];
  });
  await dialog.getByRole("button", { name: "Create invoice" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "client channel is not available",
  );
  await expect(dialog.getByLabel("Service / description")).toHaveValue(
    "Retry me",
  );
  await expect(dialog.getByLabel("Unit amount · ZAR")).toHaveValue("900");
});

test("a member cannot create invoices", async ({ page }) => {
  await openMoney(page, "/#/money/invoices", "member");
  await expect(
    page.getByRole("heading", { name: "Invoices", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New invoice" })).toHaveCount(
    0,
  );
  await page.goto(`/#/clients/${NORTHLINE_CLIENT_ID}`);
  await expect(
    page.getByRole("heading", { name: "Northline Interiors" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New invoice" })).toHaveCount(
    0,
  );
});
