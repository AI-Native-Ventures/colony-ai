import * as React from "react";

import type { EventRecord } from "@/features/clients/lib/businessRecords";
import { usePeople } from "@/features/clients/lib/usePeople";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  Pill,
} from "@/features/clients/ui/BusinessBits";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  formatMoneyMinor,
  type MoneyInvoiceHead,
  type MoneyWorkspaceRecords,
  type deriveMoneyTotals,
} from "./lib/moneyRecords";
import {
  clientInitials,
  formatCurrencyTotals,
  formatDisplayDate,
  invoiceNumber,
  isOverdue,
  periodMatches,
} from "./moneyUtils";

export function MoneyOverview({
  clientId,
  clientNames,
  invoices,
  period,
  records,
  totals,
}: {
  clientId: string;
  clientNames: ReadonlyMap<string, string>;
  invoices: EventRecord<MoneyInvoiceHead>[];
  period: string;
  records: MoneyWorkspaceRecords;
  totals: ReturnType<typeof deriveMoneyTotals>;
}) {
  const identityQuery = useIdentityQuery();
  const selfPubkey = identityQuery.data?.pubkey.toLowerCase() ?? "";
  const overdue = invoices.filter(({ value }) => isOverdue(value));
  const payments = React.useMemo(
    () =>
      records.payments
        .filter(
          ({ value }) =>
            (clientId === "all" || value.clientId === clientId) &&
            periodMatches(period, value.occurredAt),
        )
        .sort((left, right) => left.value.occurredAt - right.value.occurredAt),
    [clientId, period, records.payments],
  );
  const { person } = usePeople(payments.map(({ event }) => event.pubkey));
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
    <div className="b3-overview-root" data-testid="money-overview">
      <div className="b3-kpis">
        {metrics.map(([label, amounts, href, sub]) => (
          <a className="b3-card b3-kpi" href={`#${href}`} key={label}>
            <span className="b3-kpi-label">
              {label}
              <ArrowRightIcon size={17} />
            </span>
            <span className="b3-amount">{formatCurrencyTotals(amounts)}</span>
            <span className="b3-kpi-sub">{sub}</span>
          </a>
        ))}
      </div>
      <div className="b3-overview">
        <section
          aria-labelledby="money-attention"
          className="b3-card b3-attention"
        >
          <div className="b3-attention-head">
            <h2 className="b3-card-title" id="money-attention">
              Needs attention
            </h2>
          </div>
          {overdue.length ? (
            overdue.map(({ value }) => {
              const client = clientNames.get(value.clientId) ?? value.clientId;
              return (
                <a
                  className="b3-attention-row"
                  href={`#/money/invoice/${value.invoiceId}`}
                  key={value.invoiceId}
                >
                  <span aria-hidden="true" className="b3-attention-tile">
                    {clientInitials(client)}
                  </span>
                  <span className="b3-attention-copy">
                    <span className="b3-attention-title">
                      {client} ·{" "}
                      <span className="b3-tabular">
                        {formatMoneyMinor(
                          value.outstandingMinor,
                          value.currency,
                        )}
                      </span>{" "}
                      outstanding
                    </span>
                    <span className="b3-meta">
                      Invoice {invoiceNumber(value.invoiceId)} · due{" "}
                      {formatDisplayDate(value.dueAt)}
                    </span>
                  </span>
                  <Pill tone="bad">Overdue</Pill>
                  <ChevronRightIcon className="b3-muted-icon" />
                </a>
              );
            })
          ) : (
            <div className="b3-attention-empty">No overdue balances</div>
          )}
        </section>
        <section aria-labelledby="money-cash" className="b3-card b3-cash">
          <h2 className="b3-card-title" id="money-cash">
            Cash movement
          </h2>
          <div className="b3-cash-total">
            <span className="b3-eyebrow">Payments collected</span>
            <span className="b3-amount">
              {formatCurrencyTotals(totals.collectedMinorByCurrency)}
            </span>
          </div>
          {payments.length ? (
            <ul className="b3-cash-list">
              {payments.map(({ event, value }) => {
                const recorder = person(event.pubkey);
                return (
                  <li key={value.paymentId}>
                    <span className="b3-cash-who">
                      <span className="b3-cash-name">
                        {clientNames.get(value.clientId) ?? value.clientId}
                      </span>
                      <span className="b3-cash-meta">
                        Invoice {invoiceNumber(value.invoiceId)} ·{" "}
                        {formatDisplayDate(value.occurredAt)}
                        {recorder.pubkey !== selfPubkey
                          ? ` · Recorded by ${recorder.name}`
                          : ""}
                      </span>
                    </span>
                    <span className="b3-cash-amount">
                      {formatMoneyMinor(value.amountMinor, value.currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="b3-info-line">
            <svg
              aria-hidden="true"
              fill="none"
              height="17"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
              viewBox="0 0 24 24"
              width="17"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 11v5M12 8v.2" />
            </svg>
            Recorded payment evidence only. This is not a bank balance.
          </p>
        </section>
      </div>
    </div>
  );
}
