import { useMoneyRecordsQuery } from "@/features/clients/useBusinessRecords";
import {
  W10Error,
  W10Loading,
  W10Page,
} from "@/features/discovery/BusinessCommon";
import {
  deriveMoneyTotals,
  formatMoneyMinor,
  type MoneyWorkspaceRecords,
} from "./lib/moneyRecords";
import { currentPeriod, displayError, periodForTimestamp } from "./moneyUtils";
import "@/features/discovery/business-records.css";
import "./money.css";
import "./money-sources.css";

export type MoneySourceRouteState = "unavailable" | "partial" | "recovered";

export function MoneySourceRouteScreen({
  family,
  state,
}: {
  family: "costs" | "profitability";
  state: MoneySourceRouteState;
}) {
  const query = useMoneyRecordsQuery();
  const directory = query.directoryQuery;
  if (directory.isPending || query.isPending) {
    return <W10Loading label="Loading money source records" />;
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

  const records = query.data;
  if (!records) return <W10Loading label="Loading money source records" />;

  return (
    <MoneySourceContent family={family} records={records} routeState={state} />
  );
}

function MoneySourceContent({
  family,
  records,
  routeState,
}: {
  family: "costs" | "profitability";
  records: MoneyWorkspaceRecords;
  routeState: MoneySourceRouteState;
}) {
  const period = currentPeriod();
  const totals = deriveMoneyTotals(
    records,
    period,
    null,
    Math.floor(Date.now() / 1_000),
  );
  const issuedInvoicesInPeriod = records.invoiceHeads.some(
    ({ event, value }) =>
      value.status === "issued" &&
      periodForTimestamp(value.issuedAt ?? event.created_at) === period,
  );
  const derivedState =
    family === "profitability" && issuedInvoicesInPeriod
      ? "partial"
      : "unavailable";
  const title = family === "costs" ? "Costs" : "Profitability";
  const revenueAvailable = issuedInvoicesInPeriod;

  return (
    <W10Page wide testId={`money-${family}-page`}>
      <header className="w10-page-heading money-page-heading money-source-heading">
        <h1>{title}</h1>
      </header>
      <section
        aria-label="Cost source status"
        className="money-source-status-card"
        data-derived-state={derivedState}
      >
        <strong>
          {derivedState === "partial" ? "Partial data" : "Unavailable"}
        </strong>
        <span>
          {revenueAvailable
            ? "Revenue is available from issued invoices, but no cost records are available. Profit cannot be calculated reliably."
            : "No issued invoice or cost records are available for this period."}
        </span>
      </section>
      <section
        aria-label="Revenue, costs and profit"
        className="money-source-metrics"
        data-derived-state={derivedState}
        data-route-state={routeState}
      >
        <div className="money-source-metric">
          <span>Revenue</span>
          <strong>
            {revenueAvailable
              ? formatCurrencyValues(totals.invoicedMinorByCurrency)
              : "Unavailable"}
          </strong>
          <small>
            {revenueAvailable
              ? "Derived from issued invoices in your client records."
              : "No issued invoice records are available for this period."}
          </small>
        </div>
        <div className="money-source-metric">
          <span>Known costs</span>
          <strong>Unavailable</strong>
          <small>No cost records are available.</small>
        </div>
        <div className="money-source-metric">
          <span>Profit</span>
          <strong>Unavailable</strong>
          <small>Profit needs source-backed cost records.</small>
        </div>
      </section>
      <section className="money-source-list">
        <h2>Cost sources</h2>
        <p>No cost source records are available for this workspace.</p>
        {family === "profitability" ? (
          <p>Profitability unavailable until cost records are available.</p>
        ) : null}
      </section>
    </W10Page>
  );
}

function formatCurrencyValues(amounts: Record<string, number>) {
  const values = Object.entries(amounts).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (values.length === 0) return "0";
  return values
    .map(([currency, amount]) => formatMoneyMinor(amount, currency))
    .join(" · ");
}
