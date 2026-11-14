import * as React from "react";

import { useRouteOrigin } from "@/app/navigation/RouteOriginContext";
import type { EventRecord } from "@/features/clients/lib/businessRecords";
import { useMoneyRecordsQuery } from "@/features/clients/useBusinessRecords";
import { useBusinessRecords } from "@/features/discovery/useBusinessRecords";
import {
  StateButton,
  StateCard,
  StateIcons,
  RetryIcon,
} from "@/features/clients/ui/BusinessStates";
import { PlusIcon } from "@/features/clients/ui/BusinessBits";
import { ClientWorkspace } from "@/features/clients/ui/ClientWorkspace";
import { RecordMessage } from "@/features/clients/ui/ClientWorkspace";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { MoneyInvoiceDetail } from "./MoneyInvoiceDetail";
import { InvoiceCreateDialog } from "./MoneyInvoiceCreateDialog";
import { MoneyInvoiceList, MoneyStatusChips } from "./MoneyInvoiceList";
import { MoneyOverview } from "./MoneyOverview";
import {
  deriveMoneyTotals,
  type MoneyInvoiceHead,
  type MoneyWorkspaceRecords,
} from "./lib/moneyRecords";
import {
  currentPeriod,
  displayError,
  filterInvoiceRecords,
  formatPeriod,
  invoiceChips,
  invoiceNumber,
  navigateMoney,
  periodForTimestamp,
  periodRange,
  type InvoiceChip,
} from "./moneyUtils";
import "./colony3-money.css";

export type MoneySection =
  | "overview"
  | "revenue"
  | "revenue-invoice"
  | "invoices"
  | "invoice";

const SUBTITLES = {
  overview: "Invoices and payments recorded in your client channels.",
  revenue: "Issued invoices only. Drafts don’t count as revenue.",
  invoices: "Drafts, issued and void invoices across your client channels.",
} as const;

const TITLES = {
  overview: "Money",
  revenue: "Revenue",
  invoices: "Invoices",
} as const;

export function MoneyRouteScreen({
  section,
  invoiceId,
}: {
  section: MoneySection;
  invoiceId?: string;
}) {
  const routeOrigin = useRouteOrigin();
  const restored = routeOrigin.pageSnapshot?.viewState as
    | {
        chosenPeriod?: string | null;
        clientId?: string;
        statusFilter?: InvoiceChip | "all";
      }
    | undefined;
  const query = useMoneyRecordsQuery();
  const salesRecords = useBusinessRecords({ createIfMissing: false });
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
  const clientLogos = React.useMemo(() => {
    const prospectByPartyId = new Map(
      (salesRecords.records?.prospects ?? []).map(({ record }) => [
        record.prospect.party.partyId,
        record.prospect,
      ]),
    );
    return new Map(
      clients.flatMap(({ value }) => {
        const prospect = prospectByPartyId.get(value.partyId);
        return value.clientId && prospect
          ? [
              [
                value.clientId,
                {
                  website: prospect.website,
                  logoUrl: prospect.logoUrl ?? null,
                  placePhotoUrl: prospect.placePhotoUrl ?? null,
                },
              ] as const,
            ]
          : [];
      }),
    );
  }, [clients, salesRecords.records?.prospects]);
  const [chosenPeriod, setPeriod] = React.useState<string | null>(
    restored?.chosenPeriod ?? null,
  );
  const [clientId, setClientId] = React.useState(restored?.clientId ?? "all");
  const [statusFilter, setStatusFilter] = React.useState<InvoiceChip | "all">(
    restored?.statusFilter ?? "all",
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  const records = query.data;

  React.useEffect(() => {
    if (section === "invoice" || section === "revenue-invoice") return;
    const label =
      section === "overview"
        ? "Money"
        : section === "revenue"
          ? "All revenue"
          : "All invoices";
    const breadcrumbs =
      section === "overview"
        ? ["Business", "Money"]
        : ["Business", "Money", section === "revenue" ? "Revenue" : "Invoices"];
    const save = () =>
      routeOrigin.savePageSnapshot({
        backLabel: label,
        breadcrumbs,
        viewState: { chosenPeriod, clientId, statusFilter },
        scrollY: window.scrollY,
      });
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [
    chosenPeriod,
    clientId,
    routeOrigin.savePageSnapshot,
    section,
    statusFilter,
  ]);

  React.useEffect(() => {
    const scrollY = routeOrigin.pageSnapshot?.scrollY;
    if (typeof scrollY !== "number" || scrollY <= 0) return;
    requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
  }, [routeOrigin.pageSnapshot?.scrollY]);

  if (directory.isPending || query.isPending) {
    return (
      <ClientWorkspace title="Money">
        <RecordMessage kind="loading">Loading money records</RecordMessage>
      </ClientWorkspace>
    );
  }
  const failed = directory.isError ? directory : query.isError ? query : null;
  if (failed) {
    return (
      <ClientWorkspace title="Money">
        <StateCard
          actions={
            <StateButton
              disabled={failed.isFetching}
              onClick={() => void failed.refetch()}
            >
              <RetryIcon />
              Retry
            </StateButton>
          }
          body={displayError(failed.error)}
          eyebrow="Money"
          icon={StateIcons.offline}
          role="alert"
          title="Connection unavailable"
          tone="bad"
        />
      </ClientWorkspace>
    );
  }
  if (!records) {
    return (
      <ClientWorkspace title="Money">
        <RecordMessage kind="loading">Loading money records</RecordMessage>
      </ClientWorkspace>
    );
  }

  if (section === "invoice" || section === "revenue-invoice") {
    const invoice = invoiceId
      ? records.invoiceHeads.find(({ value }) => value.invoiceId === invoiceId)
      : null;
    return invoice ? (
      <MoneyInvoiceDetail
        canManage={canManage}
        clientNames={clientNames}
        fromRevenue={section === "revenue-invoice"}
        invoice={invoice}
        records={records}
      />
    ) : (
      <ClientWorkspace title="Money">
        <StateCard
          actions={
            <StateButton href="#/money/invoices">All invoices</StateButton>
          }
          body="This invoice is not available in your client records."
          eyebrow="Invoice"
          icon={StateIcons.missing}
          role="alert"
          title="Invoice unavailable"
        />
      </ClientWorkspace>
    );
  }

  const listSection = section as "overview" | "revenue" | "invoices";
  const periods = periodOptions(records, listSection);
  const period =
    chosenPeriod && periods.includes(chosenPeriod)
      ? chosenPeriod
      : (periods.find((value) => value.includes("..")) ?? currentPeriod());
  const visibleRecords = filterInvoiceRecords(
    records.invoiceHeads,
    period,
    clientId,
  ).sort(compareInvoices);
  const selectedClientId = clientId === "all" ? null : clientId;
  const singleMonth = period.includes("..") ? currentPeriod() : period;
  const totals = deriveMoneyTotals(
    records,
    singleMonth,
    selectedClientId,
    Math.floor(Date.now() / 1_000),
  );

  return (
    <ClientWorkspace
      action={
        listSection === "invoices" && canManage && clients.length > 0 ? (
          <button
            className="b3-btn"
            data-variant="primary"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            <PlusIcon />
            New invoice
          </button>
        ) : undefined
      }
      gap={24}
      subtitle={SUBTITLES[listSection]}
      title={TITLES[listSection]}
    >
      <MoneyNavigation section={listSection} />
      <MoneyFilters
        clientId={clientId}
        clients={clients}
        onClientChange={setClientId}
        onPeriodChange={setPeriod}
        period={period}
        periods={periods}
      >
        {listSection === "invoices" ? (
          <MoneyStatusChips
            invoices={visibleRecords}
            onChange={setStatusFilter}
            value={statusFilter}
          />
        ) : null}
      </MoneyFilters>
      {listSection === "overview" ? (
        <MoneyOverview
          clientLogos={clientLogos}
          clientNames={clientNames}
          clientId={clientId}
          invoices={visibleRecords}
          period={period}
          records={records}
          totals={totals}
        />
      ) : (
        <MoneyInvoiceList
          clientNames={clientNames}
          fromRevenue={listSection === "revenue"}
          invoices={visibleRecords.filter(({ value }) =>
            listSection === "revenue"
              ? value.status === "issued"
              : statusFilter === "all" ||
                invoiceChips(value).includes(statusFilter),
          )}
          records={records}
        />
      )}
      <InvoiceCreateDialog
        canManage={canManage}
        clients={clients
          .filter(({ value }) => value.status !== "archived")
          .map(({ value }) => ({
            clientId: value.clientId,
            displayName: value.displayName,
          }))}
        currency={records.invoiceHeads[0]?.value.currency}
        onCreated={(invoiceId) => navigateMoney(`/money/invoice/${invoiceId}`)}
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
    </ClientWorkspace>
  );
}

/** Drafts first, then newest issue date; ties fall to the invoice reference. */
function compareInvoices(
  left: EventRecord<MoneyInvoiceHead>,
  right: EventRecord<MoneyInvoiceHead>,
) {
  const draft = (record: EventRecord<MoneyInvoiceHead>) =>
    record.value.status === "draft" ? 1 : 0;
  return (
    draft(right) - draft(left) ||
    (right.value.issuedAt ?? right.event.created_at) -
      (left.value.issuedAt ?? left.event.created_at) ||
    invoiceNumber(right.value.invoiceId).localeCompare(
      invoiceNumber(left.value.invoiceId),
    )
  );
}

/** Months with records, newest first; the invoice list also offers the span. */
function periodOptions(
  records: MoneyWorkspaceRecords,
  section: "overview" | "revenue" | "invoices",
): string[] {
  const months = new Set([currentPeriod()]);
  const dataMonths = new Set<string>();
  for (const { event, value } of records.invoiceHeads) {
    dataMonths.add(periodForTimestamp(value.issuedAt ?? event.created_at));
  }
  for (const { value } of [...records.payments, ...records.adjustments]) {
    dataMonths.add(periodForTimestamp(value.occurredAt));
  }
  for (const month of dataMonths) months.add(month);
  const sorted = [...months].sort().reverse();
  const span = [...dataMonths].sort();
  if (section === "invoices" && span.length > 1) {
    return [periodRange(span[0], span[span.length - 1]), ...sorted];
  }
  return sorted;
}

function MoneyNavigation({
  section,
}: {
  section: "overview" | "revenue" | "invoices";
}) {
  const tabs = [
    ["overview", "Overview", "/money"],
    ["revenue", "Revenue", "/money/revenue"],
    ["invoices", "Invoices", "/money/invoices"],
  ] as const;
  return (
    <div className="b3-tabs-row">
      <nav
        aria-label="Money views"
        className="b3-tabs"
        data-map-canvas-same-desk="true"
      >
        {tabs.map(([id, label, href]) => (
          <a
            aria-current={section === id ? "page" : undefined}
            className="b3-tab"
            href={`#${href}`}
            key={id}
          >
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}

function MoneyFilters({
  clientId,
  clients,
  onClientChange,
  onPeriodChange,
  children,
  period,
  periods,
}: {
  children?: React.ReactNode;
  clientId: string;
  clients: ReturnType<typeof useMoneyRecordsQuery>["directoryQuery"]["data"];
  onClientChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  period: string;
  periods: string[];
}) {
  const options = periods.includes(period) ? periods : [period, ...periods];
  return (
    <div className="b3-filters">
      <label className="b3-filter">
        Period
        <select
          aria-label="Money period"
          onChange={(event) => onPeriodChange(event.currentTarget.value)}
          value={period}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {formatPeriod(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="b3-filter">
        Client
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
      {children}
    </div>
  );
}
