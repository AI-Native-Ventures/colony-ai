import * as React from "react";

import type { EventRecord } from "@/features/clients/lib/businessRecords";
import { usePeople } from "@/features/clients/lib/usePeople";
import {
  PersonAvatar,
  Pill,
  type PillTone,
} from "@/features/clients/ui/BusinessBits";
import { StateCard, StateIcons } from "@/features/clients/ui/BusinessStates";
import {
  formatMoneyMinor,
  type MoneyInvoiceHead,
  type MoneyWorkspaceRecords,
} from "./lib/moneyRecords";
import {
  formatDisplayDate,
  INVOICE_CHIP_LABELS,
  invoiceChips,
  invoiceNumber,
  isOverdue,
  navigateMoney,
  periodForTimestamp,
  formatPeriod,
  type InvoiceChip,
} from "./moneyUtils";

const CHIP_TONES: Record<InvoiceChip, PillTone | "void"> = {
  draft: "default",
  awaiting: "info",
  part: "need",
  overdue: "bad",
  paid: "ok",
  void: "void",
};

const CHIP_ORDER: InvoiceChip[] = [
  "draft",
  "awaiting",
  "part",
  "overdue",
  "paid",
  "void",
];

/** Status filter chips with counts; an invoice can count under two (part paid and overdue). */
export function MoneyStatusChips({
  invoices,
  onChange,
  value,
}: {
  invoices: EventRecord<MoneyInvoiceHead>[];
  onChange: (value: InvoiceChip | "all") => void;
  value: InvoiceChip | "all";
}) {
  const counts = new Map<InvoiceChip, number>();
  for (const { value: invoice } of invoices) {
    for (const chip of invoiceChips(invoice)) {
      counts.set(chip, (counts.get(chip) ?? 0) + 1);
    }
  }
  return (
    <fieldset className="b3-status-chips">
      <legend className="b3-sr-only">Status</legend>
      <button
        aria-pressed={value === "all"}
        className="b3-status-chip"
        data-tone="all"
        onClick={() => onChange("all")}
        type="button"
      >
        All {invoices.length}
      </button>
      {CHIP_ORDER.map((chip) => (
        <button
          aria-pressed={value === chip}
          className="b3-status-chip"
          data-tone={CHIP_TONES[chip]}
          key={chip}
          onClick={() => onChange(chip)}
          type="button"
        >
          {INVOICE_CHIP_LABELS[chip]} {counts.get(chip) ?? 0}
        </button>
      ))}
    </fieldset>
  );
}

export function InvoiceStatusPills({ invoice }: { invoice: MoneyInvoiceHead }) {
  return (
    <>
      {invoiceChips(invoice).map((chip) => (
        <Pill
          key={chip}
          tone={CHIP_TONES[chip] === "void" ? "default" : CHIP_TONES[chip]}
        >
          {INVOICE_CHIP_LABELS[chip]}
        </Pill>
      ))}
    </>
  );
}

/** The pubkey that issued an invoice: the author of its issue version. */
export function invoiceIssuer(
  records: MoneyWorkspaceRecords,
  invoiceId: string,
): string | null {
  const issue = records.invoiceVersions
    .filter(
      ({ value }) => value.invoiceId === invoiceId && value.action === "issue",
    )
    .sort((left, right) => right.value.version - left.value.version)[0];
  return issue?.event.pubkey.toLowerCase() ?? null;
}

export function MoneyInvoiceList({
  clientNames,
  fromRevenue,
  invoices,
  records,
}: {
  clientNames: ReadonlyMap<string, string>;
  fromRevenue: boolean;
  invoices: EventRecord<MoneyInvoiceHead>[];
  records: MoneyWorkspaceRecords;
}) {
  const issuers = React.useMemo(
    () =>
      new Map(
        invoices.map(({ value }) => [
          value.invoiceId,
          invoiceIssuer(records, value.invoiceId),
        ]),
      ),
    [invoices, records],
  );
  const { person } = usePeople(
    [...issuers.values()].filter(Boolean) as string[],
  );
  const groups = React.useMemo(() => {
    const byMonth = new Map<string, EventRecord<MoneyInvoiceHead>[]>();
    for (const record of invoices) {
      const month = periodForTimestamp(
        record.value.issuedAt ?? record.event.created_at,
      );
      byMonth.set(month, [...(byMonth.get(month) ?? []), record]);
    }
    return [...byMonth.entries()].sort(([left], [right]) =>
      right.localeCompare(left),
    );
  }, [invoices]);
  const title = fromRevenue ? "Revenue" : "Invoices";
  const detailRoute = fromRevenue ? "revenue" : "invoice";

  return (
    <section
      aria-labelledby="money-invoice-table"
      className="b3-card b3-invoice-card"
      data-testid="money-invoice-list"
    >
      <div className="b3-invoice-card-head">
        <h2 className="b3-card-title" id="money-invoice-table">
          {title}
        </h2>
        <span>{invoices.length} records</span>
      </div>
      {invoices.length === 0 ? (
        <div className="b3-invoice-empty">
          <StateCard
            body="Change the period or client to find other invoices."
            eyebrow="Invoices"
            icon={StateIcons.document}
            title="No invoices for this selection"
            tone="accent"
          />
        </div>
      ) : (
        <>
          <div className="b3-invoice-scroll">
            <table aria-label="Invoices" className="b3-invoices">
              <colgroup>
                <col style={{ width: "22.4%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th className="b3-eyebrow" scope="col">
                    Invoice / service
                  </th>
                  <th className="b3-eyebrow" scope="col">
                    Client
                  </th>
                  <th className="b3-eyebrow" scope="col">
                    Issued / due
                  </th>
                  <th className="b3-eyebrow" data-align="end" scope="col">
                    Amount
                  </th>
                  <th className="b3-eyebrow" data-align="end" scope="col">
                    Collected
                  </th>
                  <th className="b3-eyebrow" data-align="end" scope="col">
                    Balance
                  </th>
                  <th className="b3-eyebrow" scope="col">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([month, rows], groupIndex) => (
                  <React.Fragment key={month}>
                    <tr
                      className="b3-invoice-month"
                      data-later={groupIndex > 0}
                    >
                      <th colSpan={7} scope="colgroup">
                        {formatPeriod(month)}
                      </th>
                    </tr>
                    {rows.map(({ value }) => {
                      const issuerPubkey = issuers.get(value.invoiceId) ?? null;
                      const issuer = issuerPubkey ? person(issuerPubkey) : null;
                      const overdue = isOverdue(value);
                      const href = `#/money/${detailRoute}/${value.invoiceId}`;
                      return (
                        <tr
                          className="b3-invoice-row"
                          key={value.invoiceId}
                          onClick={(clickEvent) => {
                            if (!(clickEvent.target as Element).closest("a")) {
                              navigateMoney(
                                `/money/${detailRoute}/${value.invoiceId}`,
                              );
                            }
                          }}
                        >
                          <td>
                            <span className="b3-invoice-name">
                              <a className="b3-invoice-link" href={href}>
                                Invoice {invoiceNumber(value.invoiceId)}
                              </a>
                              <span className="b3-invoice-service">
                                {value.lines
                                  .map((line) => line.description)
                                  .join(" · ")}
                              </span>
                            </span>
                          </td>
                          <td className="b3-invoice-client">
                            {clientNames.get(value.clientId) ?? value.clientId}
                          </td>
                          <td>
                            <span className="b3-invoice-dates">
                              <span className="b3-invoice-issued">
                                {value.issuedAt === null
                                  ? "Not issued"
                                  : formatDisplayDate(value.issuedAt)}
                              </span>
                              {value.dueAt === null ? (
                                value.status === "draft" ? (
                                  <span
                                    className="b3-invoice-due"
                                    data-tone="need"
                                  >
                                    No due date
                                  </span>
                                ) : null
                              ) : (
                                <span
                                  className="b3-invoice-due"
                                  data-tone={overdue ? "bad" : undefined}
                                >
                                  Due {formatDisplayDate(value.dueAt)}
                                  {overdue ? " · overdue" : ""}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="b3-invoice-num">
                            {formatMoneyMinor(value.totalMinor, value.currency)}
                          </td>
                          <MoneyAmountCell
                            amount={value.collectedMinor}
                            currency={value.currency}
                            regular
                          />
                          <MoneyAmountCell
                            amount={
                              value.status === "draft"
                                ? 0
                                : value.outstandingMinor
                            }
                            currency={value.currency}
                          />
                          <td>
                            <span className="b3-invoice-status">
                              <span className="b3-invoice-status-chips">
                                <InvoiceStatusPills invoice={value} />
                              </span>
                              {value.status !== "draft" && issuer ? (
                                <span className="b3-issuer">
                                  <PersonAvatar person={issuer} size={16} />
                                  Issued by {issuer.name}
                                </span>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="b3-footnote">
            Drafts don’t count as revenue. Void invoices stay visible and are
            excluded from revenue.
          </p>
        </>
      )}
    </section>
  );
}

function MoneyAmountCell({
  amount,
  currency,
  regular = false,
}: {
  amount: number;
  currency: string;
  regular?: boolean;
}) {
  if (amount === 0) {
    return (
      <td aria-label="None" className="b3-invoice-num" data-empty="true">
        –
      </td>
    );
  }
  return (
    <td
      className="b3-invoice-num"
      data-weight={regular ? "regular" : undefined}
    >
      {formatMoneyMinor(amount, currency)}
    </td>
  );
}
