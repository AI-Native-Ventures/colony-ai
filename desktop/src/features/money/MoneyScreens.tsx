import * as React from "react";
import { ArrowRight, Clock3, FileText } from "lucide-react";

import type { EventRecord } from "@/features/clients/lib/businessRecords";
import { useMoneyRecordsQuery } from "@/features/clients/useBusinessRecords";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  W10Button,
  W10Error,
  W10Loading,
  W10Page,
} from "@/features/discovery/BusinessCommon";
import {
  deriveMoneyTotals,
  formatMoneyMinor,
  invoiceTaxTotalMinor,
  type MoneyInvoiceHead,
  type MoneyWorkspaceRecords,
} from "./lib/moneyRecords";
import {
  FollowUpDraftDialog,
  InvoiceEditDialog,
  IssueInvoiceDialog,
  MoneyAdjustmentDialog,
  RecordPaymentDialog,
  VoidInvoiceDialog,
} from "./MoneyDialogs";
import {
  currentPeriod,
  displayError,
  filterInvoiceRecords,
  formatCurrencyTotals,
  formatPeriod,
  formatTimestamp,
  invoiceLineRenderKey,
  isOverdue,
  lineTotalMinor,
  navigateMoney,
  periodForTimestamp,
  sumAdjustments,
  totalLinesMinor,
} from "./moneyUtils";
import "@/features/discovery/business-records.css";
import "./money.css";

export type MoneySection =
  | "overview"
  | "revenue"
  | "revenue-invoice"
  | "invoices"
  | "invoice"
  | "adjustments"
  | "follow-ups";

export function MoneyRouteScreen({
  section,
  invoiceId,
}: {
  section: MoneySection;
  invoiceId?: string;
}) {
  const query = useMoneyRecordsQuery();
  const communityMembership = useMyRelayMembershipQuery();
  const relayRole = communityMembership.data?.role;
  const canManage = relayRole === "owner" || relayRole === "admin";
  const directory = query.directoryQuery;
  const clients = directory.data ?? [];
  const clientNames = React.useMemo(
    () =>
      new Map(clients.map(({ value }) => [value.clientId, value.displayName])),
    [clients],
  );
  const [period, setPeriod] = React.useState(currentPeriod());
  const [clientId, setClientId] = React.useState("all");
  const records = query.data;

  if (directory.isPending || query.isPending)
    return <W10Loading label="Loading money records" />;
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
  if (!records) return <W10Loading label="Loading money records" />;

  const filteredInvoiceRecords = filterInvoiceRecords(
    records.invoiceHeads,
    period,
    clientId,
  );
  const visibleRecords = filteredInvoiceRecords.sort(
    (left, right) => right.event.created_at - left.event.created_at,
  );
  const selectedClientId = clientId === "all" ? null : clientId;
  const totals = deriveMoneyTotals(
    records,
    period,
    selectedClientId,
    Math.floor(Date.now() / 1_000),
  );
  const invoice = invoiceId
    ? records.invoiceHeads.find(({ value }) => value.invoiceId === invoiceId)
    : null;

  return (
    <W10Page wide testId={`money-${section}-page`}>
      {section === "invoice" || section === "revenue-invoice" ? (
        invoice ? (
          <InvoiceDetail
            canManage={canManage}
            clientNames={clientNames}
            fromRevenue={section === "revenue-invoice"}
            invoice={invoice}
            records={records}
          />
        ) : (
          <EmptyMoneyState
            actionHref="/money/invoices"
            actionLabel="All invoices"
            message="This invoice is not available in your client records."
            title="Invoice unavailable"
          />
        )
      ) : section === "overview" ||
        section === "revenue" ||
        section === "invoices" ? (
        <>
          <header className="w10-page-heading money-page-heading">
            <div>
              <h1>Money</h1>
            </div>
          </header>
          <MoneyNavigation section={section} />
          <MoneyFilters
            clientId={clientId}
            clients={clients}
            onClientChange={setClientId}
            onPeriodChange={setPeriod}
            period={period}
            records={records}
          />
          {section === "overview" ? (
            <MoneyOverview
              clientNames={clientNames}
              filteredInvoices={visibleRecords}
              totals={totals}
            />
          ) : (
            <InvoiceList
              clientNames={clientNames}
              fromRevenue={section === "revenue"}
              invoices={visibleRecords.filter(({ value }) =>
                section === "revenue" ? value.status === "issued" : true,
              )}
              title={section === "revenue" ? "Revenue" : "Invoices"}
            />
          )}
        </>
      ) : section === "adjustments" ? (
        <AdjustmentsScreen
          canManage={canManage}
          clientNames={clientNames}
          records={records}
        />
      ) : (
        <FollowUpsScreen
          canManage={canManage}
          clientNames={clientNames}
          records={records}
        />
      )}
    </W10Page>
  );
}

function MoneyNavigation({ section }: { section: MoneySection }) {
  const primary = [
    ["overview", "Overview", "/money"],
    ["revenue", "Revenue", "/money/revenue"],
    ["invoices", "Invoices", "/money/invoices"],
  ] as const;
  const operations = [
    ["adjustments", "Credit notes & refunds", "/money/adjustments"],
    ["follow-ups", "Follow-ups", "/money/follow-ups"],
  ] as const;
  return (
    <>
      <nav aria-label="Money" className="w10-tabs money-tabs">
        {primary.map(([id, label, href]) => (
          <a
            aria-current={section === id ? "page" : undefined}
            className={section === id ? "is-active" : ""}
            href={`#${href}`}
            key={id}
          >
            {label}
          </a>
        ))}
      </nav>
      <nav aria-label="Money operations" className="money-operation-tabs">
        {operations.map(([id, label, href]) => (
          <a href={`#${href}`} key={id}>
            {label}
          </a>
        ))}
        <a href="#/money/costs/unavailable">Costs</a>
        <a href="#/money/profitability/unavailable">Profitability</a>
      </nav>
    </>
  );
}

function MoneyFilters({
  clientId,
  clients,
  onClientChange,
  onPeriodChange,
  period,
  records,
}: {
  clientId: string;
  clients: ReturnType<typeof useMoneyRecordsQuery>["directoryQuery"]["data"];
  onClientChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  period: string;
  records: MoneyWorkspaceRecords;
}) {
  const periods = new Set([currentPeriod()]);
  for (const { event, value } of records.invoiceHeads) {
    const timestamp = value.issuedAt ?? event.created_at;
    periods.add(periodForTimestamp(timestamp));
  }
  for (const { value } of [...records.payments, ...records.adjustments]) {
    periods.add(periodForTimestamp(value.occurredAt));
  }
  if (!periods.has(period)) periods.add(period);
  return (
    <div className="w10-filterbar money-filterbar">
      <label className="money-filter">
        <span>Period</span>
        <select
          aria-label="Money period"
          onChange={(event) => onPeriodChange(event.currentTarget.value)}
          value={period}
        >
          {[...periods]
            .sort()
            .reverse()
            .map((value) => (
              <option key={value} value={value}>
                {formatPeriod(value)}
              </option>
            ))}
        </select>
      </label>
      <label className="money-filter">
        <span>Client</span>
        <select
          aria-label="Money client"
          onChange={(event) => onClientChange(event.currentTarget.value)}
          value={clientId}
        >
          <option value="all">All clients</option>
          {(clients ?? []).map(({ value }) => (
            <option key={value.clientId} value={value.clientId}>
              {value.displayName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function MoneyOverview({
  clientNames,
  filteredInvoices,
  totals,
}: {
  clientNames: ReadonlyMap<string, string>;
  filteredInvoices: EventRecord<MoneyInvoiceHead>[];
  totals: ReturnType<typeof deriveMoneyTotals>;
}) {
  const overdue = filteredInvoices.filter(({ value }) => isOverdue(value));
  const metrics = [
    [
      "Invoiced revenue",
      totals.invoicedMinorByCurrency,
      "/money/revenue",
      "Issued invoices · drafts excluded",
    ],
    [
      "Outstanding invoices",
      totals.outstandingMinorByCurrency,
      "/money/invoices",
      "Unpaid balances for this period",
    ],
  ] as const;
  return (
    <div className="money-overview" data-testid="money-overview">
      <div className="money-metrics">
        {metrics.map(([label, amounts, href, sub]) => (
          <a className="money-metric" href={`#${href}`} key={label}>
            <span>
              {label} <ArrowRight aria-hidden="true" />
            </span>
            <strong>{formatCurrencyTotals(amounts)}</strong>
            <small>{sub}</small>
          </a>
        ))}
      </div>
      <div className="money-overview-grid">
        <section className="money-panel">
          <header className="money-panel-heading">
            <h2>Needs attention</h2>
            <a href="#/money/follow-ups">
              All follow-ups <ArrowRight aria-hidden="true" />
            </a>
          </header>
          {overdue.length ? (
            <div className="money-attention-list">
              {overdue.map(({ value }) => (
                <a
                  href={`#/money/invoice/${value.invoiceId}`}
                  key={value.invoiceId}
                >
                  <Clock3 aria-hidden="true" />
                  <span>
                    <strong>
                      {clientNames.get(value.clientId) ?? value.clientId} ·{" "}
                      {formatMoneyMinor(value.outstandingMinor, value.currency)}{" "}
                      outstanding
                    </strong>
                    <small>
                      {value.invoiceId} · due {formatTimestamp(value.dueAt)}
                    </small>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </a>
              ))}
            </div>
          ) : (
            <div className="money-empty money-empty-compact">
              <span>No overdue balances</span>
              <small>
                A follow-up is prepared only for an outstanding invoice.
              </small>
            </div>
          )}
        </section>
        <section className="money-panel money-collections-panel">
          <h2>Cash movement</h2>
          <div className="money-summary-line">
            <span>Payments collected</span>
            <strong>
              {formatCurrencyTotals(totals.collectedMinorByCurrency)}
            </strong>
          </div>
          <p>Recorded payment evidence only. This is not a bank balance.</p>
        </section>
      </div>
    </div>
  );
}

function InvoiceList({
  clientNames,
  fromRevenue,
  invoices,
  title,
}: {
  clientNames: ReadonlyMap<string, string>;
  fromRevenue: boolean;
  invoices: EventRecord<MoneyInvoiceHead>[];
  title: string;
}) {
  return (
    <section className="money-list" data-testid="money-invoice-list">
      <div className="money-list-heading">
        <h2>{title}</h2>
        <span>{invoices.length} records</span>
      </div>
      {invoices.length === 0 ? (
        <div className="money-empty">
          <FileText aria-hidden="true" />
          <h2>No invoices for this selection</h2>
          <p>Change the period or client to find other invoices.</p>
        </div>
      ) : (
        <div className="w10-table-wrap">
          <table className="w10-table money-table">
            <thead>
              <tr>
                <th>Invoice / service</th>
                <th>Client</th>
                <th>Issued / due</th>
                <th className="number">Amount</th>
                <th className="number">Collected</th>
                <th className="number">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(({ event, value }) => (
                <tr key={value.invoiceId}>
                  <td>
                    <a
                      href={`#/money/${fromRevenue ? "revenue" : "invoice"}/${value.invoiceId}`}
                    >
                      {value.invoiceId}
                    </a>
                    <small>
                      {value.lines.map((line) => line.description).join(" · ")}
                    </small>
                  </td>
                  <td>{clientNames.get(value.clientId) ?? value.clientId}</td>
                  <td>
                    {formatTimestamp(value.issuedAt ?? event.created_at)}
                    {value.dueAt !== null ? (
                      <small>Due {formatTimestamp(value.dueAt)}</small>
                    ) : null}
                  </td>
                  <td className="number">
                    {formatMoneyMinor(value.totalMinor, value.currency)}
                  </td>
                  <td className="number">
                    {formatMoneyMinor(value.collectedMinor, value.currency)}
                  </td>
                  <td className="number">
                    {value.status === "draft"
                      ? "-"
                      : formatMoneyMinor(
                          value.outstandingMinor,
                          value.currency,
                        )}
                  </td>
                  <td>
                    <MoneyStatus value={value.status} invoice={value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InvoiceDetail({
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
  const [dialog, setDialog] = React.useState<
    "edit" | "issue" | "void" | "payment" | "follow-up" | "credit-note" | null
  >(null);
  const adjustments = records.adjustments.filter(
    ({ value }) => value.invoiceId === head.invoiceId,
  );
  const payments = records.payments
    .filter(({ value }) => value.invoiceId === head.invoiceId)
    .sort((left, right) => right.value.occurredAt - left.value.occurredAt);
  const credits = sumAdjustments(adjustments, "credit_note");
  const refunds = sumAdjustments(adjustments, "refund");
  const creditAvailable = Math.max(
    0,
    head.collectedMinor -
      Math.max(0, head.totalMinor - head.creditedMinor - head.writtenOffMinor),
  );
  const hasPaymentEvidence =
    payments.length > 0 || head.paymentEvidenceCount > 0;

  return (
    <>
      <header className="w10-page-heading money-page-heading money-detail-heading">
        <div>
          <h1>{head.invoiceId}</h1>
        </div>
        <div className="w10-heading-actions">
          <W10Button
            onClick={() =>
              navigateMoney(fromRevenue ? "/money/revenue" : "/money/invoices")
            }
            variant="secondary"
          >
            All {fromRevenue ? "revenue" : "invoices"}
          </W10Button>
          {canManage && head.status === "draft" ? (
            <W10Button onClick={() => setDialog("edit")} variant="secondary">
              Edit invoice
            </W10Button>
          ) : null}
          {canManage && head.status === "draft" ? (
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
          ) : null}
        </div>
      </header>
      <div className="money-detail-layout" data-testid="money-invoice-detail">
        <article className="money-invoice-document">
          <header>
            <strong>{clientNames.get(head.clientId) ?? head.clientId}</strong>
            <MoneyStatus invoice={head} value={head.status} />
          </header>
          <h2>{head.lines.map((line) => line.description).join(" · ")}</h2>
          <div className="money-invoice-address">
            <div>
              <small>Prepared for</small>
              <strong>{clientNames.get(head.clientId) ?? head.clientId}</strong>
            </div>
            <div>
              <small>Invoice date</small>
              <p>
                {formatTimestamp(head.issuedAt ?? invoice.event.created_at)}
              </p>
              <small>Due</small>
              <p>{formatTimestamp(head.dueAt)}</p>
            </div>
          </div>
          <div className="money-invoice-address money-tax-number-details">
            <div>
              <small>Seller tax number</small>
              <p>{head.sellerTaxNumber ?? "Not supplied"}</p>
            </div>
            <div>
              <small>Customer tax number</small>
              <p>{head.customerTaxNumber ?? "Not supplied"}</p>
            </div>
          </div>
          <table className="w10-table money-line-table">
            <thead>
              <tr>
                <th>Description</th>
                <th className="number">Amount</th>
              </tr>
            </thead>
            <tbody>
              {head.lines.map((line, index) => (
                <tr key={invoiceLineRenderKey(line, head.lines, index)}>
                  <td>{line.description}</td>
                  <td className="number">
                    {formatMoneyMinor(lineTotalMinor(line), head.currency)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>Subtotal</td>
                <td className="number">
                  {formatMoneyMinor(totalLinesMinor(head.lines), head.currency)}
                </td>
              </tr>
              {head.taxLines.length ? (
                head.taxLines.map((taxLine) => (
                  <tr
                    key={formatMoneyTaxKey(
                      taxLine.label,
                      taxLine.rateBasisPoints,
                    )}
                  >
                    <td>
                      {taxLine.label ?? "Tax"} ·{" "}
                      {formatMoneyTaxRate(taxLine.rateBasisPoints)}
                    </td>
                    <td className="number">
                      {formatMoneyMinor(
                        invoiceTaxTotalMinor(head.lines, [taxLine]),
                        head.currency,
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td>Tax · Not configured</td>
                  <td className="number">
                    {formatMoneyMinor(0, head.currency)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="money-invoice-totals">
            <div>
              <span>Total due</span>
              <strong>
                {formatMoneyMinor(head.totalMinor, head.currency)}
              </strong>
            </div>
            <div>
              <span>Payments</span>
              <strong>
                {formatMoneyMinor(head.collectedMinor, head.currency)}
              </strong>
            </div>
            <div className="money-balance">
              <span>Outstanding</span>
              <strong>
                {head.status === "draft"
                  ? "Draft"
                  : formatMoneyMinor(head.outstandingMinor, head.currency)}
              </strong>
            </div>
          </div>
        </article>
        <aside className="money-detail-aside">
          <section className="money-panel">
            <h2>Next action</h2>
            <p>
              {head.status === "draft"
                ? "Review the agreed scope and amount before issuing. Drafts do not count as revenue."
                : head.outstandingMinor > 0
                  ? "Record payments from actual payment evidence. No money is moved in Colony."
                  : "This invoice has no outstanding balance in the current records."}
            </p>
            {canManage && head.status === "draft" ? (
              <W10Button onClick={() => setDialog("issue")} variant="primary">
                Review & issue
              </W10Button>
            ) : null}
            {canManage &&
            head.status === "issued" &&
            head.outstandingMinor > 0 ? (
              <>
                <W10Button
                  onClick={() => setDialog("payment")}
                  variant="primary"
                >
                  Record payment
                </W10Button>
                <W10Button
                  onClick={() => setDialog("follow-up")}
                  variant="secondary"
                >
                  Prepare reminder
                </W10Button>
              </>
            ) : null}
            {canManage && head.status !== "void" && !hasPaymentEvidence ? (
              <W10Button onClick={() => setDialog("void")} variant="quiet">
                Void invoice
              </W10Button>
            ) : null}
            {canManage && head.status !== "void" && hasPaymentEvidence ? (
              <p className="money-note" role="note">
                Payments are recorded against this invoice. Review the payment
                record and create an adjustment before voiding.
              </p>
            ) : null}
            {!canManage ? <p className="money-note">Read only</p> : null}
          </section>
          <section className="money-panel">
            <h2>Payment history</h2>
            {payments.length ? (
              <div className="money-history-list">
                {payments.map(({ value }) => (
                  <div key={value.paymentId}>
                    <strong>
                      {formatMoneyMinor(value.amountMinor, value.currency)}
                    </strong>
                    <span>{formatTimestamp(value.occurredAt)}</span>
                    <p>
                      {value.provider === "manual"
                        ? "Manual payment"
                        : value.provider}{" "}
                      · {value.evidenceRef}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p>No payments recorded.</p>
            )}
          </section>
          <section className="money-panel">
            <h2>Source</h2>
            <p>Accepted proposal</p>
            <p>{head.proposalId}</p>
          </section>
          <section className="money-panel">
            <h2>Adjustments</h2>
            <dl className="money-facts">
              <dt>Credit notes</dt>
              <dd>{formatMoneyMinor(credits, head.currency)}</dd>
              <dt>Refunds recorded</dt>
              <dd>{formatMoneyMinor(refunds, head.currency)}</dd>
              <dt>Credit available</dt>
              <dd>{formatMoneyMinor(creditAvailable, head.currency)}</dd>
            </dl>
            {canManage && head.status === "issued" ? (
              <W10Button
                onClick={() => setDialog("credit-note")}
                variant="primary"
              >
                Create credit note
              </W10Button>
            ) : null}
            <a className="money-text-link" href="#/money/adjustments">
              All adjustments <ArrowRight aria-hidden="true" />
            </a>
          </section>
          {records.invoiceVersions.filter(
            ({ value }) => value.invoiceId === head.invoiceId,
          ).length > 1 ? (
            <section className="money-panel">
              <h2>Version history</h2>
              <p>
                {head.version} saved versions · current version {head.version}
              </p>
            </section>
          ) : null}
        </aside>
      </div>
      <InvoiceEditDialog
        canManage={canManage}
        clientName={clientNames.get(head.clientId) ?? head.clientId}
        invoice={invoice}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
        open={dialog === "edit"}
      />
      <IssueInvoiceDialog
        canManage={canManage}
        invoice={invoice}
        onOpenChange={(open) => setDialog(open ? "issue" : null)}
        open={dialog === "issue"}
      />
      <VoidInvoiceDialog
        canManage={canManage}
        invoice={invoice}
        onOpenChange={(open) => setDialog(open ? "void" : null)}
        open={dialog === "void"}
      />
      <RecordPaymentDialog
        key={invoice.event.id}
        canManage={canManage}
        invoice={invoice}
        onOpenChange={(open) => setDialog(open ? "payment" : null)}
        open={dialog === "payment"}
      />
      <FollowUpDraftDialog
        canManage={canManage}
        invoice={invoice}
        records={records}
        onOpenChange={(open) => setDialog(open ? "follow-up" : null)}
        open={dialog === "follow-up"}
      />
      <MoneyAdjustmentDialog
        key={dialog === "credit-note" ? "credit-note" : "closed"}
        action={dialog === "credit-note" ? "credit_note" : null}
        canManage={canManage}
        clientNames={clientNames}
        invoices={[invoice]}
        onActionChange={(action) =>
          setDialog(action === "credit_note" ? "credit-note" : null)
        }
        onOpenChange={(open) => setDialog(open ? "credit-note" : null)}
        open={dialog === "credit-note"}
      />
    </>
  );
}

function AdjustmentsScreen({
  canManage,
  clientNames,
  records,
}: {
  canManage: boolean;
  clientNames: ReadonlyMap<string, string>;
  records: MoneyWorkspaceRecords;
}) {
  const [action, setAction] = React.useState<"credit_note" | "refund" | null>(
    null,
  );
  const invoiceHeads = records.invoiceHeads.filter(
    ({ value }) => value.status === "issued",
  );
  const credits = records.adjustments
    .filter(({ value }) => value.adjustmentType === "credit_note")
    .sort((left, right) => right.value.occurredAt - left.value.occurredAt);
  const refunds = records.adjustments
    .filter(({ value }) => value.adjustmentType === "refund")
    .sort((left, right) => right.value.occurredAt - left.value.occurredAt);
  return (
    <>
      <header className="w10-page-heading money-page-heading">
        <div>
          <h1>Credit notes &amp; refunds</h1>
        </div>
        <div className="w10-heading-actions">
          {canManage && invoiceHeads.length ? (
            <>
              <W10Button
                onClick={() => setAction("credit_note")}
                variant="primary"
              >
                Create credit note
              </W10Button>
              <W10Button
                onClick={() => setAction("refund")}
                variant="secondary"
              >
                Record refund
              </W10Button>
            </>
          ) : null}
        </div>
      </header>
      <MoneyNavigation section="adjustments" />
      <section className="money-panel money-adjustments-section">
        <h2>Credit notes</h2>
        <MoneyRecordTable
          headings={["Reference", "Invoice", "Date", "Amount", "Reason"]}
          rows={credits.map(({ value }) => ({
            key: value.adjustmentId,
            cells: [
              value.adjustmentId,
              <a
                href={`#/money/invoice/${value.invoiceId}`}
                key={`${value.adjustmentId}:invoice`}
              >
                {value.invoiceId}
              </a>,
              formatTimestamp(value.occurredAt),
              formatMoneyMinor(value.amountMinor, value.currency),
              value.reason,
            ],
          }))}
          testId="money-credit-notes"
        />
      </section>
      <section className="money-panel money-adjustments-section">
        <h2>Refund records</h2>
        <MoneyRecordTable
          headings={["Invoice", "Date", "Amount", "Payment evidence"]}
          rows={refunds.map(({ value }) => ({
            key: value.adjustmentId,
            cells: [
              <a
                href={`#/money/invoice/${value.invoiceId}`}
                key={`${value.adjustmentId}:invoice`}
              >
                {value.invoiceId}
              </a>,
              formatTimestamp(value.occurredAt),
              formatMoneyMinor(value.amountMinor, value.currency),
              value.evidenceRef,
            ],
          }))}
          testId="money-refunds"
        />
      </section>
      <p className="money-page-note">
        Credit notes reduce invoiced revenue. Refund records reduce collected
        cash on their recorded payment date. This interface records evidence; it
        does not move money.
      </p>
      <MoneyAdjustmentDialog
        key={action ?? "closed"}
        action={action}
        canManage={canManage}
        clientNames={clientNames}
        invoices={invoiceHeads}
        onActionChange={setAction}
        onOpenChange={(open) => setAction(open ? action : null)}
        open={action !== null}
      />
    </>
  );
}

function FollowUpsScreen({
  canManage,
  clientNames,
  records,
}: {
  canManage: boolean;
  clientNames: ReadonlyMap<string, string>;
  records: MoneyWorkspaceRecords;
}) {
  const [invoiceId, setInvoiceId] = React.useState<string | null>(null);
  const overdueInvoices = records.invoiceHeads
    .filter(({ value }) => isOverdue(value))
    .sort((left, right) => (left.value.dueAt ?? 0) - (right.value.dueAt ?? 0));
  const selectedInvoice = invoiceId
    ? (records.invoiceHeads.find(
        ({ value }) => value.invoiceId === invoiceId,
      ) ?? null)
    : null;
  return (
    <>
      <header className="w10-page-heading money-page-heading">
        <div>
          <h1>Invoice follow-ups</h1>
        </div>
      </header>
      <MoneyNavigation section="follow-ups" />
      {overdueInvoices.length ? (
        <div className="money-follow-up-list" data-testid="money-follow-ups">
          {overdueInvoices.map(({ value }) => (
            <div className="money-follow-up-row" key={value.invoiceId}>
              <span className="money-follow-up-icon">
                <FileText aria-hidden="true" />
              </span>
              <a href={`#/money/invoice/${value.invoiceId}`}>
                <strong>
                  {clientNames.get(value.clientId) ?? value.clientId} ·{" "}
                  {value.invoiceId}
                </strong>
                <small>
                  {formatMoneyMinor(value.outstandingMinor, value.currency)}{" "}
                  outstanding · due {formatTimestamp(value.dueAt)}
                </small>
              </a>
              {canManage ? (
                <W10Button
                  onClick={() => setInvoiceId(value.invoiceId)}
                  variant="secondary"
                >
                  Prepare reminder
                </W10Button>
              ) : null}
              <a
                aria-label={`Open invoice ${value.invoiceId}`}
                href={`#/money/invoice/${value.invoiceId}`}
              >
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
          ))}
        </div>
      ) : (
        <div className="money-empty" data-testid="money-follow-ups-empty">
          <Clock3 aria-hidden="true" />
          <h2>No overdue balances</h2>
          <p>A reminder is prepared only for an outstanding invoice.</p>
        </div>
      )}
      <FollowUpDraftDialog
        canManage={canManage}
        invoice={selectedInvoice}
        records={records}
        onOpenChange={(open) => setInvoiceId(open ? invoiceId : null)}
        open={selectedInvoice !== null}
      />
    </>
  );
}

function MoneyRecordTable({
  headings,
  rows,
  testId,
}: {
  headings: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
  testId: string;
}) {
  return (
    <div className="w10-table-wrap">
      <table className="w10-table money-table" data-testid={testId}>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ cells, key }) => (
            <tr key={key}>
              {cells.map((cell, cellIndex) => (
                <td key={`${key}:${headings[cellIndex]}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoneyStatus({
  invoice,
  value,
}: {
  invoice: MoneyInvoiceHead;
  value: MoneyInvoiceHead["status"];
}) {
  const label =
    value === "void"
      ? "Void"
      : value === "draft"
        ? "Draft"
        : invoice.outstandingMinor === 0
          ? "Paid"
          : invoice.collectedMinor > 0
            ? "Part paid"
            : isOverdue(invoice)
              ? "Overdue"
              : "Awaiting payment";
  const tone =
    value === "void"
      ? "void"
      : label === "Paid"
        ? "paid"
        : label === "Overdue"
          ? "overdue"
          : "neutral";
  return <span className={`money-status money-status-${tone}`}>{label}</span>;
}

function MoneyNavigationButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <a className="money-text-link" href={`#${href}`}>
      {label}
    </a>
  );
}

function EmptyMoneyState({
  actionHref,
  actionLabel,
  message,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  message: string;
  title: string;
}) {
  return (
    <section className="money-empty">
      <FileText aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      {actionHref && actionLabel ? (
        <MoneyNavigationButton href={actionHref} label={actionLabel} />
      ) : null}
    </section>
  );
}

function formatMoneyTaxRate(rateBasisPoints: number) {
  const value = BigInt(rateBasisPoints);
  const whole = value / 100n;
  const fraction = (value % 100n)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

function formatMoneyTaxKey(label: string | null, rateBasisPoints: number) {
  return `${label ?? "tax"}:${rateBasisPoints}`;
}
