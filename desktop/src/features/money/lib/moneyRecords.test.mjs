import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMoneyTotals,
  formatMoneyMinor,
  invoiceTaxTotalMinor,
  parseMoneyInput,
  parseMoneyRecords,
  totalInvoiceMinor,
} from "./moneyRecords.ts";
import {
  KIND_INVOICE_HEAD,
  KIND_PAYMENT,
  KIND_MONEY_ADJUSTMENT,
} from "@/shared/constants/kinds.ts";

const CLIENT_ID = "1e1a7000-0000-4000-8000-000000000012";
const OTHER_CLIENT_ID = "1e1a7000-0000-4000-8000-000000000013";
const INVOICE_ID = "2e2a7000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "2e2a7000-0000-4000-8000-000000000002";
const PAYMENT_ID = "2e2a7000-0000-4000-8000-000000000003";
const ADJUSTMENT_ID = "2e2a7000-0000-4000-8000-000000000004";
const EVENT_ID = "a".repeat(64);
const EVENT_ID_2 = "b".repeat(64);

function recordEvent(kind, content, dTag, createdAt, index) {
  return {
    id: index.toString(16).padStart(64, "0"),
    pubkey: "c".repeat(64),
    created_at: createdAt,
    kind,
    tags: [
      ["h", CLIENT_ID],
      ["d", dTag],
    ],
    content: JSON.stringify(content),
    sig: "d".repeat(128),
  };
}

const invoiceHead = {
  schemaVersion: 1,
  clientId: CLIENT_ID,
  invoiceId: INVOICE_ID,
  proposalId: PROPOSAL_ID,
  proposalVersionEventId: EVENT_ID,
  currency: "ZAR",
  lines: [
    {
      serviceId: null,
      description: "Monthly creative services",
      quantityHundredths: 100,
      unitAmountMinor: 10_000,
    },
  ],
  totalMinor: 10_000,
  creditedMinor: 1_000,
  writtenOffMinor: 0,
  collectedMinor: 2_500,
  outstandingMinor: 6_000,
  paymentEvidenceCount: 1,
  version: 2,
  currentVersionEventId: EVENT_ID_2,
  status: "issued",
  dueAt: 1_790_000_000,
  issuedAt: Date.parse("2026-09-01T00:00:00Z") / 1_000,
  sourceEventId: EVENT_ID_2,
};

test("money totals derive from scoped invoice, payment, and adjustment records", () => {
  const events = [
    recordEvent(
      KIND_INVOICE_HEAD,
      invoiceHead,
      `client:${CLIENT_ID}:invoice:${INVOICE_ID}`,
      invoiceHead.issuedAt,
      1,
    ),
    recordEvent(
      KIND_PAYMENT,
      {
        schemaVersion: 1,
        clientId: CLIENT_ID,
        invoiceId: INVOICE_ID,
        paymentId: PAYMENT_ID,
        provider: "manual",
        providerReference: null,
        amountMinor: 3_000,
        currency: "ZAR",
        occurredAt: Date.parse("2026-09-10T00:00:00Z") / 1_000,
        evidenceRef: "receipt:local-1",
        expectedInvoiceHeadEventId: EVENT_ID,
      },
      `client:${CLIENT_ID}:payment:${PAYMENT_ID}`,
      Date.parse("2026-09-10T00:00:00Z") / 1_000,
      2,
    ),
    recordEvent(
      KIND_MONEY_ADJUSTMENT,
      {
        schemaVersion: 1,
        clientId: CLIENT_ID,
        invoiceId: INVOICE_ID,
        adjustmentId: ADJUSTMENT_ID,
        adjustmentType: "credit_note",
        amountMinor: 1_000,
        currency: "ZAR",
        occurredAt: Date.parse("2026-09-15T00:00:00Z") / 1_000,
        reason: "Reduced scope",
        evidenceRef: "credit-note:local-1",
        expectedInvoiceHeadEventId: EVENT_ID_2,
      },
      `client:${CLIENT_ID}:money-adjustment:${ADJUSTMENT_ID}`,
      Date.parse("2026-09-15T00:00:00Z") / 1_000,
      3,
    ),
    recordEvent(
      KIND_MONEY_ADJUSTMENT,
      {
        schemaVersion: 1,
        clientId: CLIENT_ID,
        invoiceId: INVOICE_ID,
        adjustmentId: "2e2a7000-0000-4000-8000-000000000005",
        adjustmentType: "refund",
        amountMinor: 500,
        currency: "ZAR",
        occurredAt: Date.parse("2026-09-18T00:00:00Z") / 1_000,
        reason: "Refund completed outside Colony",
        evidenceRef: "refund:local-1",
        expectedInvoiceHeadEventId: EVENT_ID_2,
      },
      `client:${CLIENT_ID}:money-adjustment:2e2a7000-0000-4000-8000-000000000005`,
      Date.parse("2026-09-18T00:00:00Z") / 1_000,
      4,
    ),
  ];
  const records = parseMoneyRecords(events, [CLIENT_ID]);
  const totals = deriveMoneyTotals(
    records,
    "2026-09",
    CLIENT_ID,
    Date.parse("2026-09-24T00:00:00Z") / 1_000,
  );

  assert.equal(totals.invoicedMinorByCurrency.ZAR, 9_000);
  assert.equal(totals.collectedMinorByCurrency.ZAR, 2_500);
  assert.equal(totals.outstandingMinorByCurrency.ZAR, 6_000);
  assert.equal(totals.overdueMinorByCurrency.ZAR, 6_000);
  assert.deepEqual(records.invoiceHeads[0].value.taxLines, []);
  assert.equal(records.invoiceHeads[0].value.sellerTaxNumber, null);
  assert.equal(records.invoiceHeads[0].value.customerTaxNumber, null);
});

test("optional tax rounds half up per invoice line with integer minor units", () => {
  const lines = [
    {
      serviceId: null,
      description: "First one-minor line",
      quantityHundredths: 100,
      unitAmountMinor: 1,
    },
    {
      serviceId: null,
      description: "Second one-minor line",
      quantityHundredths: 100,
      unitAmountMinor: 1,
    },
  ];
  const taxLines = [{ label: "Sample only", rateBasisPoints: 5_000 }];
  assert.equal(invoiceTaxTotalMinor(lines, taxLines), 2);
  assert.equal(totalInvoiceMinor(lines, taxLines), 4);
  assert.equal(invoiceTaxTotalMinor(lines, []), 0);
  assert.equal(
    invoiceTaxTotalMinor(lines.slice(0, 1), [
      { label: null, rateBasisPoints: 4_999 },
    ]),
    0,
  );
});

test("money parsing denies records outside the selected client scope", () => {
  const event = recordEvent(
    KIND_INVOICE_HEAD,
    { ...invoiceHead, clientId: OTHER_CLIENT_ID },
    `client:${OTHER_CLIENT_ID}:invoice:${INVOICE_ID}`,
    invoiceHead.issuedAt,
    5,
  );
  event.tags[0][1] = OTHER_CLIENT_ID;

  assert.throws(
    () => parseMoneyRecords([event], [CLIENT_ID]),
    /another client/,
  );
});

test("money parsing accepts optional tax snapshots on current invoice heads", () => {
  const taxableHead = {
    ...invoiceHead,
    taxLines: [{ label: "Sample only", rateBasisPoints: 850 }],
    sellerTaxNumber: "SELLER-TEST-REG",
    customerTaxNumber: "CUSTOMER-TEST-REG",
  };
  const records = parseMoneyRecords(
    [
      recordEvent(
        KIND_INVOICE_HEAD,
        taxableHead,
        `client:${CLIENT_ID}:invoice:${INVOICE_ID}`,
        invoiceHead.issuedAt,
        6,
      ),
    ],
    [CLIENT_ID],
  );
  assert.deepEqual(
    records.invoiceHeads[0].value.taxLines,
    taxableHead.taxLines,
  );
  assert.equal(
    records.invoiceHeads[0].value.sellerTaxNumber,
    "SELLER-TEST-REG",
  );
  assert.equal(
    records.invoiceHeads[0].value.customerTaxNumber,
    "CUSTOMER-TEST-REG",
  );
});

test("currency input and display retain integer minor-unit precision", () => {
  assert.equal(parseMoneyInput("65.00", "ZAR"), 6_500);
  assert.equal(parseMoneyInput("0", "ZAR", true), 0);
  assert.throws(() => parseMoneyInput("1.239", "ZAR"), /decimal places/);
  assert.throws(() => parseMoneyInput("0", "ZAR"), /positive whole number/);
  assert.equal(formatMoneyMinor(6_500, "ZAR").replace(/\s/g, ""), "R65");
  assert.equal(formatMoneyMinor(6_501, "ZAR").replace(/\s/g, ""), "R65,01");
});
