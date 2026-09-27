import * as React from "react";
import { ArrowRight, Clock3, FileText } from "lucide-react";

import {
  BusinessRecordParseError,
  BUSINESS_RECORD_SCHEMA_VERSION,
  type EventRecord,
} from "@/features/clients/lib/businessRecords";
import {
  useMoneyRecordsQuery,
  useSubmitBusinessRecordMutation,
} from "@/features/clients/useBusinessRecords";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  KIND_INVOICE_VERSION,
  KIND_MONEY_ADJUSTMENT,
  KIND_MONEY_FOLLOW_UP,
  KIND_PAYMENT,
} from "@/shared/constants/kinds";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  W10Button,
  W10Error,
  W10Loading,
  W10Page,
} from "@/features/discovery/BusinessCommon";
import {
  type MoneyAdjustment as MoneyAdjustmentPayload,
  type MoneyFollowUpAction as MoneyFollowUpPayload,
  type MoneyInvoiceVersion as MoneyInvoiceVersionPayload,
  deriveMoneyTotals,
  formatMoneyMinor,
  moneyAdjustmentDTag,
  moneyFollowUpDTag,
  moneyInvoiceVersionDTag,
  moneyRecordTemplate,
  parseMoneyInput,
  type InvoiceLine,
  type MoneyInvoiceHead,
  type MoneyWorkspaceRecords,
} from "./lib/moneyRecords";
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

type InvoiceLineDraft = Omit<
  InvoiceLine,
  "quantityHundredths" | "unitAmountMinor"
> & {
  draftKey: string;
  quantityInput: string;
  amountInput: string;
};

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
          <h2>No records for this selection</h2>
          <p>Change the period/client or create an invoice.</p>
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
            </tbody>
          </table>
          <div className="money-invoice-totals">
            <div>
              <span>Total</span>
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

function InvoiceEditDialog({
  canManage,
  clientName,
  invoice,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  clientName: string;
  invoice: EventRecord<MoneyInvoiceHead>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [lines, setLines] = React.useState<InvoiceLineDraft[]>(() =>
    invoice.value.lines.map((line) =>
      invoiceLineDraft(line, invoice.value.currency),
    ),
  );
  const [dueDate, setDueDate] = React.useState(dateInput(invoice.value.dueAt));
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setLines(
        invoice.value.lines.map((line) =>
          invoiceLineDraft(line, invoice.value.currency),
        ),
      );
      setDueDate(dateInput(invoice.value.dueAt));
      setError("");
    }
  }, [invoice.value.currency, invoice.value.dueAt, invoice.value.lines, open]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const normalizedLines: InvoiceLine[] = lines.map((line) => ({
        serviceId: line.serviceId,
        description: line.description.trim(),
        quantityHundredths: parseQuantityInput(line.quantityInput),
        unitAmountMinor: parseMoneyInput(
          line.amountInput,
          invoice.value.currency,
          true,
        ),
      }));
      const totalMinor = totalLinesMinor(normalizedLines);
      if (normalizedLines.some((line) => !line.description)) {
        throw new Error("Each invoice line needs a description.");
      }
      const value: MoneyInvoiceVersionPayload = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        version: invoice.value.version + 1,
        previousVersionEventId: invoice.value.currentVersionEventId,
        proposalVersionEventId: invoice.value.proposalVersionEventId,
        expectedHeadEventId: invoice.event.id,
        action: "draft_edit",
        currency: invoice.value.currency,
        lines: normalizedLines,
        totalMinor,
        status: "draft",
        dueAt: timestampFromDateInput(dueDate),
        voidReason: null,
      };
      const template = moneyRecordTemplate(
        KIND_INVOICE_VERSION,
        value,
        moneyInvoiceVersionDTag(value.clientId, value.invoiceId, value.version),
      );
      await submit.mutateAsync(template);
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Edit {invoice.value.invoiceId}</DialogTitle>
          <DialogDescription>
            New invoices start as drafts. Review and issue separately.
          </DialogDescription>
        </DialogHeader>
        <form className="money-form" onSubmit={(event) => void save(event)}>
          <div className="money-static-field">
            <span>Client</span>
            <strong>{clientName}</strong>
          </div>
          {lines.map((line, index) => (
            <div className="money-line-editor" key={line.draftKey}>
              <label>
                <span>Service / description</span>
                <input
                  autoComplete="off"
                  onChange={(event) =>
                    updateLine(setLines, index, {
                      description: event.currentTarget.value,
                    })
                  }
                  required
                  value={line.description}
                />
              </label>
              <div className="money-line-amount">
                <label>
                  <span>Quantity</span>
                  <input
                    inputMode="decimal"
                    min="0.01"
                    onChange={(event) =>
                      updateLine(setLines, index, {
                        quantityInput: event.currentTarget.value,
                      })
                    }
                    step="0.01"
                    type="number"
                    value={line.quantityInput}
                  />
                </label>
                <label>
                  <span>Unit amount · {invoice.value.currency}</span>
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) =>
                      updateLine(setLines, index, {
                        amountInput: event.currentTarget.value,
                      })
                    }
                    step={moneyStep(invoice.value.currency)}
                    type="number"
                    value={line.amountInput}
                  />
                </label>
              </div>
            </div>
          ))}
          <label>
            <span>Due date</span>
            <input
              onChange={(event) => setDueDate(event.currentTarget.value)}
              type="date"
              value={dueDate}
            />
          </label>
          {error ? (
            <p className="money-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <W10Button onClick={() => onOpenChange(false)} variant="secondary">
              Cancel
            </W10Button>
            <W10Button
              disabled={!canManage || submit.isPending}
              type="submit"
              variant="primary"
            >
              Save invoice
            </W10Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssueInvoiceDialog({
  canManage,
  invoice,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  invoice: EventRecord<MoneyInvoiceHead>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [error, setError] = React.useState("");
  async function issue() {
    const current = invoice.value;
    const value: MoneyInvoiceVersionPayload = {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: current.clientId,
      invoiceId: current.invoiceId,
      version: current.version + 1,
      previousVersionEventId: current.currentVersionEventId,
      proposalVersionEventId: current.proposalVersionEventId,
      expectedHeadEventId: invoice.event.id,
      action: "issue",
      currency: current.currency,
      lines: current.lines,
      totalMinor: current.totalMinor,
      status: "issued",
      dueAt: current.dueAt,
      voidReason: null,
    };
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
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Issue {invoice.value.invoiceId}?</DialogTitle>
          <DialogDescription>
            Confirm the agreed scope and{" "}
            {formatMoneyMinor(invoice.value.totalMinor, invoice.value.currency)}{" "}
            amount. Issuing includes this record in invoiced revenue; it does
            not send an email.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="money-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <W10Button onClick={() => onOpenChange(false)} variant="secondary">
            Cancel
          </W10Button>
          <W10Button
            disabled={!canManage || submit.isPending}
            onClick={() => void issue()}
            variant="primary"
          >
            Issue invoice
          </W10Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidInvoiceDialog({
  canManage,
  invoice,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  invoice: EventRecord<MoneyInvoiceHead>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  async function voidInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    const current = invoice.value;
    const value: MoneyInvoiceVersionPayload = {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: current.clientId,
      invoiceId: current.invoiceId,
      version: current.version + 1,
      previousVersionEventId: current.currentVersionEventId,
      proposalVersionEventId: current.proposalVersionEventId,
      expectedHeadEventId: invoice.event.id,
      action: "void",
      currency: current.currency,
      lines: current.lines,
      totalMinor: current.totalMinor,
      status: "void",
      dueAt: current.dueAt,
      voidReason: trimmed,
    };
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
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Void invoice {invoice.value.invoiceId}</DialogTitle>
          <DialogDescription>
            The original record remains visible. Voided invoices are excluded
            from revenue.
          </DialogDescription>
        </DialogHeader>
        <form
          className="money-form"
          onSubmit={(event) => void voidInvoice(event)}
        >
          <label>
            <span>Reason</span>
            <textarea
              onChange={(event) => setReason(event.currentTarget.value)}
              required
              rows={3}
              value={reason}
            />
          </label>
          {error ? (
            <p className="money-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <W10Button onClick={() => onOpenChange(false)} variant="secondary">
              Cancel
            </W10Button>
            <W10Button
              disabled={!canManage || submit.isPending}
              type="submit"
              variant="primary"
            >
              Void invoice
            </W10Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentDialog({
  canManage,
  invoice,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  invoice: EventRecord<MoneyInvoiceHead>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [amount, setAmount] = React.useState("");
  const [provider, setProvider] = React.useState("manual");
  const [providerReference, setProviderReference] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState(currentDate());
  const [evidenceRef, setEvidenceRef] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setAmount(
        decimalInput(invoice.value.outstandingMinor, invoice.value.currency),
      );
      setProvider("manual");
      setProviderReference("");
      setOccurredAt(currentDate());
      setEvidenceRef("");
      setError("");
    }
  }, [invoice.value.currency, invoice.value.outstandingMinor, open]);
  async function record(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const amountMinor = parseMoneyInput(amount, invoice.value.currency);
      if (amountMinor > invoice.value.outstandingMinor) {
        throw new Error(
          "The amount exceeds this invoice’s outstanding balance.",
        );
      }
      if (provider.trim() !== "manual" && !providerReference.trim()) {
        throw new Error("Enter the provider transaction reference.");
      }
      const paymentId = crypto.randomUUID();
      const expectedInvoiceHeadEventId = invoice.event.id;
      const value = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        paymentId,
        provider: provider.trim(),
        providerReference:
          provider.trim() === "manual" ? null : providerReference.trim(),
        amountMinor,
        currency: invoice.value.currency,
        occurredAt: timestampFromDateInput(occurredAt),
        evidenceRef: evidenceRef.trim(),
        expectedInvoiceHeadEventId,
      };
      const template = moneyRecordTemplate(
        KIND_PAYMENT,
        value,
        `client:${value.clientId}:payment:${paymentId}`,
      );
      await submit.mutateAsync(template);
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Record payment · {invoice.value.invoiceId}</DialogTitle>
          <DialogDescription>
            Outstanding:{" "}
            {formatMoneyMinor(
              invoice.value.outstandingMinor,
              invoice.value.currency,
            )}
            . Recording payment evidence updates the balance. No money moves in
            Colony.
          </DialogDescription>
        </DialogHeader>
        <form className="money-form" onSubmit={(event) => void record(event)}>
          <label>
            <span>Amount received · {invoice.value.currency}</span>
            <input
              inputMode="decimal"
              onChange={(event) => setAmount(event.currentTarget.value)}
              required
              value={amount}
            />
          </label>
          <label>
            <span>Payment date</span>
            <input
              onChange={(event) => setOccurredAt(event.currentTarget.value)}
              required
              type="date"
              value={occurredAt}
            />
          </label>
          <label>
            <span>Provider</span>
            <input
              onChange={(event) => setProvider(event.currentTarget.value)}
              required
              value={provider}
            />
          </label>
          {provider.trim() !== "manual" ? (
            <label>
              <span>Provider transaction reference</span>
              <input
                onChange={(event) =>
                  setProviderReference(event.currentTarget.value)
                }
                required
                value={providerReference}
              />
            </label>
          ) : null}
          <label>
            <span>Payment reference / evidence</span>
            <input
              onChange={(event) => setEvidenceRef(event.currentTarget.value)}
              required
              value={evidenceRef}
            />
          </label>
          {error ? (
            <p className="money-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <W10Button onClick={() => onOpenChange(false)} variant="secondary">
              Cancel
            </W10Button>
            <W10Button
              disabled={!canManage || submit.isPending}
              type="submit"
              variant="primary"
            >
              Record payment
            </W10Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoneyAdjustmentDialog({
  action,
  canManage,
  clientNames,
  invoices,
  onActionChange,
  onOpenChange,
  open,
}: {
  action: "credit_note" | "refund" | null;
  canManage: boolean;
  clientNames: ReadonlyMap<string, string>;
  invoices: EventRecord<MoneyInvoiceHead>[];
  onActionChange: (action: "credit_note" | "refund") => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const eligibleInvoices =
    action === "refund"
      ? invoices.filter(({ value }) => creditAvailableForRefund(value) > 0)
      : invoices;
  const firstInvoiceId = eligibleInvoices[0]?.value.invoiceId ?? "";
  const [invoiceId, setInvoiceId] = React.useState(firstInvoiceId);
  const invoice =
    eligibleInvoices.find(({ value }) => value.invoiceId === invoiceId) ?? null;
  const noRefundableBalance =
    action === "refund" && eligibleInvoices.length === 0;
  const submit = useSubmitBusinessRecordMutation();
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(currentDate());
  const [reason, setReason] = React.useState("");
  const [evidenceRef, setEvidenceRef] = React.useState("");
  const [refundEvidenceConfirmed, setRefundEvidenceConfirmed] =
    React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setInvoiceId(firstInvoiceId);
      setAmount("");
      setDate(currentDate());
      setReason("");
      setEvidenceRef("");
      setRefundEvidenceConfirmed(false);
      setError("");
    }
  }, [firstInvoiceId, open]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !invoice) return;
    try {
      const amountMinor = parseMoneyInput(amount, invoice.value.currency);
      if (
        action === "credit_note" &&
        amountMinor > invoice.value.totalMinor - invoice.value.creditedMinor
      ) {
        throw new Error("The credit exceeds the remaining invoice amount.");
      }
      if (
        action === "refund" &&
        amountMinor > creditAvailableForRefund(invoice.value)
      ) {
        throw new Error(
          "The refund exceeds the available client credit balance.",
        );
      }
      if (action === "refund" && !refundEvidenceConfirmed) {
        throw new Error("Confirm that the refund was paid outside Colony.");
      }
      const occurredAt = timestampFromDateInput(date);
      if (occurredAt === null) throw new Error("Select an adjustment date.");
      const adjustmentId = crypto.randomUUID();
      const value: MoneyAdjustmentPayload = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        adjustmentId,
        adjustmentType: action,
        amountMinor,
        currency: invoice.value.currency,
        reason: reason.trim(),
        evidenceRef: evidenceRef.trim(),
        occurredAt,
        expectedInvoiceHeadEventId: invoice.event.id,
      };
      const template = moneyRecordTemplate(
        KIND_MONEY_ADJUSTMENT,
        value,
        moneyAdjustmentDTag(value.clientId, adjustmentId),
      );
      await submit.mutateAsync(template);
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>
            {noRefundableBalance
              ? "No refundable balance"
              : action === "refund"
                ? "Record a refund already paid"
                : "Create credit note"}
          </DialogTitle>
          <DialogDescription>
            {noRefundableBalance
              ? "Record the credit note or overpayment first. A refund cannot exceed the client credit balance."
              : action === "refund"
                ? "This records evidence for a completed refund. No refund is sent."
                : "A credit note reduces the invoiced amount; it does not return a payment."}
          </DialogDescription>
        </DialogHeader>
        <form className="money-form" onSubmit={(event) => void save(event)}>
          {noRefundableBalance ? (
            <DialogFooter>
              <W10Button
                onClick={() => onOpenChange(false)}
                variant="secondary"
              >
                Close
              </W10Button>
              <W10Button
                onClick={() => onActionChange("credit_note")}
                type="button"
                variant="primary"
              >
                Create credit note
              </W10Button>
            </DialogFooter>
          ) : (
            <>
              <label>
                <span>Invoice</span>
                <select
                  onChange={(event) => {
                    setInvoiceId(event.currentTarget.value);
                    setAmount("");
                    setDate(currentDate());
                    setReason("");
                    setEvidenceRef("");
                    setRefundEvidenceConfirmed(false);
                    setError("");
                  }}
                  required
                  value={invoiceId}
                >
                  {eligibleInvoices.map(({ value }) => (
                    <option key={value.invoiceId} value={value.invoiceId}>
                      {value.invoiceId} ·{" "}
                      {clientNames.get(value.clientId) ?? value.clientId}
                      {action === "refund"
                        ? ` · available ${formatMoneyMinor(creditAvailableForRefund(value), value.currency)}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              {invoice ? (
                <>
                  <label>
                    <span>
                      {action === "refund" ? "Refund amount" : "Credit amount"}{" "}
                      · {invoice.value.currency}
                    </span>
                    <input
                      inputMode="decimal"
                      onChange={(event) => setAmount(event.currentTarget.value)}
                      required
                      value={amount}
                    />
                  </label>
                  <label>
                    <span>
                      {action === "refund" ? "Payment date" : "Credit date"}
                    </span>
                    <input
                      onChange={(event) => setDate(event.currentTarget.value)}
                      required
                      type="date"
                      value={date}
                    />
                  </label>
                  <label>
                    <span>Reason</span>
                    <textarea
                      onChange={(event) => setReason(event.currentTarget.value)}
                      required
                      rows={3}
                      value={reason}
                    />
                  </label>
                  <label>
                    <span>
                      {action === "refund"
                        ? "Payment reference"
                        : "Evidence reference"}
                    </span>
                    <input
                      onChange={(event) =>
                        setEvidenceRef(event.currentTarget.value)
                      }
                      required
                      value={evidenceRef}
                    />
                  </label>
                  {action === "refund" ? (
                    <label className="money-checkbox-field">
                      <input
                        checked={refundEvidenceConfirmed}
                        onChange={(event) =>
                          setRefundEvidenceConfirmed(
                            event.currentTarget.checked,
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        I have evidence that this refund was paid outside
                        Colony.
                      </span>
                    </label>
                  ) : null}
                </>
              ) : null}
              {!canManage ? (
                <p className="money-note">
                  Only client owners and admins can manage money records.
                </p>
              ) : null}
              {error ? (
                <p className="money-form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <W10Button
                  onClick={() => onOpenChange(false)}
                  variant="secondary"
                >
                  Cancel
                </W10Button>
                <W10Button
                  disabled={!canManage || !invoice || submit.isPending}
                  type="submit"
                  variant="primary"
                >
                  {action === "refund" ? "Record refund" : "Create credit note"}
                </W10Button>
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDraftDialog({
  canManage,
  invoice,
  records,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  invoice: EventRecord<MoneyInvoiceHead> | null;
  records: MoneyWorkspaceRecords;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const followUp = invoice
    ? (records.followUpHeads.find(
        ({ value }) => value.invoiceId === invoice.value.invoiceId,
      ) ?? null)
    : null;
  const [to, setTo] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const submit = useSubmitBusinessRecordMutation();
  React.useEffect(() => {
    if (open && invoice) {
      setTo("");
      setSubject(`Invoice ${invoice.value.invoiceId} · balance reminder`);
      setMessage(
        `A reminder that ${formatMoneyMinor(invoice.value.outstandingMinor, invoice.value.currency)} remains on invoice ${invoice.value.invoiceId}, due ${formatTimestamp(invoice.value.dueAt)}. Please let us know if you need a copy of the invoice.`,
      );
      setError("");
    }
  }, [invoice, open]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    try {
      const followUpId = crypto.randomUUID();
      const value: MoneyFollowUpPayload = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        followUpId,
        action: "draft",
        expectedHeadEventId: null,
        expectedInvoiceHeadEventId: invoice.event.id,
        dueAt: null,
        draftContent: `To: ${to.trim()}\nSubject: ${subject.trim()}\n\n${message.trim()}`,
      };
      const template = moneyRecordTemplate(
        KIND_MONEY_FOLLOW_UP,
        value,
        moneyFollowUpDTag(value.clientId, followUpId),
      );
      await submit.mutateAsync(template);
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open && invoice !== null}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>
            {followUp ? "Payment reminder draft" : "Prepare payment reminder"}
          </DialogTitle>
          <DialogDescription>
            {followUp
              ? "Saved draft only. No reminder is sent."
              : "This saves a draft only. No reminder is sent."}
          </DialogDescription>
        </DialogHeader>
        {followUp ? (
          <pre className="money-follow-up-draft">
            {followUp.value.draftContent}
          </pre>
        ) : (
          <form className="money-form" onSubmit={(event) => void save(event)}>
            <label>
              <span>To</span>
              <input
                autoComplete="email"
                onChange={(event) => setTo(event.currentTarget.value)}
                required
                type="email"
                value={to}
              />
            </label>
            <label>
              <span>Subject</span>
              <input
                onChange={(event) => setSubject(event.currentTarget.value)}
                required
                value={subject}
              />
            </label>
            <label>
              <span>Message</span>
              <textarea
                onChange={(event) => setMessage(event.currentTarget.value)}
                required
                rows={5}
                value={message}
              />
            </label>
            {!canManage ? (
              <p className="money-note">
                Only client owners and admins can prepare follow-ups.
              </p>
            ) : null}
            {error ? (
              <p className="money-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <W10Button
                onClick={() => onOpenChange(false)}
                variant="secondary"
              >
                Cancel
              </W10Button>
              <W10Button
                disabled={!canManage || submit.isPending}
                type="submit"
                variant="primary"
              >
                Save reminder draft
              </W10Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
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

function filterInvoiceRecords(
  invoices: EventRecord<MoneyInvoiceHead>[],
  period: string,
  clientId: string,
) {
  return invoices.filter(
    ({ event, value }) =>
      (clientId === "all" || value.clientId === clientId) &&
      periodForTimestamp(value.issuedAt ?? event.created_at) === period,
  );
}

function formatCurrencyTotals(
  amounts: Record<string, number>,
): React.ReactNode {
  const entries = Object.entries(amounts)
    .filter(([, amount]) => amount !== 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "-";
  return (
    <span className="money-currency-totals">
      {entries.map(([currency, amount]) => (
        <span key={currency}>{formatMoneyMinor(amount, currency)}</span>
      ))}
    </span>
  );
}

function sumAdjustments(
  adjustments: MoneyWorkspaceRecords["adjustments"],
  type: MoneyAdjustmentPayload["adjustmentType"],
) {
  return adjustments.reduce(
    (total, { value }) =>
      total + (value.adjustmentType === type ? value.amountMinor : 0),
    0,
  );
}

function creditAvailableForRefund(invoice: MoneyInvoiceHead) {
  const remainingObligation = Math.max(
    0,
    invoice.totalMinor - invoice.creditedMinor - invoice.writtenOffMinor,
  );
  return Math.max(0, invoice.collectedMinor - remainingObligation);
}

function lineTotalMinor(line: InvoiceLine) {
  const total =
    (BigInt(line.quantityHundredths) * BigInt(line.unitAmountMinor)) / 100n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BusinessRecordParseError(
      "invoice line amount exceeds the safe display range",
    );
  }
  return Number(total);
}

function totalLinesMinor(lines: readonly InvoiceLine[]) {
  const total = lines.reduce(
    (sum, line) => sum + BigInt(lineTotalMinor(line)),
    0n,
  );
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invoice total exceeds the supported display range.");
  }
  return Number(total);
}

function updateLine(
  setLines: React.Dispatch<React.SetStateAction<InvoiceLineDraft[]>>,
  index: number,
  patch: Partial<InvoiceLineDraft>,
) {
  setLines((current) =>
    current.map((line, currentIndex) =>
      currentIndex === index ? { ...line, ...patch } : line,
    ),
  );
}

function invoiceLineDraft(
  line: InvoiceLine,
  currency: string,
): InvoiceLineDraft {
  return {
    draftKey: crypto.randomUUID(),
    serviceId: line.serviceId,
    description: line.description,
    quantityInput: quantityInput(line.quantityHundredths),
    amountInput: decimalInput(line.unitAmountMinor, currency),
  };
}

function invoiceLineRenderKey(
  line: InvoiceLine,
  lines: InvoiceLine[],
  index: number,
) {
  const canonical = JSON.stringify([
    line.serviceId,
    line.description,
    line.quantityHundredths,
    line.unitAmountMinor,
  ]);
  const duplicateOrdinal = lines
    .slice(0, index)
    .filter(
      (candidate) =>
        JSON.stringify([
          candidate.serviceId,
          candidate.description,
          candidate.quantityHundredths,
          candidate.unitAmountMinor,
        ]) === canonical,
    ).length;
  return `${canonical}:${duplicateOrdinal}`;
}

function quantityInput(quantityHundredths: number) {
  const whole = Math.floor(quantityHundredths / 100);
  const remainder = quantityHundredths % 100;
  if (remainder === 0) return whole.toString();
  return `${whole}.${remainder.toString().padStart(2, "0").replace(/0+$/, "")}`;
}

function parseQuantityInput(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error("Enter a positive quantity with up to two decimal places.");
  }
  const hundredths =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (hundredths <= 0n || hundredths > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Enter a positive quantity with up to two decimal places.");
  }
  return Number(hundredths);
}

function decimalInput(amountMinor: number, currency: string) {
  const digits =
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const absolute = BigInt(amountMinor);
  const whole = absolute / scale;
  if (digits === 0) return whole.toString();
  const remainder = absolute % scale;
  const fraction = remainder
    .toString()
    .padStart(digits, "0")
    .replace(/0+$/, "");
  if (!fraction) return whole.toString();
  return `${whole}.${fraction}`;
}

function moneyStep(currency: string) {
  const digits =
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodForTimestamp(timestamp: number) {
  const date = new Date(timestamp * 1_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatTimestamp(timestamp: number | null) {
  if (timestamp === null) return "-";
  const date = new Date(timestamp * 1_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateInput(timestamp: number | null) {
  if (timestamp === null) return "";
  const date = new Date(timestamp * 1_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timestampFromDateInput(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(`${value}T12:00:00`).getTime() / 1_000;
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new Error("Choose a valid date.");
  return timestamp;
}

function currentDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isOverdue(invoice: MoneyInvoiceHead) {
  return (
    invoice.status === "issued" &&
    invoice.outstandingMinor > 0 &&
    invoice.dueAt !== null &&
    invoice.dueAt < Math.floor(Date.now() / 1_000)
  );
}

function displayError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The money record could not be saved. Your entered values are still here. Retry when the connection is available.";
}

function navigateMoney(path: string) {
  window.location.hash = `#${path}`;
}
