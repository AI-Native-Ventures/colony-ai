import * as React from "react";

import type { EventRecord } from "@/features/clients/lib/businessRecords";
import { BUSINESS_RECORD_SCHEMA_VERSION } from "@/features/clients/lib/businessRecords";
import {
  useMoneyRecordsQuery,
  useSubmitBusinessRecordMutation,
} from "@/features/clients/useBusinessRecords";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  W10Button,
  W10Error,
  W10Loading,
  W10Page,
} from "@/features/discovery/BusinessCommon";
import { KIND_INVOICE_VERSION } from "@/shared/constants/kinds";
import {
  formatMoneyMinor,
  invoiceTaxTotalMinor,
  moneyInvoiceVersionDTag,
  moneyRecordTemplate,
  totalInvoiceMinor,
  type InvoiceTaxLine,
  type MoneyInvoiceHead,
  type MoneyInvoiceVersion,
} from "./lib/moneyRecords";
import {
  displayError,
  formatTimestamp,
  lineTotalMinor,
  navigateMoney,
  totalLinesMinor,
} from "./moneyUtils";
import "@/features/discovery/business-records.css";
import "./money.css";
import "./money-tax.css";

export type MoneyTaxRouteState =
  | "invoice"
  | "settings"
  | "preview"
  | "saved"
  | "failed"
  | "denied";

const MONEY_TAX_ROUTE_STATES: readonly string[] = [
  "invoice",
  "settings",
  "preview",
  "saved",
  "failed",
  "denied",
];

export function MoneyTaxRouteScreen({
  invoiceId,
  state,
}: {
  invoiceId?: string;
  state: MoneyTaxRouteState;
}) {
  const query = useMoneyRecordsQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const directory = query.directoryQuery;

  if (directory.isPending || query.isPending || membershipQuery.isPending) {
    return <W10Loading label="Loading invoice tax details" />;
  }
  if (directory.isError) {
    return (
      <W10Error
        message={displayError(directory.error)}
        onRetry={() => void directory.refetch()}
        retrying={directory.isFetching}
      />
    );
  }
  if (query.isError) {
    return (
      <W10Error
        message={displayError(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (membershipQuery.isError) {
    return (
      <W10Error
        message={displayError(membershipQuery.error)}
        onRetry={() => void membershipQuery.refetch()}
        retrying={membershipQuery.isFetching}
      />
    );
  }

  const records = query.data;
  const normalizedInvoiceId = invoiceId?.toLowerCase();
  const invoice = normalizedInvoiceId
    ? (records?.invoiceHeads.find(
        ({ value }) => value.invoiceId === normalizedInvoiceId,
      ) ?? null)
    : null;
  if (!records || !invoice) {
    return (
      <W10Page wide testId="money-tax-unavailable-page">
        <header className="w10-page-heading money-page-heading">
          <div>
            <p className="money-tax-breadcrumb">Company / Invoice tax</p>
            <h1>Invoice unavailable</h1>
          </div>
          <W10Button
            onClick={() => navigateMoney("/money/invoices")}
            variant="secondary"
          >
            All invoices
          </W10Button>
        </header>
        <p className="money-note">
          This invoice is not available in your client records.
        </p>
      </W10Page>
    );
  }

  const role = membershipQuery.data?.role;
  const canManage = role === "owner" || role === "admin";
  const clientNames = new Map(
    (directory.data ?? []).map(({ value }) => [
      value.clientId,
      value.displayName,
    ]),
  );

  if (!canManage && state !== "preview") {
    return <TaxDenied invoice={invoice} />;
  }
  if (!MONEY_TAX_ROUTE_STATES.includes(state)) {
    return (
      <W10Page wide testId="money-tax-unavailable-page">
        <h1>Invoice tax unavailable</h1>
        <p className="money-note">This invoice tax view is not available.</p>
      </W10Page>
    );
  }
  if (state === "preview") {
    return (
      <TaxPreview
        clientName={
          clientNames.get(invoice.value.clientId) ?? invoice.value.clientId
        }
        invoice={invoice}
      />
    );
  }

  return (
    <TaxEditor
      canManage={canManage}
      clientName={
        clientNames.get(invoice.value.clientId) ?? invoice.value.clientId
      }
      invoice={invoice}
      state={state}
    />
  );
}

function TaxDenied({ invoice }: { invoice: EventRecord<MoneyInvoiceHead> }) {
  return (
    <W10Page wide testId="money-tax-denied-page">
      <header className="w10-page-heading money-page-heading">
        <div>
          <p className="money-tax-breadcrumb">
            Company / Invoice {invoice.value.invoiceId}
          </p>
          <h1>Invoice settings need permission</h1>
        </div>
      </header>
      <section className="money-tax-state-card">
        <p>An owner or administrator can configure tax.</p>
        <p>You can still view the invoice in your client records.</p>
        <W10Button
          onClick={() =>
            navigateMoney(`/money/invoice/${invoice.value.invoiceId}`)
          }
          variant="primary"
        >
          View invoice
        </W10Button>
      </section>
    </W10Page>
  );
}

function TaxEditor({
  canManage,
  clientName,
  invoice,
  state,
}: {
  canManage: boolean;
  clientName: string;
  invoice: EventRecord<MoneyInvoiceHead>;
  state: MoneyTaxRouteState;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const head = invoice.value;
  const [sellerTaxNumber, setSellerTaxNumber] = React.useState(
    head.sellerTaxNumber ?? "",
  );
  const [customerTaxNumber, setCustomerTaxNumber] = React.useState(
    head.customerTaxNumber ?? "",
  );
  const [taxLabel, setTaxLabel] = React.useState(head.taxLines[0]?.label ?? "");
  const [taxRate, setTaxRate] = React.useState(
    formatTaxRateInput(head.taxLines[0]?.rateBasisPoints ?? 0),
  );
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [inputError, setInputError] = React.useState("");

  React.useEffect(() => {
    setSellerTaxNumber(head.sellerTaxNumber ?? "");
    setCustomerTaxNumber(head.customerTaxNumber ?? "");
    setTaxLabel(head.taxLines[0]?.label ?? "");
    setTaxRate(formatTaxRateInput(head.taxLines[0]?.rateBasisPoints ?? 0));
    setSaveFailed(false);
    setInputError("");
  }, [head.customerTaxNumber, head.sellerTaxNumber, head.taxLines]);

  const parsedTaxRate = React.useMemo(() => {
    try {
      return { value: parseTaxRate(taxRate), error: "" };
    } catch (error) {
      return { value: null, error: displayError(error) };
    }
  }, [taxRate]);
  const taxLines = React.useMemo(() => {
    if (parsedTaxRate.value === null) return head.taxLines;
    const additional = head.taxLines.slice(1);
    if (parsedTaxRate.value === 0) return additional;
    return [
      {
        label: taxLabel.trim() || null,
        rateBasisPoints: parsedTaxRate.value,
      },
      ...additional,
    ];
  }, [head.taxLines, parsedTaxRate.value, taxLabel]);
  const subtotal = totalLinesMinor(head.lines);
  const taxAmount =
    parsedTaxRate.value === null
      ? null
      : invoiceTaxTotalMinor(head.lines, taxLines);
  const total =
    taxAmount === null ? null : totalInvoiceMinor(head.lines, taxLines);
  const isDraft = head.status === "draft";
  const editable = canManage && isDraft;
  const showSaved = state === "saved" && isDraft;
  const showFailed = state === "failed" && saveFailed;

  async function previewInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInputError("");
    if (!editable) return;
    if (parsedTaxRate.value === null) {
      setInputError("Enter a tax rate with up to two decimal places.");
      return;
    }
    const seller = sellerTaxNumber.trim() || null;
    const customer = customerTaxNumber.trim() || null;
    if (
      (seller && new TextEncoder().encode(seller).length > 128) ||
      (customer && new TextEncoder().encode(customer).length > 128) ||
      new TextEncoder().encode(taxLabel.trim()).length > 200
    ) {
      setInputError("Tax details are longer than the supported limit.");
      return;
    }
    const nextTotal = totalInvoiceMinor(head.lines, taxLines);
    const value: MoneyInvoiceVersion = {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: head.clientId,
      invoiceId: head.invoiceId,
      version: head.version + 1,
      previousVersionEventId: head.currentVersionEventId,
      proposalVersionEventId: head.proposalVersionEventId,
      expectedHeadEventId: invoice.event.id,
      action: "draft_edit",
      currency: head.currency,
      lines: head.lines,
      taxLines,
      sellerTaxNumber: seller,
      customerTaxNumber: customer,
      totalMinor: nextTotal,
      status: "draft",
      dueAt: head.dueAt,
      voidReason: null,
    };
    const unchanged =
      nextTotal === head.totalMinor &&
      taxLinesEqual(taxLines, head.taxLines) &&
      seller === head.sellerTaxNumber &&
      customer === head.customerTaxNumber;
    if (!unchanged) {
      try {
        await submit.mutateAsync(
          moneyRecordTemplate(
            KIND_INVOICE_VERSION,
            value,
            moneyInvoiceVersionDTag(
              value.clientId,
              value.invoiceId,
              value.version,
            ),
          ),
        );
      } catch {
        setSaveFailed(true);
        navigateMoney(
          `/money/tax/failed?invoiceId=${encodeURIComponent(head.invoiceId)}`,
        );
        return;
      }
    }
    navigateMoney(
      `/money/tax/preview?invoiceId=${encodeURIComponent(head.invoiceId)}`,
    );
  }

  const taxConfigured = taxLines.some((line) => line.rateBasisPoints > 0);
  const routeTitle =
    state === "settings" ? "Invoice tax settings" : `Invoice ${head.invoiceId}`;
  const panelTitle =
    state === "settings" ? "Optional tax details" : "Client invoice";
  const taxTotals =
    taxAmount === null ? null : formatMoneyMinor(taxAmount, head.currency);

  return (
    <W10Page wide testId={`money-tax-${state}-page`}>
      <header className="w10-page-heading money-page-heading money-tax-heading">
        <div>
          <p className="money-tax-breadcrumb">
            Company /{" "}
            {state === "settings"
              ? "Invoice tax settings"
              : `Invoice ${head.invoiceId}`}
          </p>
          <h1>{routeTitle}</h1>
        </div>
        <W10Button
          onClick={() => navigateMoney(`/money/invoice/${head.invoiceId}`)}
          variant="secondary"
        >
          Back to invoice
        </W10Button>
      </header>
      <div className="money-tax-layout">
        <section className="money-tax-panel">
          <h2>{panelTitle}</h2>
          <form
            className="money-tax-form"
            onSubmit={(event) => void previewInvoice(event)}
          >
            {showSaved ? (
              <div
                className="money-tax-banner money-tax-banner-saved"
                role="status"
              >
                <strong>Draft saved</strong>
                <span>
                  No invoice was sent. Review the totals before issuing.
                </span>
              </div>
            ) : null}
            {showFailed ? (
              <div
                className="money-tax-banner money-tax-banner-failed"
                role="alert"
              >
                <strong>Invoice was not saved</strong>
                <span>The draft, tax fields and line items are kept.</span>
              </div>
            ) : null}
            <label className="money-tax-field">
              <span>Customer</span>
              <input aria-label="Customer" readOnly value={clientName} />
            </label>
            {head.lines.length === 1 ? (
              <label className="money-tax-field">
                <span>Line amount, {head.currency}</span>
                <input
                  aria-label={`Line amount, ${head.currency}`}
                  readOnly
                  value={formatMoneyMinor(
                    lineTotalMinor(head.lines[0]),
                    head.currency,
                  )}
                />
              </label>
            ) : (
              <div className="money-tax-field">
                <span>Invoice lines</span>
                <div className="money-tax-line-list">
                  {head.lines.map((line) => (
                    <div className="money-tax-line" key={invoiceLineKey(line)}>
                      <span>{line.description}</span>
                      <strong>
                        {formatMoneyMinor(lineTotalMinor(line), head.currency)}
                      </strong>
                    </div>
                  ))}
                  <div className="money-tax-line money-tax-line-subtotal">
                    <span>Subtotal</span>
                    <strong>{formatMoneyMinor(subtotal, head.currency)}</strong>
                  </div>
                </div>
              </div>
            )}
            <label className="money-tax-field">
              <span>Seller tax number, optional</span>
              <input
                aria-label="Seller tax number, optional"
                autoComplete="off"
                disabled={!editable}
                maxLength={128}
                onChange={(event) =>
                  setSellerTaxNumber(event.currentTarget.value)
                }
                value={sellerTaxNumber}
              />
            </label>
            <label className="money-tax-field">
              <span>Customer tax number, optional</span>
              <input
                aria-label="Customer tax number, optional"
                autoComplete="off"
                disabled={!editable}
                maxLength={128}
                onChange={(event) =>
                  setCustomerTaxNumber(event.currentTarget.value)
                }
                value={customerTaxNumber}
              />
            </label>
            <div className="money-tax-fields-inline">
              <label className="money-tax-field">
                <span>Tax label, optional</span>
                <input
                  aria-label="Tax label, optional"
                  autoComplete="off"
                  disabled={!editable}
                  maxLength={200}
                  onChange={(event) => setTaxLabel(event.currentTarget.value)}
                  value={taxLabel}
                />
              </label>
              <label className="money-tax-field">
                <span>Tax rate, %</span>
                <input
                  aria-label="Tax rate, percent"
                  autoComplete="off"
                  disabled={!editable}
                  inputMode="decimal"
                  onChange={(event) => setTaxRate(event.currentTarget.value)}
                  value={taxRate}
                />
              </label>
            </div>
            <div className="money-tax-note">
              <strong>No tax by default</strong>
              <span>
                Set a tax label and rate only when the business has configured
                them. The invoice preview shows the resulting summary.
              </span>
            </div>
            {inputError || parsedTaxRate.error ? (
              <p className="money-form-error" role="alert">
                {inputError ||
                  "Enter a tax rate with up to two decimal places."}
              </p>
            ) : null}
            <div className="money-tax-actions">
              <W10Button
                disabled={
                  !editable || submit.isPending || parsedTaxRate.value === null
                }
                type="submit"
                variant="primary"
              >
                Preview invoice
              </W10Button>
              <W10Button
                onClick={() =>
                  navigateMoney(`/money/invoice/${head.invoiceId}`)
                }
                variant="secondary"
              >
                Cancel
              </W10Button>
            </div>
          </form>
        </section>
        <aside className="money-tax-panel money-tax-summary">
          <h2>Tax summary</h2>
          <dl className="money-tax-facts">
            <dt>Currency</dt>
            <dd>{head.currency}</dd>
            <dt>Subtotal</dt>
            <dd>{formatMoneyMinor(subtotal, head.currency)}</dd>
            <dt>Tax</dt>
            <dd>
              {taxConfigured && taxTotals !== null
                ? taxTotals
                : "Not applied until configured"}
            </dd>
            <dt>Default rate</dt>
            <dd>
              {taxConfigured
                ? formatTaxRate(taxLines[0].rateBasisPoints)
                : "0%"}
            </dd>
          </dl>
          <W10Button
            onClick={() =>
              navigateMoney(
                `/money/tax/settings?invoiceId=${encodeURIComponent(head.invoiceId)}`,
              )
            }
            variant="secondary"
          >
            View tax settings
          </W10Button>
          {taxAmount !== null && total !== null ? (
            <p className="money-tax-total-note">
              Total due {formatMoneyMinor(total, head.currency)}
            </p>
          ) : null}
        </aside>
      </div>
    </W10Page>
  );
}

function TaxPreview({
  clientName,
  invoice,
}: {
  clientName: string;
  invoice: EventRecord<MoneyInvoiceHead>;
}) {
  const head = invoice.value;
  const taxConfigured = head.taxLines.some((line) => line.rateBasisPoints > 0);
  return (
    <W10Page wide testId="money-tax-preview-page">
      <header className="w10-page-heading money-page-heading money-tax-heading">
        <div>
          <p className="money-tax-breadcrumb">
            Company / Invoice {head.invoiceId}
          </p>
          <h1>Invoice {head.invoiceId}</h1>
        </div>
      </header>
      <article className="money-tax-preview">
        <header>
          <strong>Invoice {head.invoiceId}</strong>
          <span>
            {head.status === "draft" ? "Draft · Not sent" : head.status}
          </span>
        </header>
        <dl className="money-tax-preview-facts">
          <dt>Bill to</dt>
          <dd>{clientName}</dd>
          <dt>Seller tax number</dt>
          <dd>{head.sellerTaxNumber ?? "Not supplied"}</dd>
          <dt>Customer tax number</dt>
          <dd>{head.customerTaxNumber ?? "Not supplied"}</dd>
          <dt>Due</dt>
          <dd>{formatTimestamp(head.dueAt)}</dd>
        </dl>
        <div className="money-tax-preview-lines">
          {head.lines.map((line) => (
            <div className="money-tax-preview-row" key={invoiceLineKey(line)}>
              <span>{line.description}</span>
              <strong>
                {formatMoneyMinor(lineTotalMinor(line), head.currency)}
              </strong>
            </div>
          ))}
          {taxConfigured ? (
            head.taxLines.map((taxLine) => (
              <div
                className="money-tax-preview-row"
                key={invoiceTaxLineKey(taxLine)}
              >
                <span>
                  {taxLine.label ?? "Tax"} ·{" "}
                  {formatTaxRate(taxLine.rateBasisPoints)}
                </span>
                <strong>
                  {formatMoneyMinor(
                    invoiceTaxTotalMinor(head.lines, [taxLine]),
                    head.currency,
                  )}
                </strong>
              </div>
            ))
          ) : (
            <div className="money-tax-preview-row">
              <span>Tax · Not configured</span>
              <strong>{formatMoneyMinor(0, head.currency)}</strong>
            </div>
          )}
        </div>
        <div className="money-tax-preview-total">
          <span>Total due</span>
          <strong>{formatMoneyMinor(head.totalMinor, head.currency)}</strong>
        </div>
        <W10Button
          onClick={() =>
            navigateMoney(
              `/money/tax/saved?invoiceId=${encodeURIComponent(head.invoiceId)}`,
            )
          }
          variant="primary"
        >
          Edit invoice
        </W10Button>
      </article>
    </W10Page>
  );
}

function formatTaxRate(rateBasisPoints: number) {
  const value = BigInt(rateBasisPoints);
  const whole = value / 100n;
  const fraction = (value % 100n)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

function invoiceLineKey(line: MoneyInvoiceHead["lines"][number]) {
  return `${line.serviceId ?? "custom"}:${line.description}:${line.quantityHundredths}:${line.unitAmountMinor}`;
}

function invoiceTaxLineKey(taxLine: InvoiceTaxLine) {
  return `${taxLine.label ?? "tax"}:${taxLine.rateBasisPoints}`;
}

function formatTaxRateInput(rateBasisPoints: number) {
  return formatTaxRate(rateBasisPoints).slice(0, -1);
}

function parseTaxRate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) throw new Error("Invalid tax rate");
  const basisPoints =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (basisPoints > 4_294_967_295n) throw new Error("Tax rate is too large");
  return Number(basisPoints);
}

function taxLinesEqual(
  left: readonly InvoiceTaxLine[],
  right: readonly InvoiceTaxLine[],
) {
  return (
    left.length === right.length &&
    left.every(
      (taxLine, index) =>
        taxLine.label === right[index]?.label &&
        taxLine.rateBasisPoints === right[index]?.rateBasisPoints,
    )
  );
}
