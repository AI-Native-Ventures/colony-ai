import * as React from "react";

import type { EventRecord } from "@/features/clients/lib/businessRecords";
import { usePeople } from "@/features/clients/lib/usePeople";
import {
  ArrowLeftIcon,
  PersonAvatar,
} from "@/features/clients/ui/BusinessBits";
import { BusinessTrail } from "@/features/clients/ui/BusinessTrail";
import { ClientWorkspace } from "@/features/clients/ui/ClientWorkspace";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  InvoiceEditDialog,
  IssueInvoiceDialog,
  RecordPaymentDialog,
  VoidInvoiceDialog,
} from "./MoneyInvoiceDialogs";
import { InvoiceStatusPills, invoiceIssuer } from "./MoneyInvoiceList";
import {
  formatMoneyMinor,
  invoiceTaxTotalMinor,
  type MoneyInvoiceHead,
  type MoneyWorkspaceRecords,
} from "./lib/moneyRecords";
import {
  formatDisplayDate,
  invoiceLineRenderKey,
  invoiceNumber,
  isOverdue,
  lineTotalMinor,
  navigateMoney,
  totalLinesMinor,
} from "./moneyUtils";

export function MoneyInvoiceDetail({
  canManage,
  clientNames,
  fromRevenue,
  invoice,
  records,
}: {
  canManage: boolean;
  clientNames: ReadonlyMap<string, string>;
  fromRevenue: boolean;
  invoice: EventRecord<MoneyInvoiceHead>;
  records: MoneyWorkspaceRecords;
}) {
  const { value: head } = invoice;
  const { activeCommunity } = useCommunities();
  const [dialog, setDialog] = React.useState<
    "edit" | "issue" | "void" | "payment" | null
  >(null);
  const payments = records.payments
    .filter(({ value }) => value.invoiceId === head.invoiceId)
    .sort((left, right) => right.value.occurredAt - left.value.occurredAt);
  const issuerPubkey = invoiceIssuer(records, head.invoiceId);
  const { person } = usePeople(
    [...payments.map(({ event }) => event.pubkey), issuerPubkey ?? ""],
    { titles: true },
  );
  const issuer = issuerPubkey ? person(issuerPubkey) : null;
  const hasPaymentEvidence =
    payments.length > 0 || head.paymentEvidenceCount > 0;
  const client = clientNames.get(head.clientId) ?? head.clientId;
  const service = head.lines.map((line) => line.description).join(" · ");
  const number = `Invoice ${invoiceNumber(head.invoiceId)}`;
  const listPath = fromRevenue ? "/money/revenue" : "/money/invoices";
  const overdue = isOverdue(head);
  const savedVersions = records.invoiceVersions.filter(
    ({ value }) => value.invoiceId === head.invoiceId,
  ).length;

  return (
    <ClientWorkspace
      gap={24}
      header={
        <div className="b3-invoice-head">
          <div className="b3-invoice-head-copy">
            <div className="b3-invoice-title-row">
              <h1 className="b3-title">{number}</h1>
              <InvoiceStatusPills invoice={head} />
            </div>
            <span className="b3-subtitle">
              {client} · {service}
            </span>
          </div>
          <div className="b3-head-actions">
            <button
              className="b3-btn"
              onClick={() => navigateMoney(listPath)}
              type="button"
            >
              <ArrowLeftIcon size={17} />
              All {fromRevenue ? "revenue" : "invoices"}
            </button>
          </div>
        </div>
      }
      title={number}
    >
      <BusinessTrail
        crumbs={[
          { label: "Business" },
          { label: "Money" },
          {
            label: fromRevenue ? "Revenue" : "Invoices",
            onClick: () => navigateMoney(listPath),
          },
          { label: number },
        ]}
      />
      <div className="b3-tabs-row">
        <nav aria-label="Money views" className="b3-tabs">
          <a className="b3-tab" href="#/money">
            Overview
          </a>
          <a
            aria-current={fromRevenue ? "page" : undefined}
            className="b3-tab"
            href="#/money/revenue"
          >
            Revenue
          </a>
          <a
            aria-current={fromRevenue ? undefined : "page"}
            className="b3-tab"
            href="#/money/invoices"
          >
            Invoices
          </a>
        </nav>
      </div>
      <div className="b3-invoice-body" data-testid="money-invoice-detail">
        <article aria-label={`${number} document`} className="b3-document">
          <div className="b3-document-head">
            <div>
              <span className="b3-eyebrow">
                {activeCommunity?.name ?? "Your business"}
              </span>
              <h2 className="b3-document-title">{service}</h2>
            </div>
            <span className="b3-document-ref">{number}</span>
          </div>

          <dl className="b3-document-facts">
            <div className="b3-fact">
              <dt>Prepared for</dt>
              <dd>{client}</dd>
            </div>
            <div className="b3-fact">
              <dt>Invoice date</dt>
              <dd>
                {formatDisplayDate(head.issuedAt ?? invoice.event.created_at)}
              </dd>
            </div>
            <div className="b3-fact">
              <dt>Due</dt>
              <dd data-tone={overdue ? "bad" : undefined}>
                {formatDisplayDate(head.dueAt)}
              </dd>
            </div>
            <div className="b3-fact">
              <dt>Seller tax number</dt>
              <dd data-quiet="true">
                {head.sellerTaxNumber ?? "Not supplied"}
              </dd>
            </div>
            <div className="b3-fact">
              <dt>Customer tax number</dt>
              <dd data-quiet="true">
                {head.customerTaxNumber ?? "Not supplied"}
              </dd>
            </div>
          </dl>

          <table aria-label="Invoice lines" className="b3-lines">
            <thead>
              <tr data-kind="head">
                <th className="b3-eyebrow" scope="col">
                  Description
                </th>
                <th className="b3-eyebrow" data-align="end" scope="col">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {head.lines.map((line, index) => (
                <tr
                  data-kind="line"
                  key={invoiceLineRenderKey(line, head.lines, index)}
                >
                  <td>{line.description}</td>
                  <td className="b3-lines-amount">
                    {formatMoneyMinor(lineTotalMinor(line), head.currency)}
                  </td>
                </tr>
              ))}
              <tr data-kind="sum">
                <td>Subtotal</td>
                <td className="b3-lines-amount">
                  {formatMoneyMinor(totalLinesMinor(head.lines), head.currency)}
                </td>
              </tr>
              {head.taxLines.length ? (
                head.taxLines.map((taxLine) => (
                  <tr
                    data-kind="tax"
                    key={`${taxLine.label ?? "tax"}:${taxLine.rateBasisPoints}`}
                  >
                    <td>
                      {taxLine.label ?? "Tax"} ·{" "}
                      {formatTaxRate(taxLine.rateBasisPoints)}
                    </td>
                    <td className="b3-lines-amount">
                      {formatMoneyMinor(
                        invoiceTaxTotalMinor(head.lines, [taxLine]),
                        head.currency,
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr data-kind="tax">
                  <td>Tax · Not configured</td>
                  <td aria-label="None" className="b3-lines-amount">
                    –
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="b3-totals">
            <div className="b3-totals-row">
              <span>Total due</span>
              <span>{formatMoneyMinor(head.totalMinor, head.currency)}</span>
            </div>
            {head.collectedMinor > 0 ? (
              <div className="b3-totals-row" data-tone="ok">
                <span>Payments</span>
                <span>
                  − {formatMoneyMinor(head.collectedMinor, head.currency)}
                </span>
              </div>
            ) : null}
            <div className="b3-totals-row" data-kind="due">
              <span>Outstanding</span>
              <span>
                {head.status === "draft"
                  ? "Draft"
                  : formatMoneyMinor(head.outstandingMinor, head.currency)}
              </span>
            </div>
          </div>

          {issuer && head.issuedAt !== null ? (
            <div className="b3-issued-by">
              <PersonAvatar person={issuer} size={26} />
              <span>
                Issued by {issuer.name}
                {issuer.title ? `, ${issuer.title}` : ""} ·{" "}
                {formatDisplayDate(head.issuedAt)}
              </span>
            </div>
          ) : null}
        </article>

        <div className="b3-invoice-side">
          <section
            aria-labelledby="invoice-next-action"
            className="b3-card b3-side-panel"
          >
            <h2 id="invoice-next-action">Next action</h2>
            <p>
              {head.status === "draft"
                ? "Review the agreed scope and amount before issuing. Drafts do not count as revenue."
                : head.status === "void"
                  ? "This invoice is void. It stays visible and is excluded from revenue."
                  : head.outstandingMinor > 0
                    ? "Record payments from actual payment evidence. No money is moved in Colony."
                    : "This invoice has no outstanding balance in the current records."}
            </p>
            {canManage && head.status === "draft" ? (
              <>
                <button
                  className="b3-btn"
                  data-size="block"
                  data-variant="primary"
                  onClick={() => setDialog("issue")}
                  type="button"
                >
                  Review &amp; issue
                </button>
                <button
                  className="b3-btn"
                  data-size="block"
                  onClick={() => setDialog("edit")}
                  type="button"
                >
                  Edit invoice
                </button>
              </>
            ) : null}
            {canManage &&
            head.status === "issued" &&
            head.outstandingMinor > 0 ? (
              <button
                className="b3-btn"
                data-size="block"
                data-variant="primary"
                onClick={() => setDialog("payment")}
                type="button"
              >
                Record payment
              </button>
            ) : null}
            {canManage && head.status !== "void" && !hasPaymentEvidence ? (
              <button
                className="b3-btn"
                data-size="block"
                onClick={() => setDialog("void")}
                type="button"
              >
                Void invoice
              </button>
            ) : null}
            {canManage && head.status !== "void" && hasPaymentEvidence ? (
              <div className="b3-side-note" role="note">
                <InfoIcon />
                <p>
                  <strong>Void invoice</strong> is unavailable. Payments are
                  recorded against this invoice.
                </p>
              </div>
            ) : null}
            {!canManage ? (
              <div className="b3-side-note">
                <InfoIcon />
                <p>Read only</p>
              </div>
            ) : null}
          </section>

          <section
            aria-labelledby="invoice-payments"
            className="b3-card b3-side-panel"
            data-gap="12"
          >
            <h2 id="invoice-payments">Payment history</h2>
            {payments.length ? (
              payments.map(({ event, value }) => {
                const recorder = person(event.pubkey);
                return (
                  <div className="b3-payment" key={value.paymentId}>
                    <span aria-hidden="true" className="b3-payment-icon">
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="16"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.6"
                        viewBox="0 0 24 24"
                        width="16"
                      >
                        <path d="m5 12 5 5 9-10" />
                      </svg>
                    </span>
                    <span className="b3-payment-copy">
                      <span className="b3-payment-amount">
                        {formatMoneyMinor(value.amountMinor, value.currency)} ·{" "}
                        {formatDisplayDate(value.occurredAt)}
                      </span>
                      <span className="b3-payment-meta">
                        {value.provider === "manual"
                          ? "Manual payment"
                          : value.provider}{" "}
                        · {value.evidenceRef}
                      </span>
                      <span className="b3-payment-by">
                        Recorded by {recorder.name}
                      </span>
                    </span>
                  </div>
                );
              })
            ) : (
              <p>No payments recorded.</p>
            )}
          </section>

          <section
            aria-labelledby="invoice-source"
            className="b3-card b3-side-panel"
            data-gap="10"
          >
            <h2 id="invoice-source">Source</h2>
            <span className="b3-money-sub">Accepted proposal</span>
            <a className="b3-text-link" href={`#/clients/${head.clientId}`}>
              Open client record
            </a>
          </section>

          {savedVersions > 1 ? (
            <section
              aria-labelledby="invoice-versions"
              className="b3-card b3-side-panel"
            >
              <h2 id="invoice-versions">Version history</h2>
              <p>
                {head.version} saved versions · current version {head.version}
              </p>
            </section>
          ) : null}
        </div>
      </div>
      <InvoiceEditDialog
        canManage={canManage}
        clientName={client}
        invoice={invoice}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
        open={dialog === "edit"}
      />
      <IssueInvoiceDialog
        canManage={canManage}
        clientName={client}
        invoice={invoice}
        onEdit={() => setDialog("edit")}
        onOpenChange={(open) => setDialog(open ? "issue" : null)}
        open={dialog === "issue"}
      />
      <VoidInvoiceDialog
        canManage={canManage}
        clientName={client}
        invoice={invoice}
        onOpenChange={(open) => setDialog(open ? "void" : null)}
        open={dialog === "void"}
      />
      <RecordPaymentDialog
        canManage={canManage}
        invoice={invoice}
        key={invoice.event.id}
        onOpenChange={(open) => setDialog(open ? "payment" : null)}
        open={dialog === "payment"}
      />
    </ClientWorkspace>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
      width="18"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.2" />
    </svg>
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
